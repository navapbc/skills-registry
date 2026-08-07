import { describe, it, expect } from 'vitest';
import {
  renderFreshness,
  renderNewColumns,
  renderDriftSummary,
  renderProjectRow,
  renderProjectList,
  groupColumns,
  indexUnresolved,
} from '../../src/scripts/projects-admin/projects.mjs';

const COLUMN_HEADERS = {
  database_code: 'Database code',
  project_name: 'Project Name',
  portfolio: 'Portfolio',
  archetype_primary: 'Archetype (Primary)',
  archetype_additional: 'Archetype (Additional)',
  agency: 'Agency',
  mystery: 'Mystery Column',
};

const COLUMN_GROUPS = {
  database_code: 'IDENTITY',
  project_name: 'IDENTITY',
  portfolio: 'IDENTITY',
  archetype_primary: 'FRAMEWORKS',
  archetype_additional: 'FRAMEWORKS',
  agency: 'TEAM',
  // `mystery` deliberately absent — the Ungrouped fallback case.
};

function project(overrides = {}) {
  return {
    record_type: 'project',
    project_code: 'FC026',
    project_name: 'CO COBEES',
    database_code: 'FC026',
    portfolio: 'FEDCIV',
    archetype_primary: 'Product Team',
    archetype_additional: '',
    agency: 'State of Colorado',
    ...overrides,
  };
}

const SYNCED = {
  state: 'complete',
  last_run_at: '2026-08-06T08:00:00.000Z',
  row_count: 53,
  created: 1,
  updated: 2,
  deleted: 0,
  new_columns: [],
};

const CLEAN_DRIFT = { archetype_count: 5, unresolved: [], missing: [] };

const meta = (unresolved = []) => ({
  columnGroups: COLUMN_GROUPS,
  columnHeaders: COLUMN_HEADERS,
  unresolvedByProject: indexUnresolved(unresolved, COLUMN_HEADERS),
});

describe('renderFreshness', () => {
  it('shows when the last sync ran', () => {
    const html = renderFreshness(SYNCED);
    expect(html).toMatch(/Last synced/);
    expect(html).toContain('53 rows');
  });

  // Zero findings because nothing was imported is not good news, and must not
  // look like zero findings because everything is fine.
  it('reports never-synced rather than a clean state', () => {
    const html = renderFreshness({ state: 'never_synced', last_run_at: null });
    expect(html).toMatch(/Never synced/i);
    expect(html).not.toMatch(/Last synced/);
  });

  it('reports never-synced when there is no sync object at all', () => {
    expect(renderFreshness(undefined)).toMatch(/Never synced/i);
  });

  // A run that wrote projects then died leaves a half-written table. Calling it
  // synced would vouch for data that may be incomplete.
  it('reports in-progress distinctly from both other states', () => {
    const html = renderFreshness({ ...SYNCED, state: 'in_progress' });
    expect(html).toMatch(/did not finish/i);
    expect(html).not.toMatch(/Last synced/);
    expect(html).not.toMatch(/Never synced/i);
  });
});

