/**
 * Pure logic for the projects sync — shaping, column exclusion, group parsing,
 * the safety gate, and the reconcile diff.
 *
 * Extracted from scripts/sync-projects.mjs for the same reason scripts/sync-ddb.mjs
 * was extracted from sync-registry-v2: the entry point needs live Google and AWS
 * credentials, and everything worth testing here is a pure function of its inputs.
 * The delete path in particular must be unit-testable — a wrong diff destroys real
 * data and the failure is invisible until someone notices missing projects.
 *
 * Nothing in this file performs I/O.
 */

import { rowsToObjects } from './sheet-export.mjs';

export class SyncProjectsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncProjectsError';
  }
}

// 0-based grid indices, NOT sheet row numbers.
//
// Named explicitly rather than derived as "the rows above the header" because
// grid index 4 (sheet row 5) is blank in this tab: anything taking "the two rows
// immediately above the header" gets the owner row plus that blank and produces
// an empty group mapping, which fails the grouping requirement silently.
//
// Sheet row 3 -> group labels, row 4 -> owning team, row 5 -> blank,
// row 6 -> headers.
export const GROUP_ROW = 2;
export const OWNER_ROW = 3;
export const HEADER_ROW = 5;

// The sheet carries two code columns. "Database project code" reads like the key
// and is empty on every row; "Database code" holds FC026/ST033/... and is unique
// and populated. Keying on the wrong one fails on every row.
export const PROJECT_CODE_HEADER = 'Database code';

// Columns preceding the sheet's first group label — the identifying fields —
// belong to no declared group. Without a synthetic one they render outside every
// heading as an unlabelled dangling block.
export const IDENTITY_GROUP = 'IDENTITY';

// Read by the API side to resolve archetype values. A mismatch between the two
// sides reports zero drift, which is a false all-clear rather than a visible
// error, so tests assert these against slugColumn output directly.
export const ARCHETYPE_PRIMARY_SLUG = 'archetype_primary';
export const ARCHETYPE_ADDITIONAL_SLUG = 'archetype_additional';

/**
 * Columns deliberately NOT mirrored into the hub.
 *
 * A denylist rather than an inclusion list: the sheet gains columns, and a new
 * one should arrive automatically rather than being silently dropped until
 * someone edits code. The inverse risk — a new or renamed sensitive column
 * arriving unnoticed — is handled by storing each run's header set and
 * surfacing newly appeared columns in the admin tab.
 *
 * Note this is NOT the sheet's own HEALTH group. The two health *link* columns
 * are deliberately kept: they hold Confluence URLs, and the assessment they
 * point at sits behind that page's own access control rather than in the cell.
 * A reader assuming "drop the HEALTH group" would remove them wrongly.
 */
export const EXCLUDED_COLUMNS = [
  // Named individuals.
  'Program Manager',
  'Nava Contract PP',
  'Project Index Owner',
  'Assigned project-index-quality reviewer',
  // Health assessments and contractor performance ratings.
  'Program Health Status',
  'Team Health Status',
  'CPARS',
];

/**
 * Derive a stored attribute name from a sheet header.
 *
 * One function owns this rule, and its output is used for both the stored
 * attribute name and the keys of the column-group map, so storage, grouping, and
 * the UI's lookup cannot disagree about what a column is called.
 *
 * A leading number is moved to the end ("2026 Capabilities" -> capabilities_2026)
 * so no attribute name starts with a digit. That can collide with a hypothetical
 * "Capabilities 2026"; shapeProjects rejects collisions loudly rather than
 * letting one column overwrite another.
 */
export function slugColumn(header) {
  const base = String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const leadingNumber = base.match(/^(\d+)_(.+)$/);
  return leadingNumber ? `${leadingNumber[2]}_${leadingNumber[1]}` : base;
}

/**
 * Map every header to the group label the sheet declares above it.
 *
 * Group labels sit in merged cells, so only the first column of a run carries
 * text and the label carries forward until the next non-empty cell. The result
 * is stored per column and never as ranges, because the runs are not contiguous
 * — "Government Domain" is labelled FRAMEWORKS while sitting between two
 * PROJECT INDEX columns.
 *
 * MUST be given the FULL header row, not a filtered subset. Group cells are
 * positioned against the original columns, so passing carried-only headers
 * shifts every label after the first excluded column — silently, and in a way
 * that still produces a plausible-looking grouping.
 */
