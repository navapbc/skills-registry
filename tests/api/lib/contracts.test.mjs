import { describe, it, expect } from 'vitest';
import {
  RECORD_CONTRACT,
  RECORD_SEED_META,
  SEED_META_KEY,
  AI_RULINGS,
  isPublished,
  resolvePosture,
  resolveProject,
  collectContractIssues,
} from '../../../functions/api/lib/contracts.mjs';
import { RULINGS } from '../../../src/lib/contracts-render.mjs';

const POSTURES = [
  { id: 'allowed', label: 'AI ALLOWED — how to proceed', status: 'active' },
  { id: 'restricted', label: 'AI RESTRICTED — how to proceed', status: 'active' },
  { id: 'silent', label: 'AI SILENT — how to proceed', status: 'inactive' },
];

const PROJECTS = [
  { project_code: 'FC001', project_name: 'DOJ Civil Rights Portal & ADA', contract_name: 'DOJ CRT' },
  { project_code: 'ST033', project_name: 'Maryland Statewide Agile Teams', contract_name: '' },
];

const contract = (over = {}) => ({
  contract_id: 'labs-aecf', portfolio: 'LABS', project: '',
  ai_use_terms: '', publish: 'Yes', ...over,
});

describe('record type constants', () => {
  it('keeps the metadata record in its own partition', () => {
    expect(RECORD_CONTRACT).not.toBe(RECORD_SEED_META);
    expect(SEED_META_KEY).toBe('current');
  });
});

describe('AI_RULINGS', () => {
  it('names the same rulings, in the same order, as the renderer', () => {
    expect(AI_RULINGS).toEqual(RULINGS.map((r) => r.id));
  });
});

describe('isPublished', () => {
  it('publishes only an explicit Yes, whatever its case and spacing', () => {
    expect(isPublished(contract({ publish: 'Yes' }))).toBe(true);
    expect(isPublished(contract({ publish: ' yes ' }))).toBe(true);
    expect(isPublished(contract({ publish: 'No' }))).toBe(false);
    expect(isPublished(contract({ publish: '' }))).toBe(false);
    expect(isPublished({ contract_id: 'x' })).toBe(false);
  });
});

describe('resolvePosture', () => {
  it('matches a posture when the AI use terms are exactly its id', () => {
    expect(resolvePosture(contract({ ai_use_terms: 'Restricted' }), POSTURES).id).toBe('restricted');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolvePosture(contract({ ai_use_terms: '  restricted ' }), POSTURES).id).toBe('restricted');
  });

  it('matches nothing when the terms carry more than the ruling name', () => {
    // Nothing derives a ruling from free text.
    expect(resolvePosture(contract({ ai_use_terms: 'Allowed, disclosure required' }), POSTURES)).toBeNull();
  });

  it('returns null when no terms are recorded', () => {
    expect(resolvePosture(contract(), POSTURES)).toBeNull();
  });

  it('returns null when the value matches no posture record', () => {
    expect(resolvePosture(contract({ ai_use_terms: 'Prohibited' }), POSTURES)).toBeNull();
  });

  it('resolves a deactivated posture rather than reporting it as drift', () => {
    expect(resolvePosture(contract({ ai_use_terms: 'Silent' }), POSTURES).id).toBe('silent');
  });
});

describe('resolveProject', () => {
  it('matches the PROJECT value on project name', () => {
    const found = resolveProject(contract({ project: 'Maryland Statewide Agile Teams' }), PROJECTS);
    expect(found.project_code).toBe('ST033');
  });

  it('matches on contract name when the project name does not match', () => {
    expect(resolveProject(contract({ project: 'DOJ CRT' }), PROJECTS).project_code).toBe('FC001');
  });

  it('folds case and collapses internal whitespace', () => {
    const found = resolveProject(contract({ project: 'MARYLAND  STATEWIDE AGILE TEAMS' }), PROJECTS);
    expect(found.project_code).toBe('ST033');
  });

  it('returns null when nothing matches', () => {
    expect(resolveProject(contract({ project: 'MA PFML' }), PROJECTS)).toBeNull();
  });

  it('returns null when no project is recorded', () => {
    expect(resolveProject(contract(), PROJECTS)).toBeNull();
  });
});

describe('collectContractIssues', () => {
  it('reports a present-but-unmatched project with the raw sheet value', () => {
    const { unresolvedProjects } = collectContractIssues(
      [contract({ project: 'MA PFML', ai_use_terms: 'Allowed' })], PROJECTS, POSTURES,
    );
    expect(unresolvedProjects).toHaveLength(1);
    expect(unresolvedProjects[0].raw_value).toBe('MA PFML');
    expect(unresolvedProjects[0].contract_id).toBe('labs-aecf');
  });

  it('does not report a contract with no project at all', () => {
    const { unresolvedProjects } = collectContractIssues([contract()], PROJECTS, POSTURES);
    expect(unresolvedProjects).toHaveLength(0);
  });

  it('counts free-text terms as no posture, separately from an unresolvable project', () => {
    const { missingPosture, unresolvedProjects, unresolvedPostures } = collectContractIssues(
      [contract({ project: 'MA PFML', ai_use_terms: 'no language regarding AI' })], PROJECTS, POSTURES,
    );
    expect(missingPosture).toHaveLength(1);
    expect(unresolvedPostures).toHaveLength(0);
    expect(unresolvedProjects).toHaveLength(1);
  });

  it('reports a ruling name that matches no posture record', () => {
    const { unresolvedPostures, missingPosture } = collectContractIssues(
      [contract({ ai_use_terms: 'Conditional' })], PROJECTS, POSTURES,
    );
    expect(unresolvedPostures).toHaveLength(1);
    expect(unresolvedPostures[0].raw_value).toBe('Conditional');
    expect(missingPosture).toHaveLength(0);
  });

  it('reports nothing for a fully resolved contract', () => {
    const issues = collectContractIssues(
      [contract({ project: 'DOJ CRT', ai_use_terms: 'Allowed' })], PROJECTS, POSTURES,
    );
    expect(issues.unresolvedProjects).toHaveLength(0);
    expect(issues.missingPosture).toHaveLength(0);
    expect(issues.unresolvedPostures).toHaveLength(0);
  });

  it('skips a contract the contracts team did not publish', () => {
    const issues = collectContractIssues(
      [contract({ project: 'MA PFML', ai_use_terms: 'Conditional', publish: 'No' })], PROJECTS, POSTURES,
    );
    expect(issues).toEqual({ unresolvedProjects: [], missingPosture: [], unresolvedPostures: [] });
  });

  it('returns empty findings for an empty contract set', () => {
    const issues = collectContractIssues([], PROJECTS, POSTURES);
    expect(issues).toEqual({ unresolvedProjects: [], missingPosture: [], unresolvedPostures: [] });
  });

  it('reports a ruling name as unresolved when no posture records exist', () => {
    const { unresolvedPostures } = collectContractIssues(
      [contract({ ai_use_terms: 'Allowed' })], PROJECTS, [],
    );
    expect(unresolvedPostures).toHaveLength(1);
  });
});
