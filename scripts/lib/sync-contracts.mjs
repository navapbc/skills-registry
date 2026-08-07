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

export { RECORD_CONTRACT };

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

  // Column indices to carry, with their attribute names. Built by index rather
  // than by name so the unnamed first column can be excluded by position.
  const carried = [];
  const byAttribute = new Map();
  headers.forEach((header, index) => {
    if (index === UNNAMED_COLUMN_INDEX) return;
    if (header === '') return;
    if (EXCLUDED_HEADERS.includes(header)) return;

    const attribute = slugAttribute(header);
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
 * Deliberately narrower than the projects sync's four-condition gate. Contracts
 * have no established baseline to measure a row-count drop against, and no
 * portfolio-size floor that would mean anything — the survey is 31% classified
 * and still being filled in, so both of those would either never fire or fire on
 * every legitimate run.
 *
 * What remains is the pair that catches real destruction:
 *
 *  - A zero-row read means the tab, its share, or its shape changed, not that
 *    every contract was retired. Never overridable.
 *  - A shifted header row can key contracts on the wrong columns and produce a
 *    full delete-and-recreate at an UNCHANGED row count. Only a delete ceiling
 *    sees that run.
 */
export function safetyVerdict({ incoming, storedCount, deletes, override = false }) {
  if (incoming === 0) {
    return 'Refusing: the sheet returned zero rows. This is never overridable — a ' +
      'zero-row read means the tab, its share, or its shape changed, not that every ' +
      'contract was retired.';
  }

  if (override) return null;

  // Only meaningful against stored data. With an empty table there is nothing to
  // protect, and applying the ceiling there would block every first population.
  if (storedCount > 0 && deletes > storedCount * MAX_DELETE_FRACTION) {
    return `Refusing: the run would delete ${deletes} of ${storedCount} stored contracts, ` +
      `more than ${MAX_DELETE_FRACTION * 100}%. Note the row count alone would not have caught ` +
      'this — a shifted header row produces a full delete-and-recreate at an unchanged count. ' +
      'Re-run with the override if this is intended.';
  }

  return null;
}