export function parseColumnGroups(cells, headers) {
  const groupCells = cells?.[GROUP_ROW] ?? [];
  if (groupCells.filter((c) => String(c ?? '').trim() !== '').length === 0) {
    throw new SyncProjectsError(
      `The group-label row (grid index ${GROUP_ROW}, sheet row ${GROUP_ROW + 1}) is empty. ` +
        'The tab was probably reorganized — do not fall back to scanning for a plausible row, ' +
        'because a wrong pick produces a grouping that looks valid and is not.',
    );
  }

  const groups = {};
  let current = IDENTITY_GROUP;
  // Bounded to the header width: the real group row runs one cell wider than the
  // header (a stray "Workday Project ID"), and an unbounded walk would invent a
  // group for a column that does not exist.
  headers.forEach((header, i) => {
    const label = String(groupCells[i] ?? '').trim();
    if (label !== '') current = label;
    groups[slugColumn(header)] = current;
  });

  return groups;
}

/**
 * Turn the raw cell grid into projects keyed by project code.
 *
 * Every row is imported. The sync applies no validity judgement of its own — no
 * code-prefix rule, no denylist, and no reference to the count the sheet states
 * above its header. Rows the sheet should not contain are removed at the sheet.
 */
export function shapeProjects(cells) {
  const { headers, rows } = rowsToObjects(cells, HEADER_ROW);

  if (!headers.includes(PROJECT_CODE_HEADER)) {
    throw new SyncProjectsError(
      `The resolved header row has no "${PROJECT_CODE_HEADER}" column. ` +
        `Expected it at grid index ${HEADER_ROW} (sheet row ${HEADER_ROW + 1}); ` +
        `found: ${headers.join(', ')}. A shifted header row otherwise looks valid, ` +
        'so this is checked before any shaping.',
    );
  }

  const carried = headers.filter((h) => !EXCLUDED_COLUMNS.includes(h));

  // Collisions are rejected rather than resolved: silently keeping the last
  // writer would drop a whole column's data with no signal anywhere.
  const columnHeaders = {};
  for (const header of carried) {
    const slug = slugColumn(header);
    if (columnHeaders[slug] !== undefined) {
      throw new SyncProjectsError(
        `Headers "${columnHeaders[slug]}" and "${header}" both map to the attribute ` +
          `"${slug}". Rename one in the sheet — keeping both would silently drop one column.`,
      );
    }
    columnHeaders[slug] = header;
  }

  const projects = {};
  let skippedBlankRows = 0;

  rows.forEach((row, i) => {
    const sheetRow = HEADER_ROW + 2 + i; // 1-based, for a message an operator can act on
    const code = String(row[PROJECT_CODE_HEADER] ?? '').trim();
    const populated = carried.some((h) => String(row[h] ?? '').trim() !== '');

    // rowsToObjects keeps every grid row below the header and pads short rows,
    // so one blank spacer row in a hand-maintained sheet reaches us. Skipping it
    // is counted and reported; erroring would halt all syncing with no
    // hub-side fix available.
    if (!populated) {
      skippedBlankRows += 1;
      return;
    }

    if (code === '') {
      throw new SyncProjectsError(
        `Sheet row ${sheetRow} has a blank "${PROJECT_CODE_HEADER}" but carries data, ` +
          'so it cannot be keyed and must not be silently dropped. Give it a code, or clear the row.',
      );
    }

    if (projects[code] !== undefined) {
      throw new SyncProjectsError(
        `Project code "${code}" appears more than once (sheet row ${sheetRow} repeats it). ` +
          'Codes are the identity of a project, so one would silently overwrite the other.',
      );
    }

    const record = { project_code: code };
    for (const header of carried) {
      record[slugColumn(header)] = String(row[header] ?? '');
    }
    projects[code] = record;
  });

  return {
    projects,
    columnNames: [...headers],
    columnHeaders,
    // Parsed against the full header row for positional alignment, then
    // narrowed to the columns actually stored.
    columnGroups: Object.fromEntries(
      Object.entries(parseColumnGroups(cells, headers)).filter(
        ([slug]) => columnHeaders[slug] !== undefined,
      ),
    ),
    skippedBlankRows,
  };
}

