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
//
// The posture is read from the survey's own AI use terms (column L), exactly as
// written. A contract resolves to a posture only when that whole cell is a posture
// id ("Allowed"); a cell carrying more ("Allowed, disclosure required") resolves to
// nothing, because nothing here derives a ruling from free text.
export const POSTURE_ATTR = 'ai_use_terms';
export const PROJECT_NAME_ATTR = 'project';

// The five AI rulings the Contract Explorer defines, in its display order. The
// renderer's RULINGS list in src/lib/contracts-render.mjs carries their names and
// definitions, and a test holds the two id lists equal.
export const AI_RULINGS = ['allowed', 'restricted', 'silent', 'prohibited', 'conditional'];

// The survey's publish flag. Only a contract whose flag reads "Yes" is served.
export const PUBLISH_ATTR = 'publish';

/**
 * Whether the contracts team marked a contract for the Contract Explorer.
 *
 * Only an explicit "Yes" publishes. A blank flag hides the contract, because the
 * workbook is attorney-client privileged and the team decides what is shown.
 */
export const isPublished = (contract) =>
  String(contract?.[PUBLISH_ATTR] ?? '').trim().toLowerCase() === 'yes';

/**
 * Find the posture record a contract names, or null.
 *
 * An id lookup rather than a label match — unlike the archetype join, which
 * matches on display labels. Comparison is normalized, because the survey is
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
 * Matches the contract's PROJECT value against both the project's own name and
 * its contract name, case-folded and whitespace-collapsed. Two fields rather
 * than one because the survey's naming follows neither consistently.
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
 * Aggregate the three findings a reader can act on, kept separate because they
 * have different fixes and different owners.
 *
 *   - `unresolvedProjects` — a project name is present and matches nothing. Fixed
 *     in the sheet, or by the project appearing in the projects table.
 *   - `missingPosture` — the AI use terms are not one of AI_RULINGS on their own.
 *     Column L is free text ("Allowed, disclosure required"), so this is the
 *     survey's usual state rather than a defect.
 *   - `unresolvedPostures` — the AI use terms are exactly a ruling, but no posture
 *     record carries that id (eg: "Conditional" before its posture is added).
 *     Fixed on the Policy Guidance tab.
 *
 * Unpublished contracts are skipped: the Contract Explorer never shows them, so a
 * finding about one is nothing a reader can see.
 */
export function collectContractIssues(contracts, projectRecords, postureRecords) {
  const unresolvedProjects = [];
  const missingPosture = [];
  const unresolvedPostures = [];

  for (const contract of contracts.filter(isPublished)) {
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
    if (!AI_RULINGS.includes(normalizeLabel(postureValue))) {
      missingPosture.push(locate());
    } else if (resolvePosture(contract, postureRecords) === null) {
      unresolvedPostures.push({ ...locate(), raw_value: postureValue });
    }
  }

  return { unresolvedProjects, missingPosture, unresolvedPostures };
}
