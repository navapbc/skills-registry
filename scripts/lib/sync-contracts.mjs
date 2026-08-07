/**
 * Pure logic for the contracts population — shaping, key derivation, the
 * reconcile diff, and the safety gate.
 *
 * Split from scripts/sync-contracts.mjs for the same reason sync-projects.mjs
 * was split: the entry point needs live Google and AWS credentials, and
 * everything worth testing here is a pure function of its inputs. The delete
 * path in particular must be unit-testable — a wrong diff destroys real data and
 * the failure is invisible until someone notices missing contracts.
 *
 * Nothing in this file performs I/O.
 */

// Imported rather than redeclared so the stored record types cannot drift from
// what the API reads. The dependency direction is forced: the API Lambda zip is
// built from functions/api/ alone, so nothing there may import from scripts/.
import { RECORD_CONTRACT } from '../../functions/api/lib/contracts.mjs';

export class SyncContractsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncContractsError';
  }
}

// 0-based grid index, NOT a sheet row number. Sheet row 1 holds banner labels
// ("Contracts to Complete"), row 2 holds prose headers, row 3 holds the machine
// names this shaping reads.
//
// Named explicitly rather than auto-detected: density detection picks row 2 on
// this tab, and row 2's prose headers include seven placeholders literally named
// "Column 21".."Column 27" over the columns that carry the posture and project.
// A wrong pick there produces a plausible-looking result with the two most
// important columns misnamed.
export const HEADER_ROW = 2;

// Headers deliberately NOT carried into storage.
//
// An explicit denylist rather than an inclusion list, matching the projects
// sync: the survey gains columns, and a new one should arrive automatically
// rather than being silently dropped until someone edits code.
//
//  - The unnamed first column (row 2 calls it "Contracts Team Member") holds a
//    named individual. It has no machine name, so it is excluded by position —
//    see UNNAMED_COLUMN_INDEX.
//  - `terms` was byte-identical to `aiPosture` on all 119 rows at the time of
//    writing. Carrying both would create two sources of truth for the posture.
export const EXCLUDED_HEADERS = ['terms'];
export const UNNAMED_COLUMN_INDEX = 0;

// Attribute names the population writes itself. A survey column that slugs to one
// of these would reach the stored item through the record spread and overwrite it.
//
// `contract_id` and `record_type` are the primary key: a column named `contractId`
// slugs to `contract_id`, wins over the key the writer sets, and sends the Put to a
// phantom range key — the real record is never touched again and serves stale data
// forever, with no delete for the gate to notice.
export const RESERVED_ATTRIBUTES = [
  'record_type',
  'contract_id',
  'first_seen_at',
  'last_synced_at',
];

// Machine names the shaping refuses to proceed without. Not the full column set
// — new columns are carried automatically — but the ones whose absence means the
// header row shifted or was reorganized, which otherwise yields a result that
// looks valid and is not.
export const REQUIRED_HEADERS = [
  'PORTFOLIO',
  'PROJECT',
  'aiPosture',
  'projectName',
  'aiUseTerms',
  'contractNum',
];

// The two columns the contract id is built from. Both are populated on every row
// today, which is the property that makes the id stable: an id drawn from a
// sparse column re-keys itself as the survey is filled in, and the reconcile
// reads that as a delete plus a create.
export const ID_COLUMNS = ['PORTFOLIO', 'PROJECT'];

// Tolerated deletes as a fraction of what is stored. Bounds the case a row count
// alone cannot see — a shifted header row can produce a full delete-and-recreate
// at an unchanged row count.
export const MAX_DELETE_FRACTION = 0.1;

// Tolerated single-run shrinkage before the run refuses, measured against the last
// COMPLETED run rather than against the current stored count.
export const MAX_ROW_DROP_FRACTION = 0.1;

// Hard minimum surviving contract count.
//
// This exists because the delete ceiling is measured against a storedCount that
// shrinks with the damage: 119 -> 108 -> 98 -> ... -> 9 drains the table without any
// single run exceeding 10%. A per-run ceiling cannot see a compounding drain across
// runs; only a floor terminates it.
//
// 119 contracts today. 90 is low enough not to block a real contraction of the
// survey and high enough to stop the decay early. Revisit if the survey changes
// materially — a hardcoded number goes stale silently.
export const ABSOLUTE_FLOOR = 90;

/**
 * Derive a stored attribute name from a machine header.
 *
 * The survey mixes two conventions — SCREAMING for a few columns, camelCase for
 * the rest — and storage uses snake_case throughout, matching every other table
 * in this repo. One function owns the rule so the population and any reader
 * cannot disagree about what a column is called.
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
 * Build a contract id from the portfolio and project values.
 *
 * Doubles as the detail-page URL segment, so it must be slug-safe. Case and
 * surrounding whitespace are normalized away — the sheet is hand-maintained and
 * "  states  " and "STATES" are the same portfolio.
 */
