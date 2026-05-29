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
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(function () {}) }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(function () { return { send: mockSend }; }) },
  GetCommand: vi.fn(function (p) { return { type: 'Get', params: p }; }),
  PutCommand: vi.fn(function (p) { return { type: 'Put', params: p }; }),
  UpdateCommand: vi.fn(function (p) { return { type: 'Update', params: p }; }),
  DeleteCommand: vi.fn(function (p) { return { type: 'Delete', params: p }; }),
  ScanCommand: vi.fn(function (p) { return { type: 'Scan', params: p }; }),
  QueryCommand: vi.fn(function (p) { return { type: 'Query', params: p }; }),
}));

import { app } from '../../../functions/api/index.mjs';

function makeSessionCookie(email = 'user@navapbc.com') {
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', TEST_SECRET).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const USER_RECORD  = { user_id: 'user@navapbc.com',  role: 'user',  email: 'user@navapbc.com',  name: 'User'  };
const ADMIN_RECORD = { user_id: 'admin@navapbc.com', role: 'admin', email: 'admin@navapbc.com', name: 'Admin' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/users/me', () => {
  it('returns current user from context', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });

    const res = await app.request('/api/users/me', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe('user@navapbc.com');
    expect(body.role).toBe('user');
  });
});

describe('GET /api/users', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });
    const res = await app.request('/api/users', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(403);
  });

  it('returns user list for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD })
      .mockResolvedValueOnce({ Items: [USER_RECORD, ADMIN_RECORD] });

    const res = await app.request('/api/users', { headers: { Cookie: makeSessionCookie('admin@navapbc.com') } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
  });
});

describe('PUT /api/users/:id/role', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });
    const res = await app.request('/api/users/user@navapbc.com/role', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin to set a user role', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD })
      .mockResolvedValueOnce({ Attributes: { ...USER_RECORD, role: 'admin' } });

    const res = await app.request(`/api/users/${encodeURIComponent('user@navapbc.com')}/role`, {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('returns 400 for invalid role value', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: ADMIN_RECORD });
    const res = await app.request(`/api/users/${encodeURIComponent('user@navapbc.com')}/role`, {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });
});
