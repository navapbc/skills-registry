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
import {
  RECORD_CONTRACT,
  SEED_COMPLETE,
  SEED_IN_PROGRESS,
  SEED_NEVER,
} from '../../../functions/api/lib/contracts.mjs';

function makeSessionCookie(email) {
  const b64 = (s) =>
    Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', TEST_SECRET)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const RECORDS = {
  'projects-admin': { user_id: 'pa@navapbc.com', role: 'projects-admin', email: 'pa@navapbc.com', name: 'PA' },
  admin: { user_id: 'admin@navapbc.com', role: 'admin', email: 'admin@navapbc.com', name: 'Admin' },
  maintain: { user_id: 'maintain@navapbc.com', role: 'maintain', email: 'maintain@navapbc.com', name: 'M' },
  user: { user_id: 'user@navapbc.com', role: 'user', email: 'user@navapbc.com', name: 'User' },
};

function as(role) {
  const record = RECORDS[role];
  mockSend.mockResolvedValueOnce({ Item: record });
  return { Cookie: makeSessionCookie(record.user_id), 'Content-Type': 'application/json' };
}

const POSTURES = [
  { entity_type: 'posture', id: 'prohibited', label: 'AI PROHIBITED — hard stop', color: '#fce8e8', position: 4, steps: ['Stop.'] },
  { entity_type: 'posture', id: 'allowed', label: 'AI ALLOWED — how to proceed', color: '#e0f5f0', position: 1, steps: ['Go.'] },
  { entity_type: 'posture', id: 'silent', label: 'AI SILENT — how to proceed', color: '#faf0f7', position: 3, steps: ['Check.'] },
];

const PROJECT = {
  record_type: RECORD_PROJECT,
  project_code: 'FC026',
  project_name: 'CO COBEES',
  portfolio: 'FEDCIV',
  agency: 'Department of Justice',
  archetype_primary: 'Product Team',
  archetype_additional: '',
  // Fields the explorer must not publish — projects remain projects-admin-gated.
  pop_start: '6/03/2021',
  link_to_program_health: 'https://confluence/secret-health-page',
  vehicle: 'GSA MAS',
  program_review_channel: 'program-review-example-fixture',
};

function contract(overrides = {}) {
  return {
    record_type: RECORD_CONTRACT,
    contract_id: 'fedciv-co-cobees',
    portfolio: 'FEDCIV',
    project: 'CO COBEES',
    project_name: 'CO COBEES',
    ai_posture: 'silent',
    ai_use_terms: 'Silent on AI use.',
    ...overrides,
  };
}

const META = {
  status: SEED_COMPLETE,
  last_run_at: '2026-08-07T18:53:15.161Z',
  row_count: 119,
};

/** Queue the four reads the handler makes after the auth lookup. */
function queueReads({ contracts = [contract()], postures = POSTURES, projects = [PROJECT], meta = META } = {}) {
  mockSend.mockResolvedValueOnce({ Item: meta ?? undefined });
  mockSend.mockResolvedValueOnce({ Items: contracts });
  mockSend.mockResolvedValueOnce({ Items: postures });
  mockSend.mockResolvedValueOnce({ Items: projects });
}

// All three tables must be configured: the route refuses with 503 unless every
// one it reads is named, so a partial config rollout cannot become an opaque
// SDK error from `TableName: undefined`.
const TABLE_VARS = {
  CONTRACTS_TABLE: 'skills-hub-contracts-staging',
  PROJECT_REFERENCE_TABLE: 'skills-hub-project-reference-staging',
  PROJECTS_TABLE: 'skills-hub-projects-staging',
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
// Deliberately the odd one out: every other project-data read is capability-gated.
// Asserted per role because "open to all signed-in users" is a decision, and a
// future change that narrows or widens it should have to delete a test that says so.
describe('contracts authorization', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await app.request('/api/contracts');
    expect(res.status).toBe(401);
  });

  it('reads no table when unauthenticated', async () => {
    await app.request('/api/contracts');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each(['user', 'maintain', 'admin', 'projects-admin'])('allows a %s', async (role) => {
    const headers = as(role);
    queueReads();
    const res = await app.request('/api/contracts', { headers });
    expect(res.status).toBe(200);
  });

  it('serves a base-role user the same contracts as an admin', async () => {
    const userHeaders = as('user');
    queueReads();
    const userBody = await (await app.request('/api/contracts', { headers: userHeaders })).json();

    mockSend.mockReset();
    const adminHeaders = as('admin');
    queueReads();
    const adminBody = await (await app.request('/api/contracts', { headers: adminHeaders })).json();

    expect(userBody).toEqual(adminBody);
  });
});

