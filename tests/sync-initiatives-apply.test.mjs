import { describe, it, expect } from 'vitest';
import {
  populateInitiatives,
  readSeedMeta,
  checkInitiativeResolution,
} from '../scripts/lib/sync-initiatives-apply.mjs';
import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
} from '../functions/api/lib/initiatives.mjs';
import { RECORD_PROJECT } from '../functions/api/lib/projects.mjs';
import { slugInitiativeId } from '../scripts/lib/sync-initiatives.mjs';

const NOW = '2026-08-10T12:00:00.000Z';
const EARLIER = '2026-01-01T00:00:00.000Z';
const TABLE = 'skills-registry-initiatives-staging';
const PROJECTS_TABLE = 'skills-registry-projects-staging';

// Command constructors that just tag their params, so assertions read off the
// recorded calls rather than mocking the AWS SDK.
const PutCommand = function (params) { return { type: 'Put', params }; };
const DeleteCommand = function (params) { return { type: 'Delete', params }; };
const GetCommand = function (params) { return { type: 'Get', params }; };
const QueryCommand = function (params) { return { type: 'Query', params }; };

const HEADERS = [
  'title', 'desc', 'useCaseLabel', 'useCaseTheme', 'exposure',
  'people', 'status', 'tags', 'links', 'projectName',
];

const rowOf = (values) => HEADERS.map((h) => values[h] ?? '');
const gridOf = (...rows) => [HEADERS, ...rows];

// Enough rows to clear the absolute floor of 30 in tests that should not trip it,
// the same approach tests/sync-contracts-apply.test.mjs takes for its floor of 90.
const manyRows = (count, { from = 0 } = {}) =>
  Array.from({ length: count }, (_, i) =>
    rowOf({ title: `Filler initiative ${from + i}`, exposure: 'internal', tags: 'internal' }));

/** The stored form of manyRows, as the table would hold it after a run. */
const manyStored = (count, { from = 0, now = NOW } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    initiative_id: slugInitiativeId(`Filler initiative ${from + i}`),
    title: `Filler initiative ${from + i}`,
    exposure: 'internal', tags: 'internal',
    desc: '', use_case_label: '', use_case_theme: '', people: '', status: '',
    links: '', project_name: '',
    first_seen_at: now, last_synced_at: now,
  }));

/**
 * A fake DynamoDB client backed by an in-memory table, recording every command.
 * Reads reflect writes, so ordering bugs surface rather than being mocked away.
 */
function fakeDdb({ initiatives = [], meta = null, projects = [], pageAt = null } = {}) {
  const store = new Map();
  for (const i of initiatives) {
    store.set(`${RECORD_INITIATIVE}#${i.initiative_id}`, { record_type: RECORD_INITIATIVE, ...i });
  }
  if (meta) store.set(`${RECORD_SEED_META}#${SEED_META_KEY}`, meta);

  const calls = [];

  return {
    calls,
    store,
    writes: () => calls.filter(
      (c) => c.type === 'Put' && c.params.Item.record_type === RECORD_INITIATIVE,
    ),
    metaWrites: () => calls.filter(
      (c) => c.type === 'Put' && c.params.Item.record_type === RECORD_SEED_META,
    ),
    deletes: () => calls.filter((c) => c.type === 'Delete'),
    mutations: () => calls.filter((c) => c.type === 'Put' || c.type === 'Delete'),
    async send(command) {
      calls.push(command);
      const { type, params } = command;

      if (type === 'Query' && params.TableName === PROJECTS_TABLE) return { Items: projects };
      if (type === 'Query') {
        const wanted = params.ExpressionAttributeValues[':t'];
        const all = [...store.values()].filter((i) => i.record_type === wanted);
        // Optional forced pagination, to prove the read follows LastEvaluatedKey.
        if (pageAt !== null && !params.ExclusiveStartKey) {
          return { Items: all.slice(0, pageAt), LastEvaluatedKey: { at: pageAt } };
        }
        if (pageAt !== null) return { Items: all.slice(pageAt) };
        return { Items: all };
      }
      if (type === 'Get') {
        return { Item: store.get(`${params.Key.record_type}#${params.Key.initiative_id}`) };
      }
      if (type === 'Put') {
        const { record_type: rt, initiative_id: id } = params.Item;
        store.set(`${rt}#${id}`, params.Item);
        return {};
      }
      if (type === 'Delete') {
        store.delete(`${params.Key.record_type}#${params.Key.initiative_id}`);
        return {};
      }
      throw new Error(`unexpected command ${type}`);
    },
  };
}

const run = (ddb, grid, extra = {}) =>
  populateInitiatives({
    ddb, table: TABLE, grid, now: NOW,
    PutCommand, DeleteCommand, GetCommand, QueryCommand, ...extra,
  });

