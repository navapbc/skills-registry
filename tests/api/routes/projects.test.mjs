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
import {
  RECORD_PROJECT,
  RECORD_SYNC_META,
  SYNC_META_KEY,
  SYNC_IN_PROGRESS,
  SYNC_COMPLETE,
  SYNC_NEVER,
  ARCHETYPE_PRIMARY_SLUG,
  ARCHETYPE_ADDITIONAL_SLUG,
} from '../../../functions/api/lib/projects.mjs';

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

const PA_RECORD       = { user_id: 'pa@navapbc.com',       role: 'projects-admin', email: 'pa@navapbc.com',       name: 'PA' };
const ADMIN_RECORD    = { user_id: 'admin@navapbc.com',    role: 'admin',          email: 'admin@navapbc.com',    name: 'Admin' };
const MAINTAIN_RECORD = { user_id: 'maintain@navapbc.com', role: 'maintain',       email: 'maintain@navapbc.com', name: 'Maintainer' };
const USER_RECORD     = { user_id: 'user@navapbc.com',     role: 'user',           email: 'user@navapbc.com',     name: 'User' };

function as(role) {
  const record = { 'projects-admin': PA_RECORD, admin: ADMIN_RECORD, maintain: MAINTAIN_RECORD, user: USER_RECORD }[role];
  mockSend.mockResolvedValueOnce({ Item: record });
  return { Cookie: makeSessionCookie(record.user_id), 'Content-Type': 'application/json' };
}

const ARCHETYPES = [
  { entity_type: 'archetype', id: 'product-team', label: 'Product Team', status: 'active' },
  { entity_type: 'archetype', id: 'platform-team', label: 'Platform Team', status: 'active' },
  { entity_type: 'archetype', id: 'strategic-consulting-team', label: 'Strategic Consulting Team', status: 'active' },
  { entity_type: 'archetype', id: 'data-modernization-team', label: 'Data Modernization Team', status: 'active' },
];

function project(overrides = {}) {
  return {
    record_type: RECORD_PROJECT,
    project_code: 'FC026',
    project_name: 'CO COBEES',
    database_code: 'FC026',
    portfolio: 'FEDCIV',
    [ARCHETYPE_PRIMARY_SLUG]: 'Product Team',
    [ARCHETYPE_ADDITIONAL_SLUG]: '',
    ...overrides,
  };
}

const COMPLETE_META = {
  record_type: RECORD_SYNC_META,
  project_code: SYNC_META_KEY,
  status: SYNC_COMPLETE,
  last_run_at: '2026-08-06T08:00:00.000Z',
  row_count: 53,
  created: 1,
  updated: 2,
  deleted: 0,
  column_names: ['Database code', 'Project Name', 'Archetype (Primary)'],
  column_groups: { database_code: 'IDENTITY', project_name: 'IDENTITY', archetype_primary: 'FRAMEWORKS' },
  column_headers: {
    database_code: 'Database code', project_name: 'Project Name', archetype_primary: 'Archetype (Primary)',
  },
};

/**
 * Queue the reads the handler makes after the auth lookup: sync metadata (Get),
 * projects (Query), archetypes (Query).
 */
function queueReads({ projects = [project()], meta = COMPLETE_META, archetypes = ARCHETYPES } = {}) {
  mockSend.mockResolvedValueOnce({ Item: meta ?? undefined });
  mockSend.mockResolvedValueOnce({ Items: projects });
  mockSend.mockResolvedValueOnce({ Items: archetypes });
}

beforeEach(() => mockSend.mockReset());

// ── Authorization ─────────────────────────────────────────────────────────
// The module this mirrors (plugins.mjs) leaves its GETs open to any signed-in
// user. This data is contract data on a public repo's deployed hub, so reads are
// gated too — asserted separately because an untested read path is exactly where
// that gate would go missing.
describe('projects authorization', () => {
  it('refuses a maintain holder', async () => {
    const res = await app.request('/api/projects', { headers: as('maintain') });
    expect(res.status).toBe(403);
  });

  it('refuses a plain user', async () => {
    const res = await app.request('/api/projects', { headers: as('user') });
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(401);
  });

  it('performs no table read when refusing', async () => {
    await app.request('/api/projects', { headers: as('maintain') });
    // Only the auth user lookup.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('allows a projects-admin holder', async () => {
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    expect(res.status).toBe(200);
  });

  it('allows a site admin', async () => {
    const headers = as('admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    expect(res.status).toBe(200);
  });
});

// ── Read-only surface ─────────────────────────────────────────────────────
// R17 rests on there being no write route. Absence is not an invariant a future
// change has to argue with, so this asserts it — adding a write route means
// deleting a test that states the requirement.
describe('projects are read-only', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`refuses ${method} for an authorized holder`, async () => {
      const res = await app.request('/api/projects', {
        method,
        headers: as('projects-admin'),
        body: JSON.stringify({ project_name: 'Injected' }),
      });
      expect([404, 405]).toContain(res.status);
    });

    it(`refuses ${method} on a single project for an authorized holder`, async () => {
      const res = await app.request('/api/projects/FC026', {
        method,
        headers: as('projects-admin'),
        body: JSON.stringify({ project_name: 'Injected' }),
      });
      expect([404, 405]).toContain(res.status);
    });
  }
});

