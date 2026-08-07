import { describe, it, expect } from 'vitest';
import {
  populateContracts,
  readSeedMeta,
  checkContractDrift,
} from '../scripts/lib/sync-contracts-apply.mjs';
import {
  RECORD_CONTRACT,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
} from '../functions/api/lib/contracts.mjs';
import { RECORD_PROJECT } from '../functions/api/lib/projects.mjs';

const NOW = '2026-08-07T12:00:00.000Z';
const EARLIER = '2026-01-01T00:00:00.000Z';
const TABLE = 'skills-registry-contracts-staging';
const PROJECTS_TABLE = 'skills-registry-projects-staging';
const REFERENCE_TABLE = 'skills-registry-project-reference-staging';

// Command constructors that just tag their params, so assertions read off the
// recorded calls rather than mocking the AWS SDK.
const PutCommand = function (params) { return { type: 'Put', params }; };
const DeleteCommand = function (params) { return { type: 'Delete', params }; };
const GetCommand = function (params) { return { type: 'Get', params }; };
const QueryCommand = function (params) { return { type: 'Query', params }; };

const MACHINE_HEADERS = [
  '', 'PORTFOLIO', 'PROJECT', 'agreementType', 'contractNum', 'aiUseTerms',
  'projectName', 'aiPosture', 'terms', 'notes',
];

function gridOf(...rows) {
  return [[], [], MACHINE_HEADERS, ...rows];
}

function rowOf(values) {
  return MACHINE_HEADERS.map((h, i) => (i === 0 ? '' : (values[h] ?? '')));
}

const AECF = { PORTFOLIO: 'LABS', PROJECT: 'AECF', aiUseTerms: 'Silent', notes: 'a' };
const RIVERSIDE = { PORTFOLIO: 'LABS', PROJECT: 'Riverside', aiUseTerms: 'Allowed', notes: 'b' };

// Enough rows to clear the absolute floor of 90 in tests that should not trip it.
// Same approach as tests/sync-projects.test.mjs, which clears its floor of 40.
function manyRows(count, { from = 0 } = {}) {
  return Array.from({ length: count }, (_, i) =>
    rowOf({ PORTFOLIO: 'LABS', PROJECT: `Filler ${from + i}`, notes: `n${from + i}` }));
}

/** The stored form of manyRows, as the table would hold it after a run. */
function manyStored(count, { from = 0, now = NOW } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    contract_id: `labs-filler-${from + i}`,
    portfolio: 'LABS', project: `Filler ${from + i}`, notes: `n${from + i}`,
    agreement_type: '', contract_num: '', ai_use_terms: '', project_name: '', ai_posture: '',
    first_seen_at: now, last_synced_at: now,
  }));
}

/**
 * A fake DynamoDB client backed by an in-memory table, recording every command.
 * Reads reflect writes, so ordering bugs surface rather than being mocked away.
 */
function fakeDdb({ contracts = [], meta = null, projects = [], postures = [] } = {}) {
  const store = new Map();
  for (const c of contracts) {
    store.set(`${RECORD_CONTRACT}#${c.contract_id}`, { record_type: RECORD_CONTRACT, ...c });
  }
  if (meta) store.set(`${RECORD_SEED_META}#${SEED_META_KEY}`, meta);

  const calls = [];

  return {
    calls,
    store,
    contractWrites: () => calls.filter((c) => c.type === 'Put' && c.params.Item.record_type === RECORD_CONTRACT),
    metaWrites: () => calls.filter((c) => c.type === 'Put' && c.params.Item.record_type === RECORD_SEED_META),
    deletes: () => calls.filter((c) => c.type === 'Delete'),
    async send(command) {
      calls.push(command);
      const { type, params } = command;

      if (type === 'Query' && params.TableName === PROJECTS_TABLE) return { Items: projects };
      if (type === 'Query' && params.TableName === REFERENCE_TABLE) return { Items: postures };
      if (type === 'Query') {
        const wanted = params.ExpressionAttributeValues[':t'];
        return { Items: [...store.values()].filter((i) => i.record_type === wanted) };
      }
      if (type === 'Get') {
        return { Item: store.get(`${params.Key.record_type}#${params.Key.contract_id}`) };
      }
      if (type === 'Put') {
        const { record_type: rt, contract_id: id } = params.Item;
        store.set(`${rt}#${id}`, params.Item);
        return {};
      }
      if (type === 'Delete') {
        store.delete(`${params.Key.record_type}#${params.Key.contract_id}`);
        return {};
      }
      throw new Error(`unexpected command ${type}`);
    },
  };
}

