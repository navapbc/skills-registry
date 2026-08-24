import { describe, it, expect } from 'vitest';
import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  TITLE_ATTR,
  PROJECT_ATTR,
  USE_CASE_ATTR,
  EXPOSURE_ATTR,
  TAGS_ATTR,
  SUMMARY_ATTR,
  DESCRIPTION_ATTR,
  resolveProject,
  contractsForProject,
  collectInitiativeIssues,
} from '../../../functions/api/lib/initiatives.mjs';
import { PROJECT_NAME_ATTR as CONTRACTS_PROJECT_NAME_ATTR } from '../../../functions/api/lib/contracts.mjs';

// Real project names and codes from skills-registry-projects-staging, so the
// punctuation these have to survive is the punctuation that actually exists.
const PROJECTS = [
  {
    project_code: 'ST029',
    project_name: 'MD Agile Digital Experience Product Transformation (ADEPT)',
    contract_name: 'MD ADEPT WO-04',
  },
  {
    project_code: 'ST014',
    project_name: 'MD Public Benefit Innovation Fund (PBIF)',
    contract_name: 'MD PBIF',
  },
  { project_code: 'FC021', project_name: 'PA HR1 IDP 1 & 2', contract_name: '' },
  { project_code: 'LB001', project_name: 'User-Facing AI', contract_name: '' },
];

const initiative = (over = {}) => ({
  initiative_id: 'init-2',
  title: 'AskCA California-wide chatbot',
  project: '',
  ...over,
});

describe('record type constants', () => {
  it('keeps the metadata record in its own partition', () => {
    expect(RECORD_INITIATIVE).not.toBe(RECORD_SEED_META);
    expect(SEED_META_KEY).toBe('current');
  });

  it('names the slugged attributes the sync and the page both read', () => {
    // The sync asserts its own slug function reproduces these. If they drift, the
    // resolution reports zero findings — a false all-clear, not a visible failure.
    expect(TITLE_ATTR).toBe('title');
    expect(PROJECT_ATTR).toBe('project');
    expect(USE_CASE_ATTR).toBe('use_case');
    expect(EXPOSURE_ATTR).toBe('exposure');
    expect(TAGS_ATTR).toBe('tags');
    expect(SUMMARY_ATTR).toBe('summary');
    expect(DESCRIPTION_ATTR).toBe('description');
  });

  it('does not name the initiatives project attribute the way contracts names its own', () => {
    // routes/initiatives.mjs imports PROJECT_NAME_ATTR from contracts.mjs one line
    // from this module's import. Same name, different value, in the file that joins
    // the two datasets, is a trap — so the names are deliberately distinct.
    expect(PROJECT_ATTR).not.toBe(CONTRACTS_PROJECT_NAME_ATTR);
    expect(CONTRACTS_PROJECT_NAME_ATTR).toBe('project_name');
  });
});

describe('resolveProject', () => {
  it('resolves an exact project match against the project record', () => {
    const found = resolveProject(initiative({ project: 'User-Facing AI' }), PROJECTS);
    expect(found?.project_code).toBe('LB001');
  });

  it('resolves through case, surrounding whitespace, and collapsed inner whitespace', () => {
    const found = resolveProject(
      initiative({ project: '  user-facing   AI ' }),
      PROJECTS,
    );
    expect(found?.project_code).toBe('LB001');
  });

  it('resolves names carrying parentheses', () => {
    const found = resolveProject(
      initiative({ project: 'MD Public Benefit Innovation Fund (PBIF)' }),
      PROJECTS,
    );
    expect(found?.project_code).toBe('ST014');
  });

  it('resolves names carrying an ampersand', () => {
    const found = resolveProject(initiative({ project: 'PA HR1 IDP 1 & 2' }), PROJECTS);
    expect(found?.project_code).toBe('FC021');
  });

  it('returns null for a blank project name', () => {
    expect(resolveProject(initiative({ project: '' }), PROJECTS)).toBeNull();
    expect(resolveProject(initiative({ project: '   ' }), PROJECTS)).toBeNull();
  });

  it('returns null against an empty project list rather than throwing', () => {
    expect(resolveProject(initiative({ project: 'User-Facing AI' }), [])).toBeNull();
  });

  it('does NOT resolve a project named by its contract_name', () => {
    // Pins the deliberate divergence from resolveProject in contracts.mjs, which
    // matches both fields. Measured to rescue zero rows here, so widening this
    // should be a visible test change rather than a silent consistency edit.
    expect(resolveProject(initiative({ project: 'MD ADEPT WO-04' }), PROJECTS)).toBeNull();
  });
});

