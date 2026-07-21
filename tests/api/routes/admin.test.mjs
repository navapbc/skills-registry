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

const USER_RECORD     = { user_id: 'user@navapbc.com',     email: 'user@navapbc.com',     name: 'User',       role: 'user'     };
const MAINTAIN_RECORD = { user_id: 'maintain@navapbc.com', email: 'maintain@navapbc.com', name: 'Maintainer', role: 'maintain' };
const ADMIN_RECORD    = { user_id: 'admin@navapbc.com',    email: 'admin@navapbc.com',    name: 'Admin',      role: 'admin'    };

beforeEach(() => mockSend.mockReset());

// ── GET /api/categories ────────────────────────────────────────────────────
describe('GET /api/categories', () => {
  it('returns categories with empty featuredSlugs when no DDB overrides', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })   // auth
      .mockResolvedValueOnce({ Responses: {} });       // BatchGetCommand

    const res = await app.request('/api/categories', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toHaveLength(5);
    expect(body.categories[0].id).toBe('personal-productivity');
    expect(body.categories[0].featuredSlugs).toEqual([]);
  });

  it('includes metadata fields for every category', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })   // auth
      .mockResolvedValueOnce({ Responses: {} });       // BatchGetCommand

    const res = await app.request('/api/categories', {
      headers: { Cookie: makeSessionCookie() },
    });
    const body = await res.json();
    for (const cat of body.categories) {
      expect(typeof cat.subtitle).toBe('string');
      expect(cat.subtitle.length).toBeGreaterThan(0);
      expect(typeof cat.heroDescription).toBe('string');
      expect(cat.heroDescription.length).toBeGreaterThan(0);
      expect(cat.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(typeof cat.icon).toBe('string');
      expect(cat.icon.length).toBeGreaterThan(0);
    }
  });

  it('merges DDB featuredSlugs override', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({
        Responses: {
          'undefined': [{ slug: 'category::build-and-ship', featuredSlugs: ['fix-bug', 'test'] }],
        },
      });

    const res = await app.request('/api/categories', {
      headers: { Cookie: makeSessionCookie() },
    });
    const body = await res.json();
    const buildShip = body.categories.find(c => c.id === 'build-and-ship');
    expect(buildShip.featuredSlugs).toEqual(['fix-bug', 'test']);
  });
});

// ── GET /api/admin/queue ───────────────────────────────────────────────────
describe('GET /api/admin/queue', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/admin/queue', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('returns pending skills for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({
        Items: [{ slug: 'pending-skill', status: 'pending', created_at: '2026-01-01T00:00:00Z' }],
        LastEvaluatedKey: undefined,
      });

    const res = await app.request('/api/admin/queue', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].slug).toBe('pending-skill');
  });
});

// ── POST /api/admin/enterprise-skills ─────────────────────────────────────
describe('POST /api/admin/enterprise-skills', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'test', name: 'Test', description: 'desc' }),
    });
    expect(res.status).toBe(403);
  });

  it('creates enterprise skill for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({})  // PutCommand
      .mockResolvedValueOnce({}); // writeAudit PutCommand

    const res = await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'daily-briefing', name: 'Daily Briefing', description: 'Morning briefing template', tags: ['productivity'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toBe('anthropic-enterprise');
    expect(body.status).toBe('approved');
    expect(body.tags).toEqual(['productivity']);
  });

  it('returns 400 when required fields missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts visibility on create and defaults to public when omitted', async () => {
    let captured;
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockImplementationOnce((cmd) => { captured = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});

    await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-skill', name: 'New', description: 'desc' }),
    });
    expect(captured?.visibility).toBe('public');
  });

  it('stores provided visibility on create', async () => {
    let captured;
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockImplementationOnce((cmd) => { captured = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});

    await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'hidden-skill', name: 'Hidden', description: 'desc', visibility: 'hidden' }),
    });
    expect(captured?.visibility).toBe('hidden');
  });
});