describe('projects listing', () => {
  it('queries the project partition, so metadata never appears among projects', async () => {
    const headers = as('projects-admin');
    queueReads();
    await app.request('/api/projects', { headers });

    const query = mockSend.mock.calls
      .map(([c]) => c)
      .find((c) => c.type === 'Query' && c.params.ExpressionAttributeValues[':t'] === RECORD_PROJECT);
    expect(query).toBeDefined();
  });

  it('returns the projects', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project(), project({ project_code: 'FH013', project_name: 'Other' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].project_code).toBe('FC026');
  });

  it('renders an empty project set without erroring', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects).toEqual([]);
  });

  it('returns the column-group mapping for the tab to group by', async () => {
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.column_groups.archetype_primary).toBe('FRAMEWORKS');
    expect(body.column_headers.archetype_primary).toBe('Archetype (Primary)');
  });
});

describe('sync state', () => {
  it('reports the last run timestamp and counts', async () => {
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.sync.state).toBe(SYNC_COMPLETE);
    expect(body.sync.last_run_at).toBe('2026-08-06T08:00:00.000Z');
    expect(body.sync.row_count).toBe(53);
  });

  it('reports never-synced rather than erroring or reporting zero', async () => {
    const headers = as('projects-admin');
    queueReads({ meta: null, projects: [] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sync.state).toBe(SYNC_NEVER);
    expect(body.sync.last_run_at).toBeNull();
  });

  // A run that wrote projects and then died leaves a populated table with an
  // in-progress marker. Reporting that as synced would vouch for a half-written
  // table; reporting it as never-synced would label a populated table empty.
  it('reports in-progress distinctly from synced and never-synced', async () => {
    const headers = as('projects-admin');
    queueReads({ meta: { ...COMPLETE_META, status: SYNC_IN_PROGRESS } });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.sync.state).toBe(SYNC_IN_PROGRESS);
  });

  // The delta is recorded by the sync rather than derived here: only the run
  // that did the writing saw both the previous and the current header set.
  it('reports the columns the sync recorded as new', async () => {
    const headers = as('projects-admin');
    queueReads({ meta: { ...COMPLETE_META, new_columns: ['Program Manager (Nava)'] } });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.sync.new_columns).toEqual(['Program Manager (Nava)']);
  });

  it('reports no new columns when the sync recorded none', async () => {
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.sync.new_columns).toEqual([]);
  });
});

