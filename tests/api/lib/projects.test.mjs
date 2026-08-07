import { describe, it, expect } from 'vitest';
import {
  ARCHETYPE_PRIMARY_SLUG,
  ARCHETYPE_ADDITIONAL_SLUG,
  RECORD_PROJECT,
  RECORD_SYNC_META,
  normalizeLabel,
  splitArchetypeCell,
  findArchetypeIssues,
  collectArchetypeIssues,
} from '../../../functions/api/lib/projects.mjs';

const ARCHETYPES = [
  { id: 'product-team', label: 'Product Team', status: 'active' },
  { id: 'platform-team', label: 'Platform Team', status: 'active' },
  { id: 'strategic-consulting-team', label: 'Strategic Consulting Team', status: 'active' },
  { id: 'data-modernization-team', label: 'Data Modernization Team', status: 'active' },
];

function project(overrides = {}) {
  return {
    project_code: 'FC026',
    project_name: 'CO COBEES',
    [ARCHETYPE_PRIMARY_SLUG]: 'Product Team',
    [ARCHETYPE_ADDITIONAL_SLUG]: '',
    ...overrides,
  };
}

describe('record types', () => {
  it('keeps projects and sync metadata in separate partitions', () => {
    expect(RECORD_PROJECT).not.toBe(RECORD_SYNC_META);
  });
});

describe('normalizeLabel', () => {
  it('case-folds, trims, and collapses internal whitespace', () => {
    expect(normalizeLabel('  Product   Team ')).toBe('product team');
    expect(normalizeLabel('PRODUCT TEAM')).toBe('product team');
  });

  it('treats nullish as empty', () => {
    expect(normalizeLabel(undefined)).toBe('');
    expect(normalizeLabel(null)).toBe('');
  });
});

describe('splitArchetypeCell', () => {
  it('splits on comma and trims each value', () => {
    expect(splitArchetypeCell('Strategic Consulting Team, Data Modernization Team'))
      .toEqual(['Strategic Consulting Team', 'Data Modernization Team']);
  });

  it('yields nothing for an empty cell', () => {
    expect(splitArchetypeCell('')).toEqual([]);
  });

  it('yields nothing for a cell of only separators and whitespace', () => {
    expect(splitArchetypeCell(' , ,  ')).toEqual([]);
  });
});

describe('findArchetypeIssues', () => {
  it('reports nothing when every value resolves', () => {
    const issues = findArchetypeIssues(project(), ARCHETYPES);
    expect(issues.unresolved).toEqual([]);
    expect(issues.missing).toEqual([]);
  });

  // 22 of 53 real rows carry a secondary archetype; 4 carry two.
  it('resolves both values of a comma-separated additional cell', () => {
    const issues = findArchetypeIssues(
      project({ [ARCHETYPE_ADDITIONAL_SLUG]: 'Strategic Consulting Team, Data Modernization Team' }),
      ARCHETYPES,
    );
    expect(issues.unresolved).toEqual([]);
  });

  it('reports an unresolved value with the sheet string verbatim', () => {
    const issues = findArchetypeIssues(project({ [ARCHETYPE_PRIMARY_SLUG]: 'Prodcut Team' }), ARCHETYPES);
    expect(issues.unresolved).toHaveLength(1);
    expect(issues.unresolved[0]).toMatchObject({
      project_code: 'FC026',
      project_name: 'CO COBEES',
      column: 'Archetype (Primary)',
      raw_value: 'Prodcut Team',
    });
  });

  // Normalization is for comparison only; a normalized string must never reach a
  // response, because the author has to find that exact text in the sheet.
  it('never reports a normalized string as the raw value', () => {
    const issues = findArchetypeIssues(project({ [ARCHETYPE_PRIMARY_SLUG]: '  Prodcut   Team  ' }), ARCHETYPES);
    expect(issues.unresolved[0].raw_value).toBe('Prodcut   Team');
  });

  it('resolves a label differing only in case or whitespace', () => {
    const issues = findArchetypeIssues(project({ [ARCHETYPE_PRIMARY_SLUG]: 'product  TEAM' }), ARCHETYPES);
    expect(issues.unresolved).toEqual([]);
  });

  // A deactivated archetype is a real record. Treating its projects as drift
  // would report a deliberate admin action as an error.
  it('treats a deactivated archetype as resolved', () => {
    const withInactive = [...ARCHETYPES, { id: 'legacy', label: 'Legacy Team', status: 'inactive' }];
    const issues = findArchetypeIssues(project({ [ARCHETYPE_PRIMARY_SLUG]: 'Legacy Team' }), withInactive);
    expect(issues.unresolved).toEqual([]);
  });

  // The distinction that keeps the sync's red-run signal meaningful: unresolved
  // fails the run, missing only warns.
  it('reports an empty primary as missing, not unresolved, with no raw value', () => {
    const issues = findArchetypeIssues(project({ [ARCHETYPE_PRIMARY_SLUG]: '' }), ARCHETYPES);
    expect(issues.unresolved).toEqual([]);
    expect(issues.missing).toHaveLength(1);
    expect(issues.missing[0]).toMatchObject({ project_code: 'FC026', column: 'Archetype (Primary)' });
    expect(issues.missing[0].raw_value).toBeUndefined();
  });

  it('does not report an empty additional cell at all', () => {
    const issues = findArchetypeIssues(project({ [ARCHETYPE_ADDITIONAL_SLUG]: '' }), ARCHETYPES);
    expect(issues.missing).toHaveLength(0);
    expect(issues.unresolved).toHaveLength(0);
  });

  it('reports every value unresolved when no archetype records exist', () => {
    const issues = findArchetypeIssues(
      project({ [ARCHETYPE_ADDITIONAL_SLUG]: 'Platform Team' }),
      [],
    );
    expect(issues.unresolved.map((u) => u.raw_value)).toEqual(['Product Team', 'Platform Team']);
  });
});

describe('collectArchetypeIssues', () => {
  it('aggregates across projects', () => {
    const projects = [
      project(),
      project({ project_code: 'FH013', [ARCHETYPE_PRIMARY_SLUG]: 'Nonsense Team' }),
      project({ project_code: 'ST099', [ARCHETYPE_PRIMARY_SLUG]: '' }),
    ];
    const { unresolved, missing } = collectArchetypeIssues(projects, ARCHETYPES);
    expect(unresolved.map((u) => u.project_code)).toEqual(['FH013']);
    expect(missing.map((m) => m.project_code)).toEqual(['ST099']);
  });
});
