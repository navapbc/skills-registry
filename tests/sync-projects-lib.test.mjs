import { describe, it, expect } from 'vitest';
import {
  EXCLUDED_COLUMNS,
  ARCHETYPE_PRIMARY_SLUG,
  ARCHETYPE_ADDITIONAL_SLUG,
  PROJECT_CODE_HEADER,
  IDENTITY_GROUP,
  GROUP_ROW,
  HEADER_ROW,
  slugColumn,
  parseColumnGroups,
  shapeProjects,
  safetyVerdict,
  reconcile,
  SyncProjectsError,
} from '../scripts/lib/sync-projects.mjs';

// A grid shaped like the real "All Columns (Full View)" tab: banner rows 1-2,
// group labels on row 3, column owners on row 4, a blank row 5, header on row 6.
// Grid indices are one less than the sheet row numbers.
function grid({ headers, rows, groupRow, ownerRow }) {
  return [
    ['', 'Nava Projects and Programs Database'],
    ['', '51', 'Current Projects and Programs'],
    groupRow ?? [],
    ownerRow ?? [],
    [],
    headers,
    ...rows,
  ];
}

const HEADERS = [
  'Database project code', 'Database code', 'Portfolio', 'Project Name',
  'Contract Name', 'Program Manager', 'Archetype (Primary)',
  'Archetype (Additional)', 'Program Health Status', 'Link to Program Health',
  'CPARS', '2026 Capabilities',
];

// OVERVIEW starts at index 4, so indices 0-3 precede every label — the real
// sheet has the same shape.
const GROUP_ROW_CELLS = [
  '', '', '', '', 'OVERVIEW', '', 'FRAMEWORKS', '', 'HEALTH', '', '', 'CAPABILITIES',
];

function row(overrides = {}) {
  const base = {
    'Database project code': '',
    'Database code': 'FC026',
    'Portfolio': 'FEDCIV',
    'Project Name': 'CO COBEES',
    'Contract Name': '',
    'Program Manager': 'Nancy Nussear',
    'Archetype (Primary)': 'Product Team',
    'Archetype (Additional)': '',
    'Program Health Status': 'Green',
    'Link to Program Health': 'https://confluence/health',
    'CPARS': 'Exceptional',
    '2026 Capabilities': '',
    ...overrides,
  };
  return HEADERS.map((h) => base[h] ?? '');
}

describe('row and column constants', () => {
  // The blank grid row at index 4 is why these are named rather than derived as
  // "the two rows above the header" — that would pick up the blank.
  it('names the group and header rows as 0-based grid indices', () => {
    expect(GROUP_ROW).toBe(2);
    expect(HEADER_ROW).toBe(5);
  });

  it('keys projects on the populated code column, not the empty lookalike', () => {
    expect(PROJECT_CODE_HEADER).toBe('Database code');
  });

  it('excludes the individual-naming and health-assessment columns', () => {
    expect(EXCLUDED_COLUMNS).toContain('Program Manager');
    expect(EXCLUDED_COLUMNS).toContain('Nava Contract PP');
    expect(EXCLUDED_COLUMNS).toContain('Project Index Owner');
    expect(EXCLUDED_COLUMNS).toContain('Assigned project-index-quality reviewer');
    expect(EXCLUDED_COLUMNS).toContain('Program Health Status');
    expect(EXCLUDED_COLUMNS).toContain('Team Health Status');
    expect(EXCLUDED_COLUMNS).toContain('CPARS');
  });

  // Decided in review: the links hold Confluence URLs whose content sits behind
  // that page's own access control. A reader assuming "the HEALTH group" would
  // drop them, so this asserts the narrower rule.
  it('keeps the health link columns', () => {
    expect(EXCLUDED_COLUMNS).not.toContain('Link to Program Health');
    expect(EXCLUDED_COLUMNS).not.toContain('Link to Team Health');
  });
});

describe('slugColumn', () => {
  it('derives the archetype slugs the API side reads by', () => {
    expect(slugColumn('Archetype (Primary)')).toBe(ARCHETYPE_PRIMARY_SLUG);
    expect(slugColumn('Archetype (Additional)')).toBe(ARCHETYPE_ADDITIONAL_SLUG);
    expect(ARCHETYPE_PRIMARY_SLUG).toBe('archetype_primary');
    expect(ARCHETYPE_ADDITIONAL_SLUG).toBe('archetype_additional');
  });

  it('lowercases and underscores', () => {
    expect(slugColumn('Database code')).toBe('database_code');
    expect(slugColumn('Aliases, Alternative Naming')).toBe('aliases_alternative_naming');
    expect(slugColumn('Prime/Sub')).toBe('prime_sub');
  });

  it('moves a leading number to the end so no slug starts with a digit', () => {
    expect(slugColumn('2026 Capabilities')).toBe('capabilities_2026');
  });
});

