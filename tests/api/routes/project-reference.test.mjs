import { vi, describe, it, expect, beforeEach } from 'vitest';
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

const ARCHETYPE = {
  id: 'product-team',
  label: 'Product Team',
  description: 'Cross-functional team building a digital product.',
  color: '#651A94',
  icon: 'users',
  characteristics: ['Cross-functional', 'Iterative delivery'],
  ai_opportunities: ['Rapid prototyping'],
};

const POSTURE = {
  id: 'restricted',
  label: 'AI RESTRICTED — how to proceed',
  color: '#fff8e1',
  position: 2,
  steps: ['Read the contract terms.', 'Never input PII.'],
};

function as(role) {
  const record = { 'projects-admin': PA_RECORD, admin: ADMIN_RECORD, maintain: MAINTAIN_RECORD, user: USER_RECORD }[role];
  mockSend.mockResolvedValueOnce({ Item: record });
  return { Cookie: makeSessionCookie(record.user_id), 'Content-Type': 'application/json' };
}

beforeEach(() => mockSend.mockReset());

// ── Authorization ─────────────────────────────────────────────────────────
// R4 requires every read AND mutation authorized server-side. The module this
// route mirrors (plugins.mjs) leaves its GETs open to any signed-in user, so the
// read cases are asserted separately — an untested read path is where the gate
// would go missing.
describe('project-reference authorization', () => {
  const MUTATIONS = [
    ['POST',   '/api/project-reference/archetype',                     { ...ARCHETYPE }],
    ['PUT',    '/api/project-reference/archetype/product-team',        { label: 'Renamed' }],
    ['PUT',    '/api/project-reference/archetype/product-team/status', { status: 'inactive' }],
  ];
  const READS = [
    ['GET', '/api/project-reference/archetype'],
    ['GET', '/api/project-reference/archetype/product-team'],
    ['GET', '/api/project-reference/posture'],
  ];

  for (const role of ['maintain', 'user']) {
    for (const [method, path, body] of MUTATIONS) {
      it(`refuses ${method} ${path} for ${role}`, async () => {
        const res = await app.request(path, { method, headers: as(role), body: JSON.stringify(body) });
        expect(res.status).toBe(403);
      });
    }
    for (const [method, path] of READS) {
      it(`refuses ${method} ${path} for ${role}`, async () => {
        const res = await app.request(path, { method, headers: as(role) });
        expect(res.status).toBe(403);
      });
    }
  }

  it('refuses an unauthenticated mutation', async () => {
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ARCHETYPE),
    });
    expect(res.status).toBe(401);
  });

  it('refuses an unauthenticated read', async () => {
    const res = await app.request('/api/project-reference/archetype');
    expect(res.status).toBe(401);
  });

  it('an unauthorized mutation neither writes nor audits', async () => {
    await app.request('/api/project-reference/archetype', {
      method: 'POST',
      headers: as('maintain'),
      body: JSON.stringify(ARCHETYPE),
    });
    // Exactly one send: the auth middleware's user lookup. No Put, no audit.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ── Reads ─────────────────────────────────────────────────────────────────
describe('GET /api/project-reference/:entityType', () => {
  it('returns only records of the requested entity type', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Items: [ARCHETYPE] });
    const res = await app.request('/api/project-reference/archetype', { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).records).toEqual([ARCHETYPE]);

    // A Query on the partition key, not a Scan — a Scan would return both types.
    const cmd = mockSend.mock.calls[1][0];
    expect(cmd.type).toBe('Query');
    expect(cmd.params.ExpressionAttributeValues[':t']).toBe('archetype');
  });

  it('returns an empty list rather than 404 when the partition is empty', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await app.request('/api/project-reference/posture', { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).records).toEqual([]);
  });

  it('rejects an unknown entity type instead of querying a phantom partition', async () => {
    const res = await app.request('/api/project-reference/widget', { headers: as('admin') });
    expect(res.status).toBe(400);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a record that does not exist', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await app.request('/api/project-reference/archetype/nope', { headers });
    expect(res.status).toBe(404);
  });
});