// ── PUT /api/admin/categories/:id/featured ────────────────────────────────
describe('PUT /api/admin/categories/:id/featured', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/admin/categories/build-and-ship/featured', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ featuredSlugs: ['fix-bug'] }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown category id', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/categories/unknown-cat/featured', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ featuredSlugs: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('updates featuredSlugs for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({})  // PutCommand
      .mockResolvedValueOnce({}); // writeAudit

    const res = await app.request('/api/admin/categories/build-and-ship/featured', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ featuredSlugs: ['fix-bug', 'test'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.featuredSlugs).toEqual(['fix-bug', 'test']);
  });
});

// ── GET /api/admin/users — admin only ─────────────────────────────────────
describe('GET /api/admin/users', () => {
  it('returns 403 for maintain role', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/users', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(403);
  });

  it('returns users for admin role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Items: [USER_RECORD, MAINTAIN_RECORD], LastEvaluatedKey: undefined });

    const res = await app.request('/api/admin/users', {
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
  });
});

// ── GET /api/admin/audit — admin only ─────────────────────────────────────
describe('GET /api/admin/audit', () => {
  it('returns 403 for maintain role', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/audit', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(403);
  });

  it('returns audit events for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Items: [{ event_id: 'e1', timestamp: '2026-01-01T00:00:00Z', action: 'created' }] });

    const res = await app.request('/api/admin/audit', {
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
  });
});

// ── GET /api/admin/skills ─────────────────────────────────────────────────
describe('GET /api/admin/skills', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/admin/skills', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('returns all skills including private and hidden for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({
        Items: [
          { slug: 'public-skill',  source: 'github',          visibility: 'public',  status: 'approved' },
          { slug: 'private-skill', source: 'github',          visibility: 'private', status: 'approved', created_by: 'other@navapbc.com' },
          { slug: 'hidden-skill',  source: 'github',          visibility: 'hidden',  status: 'approved', created_by: 'other@navapbc.com' },
          { slug: 'cat-config',    source: 'category-config' },
        ],
        LastEvaluatedKey: undefined,
      });
    const res = await app.request('/api/admin/skills', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(3);
    expect(body.skills.map(s => s.slug)).toContain('private-skill');
    expect(body.skills.map(s => s.slug)).toContain('hidden-skill');
    expect(body.skills.map(s => s.slug)).not.toContain('cat-config');
  });
});

// ── GET /api/admin/enterprise-skills ─────────────────────────────────────
describe('GET /api/admin/enterprise-skills', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/admin/enterprise-skills', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('returns enterprise skills for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Items: [{ slug: 'daily-briefing', source: 'anthropic-enterprise' }], LastEvaluatedKey: undefined });
    const res = await app.request('/api/admin/enterprise-skills', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
  });

  it('includes source=enterprise (GitHub-synced org skills) in the response', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({
        Items: [
          { slug: 'anthropic-skill', source: 'anthropic-enterprise' },
          { slug: 'github-org-skill', source: 'enterprise' },
          { slug: 'builtin-skill', source: 'anthropic-builtin' },
        ],
        LastEvaluatedKey: undefined,
      });
    const res = await app.request('/api/admin/enterprise-skills', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(3);
    expect(body.skills.map(s => s.slug)).toContain('github-org-skill');
  });
});