// ── Read-only surface ─────────────────────────────────────────────────────
describe('contracts are read-only', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`refuses ${method}`, async () => {
      const res = await app.request('/api/contracts', {
        method,
        headers: as('admin'),
        body: JSON.stringify({ contract_id: 'injected' }),
      });
      expect([404, 405]).toContain(res.status);
    });
  }
});

describe('contracts payload', () => {
  it('returns every contract', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract(), contract({ contract_id: 'labs-aecf', project: 'AECF' })] });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts).toHaveLength(2);
  });

  it('queries the contract partition, so metadata never appears among contracts', async () => {
    const headers = as('user');
    queueReads();
    await app.request('/api/contracts', { headers });

    const query = mockSend.mock.calls
      .map(([c]) => c)
      .find((c) => c.type === 'Query' && c.params.ExpressionAttributeValues[':t'] === RECORD_CONTRACT);
    expect(query).toBeDefined();
  });

  it('resolves a posture to its id', async () => {
    const headers = as('user');
    queueReads();
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].posture_id).toBe('silent');
  });

  it('reports a contract with no posture as null rather than omitting it', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract({ ai_posture: '' })] });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].posture_id).toBeNull();
    // The grid's default filter depends on telling this apart from a resolved one.
    expect(body.contracts[0]).toHaveProperty('posture_id');
  });

  it('reports a posture naming no record as null', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract({ ai_posture: 'nonsense' })] });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].posture_id).toBeNull();
    // The raw value survives so the detail page can show what the survey says.
    expect(body.contracts[0].ai_posture).toBe('nonsense');
  });

  it('orders postures by authored position, not by id', async () => {
    const headers = as('user');
    queueReads();
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.postures.map((p) => p.id)).toEqual(['allowed', 'silent', 'prohibited']);
  });

  it('carries the capture date and population state', async () => {
    const headers = as('user');
    queueReads();
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.population.captured_at).toBe('2026-08-07T18:53:15.161Z');
    expect(body.population.state).toBe(SEED_COMPLETE);
  });

  it('reports a half-written table as in progress rather than complete', async () => {
    const headers = as('user');
    queueReads({ meta: { status: SEED_IN_PROGRESS, row_count: 119 } });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.population.state).toBe(SEED_IN_PROGRESS);
  });

  it('reports never-populated when no metadata record exists', async () => {
    const headers = as('user');
    queueReads({ meta: null });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.population.state).toBe(SEED_NEVER);
    expect(body.population.captured_at).toBeNull();
  });

  it('returns an empty collection for an empty table, not an error', async () => {
    const headers = as('user');
    queueReads({ contracts: [], meta: null });
    const res = await app.request('/api/contracts', { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).contracts).toEqual([]);
  });

  it.each(Object.keys(TABLE_VARS))('refuses with 503 when %s is unconfigured', async (missing) => {
    delete process.env[missing];
    const res = await app.request('/api/contracts', { headers: as('user') });
    expect(res.status).toBe(503);
  });

  it('fails visibly rather than serving an empty success when a read throws', async () => {
    // Deliberately unlike the projects route, which degrades to empty findings.
    // Here the page IS the contracts, so an empty success would be a lie.
    const headers = as('user');
    mockSend.mockRejectedValueOnce(new Error('throttled'));
    const res = await app.request('/api/contracts', { headers });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/could not be read/i);
  });
});

describe('project resolution', () => {
  it('attaches a project summary when the name resolves', async () => {
    const headers = as('user');
    queueReads();
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].resolved_project).toMatchObject({
      project_code: 'FC026',
      project_name: 'CO COBEES',
      archetype_primary: 'Product Team',
    });
  });

  it('attaches null when the name resolves to nothing', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract({ project_name: 'MA PFML' })] });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].resolved_project).toBeNull();
    // The contract is still served — the posture answer does not depend on the join.
    expect(body.contracts[0].posture_id).toBe('silent');
  });

  it('attaches null when the contract names no project at all', async () => {
    const headers = as('user');
    queueReads({ contracts: [contract({ project_name: '' })] });
    const body = await (await app.request('/api/contracts', { headers })).json();
    expect(body.contracts[0].resolved_project).toBeNull();
  });

  it('never publishes project fields outside the deliberate projection', async () => {
    // Contracts were widened to every signed-in user; the projects table was NOT.
    // Serving whole project records here would widen a second dataset by side
    // effect. Spreading ...project into the summary would pass every other test.
    const headers = as('user');
    queueReads();
    const text = await (await app.request('/api/contracts', { headers })).text();

    for (const leaked of [
      '6/03/2021',
      'https://confluence/secret-health-page',
      'GSA MAS',
      'program-review-doj-crt',
    ]) {
      expect(text).not.toContain(leaked);
    }
    // The projection itself still arrived.
    expect(text).toContain('FC026');
  });
});
