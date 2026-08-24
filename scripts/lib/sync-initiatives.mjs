/**
 * Pure logic for the initiatives sync — shaping, key derivation, the reconcile
 * diff, and the safety gate.
 *
 * Split from scripts/sync-initiatives.mjs for the same reason sync-contracts.mjs
 * and sync-projects.mjs were split: the entry point needs live Google and AWS
 * credentials, and everything worth testing here is a pure function of its
 * inputs. The delete path in particular must be unit-testable — a wrong diff
 * destroys real data and the failure is invisible until someone notices missing
 * initiatives.
 *
 * Nothing in this file performs I/O.
 */

// This module is deliberately free of imports: it is the pure layer, and the record
// types and attribute names it would otherwise borrow live in
// functions/api/lib/initiatives.mjs, which the apply layer imports directly. The
// dependency direction is one-way and forced — the API Lambda zip is built from
// functions/api/ alone, so nothing there may import from scripts/, while scripts/
// importing from there is fine. tests/sync-initiatives-lib.test.mjs asserts that
// slugAttribute reproduces that module's attribute-name constants, which is what
// keeps the two in agreement without a runtime coupling.

export class SyncInitiativesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncInitiativesError';
  }
}

// The tab this sync reads. The workbook holds four; the CLI looks this title up
// among them rather than reading an index, so a reordered workbook is a no-op and
// a renamed tab fails loudly.
//
// Reading titles[0] was the previous rule and is not safe here. The workbook was
// reorganized around v2 on 2026-08-24: this tab moved to index 0 and the former
// source tab was renamed "OLD: v1 from initiatives.json". Index 0 happens to be
// correct right now, which is exactly the kind of coincidence that turns into a
// silent import of the wrong tab later.
export const EXPECTED_TAB_TITLE = 'v2';

// 0-based grid index, NOT a sheet row number. VERIFIED against the v2 tab on
// 2026-08-24 rather than assumed: it genuinely starts with its headers at the
// top, with no title banner and no spacer. Its two siblings do not — the projects
// tab needs row 6 and the contracts tab row 2 — so the absence of an offset here
// is a measurement, not an oversight.
export const HEADER_ROW = 0;

// The column the initiative id is built from.
//
// The workbook now populates an `id` column: 46 values, all distinct, all already
// lowercase `[a-z0-9-]` so slugInitiativeId is a no-op on them. That is the
// property a key needs and prose never had.
//
// The values are AUTHOR-PREFIXED and not uniform — `init-2` … `init-38` on the 37
// rows carried over from the v1 tab, `ryan-39` … `ryan-47` on the 9 added since,
// a continuous 2–47 sequence under two prefixes. Nothing here depends on the
// prefix; it is noted because a reader who assumes one prefix will misread the
// table, and because a third contributor will presumably add a third.
//
// This REPLACES a title-derived key, and the change retires a real cost rather
// than trading one for another. Under the old rule, retitling an initiative
// re-keyed its record: the reconcile read it as a delete plus a create,
// `first_seen_at` did not survive, and the detail URL changed. None of that is
// true any more — a retitle is now an ordinary update.
//
// What replaces it as the mass-re-key risk is the id sequence itself: a gapless
// 2–47 run, which is what a position-generated column looks like. Renumbering or
// re-sorting it would re-key every row at an unchanged row count.
// MAX_DELETE_FRACTION is what catches that; see its note below.
//
// A list rather than a bare string, matching sync-contracts.mjs, so adding a
// second column later is a data change rather than a rewrite.
export const ID_COLUMNS = ['id'];

// Headers deliberately NOT carried into storage.
//
// `id` is here because it is the KEY SOURCE. Carrying it too would put
// `initiative_id` and an identical `id` on all 46 records, leaving a reader two
// candidate keys and no rule for choosing between them. ID_COLUMNS reads the raw
// header row directly, so excluding it from the carry does not stop it keying.
//
// One consequence worth knowing: the blank-row test below asks whether any
// CARRIED cell is populated, so a row holding only an id and nothing else counts
// as blank and is skipped. That is the intended reading of such a row, and a test
// pins it so it stays a choice rather than an accident.
//
// Kept as a denylist rather than an inclusion list, matching both sibling syncs:
// the sheet gains columns, and a new one should arrive automatically rather than
// being silently dropped until someone edits code. The API's allowlist is what
// stops an unreviewed column reaching users.
export const EXCLUDED_HEADERS = ['id'];

// Attribute names the sync writes itself. A column that slugs to one of these
// would reach the stored item through the record spread and overwrite it.
//
// `initiative_id` and `record_type` are the primary key: a column named
// `initiativeId` slugs to `initiative_id`, wins over the key the writer sets, and
// sends the Put to a phantom range key — the real record is never touched again
// and serves stale data forever, with no delete for the gate to notice.
export const RESERVED_ATTRIBUTES = [
  'record_type',
  'initiative_id',
  'first_seen_at',
  'last_synced_at',
];

