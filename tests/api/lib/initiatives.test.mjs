import { describe, it, expect } from 'vitest';
import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  TITLE_ATTR,
  PROJECT_NAME_ATTR,
  USE_CASE_LABEL_ATTR,
  EXPOSURE_ATTR,
  TAGS_ATTR,
  resolveProject,
  collectInitiativeIssues,
} from '../../../functions/api/lib/initiatives.mjs';

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
  initiative_id: 'askca-california-wide-chatbot',
  title: 'AskCA California-wide chatbot',
  project_name: '',
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
    expect(PROJECT_NAME_ATTR).toBe('project_name');
    expect(USE_CASE_LABEL_ATTR).toBe('use_case_label');
    expect(EXPOSURE_ATTR).toBe('exposure');
    expect(TAGS_ATTR).toBe('tags');
  });
});

describe('resolveProject', () => {
  it('resolves an exact project_name match', () => {
    const found = resolveProject(initiative({ project_name: 'User-Facing AI' }), PROJECTS);
    expect(found?.project_code).toBe('LB001');
  });

  it('resolves through case, surrounding whitespace, and collapsed inner whitespace', () => {
    const found = resolveProject(
      initiative({ project_name: '  user-facing   AI ' }),
      PROJECTS,
    );
    expect(found?.project_code).toBe('LB001');
  });

  it('resolves names carrying parentheses', () => {
    const found = resolveProject(
      initiative({ project_name: 'MD Public Benefit Innovation Fund (PBIF)' }),
      PROJECTS,
    );
    expect(found?.project_code).toBe('ST014');
  });

  it('resolves names carrying an ampersand', () => {
    const found = resolveProject(initiative({ project_name: 'PA HR1 IDP 1 & 2' }), PROJECTS);
    expect(found?.project_code).toBe('FC021');
  });

  it('returns null for a blank project name', () => {
    expect(resolveProject(initiative({ project_name: '' }), PROJECTS)).toBeNull();
    expect(resolveProject(initiative({ project_name: '   ' }), PROJECTS)).toBeNull();
  });

  it('returns null against an empty project list rather than throwing', () => {
    expect(resolveProject(initiative({ project_name: 'User-Facing AI' }), [])).toBeNull();
  });

  it('does NOT resolve a project named by its contract_name', () => {
    // Pins the deliberate divergence from resolveProject in contracts.mjs, which
    // matches both fields. Measured to rescue zero rows here, so widening this
    // should be a visible test change rather than a silent consistency edit.
    expect(resolveProject(initiative({ project_name: 'MD ADEPT WO-04' }), PROJECTS)).toBeNull();
  });
});

describe('collectInitiativeIssues', () => {
  it('reports a stated name matching nothing, with the sheet’s own string', () => {
    // The exact shape of drift this alarm exists for: the workbook said
    // "…(ADEPT) WO4" while the projects table said "…(ADEPT)". Corrected in the
    // sheet on 2026-08-10; kept here as the regression case.
    const raw = 'MD Agile Digital Experience Product Transformation (ADEPT) WO4';
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project_name: raw })],
      PROJECTS,
    );

    expect(missingProject).toHaveLength(0);
    expect(unresolvedProjects).toHaveLength(1);
    expect(unresolvedProjects[0].raw_value).toBe(raw);
  });

  it('carries the raw value, never the normalized form', () => {
    const { unresolvedProjects } = collectInitiativeIssues(
      [initiative({ project_name: '  Nonexistent   Project  ' })],
      PROJECTS,
    );
    expect(unresolvedProjects[0].raw_value).toBe('Nonexistent   Project');
  });

  it('locates a finding by id and title so a human can find the sheet row', () => {
    const { unresolvedProjects } = collectInitiativeIssues(
      [initiative({ project_name: 'Nope', title: 'AskCA California-wide chatbot' })],
      PROJECTS,
    );
    expect(unresolvedProjects[0]).toMatchObject({
      initiative_id: 'askca-california-wide-chatbot',
      title: 'AskCA California-wide chatbot',
    });
  });

  it('puts a blank project name in missingProject, not unresolvedProjects', () => {
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project_name: '' })],
      PROJECTS,
    );
    expect(unresolvedProjects).toHaveLength(0);
    expect(missingProject).toHaveLength(1);
    expect(missingProject[0]).not.toHaveProperty('raw_value');
  });

  it('separates the two buckets over a mixed set and double-counts nothing', () => {
    const initiatives = [
      initiative({ initiative_id: 'a', project_name: 'User-Facing AI' }),
      initiative({ initiative_id: 'b', project_name: '' }),
      initiative({ initiative_id: 'c', project_name: '' }),
      initiative({ initiative_id: 'd', project_name: 'Nope' }),
    ];
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(initiatives, PROJECTS);

    expect(unresolvedProjects.map((u) => u.initiative_id)).toEqual(['d']);
    expect(missingProject.map((m) => m.initiative_id)).toEqual(['b', 'c']);
    expect(unresolvedProjects.length + missingProject.length).toBe(3);
  });

  it('reports nothing for a fully resolved set', () => {
    const { unresolvedProjects, missingProject } = collectInitiativeIssues(
      [initiative({ project_name: 'PA HR1 IDP 1 & 2' })],
      PROJECTS,
    );
    expect(unresolvedProjects).toHaveLength(0);
    expect(missingProject).toHaveLength(0);
  });
});
