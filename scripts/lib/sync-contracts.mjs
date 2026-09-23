/**
 * Pure logic for the contracts population — header mapping, shaping, key
 * derivation, the reconcile diff, and the safety gate.
 *
 * Split from scripts/sync-contracts.mjs for the same reason sync-projects.mjs
 * was split: the entry point needs live Google and AWS credentials, and
 * everything worth testing here is a pure function of its inputs. The delete
 * path in particular must be unit-testable — a wrong diff destroys real data and
 * the failure is invisible until someone notices missing contracts.
 *
 * Nothing in this file performs I/O.
 */

export class SyncContractsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncContractsError';
  }
}

// 0-based grid index, NOT a sheet row number. Sheet row 1 holds banner labels
// ("Contracts to Complete") and sheet row 2 holds the prose headers this shaping
// reads. Data starts on sheet row 3.
export const HEADER_ROW = 1;

/**
 * Collapse a header's whitespace, so a doubled space or a trailing newline typed
 * into the sheet does not read as a different column.
 */
export const normalizeHeader = (header) => String(header ?? '').replace(/\s+/g, ' ').trim();

// The "Compliance" tab has prose headers only, so each carried column is mapped to
// its stored attribute here. The attribute names match what the previous survey
// tab stored, so the API and the renderer read the same names.
//
// An inclusion map, unlike the projects sync's slug-every-column rule, for two
// reasons. A prose header slugs to an unreadable attribute name. This workbook is
// also attorney-client privileged and carries compliance-internal columns, so a
// column must be carried on purpose. A header in neither this map nor
// EXCLUDED_HEADERS fails the run.
export const COLUMN_ATTRIBUTES = {
  'PORTFOLIO': 'portfolio',
  'PROJECT': 'project',
  'AGREEMENT TYPE': 'agreement_type',
  'CONTRACT NUMBER': 'contract_num',
  'VEHICLE / OTHER (BPA/BOA/MSA)': 'vehicle',
  'TASK ORDER': 'task_order',
  'CUSTOMER': 'customer',
  'PROJECT MANAGER (Nava)': 'nava_project_mgr',
  'PROGRAM MANAGER (Nava)': 'nava_program_mgr',
  'SUBCONTRACTORS': 'subcontractors',
  'Contract AI Use Terms (i.e., allowed, restricted, silent, prohibited)': 'ai_use_terms',
  'AI Use Terms Language': 'ai_use_terms_language',
  'Is there a Client AI Use Policy (outside of the contract)? (Yes/No; if yes, provide brief narrative and link to policy)': 'client_policy',
  'Is there a Nava Program-Specific AI Use Policy? (Yes/No; if yes, provide brief narrative and link to policy)': 'nava_policy',
  'Is AI Used in Contract Performance? (Yes/No)': 'ai_used',
  'AI Tools Used in Contract Performance (list tools)': 'tools',
  'Description of How AI is Used in Contract Performance (brief narrative)': 'usage',
  'agency AI approval requirements': 'review_process',
  'Publish to Project Indices and Contract Explorer (Yes/No)?': 'publish',
};

// Headers read from the sheet and deliberately NOT stored.
//
//  - "Contracts Team Member" names an individual on the contracts team.
//  - The remaining four are the contracts team's compliance tracking. The Contract
//    Explorer serves every signed-in user, and these columns are not for them.
export const EXCLUDED_HEADERS = [
  'Contracts Team Member',
  'Nava steps for compliance',
  'Nava Compliance Status',
  'Needed for compliance',
  'Notes',
];

// The contracts team's publish flag. It is stored like any other column, and the
// API serves only the contracts whose flag reads "Yes".
export const PUBLISH_ATTR = 'publish';

// Attributes the shaping refuses to proceed without. Their absence means the
// header row shifted or a header was reworded.
export const REQUIRED_ATTRIBUTES = [
  'portfolio',
  'project',
  'contract_num',
  'ai_use_terms',
  PUBLISH_ATTR,
];