// Headers the shaping refuses to proceed without. Not the full column set — new
// columns are carried automatically — but the ones whose absence means the header
// row shifted or was reorganized, which otherwise yields a result that looks
// valid and is not.
//
//  - `id` sources the key. Without it every id is empty.
//  - `Project` is the join. Without it every row reads as unlinked, which is a
//    plausible-looking result and a false all-clear on the resolution alarm.
//  - `Title` is what every card and detail page renders.
//  - the three facets drive the page's filters. A silently-empty facet control is
//    worse than a failed run, because nobody can tell it is empty by mistake.
//
// COLUMN PRESENCE, not cell fill. As of 2026-08-24, 9 of the 46 rows leave
// `Exposure`, `Use Case`, and `Description` blank — they are Substack and
// marketing entries carrying a `Summary` instead. Requiring values here would
// reject the sheet as it actually is.
export const REQUIRED_HEADERS = [
  'id',
  'Title',
  'Use Case',
  'Exposure',
  'tags',
  'Project',
];

// Tolerated deletes as a fraction of what is stored. Bounds the case a row count
// alone cannot see — a shifted header row, or a mass re-key, can produce a full
// delete-and-recreate at an unchanged row count.
//
// THE MASS RE-KEY THIS NOW GUARDS AGAINST is a renumbering or re-sort of the `id`
// column. The ids are a continuous 2–47 sequence with no gaps, which is what a
// column generated from row position looks like — so re-sorting the sheet and
// regenerating them would hand every row a different key. That presents here as a
// near-total delete and is refused. (Under the previous title-derived key the
// equivalent risk was a bulk retitle, which is no longer a re-key at all.)
//
// SMALL-N ARITHMETIC, because it surprises people: at 46 rows this refuses at 5
// deletes (10% of 46 is 4.6). A legitimate pruning of five initiatives therefore
// needs --force. That is the right default for a dataset this small — the whole
// table is one accidental sort away from destruction.
export const MAX_DELETE_FRACTION = 0.1;

// Tolerated single-run shrinkage before the run refuses, measured against the last
// COMPLETED run rather than against the current stored count. At 46 rows this
// refuses below 42 incoming.
export const MAX_ROW_DROP_FRACTION = 0.1;

// Hard minimum surviving initiative count.
//
// This exists because the delete ceiling is measured against a storedCount that
// shrinks with the damage: 46 -> 42 -> 38 -> ... drains the table without any
// single run exceeding 10%. A per-run ceiling cannot see a compounding drain
// across runs; only a floor terminates it.
//
// 46 initiatives as of 2026-08-24. 38 is low enough not to block a real
// contraction and high enough to stop the decay early, holding roughly the same
// proportion the previous pair (30 of 37) did. Revisit if the sheet changes
// materially — a hardcoded number goes stale silently.
export const ABSOLUTE_FLOOR = 38;

/**
 * Derive a stored attribute name from a machine header.
 *
 * The sheet is camelCase throughout and storage uses snake_case, matching every
 * other table in this repo. One function owns the rule so the sync and any reader
 * cannot disagree about what a column is called — and a test asserts it
 * reproduces the constants functions/api/lib/initiatives.mjs declares, because a
 * mismatch there reports zero findings rather than failing visibly.
 */
