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

const USER_RECORD     = { user_id: 'user@navapbc.com',     role: 'user',     email: 'user@navapbc.com',     name: 'User'  };
const ADMIN_RECORD    = { user_id: 'admin@navapbc.com',    role: 'admin',    email: 'admin@navapbc.com',    name: 'Admin' };
const MAINTAIN_RECORD = { user_id: 'maintain@navapbc.com', role: 'maintain', email: 'maintain@navapbc.com', name: 'Maintainer' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/plugins', () => {
  it('returns plugin list for authenticated user', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Items: [{ slug: 'my-plugin', name: 'My Plugin', visibility: 'public', status: 'approved' }] });

    const res = await app.request('/api/plugins', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins).toHaveLength(1);
  });
});

describe('POST /api/plugins', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-plugin', name: 'New Plugin', description: 'A plugin', repo: 'navapbc/repo', author: 'admin@navapbc.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin to create a plugin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-plugin', name: 'New Plugin', description: 'A plugin', repo: 'navapbc/repo', author: 'admin@navapbc.com' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'p', name: 'P', description: 'desc', repo: 'org/repo', author: 'me' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows maintain to create a plugin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-plugin', name: 'New Plugin', description: 'A plugin', repo: 'navapbc/repo', author: 'maintain@navapbc.com' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing required fields', async () => {
    mockSend.mockResolvedValueOnce({ Item: ADMIN_RECORD });
    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'incomplete' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/plugins/:slug', () => {
  it('returns plugin by slug for authenticated user', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'my-plugin', name: 'My Plugin' } });

    const res = await app.request('/api/plugins/my-plugin', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('my-plugin');
  });

  it('returns 404 when plugin not found', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Item: undefined });

    const res = await app.request('/api/plugins/missing-plugin', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/plugins/:slug', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/plugins/some-plugin', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when plugin not found', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: undefined });
    const res = await app.request('/api/plugins/missing-plugin', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(404);
  });

  it('updates plugin for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'some-plugin', name: 'Old Name', description: 'desc', repo: 'org/repo', author: 'me' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/plugins/some-plugin', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('New Name');
  });
});

describe('DELETE /api/plugins/:slug', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/plugins/some-plugin', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when plugin not found', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Item: undefined });
    const res = await app.request('/api/plugins/missing-plugin', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(404);
  });

  it('admin can delete a plugin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'some-plugin', name: 'Some Plugin' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/plugins/some-plugin', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('some-plugin');
  });

  it('maintain can delete a plugin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'some-plugin', name: 'Some Plugin' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = await app.request('/api/plugins/some-plugin', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('some-plugin');
  });
});
