import { describe, it, expect } from 'vitest';
import {
  syncProjects,
  readSyncMeta,
  checkDrift,
} from '../scripts/lib/sync-projects-apply.mjs';
import {
  RECORD_PROJECT,
  RECORD_SYNC_META,
  SYNC_META_KEY,
  SYNC_IN_PROGRESS,
  SYNC_COMPLETE,
  SYNC_NEVER,
  ARCHETYPE_PRIMARY_SLUG,
} from '../functions/api/lib/projects.mjs';

const NOW = '2026-08-06T12:00:00.000Z';
const TABLE = 'skills-hub-projects-staging';
const REFERENCE_TABLE = 'skills-hub-project-reference-staging';

// Command constructors that just tag their params, so assertions read off the
// recorded calls rather than mocking the AWS SDK.
const PutCommand = function (params) { return { type: 'Put', params }; };
const DeleteCommand = function (params) { return { type: 'Delete', params }; };
const GetCommand = function (params) { return { type: 'Get', params }; };
const QueryCommand = function (params) { return { type: 'Query', params }; };

/**
 * A fake DynamoDB client backed by an in-memory table, recording every command.
 * Reads reflect writes, so ordering bugs surface rather than being mocked away.
 */
function fakeDdb({ projects = {}, meta = null, archetypes = [] } = {}) {
  const store = new Map();
  for (const p of Object.values(projects)) {
    store.set(`${RECORD_PROJECT}#${p.project_code}`, { record_type: RECORD_PROJECT, ...p });
  }
  if (meta) store.set(`${RECORD_SYNC_META}#${SYNC_META_KEY}`, meta);

  const calls = [];

  return {
    calls,
    store,
    writes: () => calls.filter((c) => c.type === 'Put'),
    deletes: () => calls.filter((c) => c.type === 'Delete'),
    projectWrites: () => calls.filter((c) => c.type === 'Put' && c.params.Item.record_type === RECORD_PROJECT),
    metaWrites: () => calls.filter((c) => c.type === 'Put' && c.params.Item.record_type === RECORD_SYNC_META),
    async send(command) {
      calls.push(command);
      const { type, params } = command;

      if (type === 'Query' && params.TableName === REFERENCE_TABLE) {
        return { Items: archetypes };
      }
      if (type === 'Query') {
        const wanted = params.ExpressionAttributeValues[':t'];
        return { Items: [...store.values()].filter((i) => i.record_type === wanted) };
      }
      if (type === 'Get') {
        return { Item: store.get(`${params.Key.record_type}#${params.Key.project_code}`) };
      }
      if (type === 'Put') {
        const i = params.Item;
        store.set(`${i.record_type}#${i.project_code}`, i);
        return {};
      }
      if (type === 'Delete') {
        store.delete(`${params.Key.record_type}#${params.Key.project_code}`);
        return {};
      }
      throw new Error(`unexpected command ${type}`);
    },
  };
}

const HEADERS = ['Database code', 'Project Name', 'Archetype (Primary)', 'Program Manager'];
const GROUP_ROW = ['', '', 'FRAMEWORKS', 'TEAM'];

function grid(rows) {
  return [[], [], GROUP_ROW, ['DelOps', 'DelOps', 'Practice Leadership', 'Staffing'], [], HEADERS, ...rows];
}

// Enough rows to clear the absolute floor of 40 in tests that should not trip it.
function manyRows(count, { archetype = 'Product Team' } = {}) {
  return Array.from({ length: count }, (_, i) => [
    `FC${String(i).padStart(3, '0')}`, `Project ${i}`, archetype, 'Someone',
  ]);
}

function storedFrom(rows) {
  return Object.fromEntries(rows.map((r) => [r[0], {
    project_code: r[0], project_name: r[1], [ARCHETYPE_PRIMARY_SLUG]: r[2], database_code: r[0],
  }]));
}

function run(ddb, rows, opts = {}) {
  return syncProjects({
    ddb, table: TABLE, grid: grid(rows), now: NOW,
    PutCommand, DeleteCommand, GetCommand, QueryCommand, ...opts,
  });
}