describe('contractsForProject', () => {
  const contract = (over = {}) => ({
    contract_id: 'c-default',
    project_name: '',
    ...over,
  });

  const UFAI = PROJECTS.find((p) => p.project_code === 'LB001');
  const ADEPT = PROJECTS.find((p) => p.project_code === 'ST029');

  it('keeps the contracts resolving to the project and drops the rest', () => {
    const mine = contract({ contract_id: 'c-1', project_name: 'User-Facing AI' });
    const theirs = contract({ contract_id: 'c-2', project_name: 'MD PBIF' });

    const found = contractsForProject(UFAI, [mine, theirs]);
    expect(found.map((c) => c.contract_id)).toEqual(['c-1']);
  });

  it('keeps a contract that resolves through contract_name, not project_name', () => {
    // The whole reason this runs the contracts-side rule. The initiatives rule
    // matches project_name alone and would drop this row silently.
    const byContractName = contract({ contract_id: 'c-3', project_name: 'MD ADEPT WO-04' });

    const found = contractsForProject(ADEPT, [byContractName]);
    expect(found.map((c) => c.contract_id)).toEqual(['c-3']);
  });

  it('resolves through case and collapsed whitespace', () => {
    const messy = contract({ contract_id: 'c-4', project_name: '  user-facing   ai ' });
    expect(contractsForProject(UFAI, [messy])).toHaveLength(1);
  });

  it('never matches a contract stating no project', () => {
    expect(contractsForProject(UFAI, [contract({ project_name: '' })])).toEqual([]);
  });

  it('returns nothing for a project that owns no contracts', () => {
    const theirs = contract({ contract_id: 'c-5', project_name: 'MD PBIF' });
    expect(contractsForProject(UFAI, [theirs])).toEqual([]);
  });

  it('returns nothing when there is no project to join on', () => {
    expect(contractsForProject(null, [contract({ project_name: 'User-Facing AI' })])).toEqual([]);
  });

  it('finds a project’s contracts even when another project’s contract_name collides', () => {
    // The regression case. Resolving across the WHOLE table hands this contract to
    // `decoy` — the first record matching on either field — so a membership test
    // against that answer returns nothing, and the page reports "No contracts on
    // file": a confident wrong answer. Asking the one-project question cannot.
    const decoy = { project_code: 'D', project_name: 'Something Else', contract_name: 'User-Facing AI' };
    const onUfai = contract({ contract_id: 'c-6', project_name: 'User-Facing AI' });

    expect(contractsForProject(UFAI, [onUfai]).map((c) => c.contract_id)).toEqual(['c-6']);
    // And the decoy legitimately claims it too — ambiguous data rendered honestly
    // on both pages rather than vanishing from one.
    expect(contractsForProject(decoy, [onUfai]).map((c) => c.contract_id)).toEqual(['c-6']);
  });

  it('does not group two code-less projects together', () => {
    // Membership is a name question, not a project_code one. Comparing codes would
    // match every code-less project to every other via `undefined === undefined`.
    const a = { project_name: 'Alpha', contract_name: '' };
    const b = { project_name: 'Beta', contract_name: '' };
    const onB = contract({ contract_id: 'c-7', project_name: 'Beta' });

    expect(contractsForProject(a, [onB])).toEqual([]);
    expect(contractsForProject(b, [onB]).map((c) => c.contract_id)).toEqual(['c-7']);
  });

  it('tolerates an absent contract list rather than throwing', () => {
    expect(contractsForProject(UFAI, undefined)).toEqual([]);
  });
});

describe('collectInitiativeIssues', () => {
  it('reports a stated name matching nothing, with the sheet’s own string', () => {
    // The exact shape of drift this alarm exists for: the workbook said
    // "…(ADEPT) WO4" while the projects table said "…(ADEPT)". Corrected in the
    // sheet on 2026-08-10; kept here as the regression case.
    const raw = 'MD Agile Digital Experience Product Transformation (ADEPT) WO4';
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project: raw })],
      PROJECTS,
    );

    expect(missingProject).toHaveLength(0);
    expect(unresolvedProjects).toHaveLength(1);
    expect(unresolvedProjects[0].raw_value).toBe(raw);
  });

  it('carries the raw value, never the normalized form', () => {
    const { unresolvedProjects } = collectInitiativeIssues(
      [initiative({ project: '  Nonexistent   Project  ' })],
      PROJECTS,
    );
    expect(unresolvedProjects[0].raw_value).toBe('Nonexistent   Project');
  });

  it('locates a finding by id and title so a human can find the sheet row', () => {
    const { unresolvedProjects } = collectInitiativeIssues(
      [initiative({ project: 'Nope', title: 'AskCA California-wide chatbot' })],
      PROJECTS,
    );
    expect(unresolvedProjects[0]).toMatchObject({
      initiative_id: 'init-2',
      title: 'AskCA California-wide chatbot',
    });
  });

  it('puts a blank project name in missingProject, not unresolvedProjects', () => {
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project: '' })],
      PROJECTS,
    );
    expect(unresolvedProjects).toHaveLength(0);
    expect(missingProject).toHaveLength(1);
    expect(missingProject[0]).not.toHaveProperty('raw_value');
  });

  it('separates the two buckets over a mixed set and double-counts nothing', () => {
    const initiatives = [
      initiative({ initiative_id: 'a', project: 'User-Facing AI' }),
      initiative({ initiative_id: 'b', project: '' }),
      initiative({ initiative_id: 'c', project: '' }),
      initiative({ initiative_id: 'd', project: 'Nope' }),
    ];
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(initiatives, PROJECTS);

    expect(unresolvedProjects.map((u) => u.initiative_id)).toEqual(['d']);
    expect(missingProject.map((m) => m.initiative_id)).toEqual(['b', 'c']);
    expect(unresolvedProjects.length + missingProject.length).toBe(3);
  });

  it('reports nothing for a fully resolved set', () => {
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project: 'PA HR1 IDP 1 & 2' })],
      PROJECTS,
    );
    expect(unresolvedProjects).toHaveLength(0);
    expect(missingProject).toHaveLength(0);
  });
});