describe('readSeedMeta', () => {
  it('reports never-populated when no metadata record exists', async () => {
    const meta = await readSeedMeta({ ddb: fakeDdb(), table: TABLE, GetCommand });
    expect(meta.state).toBe(SEED_NEVER);
    expect(meta.baseline).toBeNull();
  });

  it('distinguishes an in-progress marker from a completed run', async () => {
    const ddb = fakeDdb({
      meta: {
        record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY,
        status: SEED_IN_PROGRESS, row_count: 37,
      },
    });
    const meta = await readSeedMeta({ ddb, table: TABLE, GetCommand });
    expect(meta.state).toBe(SEED_IN_PROGRESS);
    expect(meta.baseline).toBe(37);
  });

  it('reads the metadata record from its own partition', async () => {
    const ddb = fakeDdb();
    await readSeedMeta({ ddb, table: TABLE, GetCommand });
    expect(ddb.calls[0].params.Key).toEqual({
      record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY,
    });
  });
});

describe('populateInitiatives — first run', () => {
  it('writes the marker, one Put per row, then the completed marker', async () => {
    const ddb = fakeDdb();
    const report = await run(ddb, gridOf(...manyRows(37)));

    expect(report.applied).toBe(true);
    expect(report.incoming).toBe(37);
    expect(report.created).toBe(37);
    expect(ddb.writes()).toHaveLength(37);

    const markers = ddb.metaWrites();
    expect(markers).toHaveLength(2);
    expect(markers[0].params.Item.status).toBe(SEED_IN_PROGRESS);
    expect(markers[1].params.Item).toMatchObject({ status: SEED_COMPLETE, row_count: 37 });
  });

  it('reports never-populated as the previous state', async () => {
    const report = await run(fakeDdb(), gridOf(...manyRows(37)));
    expect(report.previousState).toBe(SEED_NEVER);
  });

  it('omits row_count from the in-progress marker', async () => {
    // The baseline must keep describing the last COMPLETED run, or a death
    // mid-apply leaves the next run measuring against a half-written table.
    const ddb = fakeDdb();
    await run(ddb, gridOf(...manyRows(37)));
    const inProgress = ddb.metaWrites()[0].params.Item;
    expect(inProgress.row_count).toBeUndefined();
    expect(inProgress.incoming_row_count).toBe(37);
  });

  it('stamps first_seen_at and last_synced_at on every created record', async () => {
    const ddb = fakeDdb();
    await run(ddb, gridOf(...manyRows(37)));
    for (const call of ddb.writes()) {
      expect(call.params.Item.first_seen_at).toBe(NOW);
      expect(call.params.Item.last_synced_at).toBe(NOW);
    }
  });
});

describe('populateInitiatives — ordering', () => {
  it('applies marker, then writes, then deletes, then marker', async () => {
    // Assert on the sequence, not just the final state: the ordering is the
    // recovery guarantee, and a reordering leaves the table indistinguishable.
    const ddb = fakeDdb({ initiatives: [...manyStored(37), ...manyStored(1, { from: 90 })] });
    await run(ddb, gridOf(...manyRows(37)));

    const shape = ddb.mutations().map((c) => {
      if (c.type === 'Delete') return 'delete';
      return c.params.Item.record_type === RECORD_SEED_META ? c.params.Item.status : 'write';
    });

    expect(shape[0]).toBe(SEED_IN_PROGRESS);
    expect(shape[shape.length - 1]).toBe(SEED_COMPLETE);
    expect(shape.indexOf('delete')).toBeGreaterThan(0);
    expect(shape.lastIndexOf('write')).toBeLessThan(shape.indexOf('delete'));
  });
});

