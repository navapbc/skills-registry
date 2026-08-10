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

// The workbook has exactly one tab. The CLI still reads titles[0] and compares it
// to this, so a reordered or renamed tab fails loudly rather than importing
// whatever happens to sit at index 0.
export const EXPECTED_TAB_TITLE = 'from initiatives.json';

// 0-based grid index, NOT a sheet row number. VERIFIED against the workbook on
// 2026-08-10 rather than assumed: this tab genuinely starts with its machine
// headers at the top, with no title banner and no spacer. Its two siblings do
// not — the projects tab needs row 6 and the contracts tab row 2 — so the
// absence of an offset here is a measurement, not an oversight.
export const HEADER_ROW = 0;

// The column the initiative id is built from.
//
// This is not a free choice. The workbook carried an `id` column and a
// `programId` column when this was planned and both were removed before
// implementation, leaving `title` as the only column that is BOTH populated on
// every row AND unique across them — the property that makes a key stable, since
// an id drawn from a sparse column re-keys itself as the sheet is filled in and
// the reconcile reads that as a delete plus a create.
//
// The rejected alternatives, measured over the real 37 rows: `programId` was
// blank on 14 rows, and `programId` + `useCaseLabel` produced only 29 distinct
// keys. Adding `useCaseLabel` or `projectName` to `title` buys no uniqueness and
// makes every URL 30-40 characters longer.
//
// The cost of keying on prose: retitling an initiative re-keys the row, so a
// rename is a delete plus a create. `first_seen_at` does not survive it and
// neither does the URL. MAX_DELETE_FRACTION is what stops a BULK retitle from
// applying; a single one is allowed through as intended behaviour.
//
// A list rather than a bare string, matching sync-contracts.mjs, so adding a
// second column later is a data change rather than a rewrite.
export const ID_COLUMNS = ['title'];

// Headers deliberately NOT carried into storage.
//
// Empty today. Kept as an explicit denylist rather than an inclusion list,
// matching both sibling syncs: the sheet gains columns, and a new one should
// arrive automatically rather than being silently dropped until someone edits
// code. The API's allowlist is what stops an unreviewed column reaching users.
export const EXCLUDED_HEADERS = [];

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

// Machine names the shaping refuses to proceed without. Not the full column set —
// new columns are carried automatically — but the ones whose absence means the
// header row shifted or was reorganized, which otherwise yields a result that
// looks valid and is not.
//
//  - `title` sources the key. Without it every id is empty.
//  - `projectName` is the join. Without it every row reads as unlinked, which is
//    a plausible-looking result and a false all-clear on the resolution alarm.
//  - the three facets drive the page's filters. A silently-empty facet control is
//    worse than a failed run, because nobody can tell it is empty by mistake.
export const REQUIRED_HEADERS = [
  'title',
  'useCaseLabel',
  'exposure',
  'tags',
  'projectName',
];

// Tolerated deletes as a fraction of what is stored. Bounds the case a row count
// alone cannot see — a shifted header row, or a bulk retitle, can produce a full
// delete-and-recreate at an unchanged row count.
//
// SMALL-N ARITHMETIC, because it surprises people: at 37 rows this refuses at 4
// deletes (10% of 37 is 3.7). A legitimate pruning of five initiatives therefore
// needs --force. That is the right default for a dataset this small — the whole
// table is one accidental sort away from destruction — and it is also the guard
// that catches the mass re-key a title-derived key makes possible.
export const MAX_DELETE_FRACTION = 0.1;

// Tolerated single-run shrinkage before the run refuses, measured against the last
// COMPLETED run rather than against the current stored count. At 37 rows this
// refuses below 34 incoming.
export const MAX_ROW_DROP_FRACTION = 0.1;

// Hard minimum surviving initiative count.
//
// This exists because the delete ceiling is measured against a storedCount that
// shrinks with the damage: 37 -> 34 -> 31 -> ... drains the table without any
// single run exceeding 10%. A per-run ceiling cannot see a compounding drain
// across runs; only a floor terminates it.
//
// 37 initiatives as of 2026-08-10. 30 is low enough not to block a real
// contraction and high enough to stop the decay early. Revisit if the sheet
// changes materially — a hardcoded number goes stale silently.
export const ABSOLUTE_FLOOR = 30;

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
 * Build an initiative id from its title.
 *
 * Doubles as the detail-page URL segment, so it must be slug-safe. Case and
 * surrounding whitespace are normalized away — the sheet is hand-maintained.
 *
 * Real titles carry em dashes, ampersands, apostrophes, and parentheses; runs of
 * those collapse to a single hyphen rather than leaving doubles.
 *
 * There is deliberately NO length cap. The longest real title slugs to 89
 * characters, far under DynamoDB's range-key limit, and truncating would
 * reintroduce exactly the collision class the duplicate check exists to catch —
 * the removed `id` column truncated at 60 and two similar titles would have
 * collided there silently.
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
          'so it cannot be keyed and must not be silently dropped. A title of only ' +
          'punctuation does this. Give the row a title, or clear the row.',
      );
    }

    if (seenAt.has(id)) {
      throw new SyncInitiativesError(
        `Initiative id "${id}" is produced by both sheet row ${seenAt.get(id)} and ` +
          `row ${sheetRow}. Ids come from ${ID_COLUMNS.join(' + ')}, so one row would ` +
          'silently overwrite the other — two titles differing only in punctuation slug ' +
          'the same. Distinguish the two in the sheet.',
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
// makes every initiative compare as changed, which is the "37 updated on every
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
 * A retitled initiative appears here as one create plus one delete, never as an
 * update, because the title sources the key. That is the documented cost of a
 * prose key and is asserted by a test so it is discovered here rather than in
 * production.
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
 *  - A shifted header row, or a bulk retitle, can key initiatives differently and
 *    produce a full delete-and-recreate at an UNCHANGED row count. Only a delete
 *    ceiling sees that run — and with a title-derived key this is the condition
 *    most likely to fire in practice.
 *  - The delete ceiling is measured against a storedCount that shrinks with the
 *    damage, so repeated under-ceiling runs compound: 37 -> 34 -> 31 -> ..., with
 *    every run exiting clean. The baseline check and the absolute floor are what
 *    terminate that decay, and they are why a per-run ceiling is not enough.
 *
 * KNOWN LIMIT: every condition here counts records. None of them inspects field
 * VALUES, so a run that rewrites the contents of all 37 initiatives onto the wrong
 * records — a sub-range sort in the sheet does exactly this — presents as 0 deletes
 * and 37 updates and passes untouched.
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
      'this — a shifted header row, or a bulk retitle in the sheet, produces a full ' +
      'delete-and-recreate at an unchanged count. Check the sheet before overriding: ids ' +
      'come from the title, so renaming many initiatives at once looks exactly like this.';
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