// ── Create ────────────────────────────────────────────────────────────────
describe('POST /api/project-reference/:entityType', () => {
  it('creates an archetype and writes an audit entry naming the actor', async () => {
    const headers = as('projects-admin');
    mockSend
      .mockResolvedValueOnce({})  // Put
      .mockResolvedValueOnce({}); // writeAudit
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers, body: JSON.stringify(ARCHETYPE),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('product-team');
    expect(body.entity_type).toBe('archetype');
    expect(body.status).toBe('active');

    const audit = mockSend.mock.calls[2][0];
    expect(audit.params.Item.user_id).toBe('pa@navapbc.com');
    expect(audit.params.Item.action).toBe('created');
    expect(audit.params.Item.resource_type).toBe('archetype');
  });

  it('creates a posture with its steps in the authored order', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/posture', {
      method: 'POST', headers, body: JSON.stringify(POSTURE),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).steps).toEqual(POSTURE.steps);
  });

  it('admins can create too', async () => {
    const headers = as('admin');
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers, body: JSON.stringify(ARCHETYPE),
    });
    expect(res.status).toBe(201);
  });

  it('refuses to create over an existing id rather than discarding the record', async () => {
    const headers = as('projects-admin');
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })
    );
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers, body: JSON.stringify(ARCHETYPE),
    });
    expect(res.status).toBe(409);
    // No audit entry for a create that did not happen.
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('rejects an icon outside the allowlist', async () => {
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST',
      headers: as('projects-admin'),
      body: JSON.stringify({ ...ARCHETYPE, icon: 'groups' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/icon/i);
  });

  it('rejects a posture step that is an empty string', async () => {
    const res = await app.request('/api/project-reference/posture', {
      method: 'POST',
      headers: as('projects-admin'),
      body: JSON.stringify({ ...POSTURE, steps: ['Read the terms.', '   '] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/step/i);
  });

  it('rejects a posture with no steps at all', async () => {
    const res = await app.request('/api/project-reference/posture', {
      method: 'POST',
      headers: as('projects-admin'),
      body: JSON.stringify({ ...POSTURE, steps: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an id that is not slug-safe, since it is used as a style key', async () => {
    const res = await app.request('/api/project-reference/posture', {
      method: 'POST',
      headers: as('projects-admin'),
      body: JSON.stringify({ ...POSTURE, id: 'Not A Slug' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/id/i);
  });

  it('rejects a colour that is not a hex value', async () => {
    const res = await app.request('/api/project-reference/posture', {
      method: 'POST',
      headers: as('projects-admin'),
      body: JSON.stringify({ ...POSTURE, color: 'goldenrod' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing required field', async () => {
    const { label, ...noLabel } = ARCHETYPE;
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers: as('projects-admin'), body: JSON.stringify(noLabel),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers: as('projects-admin'), body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('round-trips an archetype with no optional lists without inventing null entries', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const minimal = { id: 'lean-team', label: 'Lean Team', color: '#123456', icon: 'users' };
    const res = await app.request('/api/project-reference/archetype', {
      method: 'POST', headers, body: JSON.stringify(minimal),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.characteristics).toEqual([]);
    expect(body.ai_opportunities).toEqual([]);
  });
});

// ── Update ────────────────────────────────────────────────────────────────
describe('PUT /api/project-reference/:entityType/:id', () => {
  it('persists reordered steps in the new order', async () => {
    const headers = as('projects-admin');
    const reordered = ['Never input PII.', 'Read the contract terms.'];
    mockSend
      .mockResolvedValueOnce({ Item: { ...POSTURE, entity_type: 'posture', status: 'active' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/posture/restricted', {
      method: 'PUT', headers, body: JSON.stringify({ ...POSTURE, steps: reordered }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).steps).toEqual(reordered);
  });

  it('returns 404 for a record that does not exist rather than creating it', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await app.request('/api/project-reference/archetype/ghost', {
      method: 'PUT', headers, body: JSON.stringify({ ...ARCHETYPE, id: 'ghost' }),
    });
    expect(res.status).toBe(404);
    expect(mockSend).toHaveBeenCalledTimes(2); // auth + get, no put
  });

  it('cannot change a record id via the body', async () => {
    const headers = as('projects-admin');
    mockSend
      .mockResolvedValueOnce({ Item: { ...ARCHETYPE, entity_type: 'archetype', status: 'active' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/archetype/product-team', {
      method: 'PUT', headers, body: JSON.stringify({ ...ARCHETYPE, id: 'hijacked' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('product-team');
  });
});

// ── Status transition ─────────────────────────────────────────────────────
describe('PUT /api/project-reference/:entityType/:id/status', () => {
  it('deactivates a record and names the intent in the audit trail', async () => {
    const headers = as('projects-admin');
    mockSend
      .mockResolvedValueOnce({ Item: { ...ARCHETYPE, entity_type: 'archetype', status: 'active' } })
      .mockResolvedValueOnce({ Attributes: { ...ARCHETYPE, status: 'inactive' } })
      .mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/archetype/product-team/status', {
      method: 'PUT', headers, body: JSON.stringify({ status: 'inactive' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('inactive');

    const audit = mockSend.mock.calls[3][0];
    expect(audit.params.Item.action).toBe('deactivated');
  });

  it('reactivates a record and names that intent distinctly', async () => {
    const headers = as('projects-admin');
    mockSend
      .mockResolvedValueOnce({ Item: { ...ARCHETYPE, entity_type: 'archetype', status: 'inactive' } })
      .mockResolvedValueOnce({ Attributes: { ...ARCHETYPE, status: 'active' } })
      .mockResolvedValueOnce({});
    const res = await app.request('/api/project-reference/archetype/product-team/status', {
      method: 'PUT', headers, body: JSON.stringify({ status: 'active' }),
    });
    expect(res.status).toBe(200);
    expect(mockSend.mock.calls[3][0].params.Item.action).toBe('reactivated');
  });

  it('a deactivated record is still retrievable by id', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Item: { ...ARCHETYPE, status: 'inactive' } });
    const res = await app.request('/api/project-reference/archetype/product-team', { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('inactive');
  });

  it('rejects an unrecognised status value', async () => {
    const res = await app.request('/api/project-reference/archetype/product-team/status', {
      method: 'PUT', headers: as('projects-admin'), body: JSON.stringify({ status: 'deleted' }),
    });
    expect(res.status).toBe(400);
  });
});

// Deletion is deliberately not exposed: the origin requires that a referenced
// record cannot be hard-deleted, and omitting the route is simpler than guarding
// one. This pins that decision so a later addition is a conscious choice.
describe('deletion is not exposed', () => {
  it('DELETE is not routed', async () => {
    const res = await app.request('/api/project-reference/archetype/product-team', {
      method: 'DELETE', headers: as('admin'),
    });
    expect(res.status).toBe(404);
  });
});

// ── Reference usage ───────────────────────────────────────────────────────
describe('GET /api/project-reference-usage/:entityType', () => {
  it('reports unavailable rather than zeroes while program data is absent', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Items: [{ id: 'product-team' }] });
    const res = await app.request('/api/project-reference-usage/archetype', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.counts).toBeUndefined();
    expect(body.reason).toMatch(/not yet loaded/i);
  });

  it('is gated like every other route', async () => {
    const res = await app.request('/api/project-reference-usage/archetype', { headers: as('maintain') });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown entity type', async () => {
    const res = await app.request('/api/project-reference-usage/widget', { headers: as('admin') });
    expect(res.status).toBe(400);
  });

  // The path is separate rather than nested so a record whose id is literally
  // "usage" stays reachable.
  it('does not shadow a record whose id is "usage"', async () => {
    const headers = as('projects-admin');
    mockSend.mockResolvedValueOnce({ Item: { entity_type: 'archetype', id: 'usage', label: 'Usage' } });
    const res = await app.request('/api/project-reference/archetype/usage', { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('usage');
  });
});