describe('renderNewColumns', () => {
  it('renders nothing when no columns are new', () => {
    expect(renderNewColumns(SYNCED)).toBe('');
  });

  // The signal has to land where an admin already looks: a rename can re-admit an
  // excluded people-column, and workflow output is not read unprompted.
  it('surfaces a newly appeared column and warns that a rename looks identical', () => {
    const html = renderNewColumns({ ...SYNCED, new_columns: ['Program Manager (Nava)'] });
    expect(html).toContain('Program Manager (Nava)');
    expect(html).toMatch(/renamed column/i);
  });

  it('escapes column names', () => {
    const html = renderNewColumns({ ...SYNCED, new_columns: ['<script>x</script>'] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderDriftSummary', () => {
  // Steady state is zero findings, so the common case must read as a positive
  // confirmation. An empty region would be indistinguishable from a broken tab.
  it('states plainly that nothing is unresolved, rather than rendering empty', () => {
    const html = renderDriftSummary(CLEAN_DRIFT, SYNCED);
    expect(html).toMatch(/matches an archetype record/i);
    expect(html.trim()).not.toBe('');
  });

  it('names the project and reproduces the offending string verbatim', () => {
    const html = renderDriftSummary(
      {
        archetype_count: 5,
        unresolved: [{
          project_code: 'FC026', project_name: 'CO COBEES',
          column: 'Archetype (Primary)', raw_value: 'Prodcut Team',
        }],
        missing: [],
      },
      SYNCED,
    );
    expect(html).toContain('FC026');
    expect(html).toContain('CO COBEES');
    expect(html).toContain('Prodcut Team');
    expect(html).toContain('Archetype (Primary)');
  });

  it('carries the freshness line inside the summary', () => {
    expect(renderDriftSummary(CLEAN_DRIFT, SYNCED)).toMatch(/Last synced/);
  });

  it('explains an empty archetype table rather than blaming the sheet', () => {
    const html = renderDriftSummary(
      {
        archetype_count: 0,
        unresolved: [{ project_code: 'FC026', project_name: 'X', column: 'Archetype (Primary)', raw_value: 'Product Team' }],
        missing: [],
      },
      SYNCED,
    );
    expect(html).toMatch(/No archetype records exist yet/i);
  });

  // Same split the sync uses for fail vs warn: a typo is an error, an unassigned
  // archetype is normal in-progress state.
  it('renders a missing archetype distinctly from an unresolved one', () => {
    const html = renderDriftSummary(
      {
        archetype_count: 5,
        unresolved: [],
        missing: [{ project_code: 'LB007', project_name: 'Brand New', column: 'Archetype (Primary)' }],
      },
      SYNCED,
    );
    expect(html).toMatch(/no archetype assigned yet/i);
    expect(html).toMatch(/Not an error/i);
    // And the headline still reads clean, because a missing value is not drift.
    expect(html).toMatch(/matches an archetype record/i);
  });

  it('links each finding to its project row', () => {
    const html = renderDriftSummary(
      {
        archetype_count: 5,
        unresolved: [{ project_code: 'FC026', project_name: 'X', column: 'Archetype (Primary)', raw_value: 'Bad' }],
        missing: [],
      },
      SYNCED,
    );
    expect(html).toContain('href="#project-row-FC026"');
    expect(html).toContain('class="drift-jump underline"');
  });

  it('escapes markup in a project name and in the offending value', () => {
    const html = renderDriftSummary(
      {
        archetype_count: 5,
        unresolved: [{
          project_code: 'FC026', project_name: '<img src=x>',
          column: 'Archetype (Primary)', raw_value: '<script>alert(1)</script>',
        }],
        missing: [],
      },
      SYNCED,
    );
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the summary without needing any project data', () => {
    expect(() => renderDriftSummary(CLEAN_DRIFT, SYNCED)).not.toThrow();
  });
});

describe('groupColumns', () => {
  it('puts identity columns first and ungrouped last', () => {
    const groups = groupColumns(
      ['agency', 'mystery', 'archetype_primary', 'database_code'],
      COLUMN_GROUPS,
    );
    expect(groups[0].group).toBe('IDENTITY');
    expect(groups.at(-1).group).toBe('Ungrouped');
  });

  // Distinct from the sheet's own OTHER group, so it reads as a hub-side fallback
  // rather than a category the sheet declared.
  it('falls back to Ungrouped rather than dropping or merging into OTHER', () => {
    const groups = groupColumns(['mystery'], COLUMN_GROUPS);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('Ungrouped');
    expect(groups[0].slugs).toEqual(['mystery']);
  });

  it('keeps the sheet groups it was given', () => {
    const groups = groupColumns(['archetype_primary', 'agency'], COLUMN_GROUPS);
    expect(groups.map((g) => g.group).sort()).toEqual(['FRAMEWORKS', 'TEAM']);
  });
});

describe('renderProjectRow', () => {
  it('renders fields under their sheet group names, not one flat list', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).toContain('IDENTITY');
    expect(html).toContain('FRAMEWORKS');
    expect(html).toContain('TEAM');
  });

  it('labels fields with their original sheet headers', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).toContain('Archetype (Primary)');
    expect(html).not.toContain('>archetype_primary<');
  });

  it('renders the four identity columns under IDENTITY rather than outside every heading', () => {
    const html = renderProjectRow(project(), meta());
    const identityIndex = html.indexOf('IDENTITY');
    expect(identityIndex).toBeGreaterThan(-1);
    expect(html.indexOf('Database code')).toBeGreaterThan(identityIndex);
  });

  it('renders an ungrouped column under the Ungrouped heading', () => {
    const html = renderProjectRow(project({ mystery: 'value' }), meta());
    expect(html).toContain('Ungrouped');
    expect(html).toContain('Mystery Column');
  });

  // Order and detail are load-bearing; a div toggle or hover reveal would put
  // them out of reach for keyboard and screen-reader users entirely.
  it('uses a real button with aria-expanded for disclosure', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).toMatch(/<button[^>]*class="project-disclosure[^>]*aria-expanded="false"/);
    expect(html).toMatch(/aria-controls="project-row-FC026-detail"/);
  });

  it('marks an unresolved value with text, not colour alone', () => {
    const unresolved = [{
      project_code: 'FC026', project_name: 'CO COBEES',
      column: 'Archetype (Primary)', raw_value: 'Prodcut Team',
    }];
    const html = renderProjectRow(project({ archetype_primary: 'Prodcut Team' }), meta(unresolved));
    expect(html).toContain('unresolved');
  });

  it('marks only the unresolved column, not its resolved sibling', () => {
    const unresolved = [{
      project_code: 'FC026', project_name: 'CO COBEES',
      column: 'Archetype (Additional)', raw_value: 'Nonsense Team',
    }];
    const html = renderProjectRow(
      project({ archetype_primary: 'Product Team', archetype_additional: 'Nonsense Team' }),
      meta(unresolved),
    );
    // One badge on the field plus one on the summary line.
    expect(html.match(/>unresolved</g)).toHaveLength(2);
  });

  it('renders no marker when nothing is unresolved', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).not.toContain('>unresolved<');
  });

  it('renders an empty cell as a dash rather than blank', () => {
    const html = renderProjectRow(project({ agency: '' }), meta());
    expect(html).toContain('—');
  });

  it('escapes markup in values', () => {
    const html = renderProjectRow(project({ project_name: '<script>x</script>' }), meta());
    expect(html).not.toContain('<script>');
  });

  it('does not render record_type as a field', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).not.toContain('record_type');
  });

  // The tab is a window. The sheet is the only write surface.
  it('renders no control that mutates project data', () => {
    const html = renderProjectRow(project(), meta());
    expect(html).not.toMatch(/Edit|Delete|Save|Deactivate|Retry/i);
  });
});

