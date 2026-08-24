// Shared knowledge about populated initiative records: the table's record types,
// the population states, and the rule for resolving an initiative's project
// against the project records.
//
// This module is the single home for the resolution rule because it has two
// callers that must never disagree:
//
//   - functions/api/routes/initiatives.mjs resolves on READ, so fixing a project
//     name in the sheet clears the finding on the next page load rather than the
//     next sync run.
//   - scripts/lib/sync-initiatives-apply.mjs resolves after apply, so a typo
//     fails the workflow instead of waiting for someone to open the page.
//
// The dependency direction is forced: the API Lambda zip is built from
// functions/api/ alone, so nothing here may import from scripts/ or src/.
// scripts/ importing from here is fine and is what the sync already does.

import { normalizeLabel } from './projects.mjs';
import { resolveProject as resolveContractProject } from './contracts.mjs';

// Partition-key values. The metadata record lives in its own partition so it can
// never be returned among the initiatives.
export const RECORD_INITIATIVE = 'initiative';
export const RECORD_SEED_META = 'seed_meta';

// The metadata partition holds exactly one row.
export const SEED_META_KEY = 'current';

// Written before a run applies and overwritten when it completes. The
// distinction matters: a run that wrote initiatives and then died leaves a
// populated table whose metadata is absent, which would otherwise read as
// "never populated" — a populated table labelled empty.
//
// These values coincide with the ones in contracts.mjs and are declared here
// rather than imported from it on purpose. The two tables' lifecycles are
// independent — one is CI-populated on dispatch, the other operator-populated —
// and a shared constant would couple them for no gain.
export const SEED_IN_PROGRESS = 'in_progress';
export const SEED_COMPLETE = 'complete';

// The three states a caller can observe. Absent metadata is not an error.
export const SEED_NEVER = 'never_populated';

// Stored attribute names, in their slugged form, that the resolution rule and the
// page's filters read. Defined here rather than spelled inline at each call site
// so a rename is one edit rather than a hunt, and so the sync can assert its own
// slug function reproduces them — a mismatch there yields a false all-clear
// rather than a visible failure.
//
// TITLE_ATTR no longer sources the range key. That comes from the sheet's own `id`
// column now, which is why retitling an initiative is an ordinary update rather
// than a re-key. Do not restore a title-derived key on the strength of this
// constant's name.
//
// PROJECT_ATTR is deliberately NOT called PROJECT_NAME_ATTR. contracts.mjs exports
// a constant by that name whose value is still `project_name`, and
// routes/initiatives.mjs imports both — one line apart, in the file that joins the
// two datasets. Same name with a different value there would be a trap.
export const TITLE_ATTR = 'title';
export const PROJECT_ATTR = 'project';
export const USE_CASE_ATTR = 'use_case';
export const EXPOSURE_ATTR = 'exposure';
export const TAGS_ATTR = 'tags';
export const SUMMARY_ATTR = 'summary';
export const DESCRIPTION_ATTR = 'description';

/**
 * Find the project an initiative belongs to, or null.
 *
 * Matches the initiative's `project` against the project's own `project_name`,
 * case-folded and whitespace-collapsed. The sheet is hand-maintained and nothing
 * enforces casing at write time.
 *
 * The two sides are spelled differently and that is not an oversight: the v2
 * sheet's column is `Project`, and the projects table's attribute is
 * `project_name`. This function is the seam between them.
 *
 * `contract_name` is deliberately NOT consulted, which is the one place this
 * diverges from resolveProject in contracts.mjs. That function matches both
 * fields because the contracts survey's naming follows neither consistently.
 * Here it was measured: against the real workbook and the 53 stored projects,
 * matching `project_name` alone resolves all 14 stated names, and adding a
 * `contract_name` fallback rescues zero additional rows. The v2 sheet carries the
 * same 14 distinct names across 23 rows, so the measurement still holds. The
 * narrower rule costs nothing, so it is the rule the requirement asked for. Do not
 * widen it for symmetry with contracts.mjs — widening should follow a measurement,
 * not a consistency argument.
 */
export function resolveProject(initiative, projectRecords) {
  const value = normalizeLabel(initiative?.[PROJECT_ATTR]);
  if (value === '') return null;
  return projectRecords.find((p) => normalizeLabel(p.project_name) === value) ?? null;
}

/**
 * The contracts that belong to a project, for the initiative detail page.
 *
 * The join deliberately runs the CONTRACTS-side resolution rule
 * (`resolveProject` from ./contracts.mjs), not the one above. The two differ:
 * contracts match a project's `project_name` OR its `contract_name`, because the
 * survey's naming follows neither consistently — measured at 23 of 37 resolving
 * only across the pair. Running the initiatives rule here instead would silently
 * drop every contract that resolves via `contract_name`.
 *
 * The rule is applied against a list holding ONLY this project, which is what makes
 * the question "does this contract name this project?" rather than "which project
 * does this contract resolve to first?". The difference is not academic: the
 * contracts rule returns the first record matching on EITHER field, so if some other
 * project's `contract_name` normalizes to this project's `project_name`, a
 * whole-table resolve hands back that other record. Membership tested by identity or
 * by `project_code` against that answer then yields nothing, and the page states "No
 * contracts on file" — a confident wrong answer rather than an absent one. Asking
 * the one-project question cannot go wrong that way, and it drops the join from
 * O(contracts × projects) to O(contracts) besides.
 *
 * A consequence worth naming: with colliding names a contract can belong to two
 * projects and appear on both. That is the honest rendering of ambiguous data —
 * better than vanishing from one of them.
 */
export function contractsForProject(project, contracts) {
  if (!project) return [];
  return (contracts ?? []).filter(
    (contract) => resolveContractProject(contract, [project]) !== null,
  );
}

/**
 * Aggregate the two findings a reader can act on, kept separate because they have
 * different severities as well as different fixes.
 *
 *   - `unresolvedProjects` — a project name is STATED and matches nothing. This
 *     is a typo or a renamed project, and it is what FAILS a sync run. Zero rows
 *     as of 2026-08-24, which is what makes the alarm worth reading.
 *   - `missingProject` — no project name at all. Fixed in the sheet if the
 *     initiative does belong to a project, and otherwise not a defect: plenty of
 *     initiatives are internal. This only WARNS. 23 of 46 rows as of 2026-08-24,
 *     and failing on half the sheet would make every run red and train the
 *     operator to ignore it.
 *
 * The severity split is where this diverges from collectContractIssues, where a
 * stated-but-unresolved name also only warns. State that precisely if you are
 * comparing the two: the divergence is on `unresolvedProjects`, not on the
 * absent-value bucket, and flattening both to one severity loses the alarm.
 */
export function collectInitiativeIssues(initiatives, projectRecords) {
  const unresolvedProjects = [];
  const missingProject = [];

  for (const initiative of initiatives) {
    const locate = () => ({
      initiative_id: initiative.initiative_id,
      title: initiative[TITLE_ATTR] ?? '',
    });

    const projectName = String(initiative[PROJECT_ATTR] ?? '').trim();
    if (projectName === '') {
      missingProject.push(locate());
    } else if (resolveProject(initiative, projectRecords) === null) {
      // `raw_value` is the sheet's own string, never the normalized form — what
      // an author needs to see is the value exactly as the sheet holds it.
      unresolvedProjects.push({ ...locate(), raw_value: projectName });
    }
  }

  return { unresolvedProjects, missingProject };
}