// Attributes that describe the sync rather than the project, and so must not
// count toward whether a record changed.
const SYNC_METADATA_FIELDS = new Set(['first_seen_at', 'last_synced_at']);

function carriedFieldsDiffer(incoming, stored) {
  const keys = new Set([
    ...Object.keys(incoming).filter((k) => !SYNC_METADATA_FIELDS.has(k)),
    ...Object.keys(stored).filter((k) => !SYNC_METADATA_FIELDS.has(k)),
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
 * Computing them from keys alone would report every project as updated on every
 * run forever, making the run counts a constant rather than an answer to "did
 * anything change?".
 */
export function reconcile(incoming, stored) {
  const creates = [];
  const updates = [];

  for (const [code, record] of Object.entries(incoming)) {
    const existing = stored[code];
    if (existing === undefined) {
      creates.push(record);
    } else if (carriedFieldsDiffer(record, existing)) {
      // A whole-record write with no prior read cannot preserve when a project
      // first appeared, so carry it forward explicitly.
      updates.push(
        existing.first_seen_at ? { ...record, first_seen_at: existing.first_seen_at } : record,
      );
    }
  }

  const deletes = Object.keys(stored).filter((code) => incoming[code] === undefined);

  return { creates, updates, deletes };
}

// Tolerated single-run shrinkage before the run refuses.
const MAX_ROW_DROP_FRACTION = 0.1;
// Tolerated deletes as a fraction of what is stored. Bounds the case row count
// cannot see (see safetyVerdict).
const MAX_DELETE_FRACTION = 0.1;
// Hard minimum surviving project count. 53 projects today; 40 is low enough not
// to block a real portfolio contraction and high enough to terminate a
// compounding drain. Revisit if the portfolio changes materially — a hardcoded
// number goes stale silently.
export const ABSOLUTE_FLOOR = 40;

/**
 * Decide whether a run may write. Returns a refusal reason, or null to proceed.
 *
 * Four conditions, because a row-count comparison alone is blind twice:
 *
 *  - A header row shifted by two columns keys projects on "Project Name" —
 *    unique and populated on all 53 real rows, so neither the blank-code nor the
 *    duplicate check fires — and yields 53 deletes plus 53 creates at an
 *    UNCHANGED row count of 53. Only a delete ceiling sees that run.
 *  - Because the baseline moves on every success, repeated under-threshold drops
 *    compound: 53 -> 48 -> 44 -> 40 -> 36 drains the table without any single
 *    run tripping 10%. Only an absolute floor terminates that.
 *
 * Zero rows is never overridable; the rest are.
 */
export function safetyVerdict({ incoming, storedCount, deletes, baseline, override = false }) {
  if (incoming === 0) {
    return 'Refusing: the sheet returned zero rows. This is never overridable — a ' +
      'zero-row read means the tab, its share, or its shape changed, not that every ' +
      'project was retired.';
  }

  if (override) return null;

  if (baseline !== null && baseline !== undefined && incoming < baseline * (1 - MAX_ROW_DROP_FRACTION)) {
    return `Refusing: the sheet returned ${incoming} rows against a previous ${baseline}, ` +
      `a drop of more than ${MAX_ROW_DROP_FRACTION * 100}%. Re-run with the override if this is intended.`;
  }

  if (storedCount > 0 && deletes > storedCount * MAX_DELETE_FRACTION) {
    return `Refusing: the run would delete ${deletes} of ${storedCount} stored projects, ` +
      `more than ${MAX_DELETE_FRACTION * 100}%. Note the row count alone would not have caught ` +
      'this — a shifted header row produces a full delete-and-recreate at an unchanged count. ' +
      'Re-run with the override if this is intended.';
  }

  // Only meaningful when there is stored data to drain. With an empty table
  // there is nothing to protect, and applying the floor there would make the
  // first sync of any sheet smaller than the floor impossible.
  if (storedCount > 0 && incoming < ABSOLUTE_FLOOR) {
    return `Refusing: ${incoming} surviving projects is below the absolute floor of ` +
      `${ABSOLUTE_FLOOR}. Successive under-threshold drops compound, and this is the condition ` +
      'that stops them. Re-run with the override if the portfolio really is this small now.';
  }

  return null;
}
