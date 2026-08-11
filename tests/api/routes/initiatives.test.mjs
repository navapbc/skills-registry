import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

const { TEST_SECRET, mockSend } = vi.hoisted(() => ({
  TEST_SECRET: 'test-secret-value-32-chars-min!!',
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(function () {
    return { send: vi.fn().mockResolvedValue({ Parameter: { Value: TEST_SECRET } }) };
  }),
  GetParameterCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {}),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(function () { return { send: mockSend }; }) },
  GetCommand: vi.fn(function (p) { return { type: 'Get', params: p }; }),
  PutCommand: vi.fn(function (p) { return { type: 'Put', params: p }; }),
  UpdateCommand: vi.fn(function (p) { return { type: 'Update', params: p }; }),
  DeleteCommand: vi.fn(function (p) { return { type: 'Delete', params: p }; }),
  ScanCommand: vi.fn(function (p) { return { type: 'Scan', params: p }; }),
  QueryCommand: vi.fn(function (p) { return { type: 'Query', params: p }; }),
  BatchGetCommand: vi.fn(function (p) { return { type: 'BatchGet', params: p }; }),
}));

import { app } from '../../../functions/api/index.mjs';
import { RECORD_PROJECT } from '../../../functions/api/lib/projects.mjs';
import { RECORD_CONTRACT } from '../../../functions/api/lib/contracts.mjs';
import {
  RECORD_INITIATIVE,
  SEED_COMPLETE,
  SEED_IN_PROGRESS,
  SEED_NEVER,
} from '../../../functions/api/lib/initiatives.mjs';