describe('refusal paths write nothing', () => {
  it('refuses zero rows and issues no write or delete', async () => {
    const ddb = fakeDdb({ projects: storedFrom(manyRows(50)) });
    const report = await run(ddb, []);

    expect(report.refusal).toMatch(/zero rows/i);
    expect(report.applied).toBe(false);
    expect(ddb.writes()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
  });

  it('refuses zero rows even with the override', async () => {
    const ddb = fakeDdb({ projects: storedFrom(manyRows(50)) });
    const report = await run(ddb, [], { override: true });
    expect(report.refusal).toMatch(/zero rows/i);
    expect(ddb.writes()).toHaveLength(0);
  });

  it('refuses a >10% drop and leaves the previous baseline untouched', async () => {
    const stored = manyRows(53);
    const ddb = fakeDdb({
      projects: storedFrom(stored),
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE, row_count: 53, column_names: HEADERS,
      },
    });
    const report = await run(ddb, manyRows(45));

    expect(report.refusal).toMatch(/45/);
    expect(report.refusal).toMatch(/53/);
    expect(ddb.writes()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
    expect(ddb.store.get(`${RECORD_SYNC_META}#${SYNC_META_KEY}`).row_count).toBe(53);
  });

  // The case the row-count condition cannot see: a shifted header keys projects
  // on a different unique column, so the count is unchanged and every stored
  // code is absent from the incoming set.
  it('refuses a wholesale re-key at an unchanged row count', async () => {
    const stored = storedFrom(manyRows(53));
    const rekeyed = manyRows(53).map((r) => [`RE${r[0]}`, r[1], r[2], r[3]]);
    const ddb = fakeDdb({
      projects: stored,
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE, row_count: 53, column_names: HEADERS,
      },
    });
    const report = await run(ddb, rekeyed);

    expect(report.refusal).toMatch(/delete/i);
    expect(report.deleted).toBe(53);
    expect(ddb.deletes()).toHaveLength(0);
    expect(ddb.writes()).toHaveLength(0);
  });

  it('applies a >10% drop when overridden, and records the new baseline', async () => {
    const ddb = fakeDdb({
      projects: storedFrom(manyRows(53)),
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE, row_count: 53, column_names: HEADERS,
      },
    });
    const report = await run(ddb, manyRows(45), { override: true });

    expect(report.refusal).toBeNull();
    expect(report.applied).toBe(true);
    expect(ddb.store.get(`${RECORD_SYNC_META}#${SYNC_META_KEY}`).row_count).toBe(45);
  });
});