describe('parseColumnGroups', () => {
  it('carries a merged-cell label forward to the columns it spans', () => {
    const groups = parseColumnGroups(grid({ headers: HEADERS, rows: [], groupRow: GROUP_ROW_CELLS }), HEADERS);
    expect(groups.contract_name).toBe('OVERVIEW');
    expect(groups.archetype_primary).toBe('FRAMEWORKS');
    expect(groups.archetype_additional).toBe('FRAMEWORKS');
  });

  it('assigns columns before the first label to a synthetic identity group', () => {
    const groups = parseColumnGroups(grid({ headers: HEADERS, rows: [], groupRow: GROUP_ROW_CELLS }), HEADERS);
    expect(groups.database_code).toBe(IDENTITY_GROUP);
    expect(groups.portfolio).toBe(IDENTITY_GROUP);
    expect(groups.project_name).toBe(IDENTITY_GROUP);
  });

  // The real group row has 44 cells against 43 headers — a stray
  // "Workday Project ID" past the end. An unbounded walk invents a group for a
  // column that does not exist.
  it('ignores group cells beyond the header width', () => {
    const wide = [...GROUP_ROW_CELLS, 'PROJECT INDEX', 'Workday Project ID'];
    const groups = parseColumnGroups(grid({ headers: HEADERS, rows: [], groupRow: wide }), HEADERS);
    expect(Object.keys(groups)).toHaveLength(HEADERS.length);
    expect(Object.values(groups)).not.toContain('Workday Project ID');
  });

  // "Government Domain" is labelled FRAMEWORKS while sitting between two
  // PROJECT INDEX columns, so groups are stored per column, never as ranges.
  it('keeps per-column labels when a group reappears after another', () => {
    const headers = ['Database code', 'A', 'B', 'C', 'D'];
    const groupRow = ['', 'PROJECT INDEX', '', 'FRAMEWORKS', 'PROJECT INDEX'];
    const groups = parseColumnGroups(grid({ headers, rows: [], groupRow }), headers);
    expect(groups.b).toBe('PROJECT INDEX');
    expect(groups.c).toBe('FRAMEWORKS');
    expect(groups.d).toBe('PROJECT INDEX');
  });

  it('fails loudly when the named group row is empty', () => {
    expect(() => parseColumnGroups(grid({ headers: HEADERS, rows: [], groupRow: [] }), HEADERS))
      .toThrow(SyncProjectsError);
  });
});