function makeSessionCookie(email) {
  const b64 = (s) =>
    Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({
    sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', TEST_SECRET)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const RECORDS = {
  admin: { user_id: 'admin@navapbc.com', role: 'admin', email: 'admin@navapbc.com', name: 'Admin' },
  maintain: { user_id: 'm@navapbc.com', role: 'maintain', email: 'm@navapbc.com', name: 'M' },
  user: { user_id: 'user@navapbc.com', role: 'user', email: 'user@navapbc.com', name: 'User' },
};

function as(role) {
  const record = RECORDS[role];
  mockSend.mockResolvedValueOnce({ Item: record });
  return { Cookie: makeSessionCookie(record.user_id), 'Content-Type': 'application/json' };
}

const PROJECT = {
  record_type: RECORD_PROJECT,
  project_code: 'LB001',
  project_name: 'User-Facing AI',
  portfolio: 'LABS',
  agency: 'Nava Labs',
  archetype_primary: 'Product Team',
  archetype_additional: '',
  program_manager: 'Nancy Nussear',
  nava_contract_pp: 'Priya Contracts',
  project_index_code: 'UFAI',
  // Fields the hub must not publish — projects remain projects-admin-gated.
  pop_start: '6/03/2021',
  link_to_program_health: 'https://confluence/secret-health-page',
  vehicle: 'GSA MAS',
  program_review_channel: 'program-review-example-fixture',
};

function initiative(overrides = {}) {
  return {
    record_type: RECORD_INITIATIVE,
    initiative_id: 'benefits-navigator-prototype',
    title: 'Benefits navigator prototype',
    desc: 'Exploring a navigator for multiple benefit types.',
    use_case_label: 'AI-powered benefits assistant',
    use_case_theme: 'AI-powered assistant that makes benefits easier to access',
    exposure: 'client',
    people: 'Ada Lovelace; Grace Hopper',
    status: 'Apr 7–14, 2026',
    tags: 'internal',
    links: 'Demo: https://example.gov/demo',
    project_name: 'User-Facing AI',
    first_seen_at: '2026-08-10T12:00:00.000Z',
    last_synced_at: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

const META = {
  status: SEED_COMPLETE,
  last_run_at: '2026-08-10T12:00:00.000Z',
  row_count: 37,
};

function contract(overrides = {}) {
  return {
    record_type: RECORD_CONTRACT,
    contract_id: 'user-facing-ai',
    project: 'User-Facing AI',
    project_name: 'User-Facing AI',
    contract_num: '47QRAA21D0064',
    vehicle: 'GSA MAS',
    customer: 'Nava Labs',
    agreement_type: 'Task order',
    ai_posture: 'allowed',
    // Fields the initiative page must not publish.
    notes: 'internal contracting note',
    client_policy_summary: 'not this page’s business',
    ...overrides,
  };
}

/**
 * Queue the reads the handler makes after the auth lookup.
 *
 * The contracts read is FOURTH and happens only on a `?id=` request that resolves
 * to a project — queueing it for a list request would leave a stale response in the
 * mock and mask the assertion that the read never happened.
 */
function queueReads({
  initiatives = [initiative()],
  projects = [PROJECT],
  meta = META,
  contracts = null,
} = {}) {
  mockSend.mockResolvedValueOnce({ Item: meta ?? undefined });
  mockSend.mockResolvedValueOnce({ Items: initiatives });
  mockSend.mockResolvedValueOnce({ Items: projects });
  if (contracts) mockSend.mockResolvedValueOnce({ Items: contracts });
}

/** The partition keys the handler actually queried, in order. */
const queriedPartitions = () => mockSend.mock.calls
  .map(([cmd]) => cmd)
  .filter((cmd) => cmd?.type === 'Query')
  .map((q) => q.params.ExpressionAttributeValues[':t']);

// Both tables must be configured: the route refuses with 503 unless every one it
// reads is named, so a partial config rollout cannot become an opaque SDK error
// from `TableName: undefined`.
const TABLE_VARS = {
  INITIATIVES_TABLE: 'skills-hub-initiatives-staging',
  PROJECTS_TABLE: 'skills-hub-projects-staging',
  // Read only on a `?id=` request whose initiative resolves to a project.
  CONTRACTS_TABLE: 'skills-hub-contracts-staging',
};

let previousVars;
beforeEach(() => {
  mockSend.mockReset();
  previousVars = Object.fromEntries(Object.keys(TABLE_VARS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, TABLE_VARS);
});
afterEach(() => {
  for (const [key, value] of Object.entries(previousVars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ── Authorization ─────────────────────────────────────────────────────────
// Deliberately not capability-gated, matching the Contract Explorer and unlike
// every other project-data read. Asserted per role because "open to all signed-in
// users" is a decision, and a change that narrows or widens it should have to
// delete a test that says so.
describe('initiatives authorization', () => {
  it('refuses an unauthenticated request before touching DynamoDB', async () => {
    const res = await app.request('/api/initiatives');
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each(['user', 'maintain', 'admin'])('serves a signed-in %s', async (role) => {
    const headers = as(role);
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    expect(res.status).toBe(200);
  });
});

describe('initiatives read', () => {
  it('returns the initiatives and the population state', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const body = await res.json();

    expect(body.initiatives).toHaveLength(1);
    expect(body.population).toEqual({
      state: SEED_COMPLETE,
      captured_at: '2026-08-10T12:00:00.000Z',
      row_count: 37,
    });
  });

  it('resolves a matching project into resolved_project', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.resolved_project).toMatchObject({
      project_code: 'LB001',
      project_name: 'User-Facing AI',
      project_index_code: 'UFAI',
      program_manager: 'Nancy Nussear',
      nava_contract_pp: 'Priya Contracts',
    });
  });

  it('returns an initiative stating no project, with resolved_project null', async () => {
    // 14 of 37 rows state no project, so this is the common case rather than an
    // edge one. Omitting the record would hide 38% of the data.
    const headers = as('user');
    queueReads({ initiatives: [initiative({ project_name: '' })] });
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.resolved_project).toBeNull();
    expect(got.project_name).toBe('');
  });

  it('keeps the raw project_name when it resolves to nothing, so the page can name it', async () => {
    const headers = as('user');
    queueReads({ initiatives: [initiative({ project_name: 'MD ADEPT WO4' })] });
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.resolved_project).toBeNull();
    expect(got.project_name).toBe('MD ADEPT WO4');
  });

  it('queries the initiative partition and the project partition', async () => {
    const headers = as('user');
    queueReads();
    await app.request('/api/initiatives', { headers });

    expect(queriedPartitions()).toContain(RECORD_INITIATIVE);
    expect(queriedPartitions()).toContain(RECORD_PROJECT);
  });

  it('follows LastEvaluatedKey when a partition pages', async () => {
    const headers = as('user');
    mockSend.mockResolvedValueOnce({ Item: META });
    mockSend.mockResolvedValueOnce({
      Items: [initiative({ initiative_id: 'a', title: 'A' })],
      LastEvaluatedKey: { at: 1 },
    });
    mockSend.mockResolvedValueOnce({ Items: [initiative({ initiative_id: 'b', title: 'B' })] });
    mockSend.mockResolvedValueOnce({ Items: [PROJECT] });

    const res = await app.request('/api/initiatives', { headers });
    const body = await res.json();
    expect(body.initiatives.map((i) => i.initiative_id)).toEqual(['a', 'b']);
  });
});

describe('initiatives payload boundaries', () => {
  it('omits any stored attribute outside the allowlist', async () => {
    // The leak-prevention assertion. The sync uses a denylist so new sheet columns
    // reach the table automatically; this must fail if anyone replaces the
    // allowlist with a spread.
    const headers = as('user');
    queueReads({
      initiatives: [initiative({
        secret_internal_note: 'do not publish',
        owner_salary_band: 'IC5',
      })],
    });
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got).not.toHaveProperty('secret_internal_note');
    expect(got).not.toHaveProperty('owner_salary_band');
    expect(got).not.toHaveProperty('record_type');
  });

  it('serves every allowlisted field that the record carries', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    for (const field of [
      'initiative_id', 'title', 'desc', 'use_case_label', 'use_case_theme',
      'exposure', 'people', 'status', 'tags', 'links', 'project_name',
    ]) {
      expect(got).toHaveProperty(field);
    }
  });

  it('omits the projects table’s non-projected fields from resolved_project', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.resolved_project).not.toHaveProperty('pop_start');
    expect(got.resolved_project).not.toHaveProperty('link_to_program_health');
    expect(got.resolved_project).not.toHaveProperty('program_review_channel');
    expect(got.resolved_project).not.toHaveProperty('vehicle');
  });

  it('attaches the project as resolved_project, never as project', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(got).not.toHaveProperty('project');
  });
});

// ── Related contracts ─────────────────────────────────────────────────────
// The join is detail-only: `?id=` asks for it, a bare list request must not pay
// for it. `related_contracts` absent and `related_contracts: []` are different
// answers — "not asked for" and "asked, and this project owns none" — and the
// renderer keys off the difference, so both are pinned here.
describe('initiatives related contracts', () => {
  const ID = 'benefits-navigator-prototype';

  it('attaches the contracts resolving to the initiative’s project', async () => {
    const headers = as('user');
    queueReads({
      contracts: [
        contract({ contract_id: 'ufai-1' }),
        contract({ contract_id: 'elsewhere', project_name: 'MD PBIF', project: 'MD PBIF' }),
      ],
    });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.related_contracts.map((c) => c.contract_id)).toEqual(['ufai-1']);
  });

  it('includes a contract that resolves through the project’s contract_name', async () => {
    // The contracts-side resolution rule matches project_name OR contract_name.
    // Running the initiatives-side rule here instead would drop this row.
    const headers = as('user');
    queueReads({
      projects: [{ ...PROJECT, contract_name: 'UFAI WO-02' }],
      contracts: [contract({ contract_id: 'by-contract-name', project_name: 'UFAI WO-02' })],
    });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const [got] = (await res.json()).initiatives;

    expect(got.related_contracts.map((c) => c.contract_id)).toEqual(['by-contract-name']);
  });

  it('serves an empty array when the project owns no contracts', async () => {
    const headers = as('user');
    queueReads({ contracts: [] });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const [got] = (await res.json()).initiatives;

    // Queued as `[]`, so the read still happens — the empty answer is the point.
    expect(got.related_contracts).toEqual([]);
  });

  it('does not read the contracts partition for a list request', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    const [got] = (await res.json()).initiatives;

    expect(queriedPartitions()).not.toContain(RECORD_CONTRACT);
    expect(got).not.toHaveProperty('related_contracts');
  });

  it('does not read the contracts partition when the initiative has no project', async () => {
    const headers = as('user');
    queueReads({ initiatives: [initiative({ project_name: '' })] });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const [got] = (await res.json()).initiatives;

    expect(queriedPartitions()).not.toContain(RECORD_CONTRACT);
    expect(got).not.toHaveProperty('related_contracts');
  });

  it('serves the plain list for an id matching no initiative', async () => {
    const headers = as('user');
    queueReads();
    const res = await app.request('/api/initiatives?id=no-such-initiative', { headers });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(queriedPartitions()).not.toContain(RECORD_CONTRACT);
    expect(body.initiatives[0]).not.toHaveProperty('related_contracts');
  });

  it('attaches contracts only to the named initiative', async () => {
    const headers = as('user');
    queueReads({
      initiatives: [
        initiative(),
        initiative({ initiative_id: 'other', title: 'Other' }),
      ],
      contracts: [contract()],
    });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const body = await res.json();

    const named = body.initiatives.find((i) => i.initiative_id === ID);
    const other = body.initiatives.find((i) => i.initiative_id === 'other');
    expect(named.related_contracts).toHaveLength(1);
    expect(other).not.toHaveProperty('related_contracts');
  });

  it('omits any contract attribute outside the allowlist', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract()] });
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    const [got] = (await res.json()).initiatives;
    const [related] = got.related_contracts;

    expect(related).toEqual({
      contract_id: 'user-facing-ai',
      project: 'User-Facing AI',
      contract_num: '47QRAA21D0064',
      vehicle: 'GSA MAS',
      customer: 'Nava Labs',
      agreement_type: 'Task order',
    });
    expect(related).not.toHaveProperty('notes');
    expect(related).not.toHaveProperty('client_policy_summary');
    expect(related).not.toHaveProperty('record_type');
  });

  it('returns 503 when a detail request needs an unconfigured contracts table', async () => {
    const headers = as('user');
    delete process.env.CONTRACTS_TABLE;
    queueReads();
    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    expect(res.status).toBe(503);
  });

  it('still serves a list request when the contracts table is unconfigured', async () => {
    // The grid never needed that table, so a partial config rollout must not take
    // the hub's landing page down with it.
    const headers = as('user');
    delete process.env.CONTRACTS_TABLE;
    queueReads();
    const res = await app.request('/api/initiatives', { headers });
    expect(res.status).toBe(200);
  });

  it('returns 500 rather than an empty list when the contracts read fails', async () => {
    const headers = as('user');
    mockSend.mockResolvedValueOnce({ Item: META });
    mockSend.mockResolvedValueOnce({ Items: [initiative()] });
    mockSend.mockResolvedValueOnce({ Items: [PROJECT] });
    mockSend.mockRejectedValueOnce(new Error('dynamo exploded'));

    const res = await app.request(`/api/initiatives?id=${ID}`, { headers });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty('initiatives');
  });
});