describe('applying', () => {
  it('deletes a stored project absent from the sheet and counts it', async () => {
    const stored = manyRows(50);
    const ddb = fakeDdb({ projects: storedFrom([...stored, ['ST099', 'Gone', 'Product Team', '']]) });
    const report = await run(ddb, stored);

    expect(report.deleted).toBe(1);
    expect(report.deletedCodes).toEqual(['ST099']);
    expect(ddb.deletes()).toHaveLength(1);
    expect(ddb.deletes()[0].params.Key).toEqual({ record_type: RECORD_PROJECT, project_code: 'ST099' });
  });

  // A key-only read would report every shared code as updated on every run,
  // making the counts a constant rather than an answer to "did anything change?".
  it('reports zero updates when nothing changed', async () => {
    const rows = manyRows(50);
    const ddb = fakeDdb({ projects: storedFrom(rows) });
    const report = await run(ddb, rows);

    expect(report.created).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(ddb.projectWrites()).toHaveLength(0);
  });

  it('preserves first_seen_at across a rewrite', async () => {
    const rows = manyRows(50);
    const stored = storedFrom(rows);
    stored.FC000.first_seen_at = '2020-01-01T00:00:00.000Z';
    stored.FC000.project_name = 'Old Name';

    const ddb = fakeDdb({ projects: stored });
    await run(ddb, rows);

    expect(ddb.store.get(`${RECORD_PROJECT}#FC000`).first_seen_at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('stamps first_seen_at on a newly created project', async () => {
    const ddb = fakeDdb({ projects: storedFrom(manyRows(50)) });
    await run(ddb, [...manyRows(50), ['LB007', 'Brand New', 'Product Team', '']]);
    expect(ddb.store.get(`${RECORD_PROJECT}#LB007`).first_seen_at).toBe(NOW);
  });

  it('records the run timestamp, counts, and column metadata', async () => {
    const ddb = fakeDdb({ projects: storedFrom(manyRows(50)) });
    await run(ddb, [...manyRows(50), ['LB007', 'Brand New', 'Product Team', '']]);

    const meta = ddb.store.get(`${RECORD_SYNC_META}#${SYNC_META_KEY}`);
    expect(meta.status).toBe(SYNC_COMPLETE);
    expect(meta.last_run_at).toBe(NOW);
    expect(meta.row_count).toBe(51);
    expect(meta.created).toBe(1);
    expect(meta.column_names).toEqual(HEADERS);
    expect(meta.column_groups.archetype_primary).toBe('FRAMEWORKS');
    // Excluded columns get no group entry, because they are not stored.
    expect(meta.column_groups.program_manager).toBeUndefined();
  });

  it('writes an in-progress marker before touching any project', async () => {
    const ddb = fakeDdb({ projects: storedFrom(manyRows(50)) });
    await run(ddb, [...manyRows(50), ['LB007', 'Brand New', 'Product Team', '']]);

    const firstWrite = ddb.writes()[0];
    expect(firstWrite.params.Item.record_type).toBe(RECORD_SYNC_META);
    expect(firstWrite.params.Item.status).toBe(SYNC_IN_PROGRESS);

    const firstProjectIndex = ddb.calls.indexOf(ddb.projectWrites()[0]);
    expect(ddb.calls.indexOf(firstWrite)).toBeLessThan(firstProjectIndex);
  });

  // The in-progress marker must not advance the baseline: if the run dies here,
  // the next one has to measure against the last COMPLETED count.
  it('leaves the completed baseline intact while in progress', async () => {
    const ddb = fakeDdb({
      projects: storedFrom(manyRows(50)),
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE, row_count: 50, column_names: HEADERS,
      },
    });
    await run(ddb, [...manyRows(50), ['LB007', 'Brand New', 'Product Team', '']]);

    const inProgress = ddb.metaWrites()[0].params.Item;
    expect(inProgress.row_count).toBe(50);
    expect(inProgress.incoming_row_count).toBe(51);
  });

  it('deletes only after creates and updates are written', async () => {
    const rows = manyRows(50);
    const ddb = fakeDdb({ projects: storedFrom([...rows, ['ST099', 'Gone', 'Product Team', '']]) });
    await run(ddb, [...rows, ['LB007', 'New', 'Product Team', '']]);

    const lastProjectWrite = ddb.calls.indexOf(ddb.projectWrites().at(-1));
    expect(ddb.calls.indexOf(ddb.deletes()[0])).toBeGreaterThan(lastProjectWrite);
  });

  it('does not store excluded columns', async () => {
    const ddb = fakeDdb();
    await run(ddb, manyRows(45));
    expect(ddb.store.get(`${RECORD_PROJECT}#FC000`).program_manager).toBeUndefined();
    expect(ddb.store.get(`${RECORD_PROJECT}#FC000`).project_name).toBe('Project 0');
  });

  it('reports newly appeared columns against the previous run header set', async () => {
    const ddb = fakeDdb({
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE, row_count: 45,
        column_names: ['Database code', 'Project Name', 'Archetype (Primary)'],
      },
    });
    const report = await run(ddb, manyRows(45));
    expect(report.newColumns).toEqual(['Program Manager']);
  });

  it('skips and counts a wholly blank row without failing', async () => {
    const ddb = fakeDdb();
    const report = await run(ddb, [...manyRows(45), ['', '', '', '']]);
    expect(report.skippedBlankRows).toBe(1);
    expect(report.incoming).toBe(45);
  });

  it('fails on a row with a blank code but other data', async () => {
    const ddb = fakeDdb();
    await expect(run(ddb, [...manyRows(45), ['', 'Has data', '', '']]))
      .rejects.toThrow(/blank .*code/i);
    expect(ddb.writes()).toHaveLength(0);
  });

  it('fails before shaping when the code column is missing', async () => {
    const ddb = fakeDdb();
    const shifted = [[], [], GROUP_ROW, [], [], ['Project Name', 'Archetype (Primary)'], ['A', 'Product Team']];
    await expect(syncProjects({
      ddb, table: TABLE, grid: shifted, now: NOW,
      PutCommand, DeleteCommand, GetCommand, QueryCommand,
    })).rejects.toThrow(/Database code/);
    expect(ddb.writes()).toHaveLength(0);
  });
});

describe('dry run', () => {
  it('reports the diff and writes nothing', async () => {
    const rows = manyRows(50);
    const ddb = fakeDdb({ projects: storedFrom([...rows, ['ST099', 'Gone', 'Product Team', '']]) });
    const report = await run(ddb, [...rows, ['LB007', 'New', 'Product Team', '']], { dryRun: true });

    expect(report.created).toBe(1);
    expect(report.deleted).toBe(1);
    expect(report.applied).toBe(false);
    expect(ddb.writes()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
  });
});

describe('readSyncMeta', () => {
  it('reports never-synced when no record exists', async () => {
    const ddb = fakeDdb();
    const meta = await readSyncMeta({ ddb, table: TABLE, GetCommand });
    expect(meta.state).toBe(SYNC_NEVER);
    expect(meta.baseline).toBeNull();
  });

  it('reports in-progress distinctly from complete', async () => {
    const ddb = fakeDdb({
      meta: {
        record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY,
        status: SYNC_IN_PROGRESS, row_count: 53,
      },
    });
    const meta = await readSyncMeta({ ddb, table: TABLE, GetCommand });
    expect(meta.state).toBe(SYNC_IN_PROGRESS);
    expect(meta.baseline).toBe(53);
  });
});

describe('checkDrift', () => {
  const archetypes = [{ id: 'product-team', label: 'Product Team', status: 'active' }];

  it('reports an unresolved value with its project and exact string', async () => {
    const ddb = fakeDdb({ archetypes });
    const projects = {
      FC026: { project_code: 'FC026', project_name: 'CO COBEES', [ARCHETYPE_PRIMARY_SLUG]: 'Prodcut Team' },
    };
    const drift = await checkDrift({ ddb, referenceTable: REFERENCE_TABLE, projects, QueryCommand });

    expect(drift.unresolved).toHaveLength(1);
    expect(drift.unresolved[0].raw_value).toBe('Prodcut Team');
    expect(drift.unresolved[0].project_code).toBe('FC026');
    expect(drift.missing).toHaveLength(0);
  });

  // Unresolved fails the run; missing only warns. Conflating them would make an
  // unassigned new project turn the sync red.
  it('reports an unassigned primary as missing, not unresolved', async () => {
    const ddb = fakeDdb({ archetypes });
    const projects = {
      LB007: { project_code: 'LB007', project_name: 'Brand New', [ARCHETYPE_PRIMARY_SLUG]: '' },
    };
    const drift = await checkDrift({ ddb, referenceTable: REFERENCE_TABLE, projects, QueryCommand });

    expect(drift.unresolved).toHaveLength(0);
    expect(drift.missing).toHaveLength(1);
  });

  it('reports nothing when every value resolves', async () => {
    const ddb = fakeDdb({ archetypes });
    const projects = {
      FC026: { project_code: 'FC026', project_name: 'CO COBEES', [ARCHETYPE_PRIMARY_SLUG]: 'Product Team' },
    };
    const drift = await checkDrift({ ddb, referenceTable: REFERENCE_TABLE, projects, QueryCommand });
    expect(drift.unresolved).toHaveLength(0);
    expect(drift.missing).toHaveLength(0);
  });

  it('reports every value unresolved when the archetype table is empty', async () => {
    const ddb = fakeDdb({ archetypes: [] });
    const projects = {
      FC026: { project_code: 'FC026', project_name: 'CO COBEES', [ARCHETYPE_PRIMARY_SLUG]: 'Product Team' },
    };
    const drift = await checkDrift({ ddb, referenceTable: REFERENCE_TABLE, projects, QueryCommand });
    expect(drift.archetypeCount).toBe(0);
    expect(drift.unresolved).toHaveLength(1);
  });
});