describe('shapeProjects', () => {
  it('omits excluded columns and retains their neighbours', () => {
    const { projects } = shapeProjects(grid({ headers: HEADERS, rows: [row()], groupRow: GROUP_ROW_CELLS }));
    const p = projects.FC026;
    expect(p.program_manager).toBeUndefined();
    expect(p.program_health_status).toBeUndefined();
    expect(p.cpars).toBeUndefined();
    expect(p.project_name).toBe('CO COBEES');
    expect(p.archetype_primary).toBe('Product Team');
  });

  it('keeps the health link columns', () => {
    const { projects } = shapeProjects(grid({ headers: HEADERS, rows: [row()], groupRow: GROUP_ROW_CELLS }));
    expect(projects.FC026.link_to_program_health).toBe('https://confluence/health');
  });

  it('carries an unknown column through rather than dropping it', () => {
    const headers = [...HEADERS, 'Brand New Column'];
    const rows = [[...row(), 'a value']];
    const { projects } = shapeProjects(grid({ headers, rows, groupRow: GROUP_ROW_CELLS }));
    expect(projects.FC026.brand_new_column).toBe('a value');
  });

  // The full header set, excluded columns included — that is what makes a
  // rename detectable. "Program Manager" becoming "Program Manager (Nava)"
  // re-admits an excluded people-column, and comparing full header sets across
  // runs is how it surfaces.
  it('returns the full header set present now, and the original header per carried slug', () => {
    const { columnNames, columnHeaders } = shapeProjects(
      grid({ headers: HEADERS, rows: [row()], groupRow: GROUP_ROW_CELLS }),
    );
    expect(columnNames).toEqual(HEADERS);
    expect(columnHeaders.archetype_primary).toBe('Archetype (Primary)');
    expect(columnHeaders.program_manager).toBeUndefined();
  });

  // Decided with the user: the sync applies no validity judgement of its own.
  it('imports a fabricated test row and an x-prefixed row as ordinary projects', () => {
    const rows = [
      row({ 'Database code': 'TEST PROJECT', 'Project Name': 'State of Columbia' }),
      row({ 'Database code': 'xLB001.2', 'Project Name': 'Gates Foundation DST' }),
    ];
    const { projects } = shapeProjects(grid({ headers: HEADERS, rows, groupRow: GROUP_ROW_CELLS }));
    expect(Object.keys(projects)).toEqual(['TEST PROJECT', 'xLB001.2']);
  });

  it('ignores the stated project count above the header', () => {
    const rows = [row(), row({ 'Database code': 'FC001' })];
    const { projects } = shapeProjects(grid({ headers: HEADERS, rows, groupRow: GROUP_ROW_CELLS }));
    expect(Object.keys(projects)).toHaveLength(2); // banner says 51
  });

  it('skips and counts a row whose every carried cell is empty', () => {
    const blank = HEADERS.map(() => '');
    const { projects, skippedBlankRows } = shapeProjects(
      grid({ headers: HEADERS, rows: [row(), blank], groupRow: GROUP_ROW_CELLS }),
    );
    expect(Object.keys(projects)).toEqual(['FC026']);
    expect(skippedBlankRows).toBe(1);
  });

  it('fails on a row with a blank code but other populated cells', () => {
    const orphan = row({ 'Database code': '', 'Project Name': 'Has data, no key' });
    expect(() => shapeProjects(grid({ headers: HEADERS, rows: [orphan], groupRow: GROUP_ROW_CELLS })))
      .toThrow(/blank .*code/i);
  });

  it('fails on two rows sharing a project code', () => {
    const rows = [row(), row({ 'Project Name': 'Different name, same code' })];
    expect(() => shapeProjects(grid({ headers: HEADERS, rows, groupRow: GROUP_ROW_CELLS })))
      .toThrow(/FC026/);
  });

  // A shifted header row is otherwise indistinguishable from a valid one.
  it('fails when the code column is absent from the resolved headers', () => {
    const headers = HEADERS.filter((h) => h !== 'Database code');
    const rows = [headers.map(() => 'x')];
    expect(() => shapeProjects(grid({ headers, rows, groupRow: GROUP_ROW_CELLS })))
      .toThrow(/Database code/);
  });

  // Regression: groups were parsed against the carried (filtered) headers, so
  // every label after the first excluded column shifted left. It still produced
  // a plausible-looking grouping, which is why only real sheet data caught it —
  // "Government Domain" came back HEALTH instead of FRAMEWORKS.
  it('aligns groups to original column positions despite excluded columns', () => {
    const headers = ['Database code', 'Program Manager', 'Archetype (Primary)', 'CPARS', '2026 Capabilities'];
    const groupRow = ['', 'TEAM', 'FRAMEWORKS', 'HEALTH', 'CAPABILITIES'];
    const rows = [['FC026', 'Someone', 'Product Team', 'Exceptional', 'yes']];
    const { columnGroups } = shapeProjects(grid({ headers, rows, groupRow }));
    expect(columnGroups.archetype_primary).toBe('FRAMEWORKS');
    expect(columnGroups.capabilities_2026).toBe('CAPABILITIES');
  });

  it('reports groups only for columns it stores', () => {
    const headers = ['Database code', 'Program Manager', 'Archetype (Primary)'];
    const groupRow = ['', 'TEAM', 'FRAMEWORKS'];
    const rows = [['FC026', 'Someone', 'Product Team']];
    const { columnGroups } = shapeProjects(grid({ headers, rows, groupRow }));
    expect(columnGroups.program_manager).toBeUndefined();
    expect(Object.keys(columnGroups).sort()).toEqual(['archetype_primary', 'database_code']);
  });

  it('fails naming both headers when two slug to the same attribute', () => {
    const headers = [...HEADERS, 'Database Code'];
    const rows = [[...row(), 'dupe']];
    expect(() => shapeProjects(grid({ headers, rows, groupRow: GROUP_ROW_CELLS })))
      .toThrow(/Database code.*Database Code|Database Code.*Database code/);
  });
});

