import { describe, it, expect } from 'vitest';
import {
  RECORD_CONTRACT,
  RECORD_SEED_META,
  SEED_META_KEY,
  resolvePosture,
  resolveProject,
  collectContractIssues,
} from '../../../functions/api/lib/contracts.mjs';

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
  contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF',
  ai_posture: '', project_name: '', ...over,
});

describe('record type constants', () => {
  it('keeps the metadata record in its own partition', () => {
    expect(RECORD_CONTRACT).not.toBe(RECORD_SEED_META);
    expect(SEED_META_KEY).toBe('current');
  });
});

describe('resolvePosture', () => {
  it('matches a posture by id', () => {
    expect(resolvePosture(contract({ ai_posture: 'restricted' }), POSTURES).id).toBe('restricted');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolvePosture(contract({ ai_posture: '  Restricted ' }), POSTURES).id).toBe('restricted');
  });

  it('returns null when no posture is recorded', () => {
    expect(resolvePosture(contract(), POSTURES)).toBeNull();
  });

  it('returns null when the value matches no posture record', () => {
    expect(resolvePosture(contract({ ai_posture: 'prohibited' }), POSTURES)).toBeNull();
  });

  it('resolves a deactivated posture rather than reporting it as drift', () => {
    expect(resolvePosture(contract({ ai_posture: 'silent' }), POSTURES).id).toBe('silent');
  });
});

describe('resolveProject', () => {
  it('matches on project name', () => {
    const found = resolveProject(contract({ project_name: 'Maryland Statewide Agile Teams' }), PROJECTS);
    expect(found.project_code).toBe('ST033');
  });

  it('matches on contract name when the project name does not match', () => {
    expect(resolveProject(contract({ project_name: 'DOJ CRT' }), PROJECTS).project_code).toBe('FC001');
  });

  it('folds case and collapses internal whitespace', () => {
    const found = resolveProject(contract({ project_name: 'maryland  statewide agile TEAMS' }), PROJECTS);
    expect(found.project_code).toBe('ST033');
  });

  it('returns null when nothing matches', () => {
    expect(resolveProject(contract({ project_name: 'MA PFML' }), PROJECTS)).toBeNull();
  });

  it('returns null when no project name is recorded', () => {
    expect(resolveProject(contract(), PROJECTS)).toBeNull();
  });
});

describe('collectContractIssues', () => {
  it('reports a present-but-unmatched project name with the raw sheet value', () => {
    const { unresolvedProjects } = collectContractIssues(
      [contract({ project_name: 'MA PFML', ai_posture: 'allowed' })], PROJECTS, POSTURES,
    );
    expect(unresolvedProjects).toHaveLength(1);
    expect(unresolvedProjects[0].raw_value).toBe('MA PFML');
    expect(unresolvedProjects[0].contract_id).toBe('labs-aecf');
  });

  it('does not report a contract with no project name at all', () => {
    // 82 of 119 rows have not been through the normalization pass; reporting them
    // would bury the entries someone can act on.
    const { unresolvedProjects } = collectContractIssues([contract()], PROJECTS, POSTURES);
    expect(unresolvedProjects).toHaveLength(0);
  });

  it('counts a contract with no posture separately from an unresolvable project', () => {
    const { missingPosture, unresolvedProjects } = collectContractIssues(
      [contract({ project_name: 'MA PFML' })], PROJECTS, POSTURES,
    );
    expect(missingPosture).toHaveLength(1);
    expect(unresolvedProjects).toHaveLength(1);
  });

  it('reports a posture value that matches no record', () => {
    const { unresolvedPostures, missingPosture } = collectContractIssues(
      [contract({ ai_posture: 'prohibited' })], PROJECTS, POSTURES,
    );
    expect(unresolvedPostures).toHaveLength(1);
    expect(unresolvedPostures[0].raw_value).toBe('prohibited');
    expect(missingPosture).toHaveLength(0);
  });

  it('reports nothing for a fully resolved contract', () => {
    const issues = collectContractIssues(
      [contract({ project_name: 'DOJ CRT', ai_posture: 'allowed' })], PROJECTS, POSTURES,
    );
    expect(issues.unresolvedProjects).toHaveLength(0);
    expect(issues.missingPosture).toHaveLength(0);
    expect(issues.unresolvedPostures).toHaveLength(0);
  });

  it('returns empty findings for an empty contract set', () => {
    const issues = collectContractIssues([], PROJECTS, POSTURES);
    expect(issues).toEqual({ unresolvedProjects: [], missingPosture: [], unresolvedPostures: [] });
  });

  it('reports every contract as posture-missing when no posture records exist', () => {
    const { unresolvedPostures } = collectContractIssues(
      [contract({ ai_posture: 'allowed' })], PROJECTS, [],
    );
    expect(unresolvedPostures).toHaveLength(1);
  });
});