// The two attributes the contract id is built from. Both are populated on every
// row today, which is the property that makes the id stable: an id drawn from a
// sparse column re-keys itself as the survey is filled in, and the reconcile
// reads that as a delete plus a create.
export const ID_ATTRIBUTES = ['portfolio', 'project'];

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
// 119 contracts today, published or not. 90 is low enough not to block a real
// contraction of the survey and high enough to stop the decay early. Revisit if
// the survey changes materially — a hardcoded number goes stale silently.
export const ABSOLUTE_FLOOR = 90;

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
 * rowsToObjects, which renames duplicate headers (`Notes` -> `Notes_2`) and blank
 * ones (`column_1`). Those renames would let a reintroduced duplicate through as
 * a new attribute instead of failing.
 *
 * Every cell is stored as written. Nothing here derives a value from another
 * column, and every row is stored whatever its publish flag says: the flag is
 * the API's to apply, so the table stays a copy of the sheet.
 */
export function shapeContracts(cells) {
  const headers = (cells?.[HEADER_ROW] ?? []).map(normalizeHeader);
  const attributeOf = Object.fromEntries(
    Object.entries(COLUMN_ATTRIBUTES).map(([header, attribute]) => [normalizeHeader(header), attribute]),
  );
  const excluded = new Set(EXCLUDED_HEADERS.map(normalizeHeader));

  const unknown = headers.filter((h) => h !== '' && !attributeOf[h] && !excluded.has(h));
  const carried = [];
  const byAttribute = new Map();
  headers.forEach((header, index) => {
    const attribute = attributeOf[header];
    if (!attribute) return;

    // Two columns with the same header would both map here. Keeping the last
    // writer would drop a whole column's data with no signal anywhere.
    if (byAttribute.has(attribute)) {
      throw new SyncContractsError(
        `Two columns are headed "${header}". Rename one in the sheet — keeping both ` +
          'would silently drop one column.',
      );
    }
    byAttribute.set(attribute, header);
    carried.push({ index, header, attribute });
  });

  const missing = REQUIRED_ATTRIBUTES.filter((a) => !byAttribute.has(a));
  if (missing.length > 0) {
    const expected = missing.map((a) => Object.keys(COLUMN_ATTRIBUTES).find((h) => COLUMN_ATTRIBUTES[h] === a));
    throw new SyncContractsError(
      `The header row is missing: ${expected.map((h) => `"${h}"`).join(', ')}. ` +
        `Expected prose headers at grid index ${HEADER_ROW} (sheet row ${HEADER_ROW + 1}); ` +
        `found: ${headers.filter((h) => h !== '').join(' | ') || '(empty row)'}. ` +
        'A shifted or reworded header row otherwise produces a plausible-looking result, ' +
        'so this is checked before any shaping.',
    );
  }

  // Checked after the required headers, so a shifted header row gets the message
  // that names the expected row rather than a list of every header as unknown.
  if (unknown.length > 0) {
    throw new SyncContractsError(
      `The header row has columns this sync does not know: ${unknown.map((h) => `"${h}"`).join(', ')}. ` +
        'Add each to COLUMN_ATTRIBUTES to store it, or to EXCLUDED_HEADERS to leave it out.',
    );
  }

  const cellAt = (row, index) => String(row?.[index] ?? '').trim();
  const indexOf = (attribute) => carried.find((c) => c.attribute === attribute).index;
  const idIndices = ID_ATTRIBUTES.map(indexOf);

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
        `Sheet row ${sheetRow} carries data but has no ${ID_ATTRIBUTES.join(' or ')}, ` +
          'so it cannot be keyed and must not be silently dropped. ' +
          'Fill those columns in, or clear the row.',
      );
    }

    if (seenAt.has(id)) {
      throw new SyncContractsError(
        `Contract id "${id}" is produced by both sheet row ${seenAt.get(id)} and row ${sheetRow}. ` +
          `Ids come from ${ID_ATTRIBUTES.join(' + ')}, so one row would silently overwrite the other. ` +
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