describe('initiatives population states', () => {
  it('reports never_populated when no metadata record exists', async () => {
    const headers = as('user');
    queueReads({ meta: null });
    const res = await app.request('/api/initiatives', { headers });
    const body = await res.json();

    expect(body.population.state).toBe(SEED_NEVER);
    expect(body.population.captured_at).toBeNull();
  });

  it('reports in_progress for a mid-flight table rather than vouching for it', async () => {
    const headers = as('user');
    queueReads({ meta: { status: SEED_IN_PROGRESS, incoming_row_count: 37 } });
    const res = await app.request('/api/initiatives', { headers });
    const body = await res.json();

    expect(body.population.state).toBe(SEED_IN_PROGRESS);
  });
});

describe('initiatives failure modes', () => {
  it('returns 503 when the initiatives table is unconfigured', async () => {
    const headers = as('user');
    delete process.env.INITIATIVES_TABLE;
    const res = await app.request('/api/initiatives', { headers });
    expect(res.status).toBe(503);
  });

  it('returns 503 when only the projects table is unconfigured', async () => {
    // The partial-rollout case. Without this check it degrades to an opaque 500.
    const headers = as('user');
    delete process.env.PROJECTS_TABLE;
    const res = await app.request('/api/initiatives', { headers });
    expect(res.status).toBe(503);
  });

  it('returns 500 with an error body rather than an empty success', async () => {
    // The page IS the initiatives, so an empty 200 would be a lie. Deliberately
    // unlike the projects route, which degrades to empty findings.
    const headers = as('user');
    mockSend.mockRejectedValueOnce(new Error('dynamo exploded'));
    const res = await app.request('/api/initiatives', { headers });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty('initiatives');
  });
});

describe('initiatives is read-only', () => {
  // Asserted rather than trusted to absence: the Lambda's IAM grant omits write
  // actions, and a route added without noticing would fail confusingly instead of
  // being caught here.
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s', async (method) => {
    const headers = as('user');
    const res = await app.request('/api/initiatives', {
      method,
      headers,
      body: JSON.stringify({ title: 'Injected' }),
    });
    expect([404, 405]).toContain(res.status);
  });
});