describe('renderProjectList', () => {
  it('renders one entry per project', () => {
    const html = renderProjectList(
      [project(), project({ project_code: 'FH013', project_name: 'Other' })],
      meta(),
    );
    expect(html.match(/<li id="project-row-/g)).toHaveLength(2);
  });

  it('renders an empty state rather than an empty table', () => {
    const html = renderProjectList([], meta());
    expect(html).toMatch(/No projects yet/i);
    expect(html).not.toContain('<ul');
  });

  it('gives every row an id the drift summary can link to', () => {
    const html = renderProjectList([project()], meta());
    expect(html).toContain('id="project-row-FC026"');
  });

  it('renders no mutating control anywhere in the list', () => {
    const html = renderProjectList([project()], meta());
    expect(html).not.toMatch(/Edit|Delete|Save|Deactivate|Retry/i);
  });
});

describe('indexUnresolved', () => {
  it('maps a finding back to the slug its column came from', () => {
    const byProject = indexUnresolved(
      [{ project_code: 'FC026', column: 'Archetype (Primary)', raw_value: 'x' }],
      COLUMN_HEADERS,
    );
    expect(byProject.get('FC026').has('archetype_primary')).toBe(true);
  });

  it('handles an empty finding list', () => {
    expect(indexUnresolved([], COLUMN_HEADERS).size).toBe(0);
    expect(indexUnresolved(undefined, COLUMN_HEADERS).size).toBe(0);
  });
});