// ── PUT /api/admin/enterprise-skills/:slug ────────────────────────────────
describe('PUT /api/admin/enterprise-skills/:slug', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/admin/enterprise-skills/some-slug', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when skill not found', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: undefined });
    const res = await app.request('/api/admin/enterprise-skills/missing-slug', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when trying to edit anthropic-builtin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'xlsx', source: 'anthropic-builtin' } });
    const res = await app.request('/api/admin/enterprise-skills/xlsx', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates enterprise skill for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'daily-briefing', source: 'anthropic-enterprise', name: 'Old Name' } })
      .mockResolvedValueOnce({})  // PutCommand
      .mockResolvedValueOnce({}); // writeAudit
    const res = await app.request('/api/admin/enterprise-skills/daily-briefing', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('New Name');
  });

  it('updates visibility for enterprise skill', async () => {
    let capturedItem;
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'daily-briefing', source: 'anthropic-enterprise', name: 'Briefing', visibility: 'public' } })
      .mockImplementationOnce((cmd) => { capturedItem = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});
    const res = await app.request('/api/admin/enterprise-skills/daily-briefing', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'hidden' }),
    });
    expect(res.status).toBe(200);
    expect(capturedItem?.visibility).toBe('hidden');
  });

  it('rejects invalid visibility value, preserves existing', async () => {
    let capturedItem;
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'daily-briefing', source: 'anthropic-enterprise', name: 'Briefing', visibility: 'public' } })
      .mockImplementationOnce((cmd) => { capturedItem = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});
    await app.request('/api/admin/enterprise-skills/daily-briefing', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'superuser' }),
    });
    expect(capturedItem?.visibility).toBe('public');
  });
});

// ── DELETE /api/admin/enterprise-skills/:slug ─────────────────────────────
describe('DELETE /api/admin/enterprise-skills/:slug', () => {
  it('returns 403 for maintain role (admin-only)', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });
    const res = await app.request('/api/admin/enterprise-skills/daily-briefing', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(403);
  });

  it('deletes for admin role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'daily-briefing', source: 'anthropic-enterprise' } })
      .mockResolvedValueOnce({})  // DeleteCommand
      .mockResolvedValueOnce({}); // writeAudit
    const res = await app.request('/api/admin/enterprise-skills/daily-briefing', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });
    expect(res.status).toBe(200);
  });
});

// ── POST /api/admin/enterprise-skills — slug collision ────────────────────
describe('POST /api/admin/enterprise-skills — slug collision', () => {
  it('returns 409 when slug already exists', async () => {
    const conflictErr = Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockRejectedValueOnce(conflictErr);
    const res = await app.request('/api/admin/enterprise-skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'existing-skill', name: 'Existing', description: 'Already there' }),
    });
    expect(res.status).toBe(409);
  });
});

// ── GET /api/admin/categories (admin-gated) ───────────────────────────────
describe('GET /api/admin/categories', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });
    const res = await app.request('/api/admin/categories', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });

  it('returns categories for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({ Responses: {} }); // BatchGetCommand
    const res = await app.request('/api/admin/categories', {
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com') },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toHaveLength(5);
  });
});

// ── PUT /api/admin/categories/:id/featured — body validation ─────────────
describe('PUT /api/admin/categories/:id/featured — body validation', () => {
  it('returns 400 when featuredSlugs is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/categories/build-and-ship/featured', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ other: 'field' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when featuredSlugs is not an array', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });

    const res = await app.request('/api/admin/categories/build-and-ship/featured', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ featuredSlugs: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });
});

// ── PUT /api/admin/users/:id/role ─────────────────────────────────────────
describe('PUT /api/admin/users/:id/role', () => {
  it('returns 403 for maintain role', async () => {
    mockSend.mockResolvedValueOnce({ Item: MAINTAIN_RECORD });
    const res = await app.request('/api/admin/users/someone%40navapbc.com/role', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'maintain' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid role', async () => {
    mockSend.mockResolvedValueOnce({ Item: ADMIN_RECORD });
    const res = await app.request('/api/admin/users/someone%40navapbc.com/role', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });

  it('updates role for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ADMIN_RECORD })
      .mockResolvedValueOnce({ Attributes: { user_id: 'someone@navapbc.com', role: 'maintain' } })
      .mockResolvedValueOnce({}); // writeAudit
    const res = await app.request('/api/admin/users/someone%40navapbc.com/role', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'maintain' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('maintain');
  });
});