const run = (ddb, grid, extra = {}) =>
  populateContracts({
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
        record_type: RECORD_SEED_META, contract_id: SEED_META_KEY,
        status: SEED_IN_PROGRESS, row_count: 119,
      },
    });
    const meta = await readSeedMeta({ ddb, table: TABLE, GetCommand });
    expect(meta.state).toBe(SEED_IN_PROGRESS);
    // The baseline still describes the last COMPLETED run.
    expect(meta.baseline).toBe(119);
  });
});

describe('populateContracts', () => {
  it('creates every contract on a first run and writes completion metadata', async () => {
    const ddb = fakeDdb();
    const report = await run(ddb, gridOf(rowOf(AECF), rowOf(RIVERSIDE)));

    expect(report.previousState).toBe(SEED_NEVER);
    expect(report.created).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.applied).toBe(true);
    expect(ddb.contractWrites()).toHaveLength(2);

    const final = ddb.store.get(`${RECORD_SEED_META}#${SEED_META_KEY}`);
    expect(final.status).toBe(SEED_COMPLETE);
    expect(final.row_count).toBe(2);
  });

  it('stamps both timestamps on a newly created contract', async () => {
    const ddb = fakeDdb();
    await run(ddb, gridOf(rowOf(AECF)));
    const record = ddb.store.get(`${RECORD_CONTRACT}#labs-aecf`);
    expect(record.first_seen_at).toBe(NOW);
    expect(record.last_synced_at).toBe(NOW);
  });

  it('reports nothing to do when the grid matches what is stored', async () => {
    const first = fakeDdb();
    await run(first, gridOf(rowOf(AECF)));
    const stored = [...first.store.values()].filter((i) => i.record_type === RECORD_CONTRACT);

    const second = fakeDdb({ contracts: stored });
    const report = await run(second, gridOf(rowOf(AECF)), { now: '2026-09-09T00:00:00.000Z' });

    expect(report.created).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(second.contractWrites()).toHaveLength(0);
  });

  it('preserves first_seen_at across an update', async () => {
    const ddb = fakeDdb({
      contracts: [
        {
          contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF',
          ai_use_terms: 'Silent', notes: 'OLD', project_name: '', ai_posture: '',
          agreement_type: '', contract_num: '',
          first_seen_at: EARLIER, last_synced_at: EARLIER,
        },
        ...manyStored(95),
      ],
    });
    const report = await run(ddb, gridOf(rowOf(AECF), ...manyRows(95)));

    expect(report.updated).toBe(1);
    const record = ddb.store.get(`${RECORD_CONTRACT}#labs-aecf`);
    expect(record.first_seen_at).toBe(EARLIER);
    expect(record.last_synced_at).toBe(NOW);
  });

  it('deletes contracts the sheet no longer lists', async () => {
    const ddb = fakeDdb({
      contracts: [
        { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', ai_use_terms: 'Silent', notes: 'a', project_name: '', ai_posture: '', agreement_type: '', contract_num: '' },
        { contract_id: 'labs-gone', portfolio: 'LABS', project: 'Gone' },
      ],
    });
    // Two stored, one incoming: one delete out of two is over the 10% ceiling,
    // so the override is required to prove the delete path at all.
    const report = await run(ddb, gridOf(rowOf(AECF)), { override: true });

    expect(report.deleted).toBe(1);
    expect(report.deletedIds).toEqual(['labs-gone']);
    expect(ddb.store.has(`${RECORD_CONTRACT}#labs-gone`)).toBe(false);
  });

  it('writes the in-progress marker before any contract write', async () => {
    const ddb = fakeDdb();
    await run(ddb, gridOf(rowOf(AECF)));

    const firstMetaWrite = ddb.calls.findIndex(
      (c) => c.type === 'Put' && c.params.Item.record_type === RECORD_SEED_META,
    );
    const firstContractWrite = ddb.calls.findIndex(
      (c) => c.type === 'Put' && c.params.Item.record_type === RECORD_CONTRACT,
    );
    expect(firstMetaWrite).toBeLessThan(firstContractWrite);
    expect(ddb.metaWrites()[0].params.Item.status).toBe(SEED_IN_PROGRESS);
  });

  it('keeps the previous baseline on the in-progress marker', async () => {
    // A death mid-apply must not leave the next run measuring against a table
    // that was never fully written.
    const ddb = fakeDdb({
      meta: {
        record_type: RECORD_SEED_META, contract_id: SEED_META_KEY,
        status: SEED_COMPLETE, row_count: 95,
      },
    });
    await run(ddb, gridOf(rowOf(AECF), ...manyRows(95)));

    const marker = ddb.metaWrites()[0].params.Item;
    expect(marker.status).toBe(SEED_IN_PROGRESS);
    expect(marker.row_count).toBe(95);
    expect(marker.incoming_row_count).toBe(96);
  });

  it('reports a previous in-progress marker to the caller', async () => {
    const ddb = fakeDdb({
      meta: { record_type: RECORD_SEED_META, contract_id: SEED_META_KEY, status: SEED_IN_PROGRESS },
    });
    const report = await run(ddb, gridOf(rowOf(AECF)));
    expect(report.previousState).toBe(SEED_IN_PROGRESS);
  });

  it('writes absolutely nothing when the gate refuses', async () => {
    const ddb = fakeDdb({
      contracts: [
        { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF' },
        { contract_id: 'labs-riverside', portfolio: 'LABS', project: 'Riverside' },
      ],
    });
    // Zero incoming rows — never overridable.
    const report = await run(ddb, gridOf());

    expect(report.refusal).toMatch(/zero/i);
    expect(report.applied).toBe(false);
    expect(ddb.contractWrites()).toHaveLength(0);
    expect(ddb.metaWrites()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
  });

  it('writes nothing on a dry run but still reports the full diff', async () => {
    const ddb = fakeDdb();
    const report = await run(ddb, gridOf(rowOf(AECF), rowOf(RIVERSIDE)), { dryRun: true });

    expect(report.created).toBe(2);
    expect(report.applied).toBe(false);
    expect(ddb.contractWrites()).toHaveLength(0);
    expect(ddb.metaWrites()).toHaveLength(0);
  });

  it('drops the excluded posture duplicate before writing', async () => {
    const ddb = fakeDdb();
    await run(ddb, gridOf(rowOf({ ...AECF, aiPosture: 'silent', terms: 'silent' })));
    const record = ddb.store.get(`${RECORD_CONTRACT}#labs-aecf`);
    expect(record.ai_posture).toBe('silent');
    expect(record.terms).toBeUndefined();
  });
});

describe('checkContractDrift', () => {
  const projects = [
    { record_type: RECORD_PROJECT, project_code: 'ST033', project_name: 'Maryland Statewide Agile Teams', contract_name: '' },
  ];
  const postures = [{ entity_type: 'posture', id: 'silent', label: 'AI SILENT' }];

  it('reports an unresolved project name and a missing posture separately', async () => {
    const ddb = fakeDdb({ projects, postures });
    const drift = await checkContractDrift({
      ddb, projectsTable: PROJECTS_TABLE, referenceTable: REFERENCE_TABLE, QueryCommand,
      contracts: {
        'labs-aecf': { contract_id: 'labs-aecf', project_name: 'MA PFML', ai_posture: '' },
      },
    });

    expect(drift.unresolvedProjects).toHaveLength(1);
    expect(drift.unresolvedProjects[0].raw_value).toBe('MA PFML');
    expect(drift.missingPosture).toHaveLength(1);
    expect(drift.projectCount).toBe(1);
    expect(drift.postureCount).toBe(1);
  });

  it('reports nothing for a fully resolved contract', async () => {
    const ddb = fakeDdb({ projects, postures });
    const drift = await checkContractDrift({
      ddb, projectsTable: PROJECTS_TABLE, referenceTable: REFERENCE_TABLE, QueryCommand,
      contracts: {
        'st-md': {
          contract_id: 'st-md',
          project_name: 'Maryland Statewide Agile Teams',
          ai_posture: 'silent',
        },
      },
    });

    expect(drift.unresolvedProjects).toHaveLength(0);
    expect(drift.missingPosture).toHaveLength(0);
    expect(drift.unresolvedPostures).toHaveLength(0);
  });

  it('reads postures from the reference table, not the projects table', async () => {
    const ddb = fakeDdb({ projects, postures });
    await checkContractDrift({
      ddb, projectsTable: PROJECTS_TABLE, referenceTable: REFERENCE_TABLE, QueryCommand,
      contracts: {},
    });

    const queried = ddb.calls.filter((c) => c.type === 'Query').map((c) => c.params.TableName);
    expect(queried).toContain(PROJECTS_TABLE);
    expect(queried).toContain(REFERENCE_TABLE);
  });
});

// The gate is unit-tested in isolation, but the call site is what actually guards
// the prod table. A wiring bug here — wrong count, wrong baseline, gate not
// consulted — would pass every pure-function test.
describe('populateContracts gate wiring', () => {
  it('refuses at the delete ceiling and writes nothing', async () => {
    const ddb = fakeDdb({ contracts: manyStored(100) });
    // 100 stored, 80 incoming: 20 deletes is over the 10% ceiling.
    const report = await run(ddb, gridOf(...manyRows(80)));

    expect(report.refusal).toMatch(/delete/i);
    expect(report.applied).toBe(false);
    expect(ddb.contractWrites()).toHaveLength(0);
    expect(ddb.metaWrites()).toHaveLength(0);
    expect(ddb.deletes()).toHaveLength(0);
  });

  it('passes the last completed run as the baseline, not the stored count', async () => {
    // Stored has already been drained to 100; the baseline still says 119. Only a
    // gate reading the baseline refuses this.
    const ddb = fakeDdb({
      contracts: manyStored(100),
      meta: {
        record_type: RECORD_SEED_META, contract_id: SEED_META_KEY,
        status: SEED_COMPLETE, row_count: 119,
      },
    });
    const report = await run(ddb, gridOf(...manyRows(100)));

    expect(report.refusal).toMatch(/drop|previous/i);
    expect(ddb.contractWrites()).toHaveLength(0);
  });

  it('refuses below the absolute floor even when deletes are under the ceiling', async () => {
    const ddb = fakeDdb({ contracts: manyStored(95) });
    // 95 stored, 89 incoming: 6 deletes is under 10%, but 89 is below the floor.
    const report = await run(ddb, gridOf(...manyRows(89)));

    expect(report.refusal).toMatch(/floor|minimum/i);
    expect(ddb.contractWrites()).toHaveLength(0);
  });

  it('applies the same run when the override is given', async () => {
    const ddb = fakeDdb({ contracts: manyStored(95) });
    const report = await run(ddb, gridOf(...manyRows(89)), { override: true });

    expect(report.refusal).toBeNull();
    expect(report.applied).toBe(true);
  });
});

describe('populateContracts write ordering', () => {
  it('writes the completion marker after the deletes, not before', async () => {
    // The docstring calls this load-bearing: a death mid-apply must leave an
    // in-progress marker rather than a baseline describing a half-applied table.
    // Asserting final store state cannot catch a regression here, because deletes
    // and the marker touch different keys.
    const ddb = fakeDdb({ contracts: manyStored(100) });
    await run(ddb, gridOf(...manyRows(95)), { override: true });

    const lastDelete = ddb.calls.map((c) => c.type).lastIndexOf('Delete');
    const completionWrite = ddb.calls.findIndex(
      (c) => c.type === 'Put'
        && c.params.Item.record_type === RECORD_SEED_META
        && c.params.Item.status === SEED_COMPLETE,
    );

    expect(lastDelete).toBeGreaterThan(-1);
    expect(completionWrite).toBeGreaterThan(lastDelete);
  });
});
