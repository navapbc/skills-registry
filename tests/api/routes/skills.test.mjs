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
}));

import { app } from '../../../functions/api/index.mjs';

function makeSessionCookie(email = 'user@navapbc.com') {
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

const USER_RECORD  = { user_id: 'user@navapbc.com',  email: 'user@navapbc.com',  name: 'Test',  role: 'user'  };
const ADMIN_RECORD = { user_id: 'admin@navapbc.com', email: 'admin@navapbc.com', name: 'Admin', role: 'admin' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/skills', () => {
  it('returns 401 without session cookie', async () => {
    const res = await app.request('/api/skills');
    expect(res.status).toBe(401);
  });

  it('returns approved public skills and filters private ones from other users', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({
        Items: [
          { slug: 'test-skill', name: 'Test', status: 'approved', visibility: 'public',  created_by: 'system' },
          { slug: 'private',    name: 'Priv', status: 'approved', visibility: 'private', created_by: 'other@navapbc.com' },
        ],
      });

    const res = await app.request('/api/skills', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].slug).toBe('test-skill');
  });
});

describe('POST /api/skills', () => {
  it('creates skill with status=pending for regular user', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'new-skill', name: 'New Skill', description: 'A new skill',
        plugin: 'my-plugin', repo: 'navapbc/my-plugin', path: 'skills/new-skill/SKILL.md',
        author: 'user@navapbc.com', compatibility: ['claude-code'], type: 'skill',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.created_by).toBe('user@navapbc.com');
    expect(body.source).toBe('user-submitted');
  });

  it('creates skill with status=approved for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'admin-skill', name: 'Admin Skill', description: 'An admin-created skill',
        plugin: 'my-plugin', repo: 'navapbc/my-plugin', path: 'skills/admin-skill/SKILL.md',
        author: 'admin@navapbc.com', compatibility: [], type: 'skill',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });

  it('returns 400 for missing required fields', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing slug' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/skills/:slug', () => {
  it('allows user to delete their own skill', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'my-skill', created_by: 'user@navapbc.com', status: 'pending' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills/my-skill', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(200);
  });

  it('returns 403 when user tries to delete another user skill', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'other-skill', created_by: 'other@navapbc.com', status: 'approved' } });

    const res = await app.request('/api/skills/other-skill', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/skills/:slug/approve', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/skills/some-skill/approve', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('approves skill for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'some-skill', status: 'pending', created_by: 'user@navapbc.com' } })
      .mockResolvedValueOnce({ Attributes: { slug: 'some-skill', status: 'approved' } })
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills/some-skill/approve', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });
});