export function slugAttribute(header) {
  return String(header ?? '')
    .trim()
    // Split camelCase before lowercasing, or the word boundaries are lost.
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build an initiative id from the sheet's id column.
 *
 * Doubles as the detail-page URL segment, so it must be slug-safe. All 46 real
 * values already are — lowercase `[a-z0-9-]` throughout — which makes this a no-op
 * on every current row.
 *
 * It is applied anyway, rather than trusted. The sheet is hand-maintained and
 * nothing enforces the id format at write time, so a value with a space or a
 * capital would otherwise reach a URL unescaped. Normalizing here means a
 * malformed id becomes a valid address instead of a broken one, and the duplicate
 * check downstream still catches two ids that normalize together.
 *
 * There is deliberately NO length cap: truncation would manufacture collisions,
 * which is the one failure this function must not introduce.
 */
export function slugInitiativeId(...parts) {
  return parts
    .map((p) => String(p ?? '').trim())
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Turn the raw cell grid into initiatives keyed by initiative id.
 *
 * Reads the header row from the grid directly rather than going through
 * rowsToObjects, which renames duplicate headers (`tags` -> `tags_2`) and blank
 * ones (`column_1`). Those renames would let a reintroduced duplicate through as
 * a new attribute instead of failing.
 *
 * Every row is imported. This applies no validity judgement of its own — an
 * initiative with no project named is normal, not an error. Rows the sheet should
 * not contain are removed at the sheet.
 */
export function shapeInitiatives(cells) {
  const headerCells = cells?.[HEADER_ROW] ?? [];
  const headers = headerCells.map((h) => String(h ?? '').trim());

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new SyncInitiativesError(
      `The header row is missing: ${missing.join(', ')}. ` +
        `Expected machine names at grid index ${HEADER_ROW} (sheet row ${HEADER_ROW + 1}); ` +
        `found: ${headers.filter((h) => h !== '').join(', ') || '(empty row)'}. ` +
        'A shifted or reorganized header row otherwise produces a plausible-looking result, ' +
        'so this is checked before any shaping.',
    );
  }

  // Column indices to carry, with their attribute names.
  const carried = [];
  const byAttribute = new Map();
  headers.forEach((header, index) => {
    if (header === '') return;
    if (EXCLUDED_HEADERS.includes(header)) return;

    const attribute = slugAttribute(header);

    // A column that slugs onto a name the sync sets would reach the item through
    // the record spread and win. For the key attributes that means writing to a
    // phantom range key: the real record is never updated again, and there is no
    // delete for the gate to notice.
    if (RESERVED_ATTRIBUTES.includes(attribute)) {
      throw new SyncInitiativesError(
        `Header "${header}" maps to the attribute "${attribute}", which the sync writes ` +
          'itself. Carrying it would overwrite a key or an audit timestamp on every record. ' +
          `Rename the column in the sheet. Reserved: ${RESERVED_ATTRIBUTES.join(', ')}.`,
      );
    }

    // Collisions are rejected rather than resolved: silently keeping the last
    // writer would drop a whole column's data with no signal anywhere.
    if (byAttribute.has(attribute)) {
      throw new SyncInitiativesError(
        `Headers "${byAttribute.get(attribute)}" and "${header}" both map to the attribute ` +
          `"${attribute}". Rename one in the sheet — keeping both would silently drop one column.`,
      );
    }
    byAttribute.set(attribute, header);
    carried.push({ index, header, attribute });
  });

  const idIndices = ID_COLUMNS.map((name) => headers.indexOf(name));
  const cellAt = (r, index) => String(r?.[index] ?? '').trim();

  const initiatives = {};
  const seenAt = new Map();
  let skippedBlankRows = 0;

  cells.slice(HEADER_ROW + 1).forEach((r, i) => {
    const sheetRow = HEADER_ROW + 2 + i; // 1-based, for a message an operator can act on
    const populated = carried.some(({ index }) => cellAt(r, index) !== '');

    // A hand-maintained sheet carries blank spacer rows. Skipping them is counted
    // and reported; erroring would halt all population with no hub-side fix.
    if (!populated) {
      skippedBlankRows += 1;
      return;
    }

    const id = slugInitiativeId(...idIndices.map((index) => cellAt(r, index)));
    if (id === '') {
      throw new SyncInitiativesError(
        `Sheet row ${sheetRow} carries data but its ${ID_COLUMNS.join(' + ')} yields no id, ` +
          'so it cannot be keyed and must not be silently dropped. A blank id cell does this, ' +
          'and so does one holding only punctuation. Give the row an id, or clear the row.',
      );
    }

    if (seenAt.has(id)) {
      throw new SyncInitiativesError(
        `Initiative id "${id}" is produced by both sheet row ${seenAt.get(id)} and ` +
          `row ${sheetRow}. Ids come from ${ID_COLUMNS.join(' + ')}, so one row would ` +
          'silently overwrite the other. A copied row is the usual cause. Give each row ' +
          'its own id.',
      );
    }
    seenAt.set(id, sheetRow);

    const record = { initiative_id: id };
    for (const { index, attribute } of carried) {
      // Empty string, never absent and never null: a reader must be able to tell
      // "recorded as blank" from "attribute does not exist" without a schema.
      record[attribute] = cellAt(r, index);
    }
    initiatives[id] = record;
  });

  return {
    initiatives,
    headers: [...headers],
    columnHeaders: Object.fromEntries(carried.map(({ attribute, header }) => [attribute, header])),
    skippedBlankRows,
  };
}

// Attributes written at sync time rather than read from the sheet, so they must
// not count toward whether a record changed. `record_type` is the partition key
// and is present on every stored item but on no incoming record — leaving it in
// makes every initiative compare as changed, which is the "46 updated on every
// run forever" failure.
const NON_CARRIED_FIELDS = new Set(RESERVED_ATTRIBUTES);

function carriedFieldsDiffer(incoming, storedRecord) {
  const keys = new Set([
    ...Object.keys(incoming).filter((k) => !NON_CARRIED_FIELDS.has(k)),
    ...Object.keys(storedRecord).filter((k) => !NON_CARRIED_FIELDS.has(k)),
  ]);
  for (const key of keys) {
    if (String(incoming[key] ?? '') !== String(storedRecord[key] ?? '')) return true;
  }
  return false;
}

/**
 * Split incoming against stored into creates, updates, and deletes.
 *
 * Updates are only those records whose carried attributes actually differ.
 * Computing them from keys alone would report every initiative as updated on
 * every run forever, making the run counts a constant rather than an answer to
 * "did anything change?".
 *
 * A retitled initiative appears here as a plain UPDATE, because the key comes
 * from the sheet's id column rather than from the title. This is asserted by a
 * test: it was the reverse under the previous key, the delete-plus-create was
 * documented in four places, and a reader who remembers that needs to see the
 * change pinned rather than described.
 *
 * A row whose ID changes is still a create plus a delete — that is what a
 * re-keyed row means. Only the sheet's id column can cause it now.
 */
export function reconcile(incoming, stored) {
  const creates = [];
  const updates = [];

  for (const [id, record] of Object.entries(incoming)) {
    const existing = stored[id];
    if (existing === undefined) {
      creates.push(record);
    } else if (carriedFieldsDiffer(record, existing)) {
      // A whole-record write with no prior read cannot preserve when an initiative
      // first appeared, so carry it forward explicitly.
      updates.push(
        existing.first_seen_at ? { ...record, first_seen_at: existing.first_seen_at } : record,
      );
    }
  }

  const deletes = Object.keys(stored).filter((id) => incoming[id] === undefined);

  return { creates, updates, deletes };
}

/**
 * Decide whether a run may write. Returns a refusal reason, or null to proceed.
 *
 * Four conditions, because each is blind to what the others catch:
 *
 *  - A zero-row read means the tab, its share, or its shape changed, not that
 *    every initiative was retired. Never overridable.
 *  - A shifted header row, or a renumbering of the sheet's id column, can key
 *    initiatives differently and produce a full delete-and-recreate at an
 *    UNCHANGED row count. Only a delete ceiling sees that run.
 *  - The delete ceiling is measured against a storedCount that shrinks with the
 *    damage, so repeated under-ceiling runs compound: 46 -> 42 -> 38 -> ..., with
 *    every run exiting clean. The baseline check and the absolute floor are what
 *    terminate that decay, and they are why a per-run ceiling is not enough.
 *
 * KNOWN LIMIT: every condition here counts records. None of them inspects field
 * VALUES, so a run that rewrites the contents of all 46 initiatives onto the wrong
 * records — a sub-range sort in the sheet does exactly this — presents as 0 deletes
 * and 46 updates and passes untouched. Note this limit got WORSE with an
 * id-derived key: a sort that moves the ids along with their rows is invisible
 * here, where a sort that renumbered them would trip the ceiling.
 */
export function safetyVerdict({ incoming, storedCount, deletes, baseline, override = false }) {
  if (incoming === 0) {
    return 'Refusing: the sheet returned zero rows. This is never overridable — a ' +
      'zero-row read means the tab, its share, or its shape changed, not that every ' +
      'initiative was retired.';
  }

  if (override) return null;

  if (
    baseline !== null && baseline !== undefined &&
    incoming < baseline * (1 - MAX_ROW_DROP_FRACTION)
  ) {
    return `Refusing: the sheet returned ${incoming} rows against a previous ${baseline}, ` +
      `a drop of more than ${MAX_ROW_DROP_FRACTION * 100}%. Re-run with the override if this ` +
      'is intended.';
  }

  // Only meaningful against stored data. With an empty table there is nothing to
  // protect, and applying the ceiling there would block every first population.
  if (storedCount > 0 && deletes > storedCount * MAX_DELETE_FRACTION) {
    return `Refusing: the run would delete ${deletes} of ${storedCount} stored initiatives, ` +
      `more than ${MAX_DELETE_FRACTION * 100}%. Note the row count alone would not have caught ` +
      'this — a shifted header row, or a renumbered id column, produces a full ' +
      'delete-and-recreate at an unchanged count. Check the sheet before overriding: ids come ' +
      'from the id column, so re-sorting the sheet and regenerating them looks exactly like ' +
      'this. Retitling initiatives does NOT cause this and never needs an override.';
  }

  // Same reasoning as the ceiling: with an empty table there is nothing to drain,
  // and applying the floor there would make the first population of any smaller
  // sheet impossible.
  if (storedCount > 0 && ABSOLUTE_FLOOR !== null && incoming < ABSOLUTE_FLOOR) {
    return `Refusing: ${incoming} surviving initiatives is below the absolute floor of ` +
      `${ABSOLUTE_FLOOR}. Successive under-ceiling drops compound, and this is the condition ` +
      'that stops them. Re-run with the override if the sheet really is this small now.';
  }

  return null;
}