export function slugContractId(...parts) {
  return parts
    .map((p) => String(p ?? '').trim())
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Turn the raw cell grid into contracts keyed by contract id.
 *
 * Reads the header row from the grid directly rather than going through
 * rowsToObjects, which renames duplicate headers (`clientPolicy` ->
 * `clientPolicy_2`) and blank ones (`column_1`). Those renames would let a
 * reintroduced duplicate through as a new attribute instead of failing, and the
 * duplicate is exactly the defect this tab already had once.
 *
 * Every row is imported. This applies no validity judgement of its own — no
 * portfolio allowlist, no posture requirement. Rows the survey should not
 * contain are removed at the sheet.
 */
export function shapeContracts(cells) {
  const headerCells = cells?.[HEADER_ROW] ?? [];
  const headers = headerCells.map((h) => String(h ?? '').trim());

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new SyncContractsError(
      `The header row is missing: ${missing.join(', ')}. ` +
        `Expected machine names at grid index ${HEADER_ROW} (sheet row ${HEADER_ROW + 1}); ` +
        `found: ${headers.filter((h) => h !== '').join(', ') || '(empty row)'}. ` +
        'A shifted or reorganized header row otherwise produces a plausible-looking result, ' +
        'so this is checked before any shaping.',
    );
  }

  // Checked AFTER the required-header check, so a shifted or emptied header row
  // gets the message that names the expected row rather than this narrower one.
  //
  // The unnamed column is excluded BY POSITION while every other header is
  // validated BY NAME, and those two strategies disagree the moment a column is
  // inserted or deleted to the left of the data. Deleting column A shifts
  // everything left: PORTFOLIO lands at index 0 and is dropped, the required-header
  // check still passes because the NAME is present, and the id still resolves via
  // indexOf — so shaping succeeds and every record is written WITHOUT its
  // portfolio. Put replaces items whole, so that erases the attribute from all 119
  // stored contracts while reporting a clean run of updates, and there are no
  // deletes for the gate to see.
  if (headers[UNNAMED_COLUMN_INDEX] !== '') {
    throw new SyncContractsError(
      `Expected the header at column ${UNNAMED_COLUMN_INDEX + 1} to be unnamed, but found ` +
        `"${headers[UNNAMED_COLUMN_INDEX]}". That column is excluded by position, so a column ` +
        'inserted or deleted to its left silently drops a real column from every record ' +
        'instead of failing. Restore the column order, or update UNNAMED_COLUMN_INDEX.',
    );
  }

  // Column indices to carry, with their attribute names. Built by index rather
  // than by name so the unnamed first column can be excluded by position.
  const carried = [];
  const byAttribute = new Map();
  headers.forEach((header, index) => {
    if (index === UNNAMED_COLUMN_INDEX) return;
    if (header === '') return;
    if (EXCLUDED_HEADERS.includes(header)) return;

    const attribute = slugAttribute(header);

    // A column that slugs onto a name the writer sets would reach the item through
    // the record spread and win. For the key attributes that means writing to a
    // phantom range key: the real record is never updated again, and there is no
    // delete for the gate to notice.
    if (RESERVED_ATTRIBUTES.includes(attribute)) {
      throw new SyncContractsError(
        `Header "${header}" maps to the attribute "${attribute}", which the population ` +
          'writes itself. Carrying it would overwrite a key or an audit timestamp on every ' +
          `record. Rename the column in the sheet. Reserved: ${RESERVED_ATTRIBUTES.join(', ')}.`,
      );
    }

    // Collisions are rejected rather than resolved: silently keeping the last
    // writer would drop a whole column's data with no signal anywhere.
    if (byAttribute.has(attribute)) {
      throw new SyncContractsError(
        `Headers "${byAttribute.get(attribute)}" and "${header}" both map to the attribute ` +
          `"${attribute}". Rename one in the sheet — keeping both would silently drop one column.`,
      );
    }
    byAttribute.set(attribute, header);
    carried.push({ index, header, attribute });
  });

  const idIndices = ID_COLUMNS.map((name) => headers.indexOf(name));
  const cellAt = (row, index) => String(row?.[index] ?? '').trim();

  const contracts = {};
  const seenAt = new Map();
  let skippedBlankRows = 0;

  cells.slice(HEADER_ROW + 1).forEach((row, i) => {
    const sheetRow = HEADER_ROW + 2 + i; // 1-based, for a message an operator can act on
    const populated = carried.some(({ index }) => cellAt(row, index) !== '');

    // A hand-maintained sheet carries blank spacer rows. Skipping them is counted
    // and reported; erroring would halt all population with no hub-side fix.
    if (!populated) {
      skippedBlankRows += 1;
      return;
    }

    const id = slugContractId(...idIndices.map((index) => cellAt(row, index)));
    if (id === '') {
      throw new SyncContractsError(
        `Sheet row ${sheetRow} carries data but has no ${ID_COLUMNS.join(' or ')}, ` +
          'so it cannot be keyed and must not be silently dropped. ' +
          'Fill those columns in, or clear the row.',
      );
    }

    if (seenAt.has(id)) {
      throw new SyncContractsError(
        `Contract id "${id}" is produced by both sheet row ${seenAt.get(id)} and row ${sheetRow}. ` +
          `Ids come from ${ID_COLUMNS.join(' + ')}, so one row would silently overwrite the other. ` +
          'Distinguish the two in the sheet.',
      );
    }
    seenAt.set(id, sheetRow);

    const record = { contract_id: id };
    for (const { index, attribute } of carried) {
      // Empty string, never absent and never null: a reader must be able to tell
      // "recorded as blank" from "attribute does not exist" without a schema.
      record[attribute] = cellAt(row, index);
    }
    contracts[id] = record;
  });

  return {
    contracts,
    headers: [...headers],
    columnHeaders: Object.fromEntries(carried.map(({ attribute, header }) => [attribute, header])),
    skippedBlankRows,
  };
}