describe('archetype drift', () => {
  it('reports nothing when every value resolves', async () => {
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
    expect(body.drift.missing).toEqual([]);
  });

  it('reports an unresolved value with the sheet string verbatim', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project({ [ARCHETYPE_PRIMARY_SLUG]: 'Prodcut Team' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toHaveLength(1);
    expect(body.drift.unresolved[0]).toMatchObject({
      project_code: 'FC026',
      project_name: 'CO COBEES',
      column: 'Archetype (Primary)',
      raw_value: 'Prodcut Team',
    });
  });

  it('resolves both values of a comma-separated additional cell', async () => {
    const headers = as('projects-admin');
    queueReads({
      projects: [project({
        [ARCHETYPE_ADDITIONAL_SLUG]: 'Strategic Consulting Team, Data Modernization Team',
      })],
    });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
  });

  it('resolves a label differing only in case or whitespace', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project({ [ARCHETYPE_PRIMARY_SLUG]: 'product  TEAM' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
  });

  it('yields no findings from an empty additional cell', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project({ [ARCHETYPE_ADDITIONAL_SLUG]: '' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
    expect(body.drift.missing).toEqual([]);
  });

  it('yields no findings from a cell of only separators', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project({ [ARCHETYPE_ADDITIONAL_SLUG]: ' , , ' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
  });

  it('does not treat a deactivated archetype as drift', async () => {
    const headers = as('projects-admin');
    queueReads({
      projects: [project({ [ARCHETYPE_PRIMARY_SLUG]: 'Legacy Team' })],
      archetypes: [...ARCHETYPES, { entity_type: 'archetype', id: 'legacy', label: 'Legacy Team', status: 'inactive' }],
    });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
  });

  it('reports an unassigned primary as missing, with no raw value', async () => {
    const headers = as('projects-admin');
    queueReads({ projects: [project({ [ARCHETYPE_PRIMARY_SLUG]: '' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toEqual([]);
    expect(body.drift.missing).toHaveLength(1);
    expect(body.drift.missing[0].raw_value).toBeUndefined();
  });

  it('reports every value unresolved when no archetype records exist', async () => {
    const headers = as('projects-admin');
    queueReads({ archetypes: [] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.drift.unresolved).toHaveLength(1);
    expect(body.drift.archetype_count).toBe(0);
  });
});

// ── Contract drift ────────────────────────────────────────────────────────
// Reported on this endpoint rather than its own because the audience is
// identical. The contracts table was added after this route existed and is
// operator-populated, so "absent" is a legitimate state that must not take the
// Projects tab down with it.
describe('projects contract drift', () => {
  const CONTRACT_POSTURES = [
    { entity_type: 'posture', id: 'silent', label: 'AI SILENT', status: 'active' },
    { entity_type: 'posture', id: 'allowed', label: 'AI ALLOWED', status: 'active' },
  ];

  function contract(overrides = {}) {
    return {
      record_type: 'contract',
      contract_id: 'fedciv-co-cobees',
      portfolio: 'FEDCIV',
      project: 'CO COBEES',
      project_name: 'CO COBEES',
      ai_posture: 'silent',
      ...overrides,
    };
  }

  /** The two extra reads the handler makes when a contracts table is configured. */
  function queueContractReads({ contracts = [contract()], postures = CONTRACT_POSTURES } = {}) {
    mockSend.mockResolvedValueOnce({ Items: contracts });
    mockSend.mockResolvedValueOnce({ Items: postures });
  }

  let previous;
  beforeEach(() => {
    previous = process.env.CONTRACTS_TABLE;
    process.env.CONTRACTS_TABLE = 'skills-hub-contracts-staging';
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CONTRACTS_TABLE;
    else process.env.CONTRACTS_TABLE = previous;
  });

  it('reports a clean bill of health when every contract resolves', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.available).toBe(true);
    expect(body.contract_drift.contract_count).toBe(1);
    expect(body.contract_drift.unresolved_projects).toEqual([]);
    expect(body.contract_drift.missing_posture).toEqual([]);
  });

  it('reports a project name matching no project, with the raw value', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads({ contracts: [contract({ project_name: 'MA PFML' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.unresolved_projects).toHaveLength(1);
    expect(body.contract_drift.unresolved_projects[0].raw_value).toBe('MA PFML');
    expect(body.contract_drift.unresolved_projects[0].contract_id).toBe('fedciv-co-cobees');
  });

  it('counts a contract with no posture separately from an unresolved project', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads({
      contracts: [contract({ project_name: 'MA PFML', ai_posture: '' })],
    });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.missing_posture).toHaveLength(1);
    expect(body.contract_drift.unresolved_projects).toHaveLength(1);
  });

  it('reports a posture value matching no posture record', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads({ contracts: [contract({ ai_posture: 'prohibited' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.unresolved_postures).toHaveLength(1);
    expect(body.contract_drift.unresolved_postures[0].raw_value).toBe('prohibited');
    expect(body.contract_drift.missing_posture).toHaveLength(0);
  });

  it('does not report a contract that names no project at all', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads({ contracts: [contract({ project_name: '' })] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.unresolved_projects).toEqual([]);
  });

  it('reports an empty contracts table as available with a zero count', async () => {
    const headers = as('projects-admin');
    queueReads();
    queueContractReads({ contracts: [] });
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(body.contract_drift.available).toBe(true);
    expect(body.contract_drift.contract_count).toBe(0);
  });

  it('serves the projects response when the contracts read fails', async () => {
    const headers = as('projects-admin');
    queueReads();
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Requested resource not found'), {
      name: 'ResourceNotFoundException',
    }));
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    // The Projects tab must not go down for a table it never needed.
    expect(res.status).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.drift.unresolved).toEqual([]);
    // Distinct from a zero count: the tab says "not checked", not "all clear".
    expect(body.contract_drift.available).toBe(false);
    expect(body.contract_drift.contract_count).toBe(0);
  });

  it('reports not-checked when no contracts table is configured', async () => {
    delete process.env.CONTRACTS_TABLE;
    const headers = as('projects-admin');
    queueReads();
    const res = await app.request('/api/projects', { headers });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.contract_drift.available).toBe(false);
  });

  it('still refuses a non-holder, contracts or not', async () => {
    const res = await app.request('/api/projects', { headers: as('maintain') });
    expect(res.status).toBe(403);
  });
});
