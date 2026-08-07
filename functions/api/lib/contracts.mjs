// Shared knowledge about populated contract records: the table's record types,
// the population states, and the rules for resolving a contract's posture and
// project against the records that own them.
//
// This module is the single home for the resolution rules because they have two
// callers that must never disagree:
//
//   - functions/api/routes/projects.mjs resolves on READ, so adding a missing
//     project or fixing a sheet value clears findings on the next page load
//     rather than the next population run.
//   - scripts/lib/sync-contracts-apply.mjs resolves after apply, so the operator
//     sees the same findings the admin tab will show.
//
// The dependency direction is forced: the API Lambda zip is built from
// functions/api/ alone, so nothing here may import from scripts/ or src/.
// scripts/ importing from here is fine and is what the population already does.

import { normalizeLabel } from './projects.mjs';

// Partition-key values. The metadata record lives in its own partition so it can
// never be returned among the contracts.
export const RECORD_CONTRACT = 'contract';
export const RECORD_SEED_META = 'seed_meta';

// The metadata partition holds exactly one row.
export const SEED_META_KEY = 'current';

// Written before a run applies and overwritten when it completes. The
// distinction matters: a run that wrote contracts and then died leaves a
// populated table whose metadata is absent, which would otherwise read as
// "never populated" — a populated table labelled empty.
export const SEED_IN_PROGRESS = 'in_progress';
export const SEED_COMPLETE = 'complete';

// The three states a caller can observe. Absent metadata is not an error.
export const SEED_NEVER = 'never_populated';

// Stored attribute names the resolution rules read. Defined here rather than
// spelled inline at each call site so a rename is one edit rather than a hunt.
export const POSTURE_ATTR = 'ai_posture';
export const PROJECT_NAME_ATTR = 'project_name';

/**
 * Find the posture record a contract names, or null.
 *
 * Values in the survey are already exact posture ids, so this is an id lookup
 * rather than a label match — unlike the archetype join, which matches on
 * display labels. Comparison is still normalized, because the survey is
 * hand-maintained and nothing enforces casing at write time.
 *
 * Deactivated postures still resolve: a deactivated record is a real record, and
 * reporting its contracts as drift would surface a deliberate admin action as an
 * error.
 */
export function resolvePosture(contract, postureRecords) {
  const value = normalizeLabel(contract?.[POSTURE_ATTR]);
  if (value === '') return null;
  return postureRecords.find((p) => normalizeLabel(p.id) === value) ?? null;
}

/**
 * Find the project a contract belongs to, or null.
 *
 * Matches the contract's project name against both the project's own name and
 * its contract name, case-folded and whitespace-collapsed. Two fields rather
 * than one because the survey's naming follows neither consistently — measured
 * at 23 of 37 resolving across the pair.
 */
export function resolveProject(contract, projectRecords) {
  const value = normalizeLabel(contract?.[PROJECT_NAME_ATTR]);
  if (value === '') return null;
  return (
    projectRecords.find(
      (p) => normalizeLabel(p.project_name) === value || normalizeLabel(p.contract_name) === value,
    ) ?? null
  );
}

/**
 * Aggregate the two findings a reader can act on, kept separate because they
 * have different fixes and different owners.
 *
 *   - `unresolvedProjects` — a project name is present and matches nothing. Fixed
 *     in the sheet, or by the project appearing in the projects table.
 *   - `missingPosture` — no posture recorded. Fixed by the survey being filled
 *     in, which is not this repo's to do. It carries no raw value because there
 *     is nothing to reproduce.
 *
 * A contract with no project name at all is not a finding: most of the survey
 * has not been through the normalization pass, and reporting all of it as drift
 * would bury the entries someone can actually act on.
 */
export function collectContractIssues(contracts, projectRecords, postureRecords) {
  const unresolvedProjects = [];
  const missingPosture = [];
  const unresolvedPostures = [];

  for (const contract of contracts) {
    const locate = () => ({
      contract_id: contract.contract_id,
      project: contract.project ?? '',
      portfolio: contract.portfolio ?? '',
    });

    const projectName = String(contract[PROJECT_NAME_ATTR] ?? '').trim();
    if (projectName !== '' && resolveProject(contract, projectRecords) === null) {
      // `raw_value` is the sheet's own string, never the normalized form — what
      // an author needs to see is the value exactly as the sheet holds it.
      unresolvedProjects.push({ ...locate(), raw_value: projectName });
    }

    const postureValue = String(contract[POSTURE_ATTR] ?? '').trim();
    if (postureValue === '') {
      missingPosture.push(locate());
    } else if (resolvePosture(contract, postureRecords) === null) {
      unresolvedPostures.push({ ...locate(), raw_value: postureValue });
    }
  }

  return { unresolvedProjects, missingPosture, unresolvedPostures };
}
