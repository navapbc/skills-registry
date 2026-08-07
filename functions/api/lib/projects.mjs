// Shared knowledge about synced project records: the table's record types, the
// archetype column names, and the rule for deciding whether an archetype value
// in the sheet names a real archetype record.
//
// This module is the single home for the comparison rule because it has two
// callers that must never disagree:
//
//   - functions/api/routes/projects.mjs resolves on READ, so adding a missing
//     archetype clears findings on the next page load rather than the next sync.
//   - scripts/lib/sync-projects.mjs resolves at SYNC time, so a typo in the
//     sheet fails the scheduled run instead of waiting for someone to open an
//     unlinked admin page.
//
// The dependency direction is forced: the API Lambda zip is built from
// functions/api/ alone, so nothing here may import from scripts/ or src/.
// scripts/ importing from here is fine and is what the seed already does.

// Partition-key values. The metadata record lives in its own partition so it can
// never be returned among the projects.
export const RECORD_PROJECT = 'project';
export const RECORD_SYNC_META = 'sync_meta';

// The metadata partition holds exactly one row.
export const SYNC_META_KEY = 'current';

// Written before a run applies and overwritten when it completes. The
// distinction matters: a run that wrote projects and then died leaves a
// populated table whose metadata is absent, which would otherwise read as
// "never synced" — a populated table labelled empty.
export const SYNC_IN_PROGRESS = 'in_progress';
export const SYNC_COMPLETE = 'complete';

// The three states a caller can observe. Absent metadata is not an error.
export const SYNC_NEVER = 'never_synced';

// Stored attribute names for the two archetype columns. Defined here rather than
// in the sync library so there is one definition rather than two agreeing
// copies — scripts/lib/sync-projects.mjs imports these and asserts its own slug
// function reproduces them. A mismatch would report zero drift, which is a false
// all-clear rather than a visible failure.
export const ARCHETYPE_PRIMARY_SLUG = 'archetype_primary';
export const ARCHETYPE_ADDITIONAL_SLUG = 'archetype_additional';

// The header text each slug came from, for messages that name the sheet column
// an author has to go fix.
export const ARCHETYPE_COLUMN_LABELS = {
  [ARCHETYPE_PRIMARY_SLUG]: 'Archetype (Primary)',
  [ARCHETYPE_ADDITIONAL_SLUG]: 'Archetype (Additional)',
};

// Only the additional column holds a list today. Written as a character class so
// a second separator is a one-line change rather than a rewrite.
const SEPARATOR = /[,]/;

/**
 * Normalize a label for comparison only.
 *
 * Case-folds, trims, and collapses internal whitespace, so `product  team ` and
 * `Product Team` match. The normalized form must never reach a response — what
 * an author needs to see is the string exactly as the sheet holds it.
 */
export function normalizeLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Split an archetype cell into the individual values it names.
 *
 * Returns raw (untrimmed-of-meaning) strings with surrounding whitespace
 * removed and empties dropped, so `Strategic Consulting Team, Data Modernization
 * Team` yields two values and a cell of only separators yields none.
 */
export function splitArchetypeCell(value) {
  return String(value ?? '')
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Compare one project's archetype columns against the known archetype records.
 *
 * Returns two kinds of finding, deliberately distinguished:
 *
 *   - `unresolved` — a value is present and matches no record. This is a typo or
 *     a renamed archetype, and it is what fails a sync run.
 *   - `missing` — the primary column is empty. A newly added project whose
 *     archetype has not been assigned yet is normal in-progress state, not drift.
 *     It carries no raw value, because there is nothing to reproduce. Failing on
 *     it would train people to ignore red runs.
 *
 * Deactivated archetype records still count as resolved: a deactivated record is
 * a real record, and treating its projects as drift would report a deliberate
 * admin action as an error.
 *
 * The additional column being empty is not a finding at all — most projects have
 * no secondary archetype.
 */
export function findArchetypeIssues(project, archetypeRecords) {
  const known = new Set(archetypeRecords.map((r) => normalizeLabel(r.label)));
  const unresolved = [];
  const missing = [];

  const locate = (column) => ({
    project_code: project.project_code,
    project_name: project.project_name ?? '',
    column: ARCHETYPE_COLUMN_LABELS[column] ?? column,
  });

  const primaryValues = splitArchetypeCell(project[ARCHETYPE_PRIMARY_SLUG]);
  if (primaryValues.length === 0) {
    missing.push(locate(ARCHETYPE_PRIMARY_SLUG));
  }

  for (const column of [ARCHETYPE_PRIMARY_SLUG, ARCHETYPE_ADDITIONAL_SLUG]) {
    for (const value of splitArchetypeCell(project[column])) {
      if (!known.has(normalizeLabel(value))) {
        // `raw_value` is the sheet's own string, never the normalized form.
        unresolved.push({ ...locate(column), raw_value: value });
      }
    }
  }

  return { unresolved, missing };
}

/** Aggregate findArchetypeIssues across many projects. */
export function collectArchetypeIssues(projects, archetypeRecords) {
  const unresolved = [];
  const missing = [];
  for (const project of projects) {
    const issues = findArchetypeIssues(project, archetypeRecords);
    unresolved.push(...issues.unresolved);
    missing.push(...issues.missing);
  }
  return { unresolved, missing };
}