describe('populateInitiatives — idempotence', () => {
  it('issues no record writes and no deletes for an unchanged re-run', async () => {
    const ddb = fakeDdb({
      initiatives: manyStored(37),
      meta: {
        record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY,
        status: SEED_COMPLETE, row_count: 37,
      },
    });
    const report = await run(ddb, gridOf(...manyRows(37)));

    expect(report).toMatchObject({ created: 0, updated: 0, deleted: 0, applied: true });
    expect(ddb.writes()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
    // The markers are still written, so a clean run is legible rather than silent.
    expect(ddb.metaWrites()).toHaveLength(2);
  });

  it('carries first_seen_at forward and refreshes last_synced_at on an update', async () => {
    const initiatives = manyStored(37);
    initiatives[0] = { ...initiatives[0], exposure: 'client', first_seen_at: EARLIER };
    const ddb = fakeDdb({ initiatives });

    await run(ddb, gridOf(...manyRows(37)));

    const written = ddb.writes();
    expect(written).toHaveLength(1);
    expect(written[0].params.Item.first_seen_at).toBe(EARLIER);
    expect(written[0].params.Item.last_synced_at).toBe(NOW);
  });
});

describe('populateInitiatives — deletes', () => {
  it('deletes a stored id the sheet no longer lists, with the right key', async () => {
    const ddb = fakeDdb({ initiatives: [...manyStored(37), ...manyStored(1, { from: 90 })] });
    const report = await run(ddb, gridOf(...manyRows(37)));

    expect(report.deleted).toBe(1);
    expect(ddb.deletes()).toHaveLength(1);
    expect(ddb.deletes()[0].params.Key).toEqual({
      record_type: RECORD_INITIATIVE,
      initiative_id: slugInitiativeId('Filler initiative 90'),
    });
  });
});

describe('populateInitiatives — the gate', () => {
  it('writes nothing at all when the gate refuses, not even the marker', async () => {
    const ddb = fakeDdb({ initiatives: manyStored(37) });
    const report = await run(ddb, gridOf(...manyRows(4)));

    expect(report.refusal).toBeTruthy();
    expect(report.applied).toBe(false);
    expect(ddb.mutations()).toHaveLength(0);
  });

  it('refuses a bulk retitle rather than applying it', async () => {
    // The scenario a title-derived key makes possible: every row reworded, so every
    // id changes. It presents as 37 creates and 37 deletes at an unchanged row
    // count, which only the delete ceiling can see.
    const retitled = Array.from({ length: 37 }, (_, i) =>
      rowOf({ title: `Renamed initiative ${i}`, exposure: 'internal', tags: 'internal' }));
    const ddb = fakeDdb({
      initiatives: manyStored(37),
      meta: {
        record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY,
        status: SEED_COMPLETE, row_count: 37,
      },
    });

    const report = await run(ddb, gridOf(...retitled));

    expect(report.refusal).toMatch(/bulk retitle/);
    expect(ddb.mutations()).toHaveLength(0);
  });

  it('refuses a zero-row sheet even under override', async () => {
    const ddb = fakeDdb({ initiatives: manyStored(37) });
    const report = await run(ddb, gridOf(), { override: true });
    expect(report.refusal).toMatch(/never overridable/);
    expect(ddb.mutations()).toHaveLength(0);
  });

  it('measures the gate against the last completed run, not a partial one', async () => {
    // The in-progress marker carries incoming_row_count from the dead run; the
    // baseline has to keep coming from row_count.
    const ddb = fakeDdb({
      initiatives: manyStored(37),
      meta: {
        record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY,
        status: SEED_IN_PROGRESS, row_count: 37, incoming_row_count: 5,
      },
    });
    const report = await run(ddb, gridOf(...manyRows(37)));
    expect(report.previousState).toBe(SEED_IN_PROGRESS);
    expect(report.refusal).toBeNull();
  });
});

describe('populateInitiatives — dry run', () => {
  it('reads and diffs but writes nothing', async () => {
    const ddb = fakeDdb({ initiatives: manyStored(37) });
    const report = await run(ddb, gridOf(...manyRows(37), rowOf({
      title: 'New initiative', exposure: 'client', tags: 'live',
    })), { dryRun: true });

    expect(report.created).toBe(1);
    expect(report.applied).toBe(false);
    expect(ddb.mutations()).toHaveLength(0);
  });
});

describe('populateInitiatives — paging', () => {
  it('follows LastEvaluatedKey so a paged read is not seen as a smaller sheet', async () => {
    const ddb = fakeDdb({ initiatives: manyStored(37), pageAt: 20 });
    const report = await run(ddb, gridOf(...manyRows(37)));

    expect(report.storedCount).toBe(37);
    expect(report.deleted).toBe(0);
  });
});

describe('checkInitiativeResolution', () => {
  const PROJECTS = [
    { record_type: RECORD_PROJECT, project_code: 'LB001', project_name: 'User-Facing AI' },
    { record_type: RECORD_PROJECT, project_code: 'ST014', project_name: 'MD PBIF' },
  ];

  const initiatives = {
    a: { initiative_id: 'a', title: 'A', project_name: 'User-Facing AI' },
    b: { initiative_id: 'b', title: 'B', project_name: '' },
    c: { initiative_id: 'c', title: 'C', project_name: 'Nonexistent Project' },
  };

  it('separates stated-unresolved from absent, and neither throws nor exits', async () => {
    const ddb = fakeDdb({ projects: PROJECTS });
    const result = await checkInitiativeResolution({
      ddb, projectsTable: PROJECTS_TABLE, initiatives, QueryCommand,
    });

    expect(result.projectCount).toBe(2);
    expect(result.unresolvedProjects.map((u) => u.initiative_id)).toEqual(['c']);
    expect(result.missingProject.map((m) => m.initiative_id)).toEqual(['b']);
  });

  it('queries the project partition of the projects table, not the initiatives table', async () => {
    const ddb = fakeDdb({ projects: PROJECTS });
    await checkInitiativeResolution({
      ddb, projectsTable: PROJECTS_TABLE, initiatives, QueryCommand,
    });

    const query = ddb.calls.find((c) => c.type === 'Query');
    expect(query.params.TableName).toBe(PROJECTS_TABLE);
    expect(query.params.ExpressionAttributeValues[':t']).toBe(RECORD_PROJECT);
  });

  it('reports nothing for a fully resolved set', async () => {
    const ddb = fakeDdb({ projects: PROJECTS });
    const result = await checkInitiativeResolution({
      ddb,
      projectsTable: PROJECTS_TABLE,
      initiatives: { a: initiatives.a },
      QueryCommand,
    });
    expect(result.unresolvedProjects).toHaveLength(0);
    expect(result.missingProject).toHaveLength(0);
  });
});