// Attributes written at population time rather than read from the sheet, so they
// must not count toward whether a record changed. `record_type` is the partition
// key and is present on every stored item but on no incoming record — leaving it
// in makes every contract compare as changed, which is the "119 updated on every
// run forever" failure.
const NON_CARRIED_FIELDS = new Set([
  'record_type',
  'contract_id',
  'first_seen_at',
  'last_synced_at',
]);

function carriedFieldsDiffer(incoming, stored) {
  const keys = new Set([
    ...Object.keys(incoming).filter((k) => !NON_CARRIED_FIELDS.has(k)),
    ...Object.keys(stored).filter((k) => !NON_CARRIED_FIELDS.has(k)),
  ]);
  for (const key of keys) {
    if (String(incoming[key] ?? '') !== String(stored[key] ?? '')) return true;
  }
  return false;
}

/**
 * Split incoming against stored into creates, updates, and deletes.
 *
 * Updates are only those records whose carried attributes actually differ.
 * Computing them from keys alone would report every contract as updated on every
 * run forever, making the run counts a constant rather than an answer to "did
 * anything change?".
 */
export function reconcile(incoming, stored) {
  const creates = [];
  const updates = [];

  for (const [id, record] of Object.entries(incoming)) {
    const existing = stored[id];
    if (existing === undefined) {
      creates.push(record);
    } else if (carriedFieldsDiffer(record, existing)) {
      // A whole-record write with no prior read cannot preserve when a contract
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
 *    every contract was retired. Never overridable.
 *  - A shifted header row can key contracts on the wrong columns and produce a
 *    full delete-and-recreate at an UNCHANGED row count. Only a delete ceiling
 *    sees that run.
 *  - The delete ceiling is measured against a storedCount that shrinks with the
 *    damage, so repeated under-ceiling runs compound: 119 -> 108 -> 98 -> ... -> 9,
 *    with every run exiting clean. The baseline check and the absolute floor are
 *    what terminate that decay, and they are why a per-run ceiling is not enough.
 *
 * An earlier version of this gate carried only the first two conditions, on the
 * reasoning that the survey is 31% classified and still being filled in. That
 * reasoning confuses two different measures: posture completeness is indeed in
 * flux, but the ROW COUNT is not — PORTFOLIO and PROJECT are populated on every
 * row. A floor measures rows, so it is meaningful here.
 *
 * KNOWN LIMIT: every condition here counts records. None of them inspects field
 * VALUES, so a run that rewrites the contents of all 119 contracts onto the wrong
 * records — a sub-range sort in the sheet does exactly this — presents as 0 deletes
 * and 119 updates and passes untouched. See docs/plans for the follow-up.
 */
export function safetyVerdict({ incoming, storedCount, deletes, baseline, override = false }) {
  if (incoming === 0) {
    return 'Refusing: the sheet returned zero rows. This is never overridable — a ' +
      'zero-row read means the tab, its share, or its shape changed, not that every ' +
      'contract was retired.';
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
    return `Refusing: the run would delete ${deletes} of ${storedCount} stored contracts, ` +
      `more than ${MAX_DELETE_FRACTION * 100}%. Note the row count alone would not have caught ` +
      'this — a shifted header row produces a full delete-and-recreate at an unchanged count. ' +
      'Re-run with the override if this is intended.';
  }

  // Same reasoning as the ceiling: with an empty table there is nothing to drain,
  // and applying the floor there would make the first population of any smaller
  // survey impossible.
  if (storedCount > 0 && incoming < ABSOLUTE_FLOOR) {
    return `Refusing: ${incoming} surviving contracts is below the absolute floor of ` +
      `${ABSOLUTE_FLOOR}. Successive under-ceiling drops compound, and this is the condition ` +
      'that stops them. Re-run with the override if the survey really is this small now.';
  }

  return null;
}