describe('reconcile', () => {
  const stored = {
    FC026: { project_code: 'FC026', project_name: 'CO COBEES' },
    FH013: { project_code: 'FH013', project_name: 'Old Name' },
    ST099: { project_code: 'ST099', project_name: 'Gone' },
  };
  const incoming = {
    FC026: { project_code: 'FC026', project_name: 'CO COBEES' },
    FH013: { project_code: 'FH013', project_name: 'New Name' },
    LB007: { project_code: 'LB007', project_name: 'Brand New' },
  };

  it('splits creates, updates, and deletes', () => {
    const d = reconcile(incoming, stored);
    expect(d.creates.map((p) => p.project_code)).toEqual(['LB007']);
    expect(d.updates.map((p) => p.project_code)).toEqual(['FH013']);
    expect(d.deletes).toEqual(['ST099']);
  });

  // A key-only read would report every shared code as updated forever, making
  // the run counts a constant rather than an answer to "did anything change?".
  it('reports no updates when nothing actually differs', () => {
    const d = reconcile(stored, stored);
    expect(d.creates).toEqual([]);
    expect(d.updates).toEqual([]);
    expect(d.deletes).toEqual([]);
  });

  it('carries first_seen_at forward from the stored record', () => {
    const d = reconcile(
      { FH013: { project_code: 'FH013', project_name: 'New Name' } },
      { FH013: { project_code: 'FH013', project_name: 'Old Name', first_seen_at: '2020-01-01T00:00:00.000Z' } },
    );
    expect(d.updates[0].first_seen_at).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('safetyVerdict', () => {
  const ok = { incoming: 53, storedCount: 53, deletes: 0, baseline: 53 };

  it('permits an unchanged run', () => {
    expect(safetyVerdict(ok)).toBeNull();
  });

  it('refuses zero rows even when overridden', () => {
    expect(safetyVerdict({ ...ok, incoming: 0 })).toMatch(/zero rows/i);
    expect(safetyVerdict({ ...ok, incoming: 0, override: true })).toMatch(/zero rows/i);
  });

  it('refuses a drop past 10% of the baseline, naming both counts', () => {
    const reason = safetyVerdict({ ...ok, incoming: 47, deletes: 6, baseline: 53 });
    expect(reason).toMatch(/47/);
    expect(reason).toMatch(/53/);
  });

  it('permits exactly the 10% boundary', () => {
    expect(safetyVerdict({ incoming: 48, storedCount: 53, deletes: 5, baseline: 53 })).toBeNull();
  });

  it('permits any non-zero count when there is no baseline', () => {
    expect(safetyVerdict({ incoming: 3, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
  });

  // The case row count cannot see: a shifted header keys projects on
  // "Project Name" — unique and populated on all 53 real rows — producing 53
  // deletes plus 53 creates at an unchanged count of 53.
  it('refuses a wholesale re-key at an unchanged row count', () => {
    const reason = safetyVerdict({ incoming: 53, storedCount: 53, deletes: 53, baseline: 53 });
    expect(reason).toMatch(/delete/i);
    expect(reason).toMatch(/53/);
  });

  it('refuses when the surviving count falls below the absolute floor', () => {
    const reason = safetyVerdict({ incoming: 39, storedCount: 40, deletes: 1, baseline: 40 });
    expect(reason).toMatch(/floor|minimum/i);
  });

  // The baseline moves on every success, so repeated under-threshold drops
  // compound. The floor is what terminates the drain.
  it('terminates a compounding drain at the floor', () => {
    const steps = [
      { incoming: 48, storedCount: 53, deletes: 5, baseline: 53 },
      { incoming: 44, storedCount: 48, deletes: 4, baseline: 48 },
      { incoming: 40, storedCount: 44, deletes: 4, baseline: 44 },
      { incoming: 36, storedCount: 40, deletes: 4, baseline: 40 },
    ];
    const verdicts = steps.map((s) => safetyVerdict(s));
    expect(verdicts.slice(0, 3).every((v) => v === null)).toBe(true);
    expect(verdicts[3]).toMatch(/floor|minimum/i);
  });

  it('permits an overridden refusal and names the condition waived', () => {
    const reason = safetyVerdict({ incoming: 47, storedCount: 53, deletes: 6, baseline: 53, override: true });
    expect(reason).toBeNull();
  });
});
