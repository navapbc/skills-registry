# RBAC + Admin Panel + Enterprise Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand roles to user → maintain → admin, build an `/admin` panel for content curation and user management, add a `/submit` page for skill submissions, and sync Anthropic built-in skills (xlsx, pptx, pdf, docx) into DynamoDB on a weekly cron.

**Architecture:** All backend changes are in the existing Hono Lambda (`functions/api`). The admin panel and submit form are new CSR Astro pages following the same fetch-on-load pattern as existing pages. A public `GET /api/categories` endpoint powers the homepage featured slots. The Anthropic sync is a standalone Node script run via GitHub Actions cron.

**Tech Stack:** Hono (Lambda router), DynamoDB (existing `skills`, `users`, `audit_log` tables), Astro CSR (no SSR — everything client-rendered), Vitest (tests in `tests/`), GitHub Actions.

---

## File Map

**Modify:**
- `functions/api/lib/permissions.mjs` — rewrite with `maintain` role + `atLeast()` helper
- `functions/api/routes/skills.mjs` — maintain+ auto-approve; maintain+ edit any; accept tags; delete:skill admin-only
- `functions/api/routes/users.mjs` — add `maintain` to VALID_ROLES
- `functions/api/index.mjs` — mount `adminRoutes`
- `functions/edge/auth-check.js.tpl` — add `/admin` and `/submit` to `rewriteUri()`
- `src/lib/render.mjs` — add tag chips + anthropic-builtin badge
- `src/pages/index.astro` — fetch featuredSlugs from `/api/categories`
- `tests/api/permissions.test.mjs` — add maintain tests; update delete:skill expectations
- `tests/api/routes/skills.test.mjs` — update delete test; add maintain approve test

**Create:**
- `functions/api/routes/admin.mjs` — all `/api/admin/*` and `/api/categories` routes
- `tests/api/routes/admin.test.mjs` — admin route tests
- `src/pages/admin/index.astro` — admin panel CSR (5 tabs)
- `src/pages/submit/index.astro` — skill submission form CSR
- `scripts/sync-anthropic-builtin-skills.mjs` — weekly Anthropic API sync
- `.github/workflows/sync-anthropic.yml` — cron workflow

---

## Task 1: RBAC — Rewrite permissions.mjs with maintain role (TDD)

**Files:**
- Modify: `functions/api/lib/permissions.mjs`
- Modify: `tests/api/permissions.test.mjs`

### Context

The current `permissions.mjs` uses an `ADMIN_ONLY` set and a switch. We're rewriting it to support a three-tier role hierarchy: `user` (0) → `maintain` (1) → `admin` (2). Key behavior changes:
- `approve:skill`, `reject:skill` move from admin-only to maintain+
- `edit:any-skill`, `manage:enterprise`, `manage:categories` are new maintain+ ops
- `delete:skill` becomes admin-only (currently users can delete own — **breaking change**)
- `update:skill` allows maintain+ to edit any skill (users still edit own)

Run tests with: `pnpm vitest run tests/api/permissions.test.mjs`

- [ ] **Step 1: Add failing tests for maintain role**

Append to `tests/api/permissions.test.mjs`:

```js
const maintain = { user_id: 'maintain@navapbc.com', role: 'maintain' };

describe('can — maintain role: approve/reject', () => {
  it('maintain can approve a pending skill', () => {
    expect(can(maintain, 'approve:skill', ownPending)).toBe(true);
  });
  it('maintain can reject a pending skill', () => {
    expect(can(maintain, 'reject:skill', ownPending)).toBe(true);
  });
  it('user still cannot approve or reject', () => {
    expect(can(user, 'approve:skill', ownPending)).toBe(false);
  });
});

describe('can — maintain role: edit any skill', () => {
  it('maintain can edit any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(maintain, 'update:skill', otherSkill)).toBe(true);
  });
  it('user can still edit their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot edit another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
});

describe('can — maintain role: enterprise and categories', () => {
  it('maintain can manage enterprise skills', () => {
    expect(can(maintain, 'manage:enterprise')).toBe(true);
  });
  it('maintain can manage categories', () => {
    expect(can(maintain, 'manage:categories')).toBe(true);
  });
  it('user cannot manage enterprise skills', () => {
    expect(can(user, 'manage:enterprise')).toBe(false);
  });
});

describe('can — delete:skill is admin-only', () => {
  it('user cannot delete any skill (admin-only now)', () => {
    expect(can(user, 'delete:skill', publicApproved)).toBe(false);
  });
  it('maintain cannot delete skills', () => {
    expect(can(maintain, 'delete:skill', publicApproved)).toBe(false);
  });
  it('admin can delete any skill', () => {
    expect(can(admin, 'delete:skill', publicApproved)).toBe(true);
  });
});

describe('atLeast helper', () => {
  it('user is not at least maintain', () => {
    expect(atLeast(user, 'maintain')).toBe(false);
  });
  it('maintain is at least maintain', () => {
    expect(atLeast(maintain, 'maintain')).toBe(true);
  });
  it('admin is at least maintain', () => {
    expect(atLeast(admin, 'maintain')).toBe(true);
  });
});
```

Also update the import line at top to include `atLeast`:
```js
import { can, atLeast } from '../../functions/api/lib/permissions.mjs';
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm vitest run tests/api/permissions.test.mjs
```

Expected: several FAIL — `atLeast` not exported, maintain tests fail, delete tests fail.

- [ ] **Step 3: Rewrite permissions.mjs**

Replace entire contents of `functions/api/lib/permissions.mjs`:

```js
const ROLE_RANK = { user: 0, maintain: 1, admin: 2 };
export const atLeast = (user, role) => (ROLE_RANK[user?.role] ?? 0) >= (ROLE_RANK[role] ?? 99);

const ADMIN_ONLY = new Set(['read:users', 'set:role', 'read:audit', 'delete:skill', 'delete:plugin']);
const MAINTAIN_PLUS = new Set(['approve:skill', 'reject:skill', 'edit:any-skill', 'manage:plugins', 'manage:enterprise', 'manage:categories']);

export function can(user, action, resource = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;
  if (MAINTAIN_PLUS.has(action)) return atLeast(user, 'maintain');

  switch (action) {
    case 'read:skill': {
      if (!resource) return false;
      if (resource.created_by === user.user_id) return true;
      return resource.status === 'approved' &&
        (resource.visibility === 'public' || resource.visibility === 'internal');
    }
    case 'create:skill':
      return true;
    case 'update:skill':
      if (atLeast(user, 'maintain')) return true;
      return resource?.created_by === user.user_id;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Update the existing delete:skill test in permissions.test.mjs**

The old test expects user CAN delete own skill — update it to match new behavior:

```js
// In describe('can — update:skill / delete:skill', ...):
// Remove: it('user can delete their own skill', ...)
// Remove: it('user cannot delete another user skill', ...)
// Remove: it('admin can update or delete any skill', ...)
// Replace the entire describe block with:
describe('can — update:skill', () => {
  it('user can update their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot update another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
  it('admin can update any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(admin, 'update:skill', otherSkill)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests — expect all pass**

```bash
pnpm vitest run tests/api/permissions.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/lib/permissions.mjs tests/api/permissions.test.mjs
git commit -m "feat(rbac): add maintain role with atLeast helper, delete:skill is admin-only"
```

---

## Task 2: Update skills.mjs and users.mjs for maintain role

**Files:**
- Modify: `functions/api/routes/skills.mjs`
- Modify: `functions/api/routes/users.mjs`
- Modify: `tests/api/routes/skills.test.mjs`

### Context

`skills.mjs` currently auto-approves only for `admin`. With maintain role, we need:
- Auto-approve on POST for maintain+ (import `atLeast` from permissions)
- Accept `tags: []` field in POST and PUT (new field, defaults to empty array)
- DELETE /api/skills/:slug: block non-admin (currently allows own-skill delete)
- PUT /api/skills/:slug: allow maintain+ to edit any skill

`users.mjs` just needs `maintain` added to `VALID_ROLES`.

Run tests with: `pnpm vitest run tests/api/routes/skills.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/api/routes/skills.test.mjs` (after the existing imports, add `MAINTAIN_RECORD`):

After `const ADMIN_RECORD = ...` add:
```js
const MAINTAIN_RECORD = { user_id: 'maintain@navapbc.com', email: 'maintain@navapbc.com', name: 'Maintainer', role: 'maintain' };
```

Append new test blocks:

```js
describe('POST /api/skills — maintain auto-approves', () => {
  it('creates skill with status=approved for maintain role', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: MAINTAIN_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('maintain@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'my-skill', name: 'My Skill', description: 'desc', plugin: 'p',
        repo: 'org/repo', path: 'SKILL.md', author: 'me',
        compatibility: ['claude-code'], type: 'skill',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });
});

describe('DELETE /api/skills/:slug — admin-only', () => {
  it('returns 403 for user deleting own skill (now admin-only)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({ Item: { slug: 'my-skill', created_by: 'user@navapbc.com', status: 'pending' } });

    const res = await app.request('/api/skills/my-skill', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/skills — tags field', () => {
  it('stores tags array when provided', async () => {
    let capturedItem;
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockImplementationOnce((cmd) => { capturedItem = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});

    await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'tagged', name: 'Tagged', description: 'desc', plugin: 'p',
        repo: 'org/repo', path: 'SKILL.md', author: 'me',
        compatibility: ['claude-code'], type: 'skill', tags: ['testing', 'docs'],
      }),
    });
    expect(capturedItem?.tags).toEqual(['testing', 'docs']);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm vitest run tests/api/routes/skills.test.mjs
```

Expected: 3 new tests FAIL, existing delete test (allows own delete) also FAIL.

- [ ] **Step 3: Update skills.mjs**

Add `atLeast` to the import at the top of `functions/api/routes/skills.mjs`:

```js
import { can, atLeast } from '../lib/permissions.mjs';
```

In `POST /api/skills` handler, update the `status` line (currently line ~74):
```js
// Change from:
status: user.role === 'admin' ? 'approved' : 'pending',
// To:
status: atLeast(user, 'maintain') ? 'approved' : 'pending',
```

Add `tags` field in the POST skill object (after `content: body.content ?? ''`):
```js
tags: body.tags ?? [],
```

In `PUT /api/skills/:slug` handler, add `tags` to the updated object:
```js
tags: body.tags ?? existing.Item.tags ?? [],
```

In `DELETE /api/skills/:slug` handler, replace the permission check:
```js
// Change from:
if (!can(user, 'delete:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);
// To:
if (!can(user, 'delete:skill')) return c.json({ error: 'Forbidden' }, 403);
```

In `PUT /api/skills/:slug` handler, update the permission check to use `edit:any-skill` for maintain:
```js
// Change from:
if (!can(user, 'update:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);
// To:
if (!can(user, 'edit:any-skill') && !can(user, 'update:skill', existing.Item)) {
  return c.json({ error: 'Forbidden' }, 403);
}
```

- [ ] **Step 4: Update users.mjs**

In `functions/api/routes/users.mjs`, change line 4:
```js
// From:
const VALID_ROLES = new Set(['user', 'admin']);
// To:
const VALID_ROLES = new Set(['user', 'maintain', 'admin']);
```

Change the error message on line 25:
```js
// From:
return c.json({ error: 'role must be "user" or "admin"' }, 400);
// To:
return c.json({ error: 'role must be "user", "maintain", or "admin"' }, 400);
```

- [ ] **Step 5: Update the stale delete test in skills.test.mjs**

Find `describe('DELETE /api/skills/:slug', ...)` — the test `'allows user to delete their own skill'` now expects 403. Update its `expect`:
```js
// Change:
expect(res.status).toBe(200);
// To:
expect(res.status).toBe(403);
```

Also remove the extra `mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({})` calls for the delete and audit that no longer happen (since we now 403 before the DDB call after the permission check — but the item is still fetched to confirm it exists). Actually, look at the route: it calls `GetCommand` to find the item, THEN checks permission. So the mock chain is: auth GetItem → skill GetItem → 403 (no more calls). Update the test to only mock 2 calls:

```js
it('returns 403 for user deleting own skill (now admin-only)', async () => {
  mockSend
    .mockResolvedValueOnce({ Item: USER_RECORD })
    .mockResolvedValueOnce({ Item: { slug: 'my-skill', created_by: 'user@navapbc.com', status: 'pending' } });

  const res = await app.request('/api/skills/my-skill', {
    method: 'DELETE',
    headers: { Cookie: makeSessionCookie() },
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 6: Run tests — expect all pass**

```bash
pnpm vitest run tests/api/routes/skills.test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/api/routes/skills.mjs functions/api/routes/users.mjs tests/api/routes/skills.test.mjs
git commit -m "feat(rbac): maintain role auto-approves, tags field, delete:skill admin-only"
```

---

## Task 3: Create admin routes (TDD)

**Files:**
- Create: `functions/api/routes/admin.mjs`
- Create: `tests/api/routes/admin.test.mjs`
- Modify: `functions/api/index.mjs`

### Context

`admin.mjs` registers two groups of routes:
1. **Public (any logged-in user):** `GET /api/categories` — returns merged featuredSlugs for the homepage
2. **Admin routes:** all under `/api/admin/*` — gated by role

The categories persistence stores `featuredSlugs` as DynamoDB records with `slug=category::{id}` and `source=category-config` in the skills table. No new tables needed.

The `MAINTAIN_RECORD` fixture and the `vi.mock` + `mockSend` pattern are already established in `tests/api/routes/skills.test.mjs` — copy the mock setup verbatim.

Run tests with: `pnpm vitest run tests/api/routes/admin.test.mjs`

- [ ] **Step 1: Create admin.test.mjs with failing tests**

Create `tests/api/routes/admin.test.mjs`:

```js
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
    expect(body.categories[0].id).toBe('writing-comms');
    expect(body.categories[0].featuredSlugs).toEqual([]);
  });

  it('merges DDB featuredSlugs override', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({
        Responses: {
          'undefined': [{ slug: 'category::dev-code', featuredSlugs: ['fix-bug', 'test'] }],
        },
      });

    const res = await app.request('/api/categories', {
      headers: { Cookie: makeSessionCookie() },
    });
    const body = await res.json();
    const devCode = body.categories.find(c => c.id === 'dev-code');
    expect(devCode.featuredSlugs).toEqual(['fix-bug', 'test']);
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
});

// ── PUT /api/admin/categories/:id/featured ────────────────────────────────
describe('PUT /api/admin/categories/:id/featured', () => {
  it('returns 403 for user role', async () => {
    mockSend.mockResolvedValueOnce({ Item: USER_RECORD });

    const res = await app.request('/api/admin/categories/dev-code/featured', {
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

    const res = await app.request('/api/admin/categories/dev-code/featured', {
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
```

- [ ] **Step 2: Run tests — expect import error (file not created yet)**

```bash
pnpm vitest run tests/api/routes/admin.test.mjs
```

Expected: FAIL — `adminRoutes` not found / import error.

- [ ] **Step 3: Create functions/api/routes/admin.mjs**

```js
import { ddb, tables, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, BatchGetCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

const CATEGORY_IDS = ['writing-comms', 'research-analysis', 'planning', 'dev-code', 'ops-automation'];
const CATEGORY_LABELS = {
  'writing-comms': 'Writing & Comms',
  'research-analysis': 'Research & Analysis',
  'planning': 'Planning',
  'dev-code': 'Dev & Code',
  'ops-automation': 'Ops & Automation',
};

async function getCategoryOverrides() {
  const result = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [tables.skills()]: {
        Keys: CATEGORY_IDS.map(id => ({ slug: `category::${id}` })),
      },
    },
  }));
  const overrides = {};
  for (const item of (result.Responses?.[tables.skills()] ?? [])) {
    overrides[item.slug.replace('category::', '')] = item.featuredSlugs ?? [];
  }
  return overrides;
}

export function adminRoutes(app) {
  // ── Public: used by homepage to get featuredSlugs ──────────────────────
  app.get('/api/categories', async (c) => {
    const overrides = await getCategoryOverrides();
    return c.json({
      categories: CATEGORY_IDS.map(id => ({
        id,
        label: CATEGORY_LABELS[id],
        featuredSlugs: overrides[id] ?? [],
      })),
    });
  });

  // ── Skills queue (maintain+) ───────────────────────────────────────────
  app.get('/api/admin/queue', async (c) => {
    const user = c.get('user');
    if (!can(user, 'approve:skill')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.skills(),
        FilterExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pending': 'pending' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    items.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
    return c.json({ skills: items });
  });

  // ── Enterprise skills (maintain+) ─────────────────────────────────────
  app.get('/api/admin/enterprise-skills', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.skills(),
        FilterExpression: '#src = :e OR #src = :b',
        ExpressionAttributeNames: { '#src': 'source' },
        ExpressionAttributeValues: { ':e': 'anthropic-enterprise', ':b': 'anthropic-builtin' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    return c.json({ skills: items });
  });

  app.post('/api/admin/enterprise-skills', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    if (!body.slug || !body.name || !body.description) {
      return c.json({ error: 'slug, name, and description are required' }, 400);
    }

    const now = new Date().toISOString();
    const skill = {
      slug: body.slug,
      name: body.name,
      description: body.description,
      tags: body.tags ?? [],
      docs_url: body.docs_url ?? '',
      source: 'anthropic-enterprise',
      type: 'skill',
      status: 'approved',
      visibility: 'public',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      last_updated: now,
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: skill }));
    await writeAudit(user, 'created', 'enterprise-skill', skill.slug);
    return c.json(skill, 201);
  });

  app.put('/api/admin/enterprise-skills/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (existing.Item.source === 'anthropic-builtin') {
      return c.json({ error: 'Anthropic built-in skills cannot be edited' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const updated = {
      ...existing.Item,
      name: body.name ?? existing.Item.name,
      description: body.description ?? existing.Item.description,
      tags: body.tags ?? existing.Item.tags ?? [],
      docs_url: body.docs_url ?? existing.Item.docs_url ?? '',
      updated_at: new Date().toISOString(),
      updated_by: user.user_id,
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: updated }));
    await writeAudit(user, 'updated', 'enterprise-skill', slug);
    return c.json(updated);
  });

  app.delete('/api/admin/enterprise-skills/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'delete:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    await ddb.send(new DeleteCommand({ TableName: tables.skills(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'enterprise-skill', slug);
    return c.json({ deleted: slug });
  });

  // ── Categories (maintain+) ────────────────────────────────────────────
  app.get('/api/admin/categories', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:categories')) return c.json({ error: 'Forbidden' }, 403);

    const overrides = await getCategoryOverrides();
    return c.json({
      categories: CATEGORY_IDS.map(id => ({
        id,
        label: CATEGORY_LABELS[id],
        featuredSlugs: overrides[id] ?? [],
      })),
    });
  });

  app.put('/api/admin/categories/:id/featured', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:categories')) return c.json({ error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    if (!CATEGORY_IDS.includes(id)) return c.json({ error: 'Unknown category' }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.featuredSlugs)) {
      return c.json({ error: 'featuredSlugs must be an array' }, 400);
    }

    await ddb.send(new PutCommand({
      TableName: tables.skills(),
      Item: {
        slug: `category::${id}`,
        source: 'category-config',
        featuredSlugs: body.featuredSlugs,
        updated_at: new Date().toISOString(),
      },
    }));

    await writeAudit(user, 'updated', 'category', id);
    return c.json({ id, featuredSlugs: body.featuredSlugs });
  });

  // ── Users (admin only) ────────────────────────────────────────────────
  app.get('/api/admin/users', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:users')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.users(),
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    items.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
    return c.json({ users: items });
  });

  app.put('/api/admin/users/:id/role', async (c) => {
    const user = c.get('user');
    if (!can(user, 'set:role')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    const VALID = new Set(['user', 'maintain', 'admin']);
    if (!body?.role || !VALID.has(body.role)) {
      return c.json({ error: 'role must be "user", "maintain", or "admin"' }, 400);
    }

    const targetId = decodeURIComponent(c.req.param('id'));
    const result = await ddb.send(new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id: targetId },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': body.role },
      ReturnValues: 'ALL_NEW',
    }));

    await writeAudit(user, 'role-changed', 'user', targetId);
    return c.json(result.Attributes);
  });

  // ── Audit log (admin only) ────────────────────────────────────────────
  app.get('/api/admin/audit', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:audit')) return c.json({ error: 'Forbidden' }, 403);

    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const result = await ddb.send(new ScanCommand({
      TableName: tables.audit(),
      Limit: limit,
    }));

    const events = (result.Items ?? []).sort((a, b) =>
      String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? ''))
    );
    return c.json({ events });
  });
}
```

- [ ] **Step 4: Mount adminRoutes in index.mjs**

In `functions/api/index.mjs`, add import and mount:

```js
// Add import (after existing imports):
import { adminRoutes } from './routes/admin.mjs';

// Add mount (after auditRoutes(app)):
adminRoutes(app);
```

- [ ] **Step 5: Run tests — expect all pass**

```bash
pnpm vitest run tests/api/routes/admin.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Run full test suite**

```bash
pnpm vitest run
```

Expected: all PASS. Fix any regressions before proceeding.

- [ ] **Step 7: Commit**

```bash
git add functions/api/routes/admin.mjs functions/api/index.mjs tests/api/routes/admin.test.mjs
git commit -m "feat(api): admin routes — queue, enterprise skills, categories, users, audit"
```

---

## Task 4: Tag chips in render.mjs (TDD)

**Files:**
- Modify: `src/lib/render.mjs`
- Modify: `tests/frontend/render.test.mjs`

### Context

`renderSkillCard` (line 34) and `renderSkillDetail` (line 89) need:
1. Tag chips: `skill.tags` (string array, may be absent) rendered as `#tag` chips in gray
2. Anthropic-builtin badge: when `skill.source === 'anthropic-builtin'`, show a distinct badge and a note on the detail page

Tags are capped at 3 chips on cards (space constraint); show all on detail page.

Run tests with: `pnpm vitest run tests/frontend/render.test.mjs`

- [ ] **Step 1: Read the existing render.test.mjs to understand test patterns**

```bash
head -50 tests/frontend/render.test.mjs
```

Note the import pattern and how `renderSkillCard` / `renderSkillDetail` are called.

- [ ] **Step 2: Add failing tests**

Append to `tests/frontend/render.test.mjs`:

```js
// ── Tag chips ──────────────────────────────────────────────────────────────
describe('renderSkillCard — tags', () => {
  const base = {
    slug: 'test', name: 'Test Skill', description: 'A test skill',
    plugin: 'test-plugin', author: 'author', compatibility: ['claude-code'],
    type: 'skill', source: 'github', tags: ['testing', 'docs', 'security', 'extra'],
  };

  it('renders up to 3 tag chips', () => {
    const html = renderSkillCard(base);
    expect(html).toContain('#testing');
    expect(html).toContain('#docs');
    expect(html).toContain('#security');
    expect(html).not.toContain('#extra');
  });

  it('renders no tag section when tags is empty', () => {
    const html = renderSkillCard({ ...base, tags: [] });
    expect(html).not.toContain('data-tags');
  });

  it('renders no tag section when tags is absent', () => {
    const { tags: _, ...noTags } = base;
    const html = renderSkillCard(noTags);
    expect(html).not.toContain('data-tags');
  });
});

describe('renderSkillCard — anthropic-builtin badge', () => {
  const builtin = {
    slug: 'xlsx', name: 'xlsx', description: 'Excel tool',
    plugin: '', author: 'Anthropic', compatibility: [],
    type: 'tool', source: 'anthropic-builtin', tags: [],
  };

  it('shows Anthropic Tool badge for anthropic-builtin source', () => {
    const html = renderSkillCard(builtin);
    expect(html).toContain('Anthropic Tool');
  });
});
```

- [ ] **Step 3: Run tests — expect failures**

```bash
pnpm vitest run tests/frontend/render.test.mjs
```

Expected: tag and badge tests FAIL.

- [ ] **Step 4: Add tag chips to renderSkillCard in render.mjs**

In `renderSkillCard`, after the `sensitiveBadge` const (around line 52), add:

```js
const anthropicBadge = skill.source === 'anthropic-builtin'
  ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 rounded">Anthropic Tool</span>`
  : '';
const tags = skill.tags?.length
  ? `<div class="flex flex-wrap gap-1" data-tags>
      ${skill.tags.slice(0, 3).map(t => `<span class="px-1 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">#${escapeHtml(t)}</span>`).join('')}
    </div>`
  : '';
```

In the badge row (line that has `${pluginBadge}${agentBadge}${sensitiveBadge}`), add `${anthropicBadge}`:
```js
<div class="flex items-center gap-1 flex-wrap">${pluginBadge}${agentBadge}${sensitiveBadge}${anthropicBadge}</div>
```

Before the closing `</a>` of the card, add `${tags}` after the description paragraph:
```js
<p class="text-xs text-gray-500 leading-relaxed m-0 flex-1">${escapeHtml(preview)}</p>
${tags}
```

- [ ] **Step 5: Add tag chips to renderSkillDetail in render.mjs**

In `renderSkillDetail`, find the section that renders the description and compatibility (around line 166). After the compat badges div, add:

```js
${skill.tags?.length
  ? `<div class="flex flex-wrap gap-1.5 mt-3">
      ${skill.tags.map(t => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">#${escapeHtml(t)}</span>`).join('')}
    </div>`
  : ''}
${skill.source === 'anthropic-builtin'
  ? `<div class="mt-4 p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700">
      <strong>Anthropic Tool</strong> — This skill runs via the Anthropic Messages API code execution container. It is not a SKILL.md workflow.
    </div>`
  : ''}
```

- [ ] **Step 6: Run tests — expect all pass**

```bash
pnpm vitest run tests/frontend/render.test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/render.mjs tests/frontend/render.test.mjs
git commit -m "feat(ui): tag chips and anthropic-builtin badge in skill cards and detail"
```

---

## Task 5: CloudFront edge function — add /admin and /submit routing

**Files:**
- Modify: `functions/edge/auth-check.js.tpl`

### Context

The CloudFront edge function (`functions/edge/auth-check.js.tpl`) rewrites URIs so Astro CSR shells load correctly. Currently it handles `/skills`, `/plugins`, `/agents`, `/category`. We need to add `/admin` and `/submit`.

After this change, `terraform apply` is required to push the updated function to CloudFront. This is a Terraform-managed resource — the plan step notes this but does not run Terraform (that is a human step done after deployment).

- [ ] **Step 1: Add two lines to rewriteUri() in auth-check.js.tpl**

In `functions/edge/auth-check.js.tpl`, find `rewriteUri()`. After the `/category` line, add:

```js
  if (uri.indexOf('/admin') === 0) return '/admin/index.html';
  if (uri.indexOf('/submit') === 0) return '/submit/index.html';
```

The updated function should look like:

```js
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;

  if (uri.indexOf('/skills') === 0) return '/skills/index.html';
  if (uri.indexOf('/plugins') === 0) return '/plugins/index.html';
  if (uri.indexOf('/agents') === 0) return '/agents/index.html';
  if (uri.indexOf('/category') === 0) return '/category/index.html';
  if (uri.indexOf('/admin') === 0) return '/admin/index.html';
  if (uri.indexOf('/submit') === 0) return '/submit/index.html';

  return uri + '/index.html';
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/edge/auth-check.js.tpl
git commit -m "feat(edge): route /admin and /submit to CSR index shells"
```

**Note:** `terraform apply -var-file=terraform.staging.tfvars` is required after this commit deploys to push the updated CloudFront function. This is a human step done post-deploy.

---

## Task 6: Admin panel UI — /admin page

**Files:**
- Create: `src/pages/admin/index.astro`

### Context

The admin panel is a CSR Astro page (no SSR). It checks the user's role from the `__user` cookie (set by the auth system and available client-side as JSON) and shows tabs accordingly. Maintain+ sees queue, enterprise skills, and categories. Admin-only tabs (users, audit) are shown only when role is `admin`.

API calls use `fetchApi` (GET) and direct `fetch` with credentials for POST/PUT/DELETE.

The `__user` cookie contains the JWT payload, which includes `role`. The edge function already validates the JWT — client-side we just read it for UI gating (not for security).

- [ ] **Step 1: Create src/pages/admin/index.astro**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Admin — Skills Hub">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-gray-900 m-0">Admin Panel</h1>
    <p class="text-sm text-gray-500 mt-1 m-0">Content curation and site management</p>
  </div>

  <!-- Tab nav -->
  <div class="border-b border-gray-200 mb-6">
    <nav class="flex gap-1 -mb-px">
      <button data-tab="queue"      class="tab-btn px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Queue <span id="queue-badge" class="ml-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full hidden"></span></button>
      <button data-tab="enterprise" class="tab-btn px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Enterprise Skills</button>
      <button data-tab="categories" class="tab-btn px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Categories</button>
      <button data-tab="users"      class="tab-btn admin-only hidden px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Users</button>
      <button data-tab="audit"      class="tab-btn admin-only hidden px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Audit Log</button>
    </nav>
  </div>

  <!-- Tab panels -->
  <div id="tab-queue"      class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
  <div id="tab-enterprise" class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
  <div id="tab-categories" class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
  <div id="tab-users"      class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
  <div id="tab-audit"      class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
</Base>

<script>
import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';

// Read role from __user cookie (base64-encoded JSON payload from JWT)
function getUserRole() {
  const cookie = document.cookie.split('; ').find(r => r.startsWith('__user='));
  if (!cookie) return 'user';
  try {
    return JSON.parse(atob(cookie.split('=')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? 'user';
  } catch { return 'user'; }
}

async function apiPost(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`/api${path}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const role = getUserRole();

if (role === 'user') {
  window.location.href = '/';
}

if (role === 'admin') {
  document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
}

// ── Tab switching ────────────────────────────────────────────────────────
let currentTab = null;

function activateTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('border-plum-600', btn.dataset.tab === tabId);
    btn.classList.toggle('text-plum-700', btn.dataset.tab === tabId);
    btn.classList.toggle('text-gray-600', btn.dataset.tab !== tabId);
    btn.classList.toggle('border-transparent', btn.dataset.tab !== tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');
  if (currentTab !== tabId) {
    currentTab = tabId;
    loadTab(tabId);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

activateTab('queue');

// ── Tab loaders ──────────────────────────────────────────────────────────
async function loadTab(tabId) {
  const panel = document.getElementById(`tab-${tabId}`);
  panel.innerHTML = '<p class="text-sm text-gray-400">Loading...</p>';
  try {
    if (tabId === 'queue')      await loadQueue(panel);
    if (tabId === 'enterprise') await loadEnterprise(panel);
    if (tabId === 'categories') await loadCategories(panel);
    if (tabId === 'users')      await loadUsers(panel);
    if (tabId === 'audit')      await loadAudit(panel);
  } catch (err) {
    panel.innerHTML = `<p class="text-sm text-red-500">Error: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Queue ────────────────────────────────────────────────────────────────
async function loadQueue(panel) {
  const { skills } = await fetchApi('/admin/queue');
  const badge = document.getElementById('queue-badge');
  if (skills.length > 0) {
    badge.textContent = skills.length;
    badge.classList.remove('hidden');
  }
  if (!skills.length) {
    panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
    return;
  }
  panel.innerHTML = `
    <table class="w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Skill</th>
        <th class="pb-2 font-medium">Author</th>
        <th class="pb-2 font-medium">Plugin</th>
        <th class="pb-2 font-medium">Submitted</th>
        <th class="pb-2 font-medium">Actions</th>
      </tr></thead>
      <tbody>
        ${skills.map(s => `
          <tr class="border-b border-gray-100 hover:bg-gray-50" data-slug="${escapeHtml(s.slug)}">
            <td class="py-3 font-medium text-gray-900"><a href="/skills/${escapeHtml(s.slug)}" class="hover:text-plum-600 no-underline">${escapeHtml(s.name)}</a></td>
            <td class="py-3 text-gray-500">${escapeHtml(s.author ?? s.created_by ?? '')}</td>
            <td class="py-3 text-gray-500">${escapeHtml(s.plugin ?? '')}</td>
            <td class="py-3 text-gray-400">${escapeHtml(s.created_at ? new Date(s.created_at).toLocaleDateString() : '')}</td>
            <td class="py-3 flex gap-2">
              <button class="approve-btn px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition-colors">Approve</button>
              <button class="reject-btn px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">Reject</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  panel.querySelectorAll('.approve-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      try {
        await apiPost(`/skills/${slug}/approve`, {});
        row.remove();
        if (!panel.querySelector('tr[data-slug]')) {
          panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
          document.getElementById('queue-badge').classList.add('hidden');
        }
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });

  panel.querySelectorAll('.reject-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      const reason = prompt('Rejection reason (optional):');
      if (reason === null) return;
      try {
        await apiPost(`/skills/${slug}/reject`, { reason });
        row.remove();
        if (!panel.querySelector('tr[data-slug]')) {
          panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
          document.getElementById('queue-badge').classList.add('hidden');
        }
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });
}

// ── Enterprise skills ─────────────────────────────────────────────────────
async function loadEnterprise(panel) {
  const { skills } = await fetchApi('/admin/enterprise-skills');
  const builtins = skills.filter(s => s.source === 'anthropic-builtin');
  const org = skills.filter(s => s.source === 'anthropic-enterprise');

  panel.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">Anthropic Built-ins</h2>
        <span class="text-xs text-gray-400">Synced weekly — read only</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
            <th class="pb-2 font-medium">Skill</th><th class="pb-2 font-medium">Version</th><th class="pb-2 font-medium">Last synced</th>
          </tr></thead>
          <tbody>
            ${builtins.length ? builtins.map(s => `
              <tr class="border-b border-gray-100">
                <td class="py-2 font-medium text-gray-800">${escapeHtml(s.name)}</td>
                <td class="py-2 text-gray-500">${escapeHtml(s.version ?? '')}</td>
                <td class="py-2 text-gray-400">${escapeHtml(s.last_updated ? new Date(s.last_updated).toLocaleDateString() : '')}</td>
              </tr>`).join('') : '<tr><td colspan="3" class="py-3 text-gray-400 text-xs">No built-ins synced yet. Run the sync script.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">Org Skills</h2>
        <button id="add-enterprise-btn" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">+ Add Skill</button>
      </div>
      <div id="org-skills-list">
        ${org.length ? `<table class="w-full text-sm border-collapse">
          <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
            <th class="pb-2 font-medium">Name</th><th class="pb-2 font-medium">Slug</th><th class="pb-2 font-medium">Tags</th><th class="pb-2 font-medium">Actions</th>
          </tr></thead>
          <tbody id="org-tbody">
            ${org.map(s => `
              <tr class="border-b border-gray-100" data-slug="${escapeHtml(s.slug)}">
                <td class="py-2 font-medium text-gray-900">${escapeHtml(s.name)}</td>
                <td class="py-2 text-gray-500 font-mono text-xs">${escapeHtml(s.slug)}</td>
                <td class="py-2 text-gray-500">${(s.tags ?? []).map(t => `<span class="text-xs bg-gray-100 rounded px-1">#${escapeHtml(t)}</span>`).join(' ')}</td>
                <td class="py-2">
                  <button class="edit-enterprise-btn text-xs text-plum-600 hover:text-plum-700 mr-2">Edit</button>
                  ${role === 'admin' ? `<button class="delete-enterprise-btn text-xs text-red-500 hover:text-red-700">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="text-sm text-gray-400">No org skills yet. Add one above.</p>'}
      </div>
    </div>

    <!-- Add/Edit form (hidden by default) -->
    <div id="enterprise-form" class="hidden mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <h3 class="text-sm font-semibold text-gray-700 mb-3" id="enterprise-form-title">Add Org Skill</h3>
      <input type="hidden" id="enterprise-edit-slug" />
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-600 block mb-1">Name *</label>
          <input id="ent-name" type="text" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
        <div>
          <label class="text-xs text-gray-600 block mb-1">Slug *</label>
          <input id="ent-slug" type="text" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
      </div>
      <div class="mb-3">
        <label class="text-xs text-gray-600 block mb-1">Description *</label>
        <textarea id="ent-desc" rows="2" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300 resize-none"></textarea>
      </div>
      <div class="mb-3">
        <label class="text-xs text-gray-600 block mb-1">Tags (comma-separated)</label>
        <input id="ent-tags" type="text" placeholder="productivity, briefing" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
      <div class="flex gap-2">
        <button id="enterprise-form-save" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
        <button id="enterprise-form-cancel" class="px-3 py-1.5 text-xs bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors">Cancel</button>
      </div>
      <p id="enterprise-form-error" class="text-xs text-red-500 mt-2 hidden"></p>
    </div>
  `;

  const form = panel.querySelector('#enterprise-form');
  const editSlugInput = panel.querySelector('#enterprise-edit-slug');

  panel.querySelector('#add-enterprise-btn').addEventListener('click', () => {
    editSlugInput.value = '';
    panel.querySelector('#enterprise-form-title').textContent = 'Add Org Skill';
    panel.querySelector('#ent-name').value = '';
    panel.querySelector('#ent-slug').value = '';
    panel.querySelector('#ent-desc').value = '';
    panel.querySelector('#ent-tags').value = '';
    panel.querySelector('#ent-slug').disabled = false;
    form.classList.remove('hidden');
  });

  panel.querySelector('#enterprise-form-cancel').addEventListener('click', () => {
    form.classList.add('hidden');
  });

  // Auto-generate slug from name
  panel.querySelector('#ent-name').addEventListener('input', e => {
    if (!editSlugInput.value) {
      panel.querySelector('#ent-slug').value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  });

  panel.querySelector('#enterprise-form-save').addEventListener('click', async () => {
    const errEl = panel.querySelector('#enterprise-form-error');
    errEl.classList.add('hidden');
    const editSlug = editSlugInput.value;
    const payload = {
      name: panel.querySelector('#ent-name').value.trim(),
      slug: panel.querySelector('#ent-slug').value.trim(),
      description: panel.querySelector('#ent-desc').value.trim(),
      tags: panel.querySelector('#ent-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    };
    try {
      if (editSlug) {
        await apiPut(`/admin/enterprise-skills/${encodeURIComponent(editSlug)}`, payload);
      } else {
        await apiPost('/admin/enterprise-skills', payload);
      }
      form.classList.add('hidden');
      currentTab = null;
      loadTab('enterprise');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  panel.querySelectorAll('.edit-enterprise-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    const skillData = org.find(s => s.slug === slug);
    btn.addEventListener('click', () => {
      editSlugInput.value = slug;
      panel.querySelector('#enterprise-form-title').textContent = 'Edit Org Skill';
      panel.querySelector('#ent-name').value = skillData?.name ?? '';
      panel.querySelector('#ent-slug').value = slug;
      panel.querySelector('#ent-slug').disabled = true;
      panel.querySelector('#ent-desc').value = skillData?.description ?? '';
      panel.querySelector('#ent-tags').value = (skillData?.tags ?? []).join(', ');
      form.classList.remove('hidden');
    });
  });

  panel.querySelectorAll('.delete-enterprise-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return;
      try {
        await apiDelete(`/admin/enterprise-skills/${encodeURIComponent(slug)}`);
        row.remove();
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });
}

// ── Categories ───────────────────────────────────────────────────────────
async function loadCategories(panel) {
  const { categories } = await fetchApi('/admin/categories');

  panel.innerHTML = `
    <p class="text-xs text-gray-500 mb-4">Featured skills appear at the top of each category card on the homepage. Enter slugs of enterprise or curated skills to feature them.</p>
    <div class="space-y-4">
      ${categories.map(cat => `
        <div class="p-4 bg-white border border-gray-200 rounded-lg" data-cat-id="${escapeHtml(cat.id)}">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700 m-0">${escapeHtml(cat.label)}</h3>
            <button class="save-featured-btn text-xs px-2 py-1 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 flex-shrink-0">Featured slugs:</span>
            <input
              class="featured-slugs-input flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-plum-300"
              value="${escapeHtml((cat.featuredSlugs ?? []).join(', '))}"
              placeholder="slug-one, slug-two"
            />
          </div>
          <p class="save-status text-xs mt-1 hidden"></p>
        </div>
      `).join('')}
    </div>
  `;

  panel.querySelectorAll('.save-featured-btn').forEach(btn => {
    const card = btn.closest('[data-cat-id]');
    const catId = card.dataset.catId;
    const input = card.querySelector('.featured-slugs-input');
    const status = card.querySelector('.save-status');
    btn.addEventListener('click', async () => {
      const featuredSlugs = input.value.split(',').map(s => s.trim()).filter(Boolean);
      try {
        await apiPut(`/admin/categories/${catId}/featured`, { featuredSlugs });
        status.textContent = 'Saved ✓';
        status.className = 'save-status text-xs mt-1 text-green-600';
        setTimeout(() => status.classList.add('hidden'), 2000);
      } catch (e) {
        status.textContent = `Error: ${e.message}`;
        status.className = 'save-status text-xs mt-1 text-red-500';
      }
    });
  });
}

// ── Users ────────────────────────────────────────────────────────────────
async function loadUsers(panel) {
  const { users } = await fetchApi('/admin/users');
  panel.innerHTML = `
    <table class="w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Name</th>
        <th class="pb-2 font-medium">Email</th>
        <th class="pb-2 font-medium">Role</th>
        <th class="pb-2 font-medium">Last seen</th>
      </tr></thead>
      <tbody>
        ${users.map(u => `
          <tr class="border-b border-gray-100" data-uid="${escapeHtml(u.user_id)}">
            <td class="py-2 text-gray-900">${escapeHtml(u.name ?? '')}</td>
            <td class="py-2 text-gray-500">${escapeHtml(u.email ?? '')}</td>
            <td class="py-2">
              <select class="role-select text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-plum-300">
                <option value="user"     ${u.role === 'user'     ? 'selected' : ''}>user</option>
                <option value="maintain" ${u.role === 'maintain' ? 'selected' : ''}>maintain</option>
                <option value="admin"    ${u.role === 'admin'    ? 'selected' : ''}>admin</option>
              </select>
            </td>
            <td class="py-2 text-gray-400 text-xs">${escapeHtml(u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  panel.querySelectorAll('.role-select').forEach(sel => {
    const row = sel.closest('tr');
    const uid = row.dataset.uid;
    sel.addEventListener('change', async () => {
      try {
        await apiPut(`/admin/users/${encodeURIComponent(uid)}/role`, { role: sel.value });
      } catch (e) {
        alert(`Error: ${e.message}`);
        loadUsers(panel);
      }
    });
  });
}

// ── Audit log ────────────────────────────────────────────────────────────
async function loadAudit(panel) {
  const { events } = await fetchApi('/admin/audit?limit=100');
  if (!events.length) {
    panel.innerHTML = '<p class="text-sm text-gray-400">No audit events yet.</p>';
    return;
  }
  panel.innerHTML = `
    <table class="w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Time</th>
        <th class="pb-2 font-medium">Actor</th>
        <th class="pb-2 font-medium">Action</th>
        <th class="pb-2 font-medium">Entity</th>
      </tr></thead>
      <tbody>
        ${events.map(e => `
          <tr class="border-b border-gray-100">
            <td class="py-2 text-gray-400 text-xs whitespace-nowrap">${escapeHtml(e.timestamp ? new Date(e.timestamp).toLocaleString() : '')}</td>
            <td class="py-2 text-gray-600">${escapeHtml(e.user_id ?? '')}</td>
            <td class="py-2"><span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">${escapeHtml(e.action ?? '')}</span></td>
            <td class="py-2 text-gray-500 font-mono text-xs">${escapeHtml(e.entity_type ?? '')} / ${escapeHtml(e.entity_id ?? '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}
</script>
```

- [ ] **Step 2: Verify build passes**

```bash
pnpm build
```

Expected: build succeeds, `dist/admin/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat(ui): admin panel — queue, enterprise skills, categories, users, audit tabs"
```

---

## Task 7: Skill submission page — /submit

**Files:**
- Create: `src/pages/submit/index.astro`

### Context

The `/submit` page lets any logged-in user submit a skill for review. It calls `POST /api/skills`. The Google Form button on the homepage is NOT changed — this page exists but is not linked from navigation yet. The backend already exists (Task 2 updated it to accept `tags`).

- [ ] **Step 1: Create src/pages/submit/index.astro**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Submit a Skill — Skills Hub">
  <div class="max-w-2xl mx-auto">
    <div class="mb-6">
      <a href="/" class="text-xs text-plum-600 hover:text-plum-700 no-underline">← Back to hub</a>
      <h1 class="text-2xl font-bold text-gray-900 mt-2 m-0">Submit a Skill</h1>
      <p class="text-sm text-gray-500 mt-1 m-0">Share a reusable skill with the Nava team. It will be reviewed before appearing publicly.</p>
    </div>

    <form id="submit-form" class="space-y-4 bg-white border border-gray-200 rounded-lg p-6">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-xs font-medium text-gray-700 block mb-1">Name *</label>
          <input id="f-name" type="text" required placeholder="My Skill" class="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-700 block mb-1">Slug * <span class="text-gray-400 font-normal">(auto-generated)</span></label>
          <input id="f-slug" type="text" required placeholder="my-skill" class="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-gray-700 block mb-1">Description * <span class="text-gray-400 font-normal">(max 500 chars)</span></label>
        <textarea id="f-desc" rows="3" required maxlength="500" placeholder="What does this skill do? When would someone use it?" class="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-plum-300 resize-none"></textarea>
        <p class="text-xs text-gray-400 mt-1"><span id="f-desc-count">0</span>/500</p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-xs font-medium text-gray-700 block mb-1">Plugin / repo * <span class="text-gray-400 font-normal">(org/repo)</span></label>
          <input id="f-plugin" type="text" required placeholder="navapbc/my-skills" class="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-700 block mb-1">File path *</label>
          <input id="f-path" type="text" required placeholder="skills/my-skill/SKILL.md" class="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-gray-700 block mb-2">Works with *</label>
        <div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" value="claude-code" class="compat-check rounded border-gray-300 text-plum-600 focus:ring-plum-300" /> Claude Code
          </label>
          <label class="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" value="cursor" class="compat-check rounded border-gray-300 text-plum-600 focus:ring-plum-300" /> Cursor
          </label>
          <label class="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" value="github-copilot" class="compat-check rounded border-gray-300 text-plum-600 focus:ring-plum-300" /> GitHub Copilot
          </label>
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-gray-700 block mb-1">Tags <span class="text-gray-400 font-normal">(comma-separated)</span></label>
        <input id="f-tags" type="text" placeholder="testing, documentation, accessibility" class="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>

      <div id="form-error" class="hidden p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"></div>

      <div class="flex items-center gap-3 pt-2">
        <button type="submit" class="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 transition-colors font-medium">Submit for review</button>
        <span id="form-submitting" class="hidden text-xs text-gray-400">Submitting...</span>
      </div>
    </form>

    <!-- Success state -->
    <div id="form-success" class="hidden p-6 bg-green-50 border border-green-200 rounded-lg text-center">
      <p class="text-base font-semibold text-green-800 m-0">Skill submitted!</p>
      <p class="text-sm text-green-700 mt-1 m-0">Your skill is pending review. A maintainer will approve it shortly.</p>
      <a href="/" class="inline-block mt-4 text-sm text-plum-600 hover:text-plum-700 no-underline">← Back to hub</a>
    </div>
  </div>
</Base>

<script>
document.getElementById('f-name').addEventListener('input', e => {
  document.getElementById('f-slug').value = e.target.value
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
});

document.getElementById('f-desc').addEventListener('input', e => {
  document.getElementById('f-desc-count').textContent = e.target.value.length;
});

document.getElementById('submit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  const submitBtn = document.querySelector('[type="submit"]');
  const submittingEl = document.getElementById('form-submitting');
  errEl.classList.add('hidden');

  const compatibility = [...document.querySelectorAll('.compat-check:checked')].map(el => el.value);
  if (!compatibility.length) {
    errEl.textContent = 'Select at least one compatibility option.';
    errEl.classList.remove('hidden');
    return;
  }

  const slug = document.getElementById('f-slug').value.trim();
  const plugin = document.getElementById('f-plugin').value.trim();
  const payload = {
    slug,
    name: document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    plugin,
    repo: plugin,
    path: document.getElementById('f-path').value.trim(),
    author: '',
    compatibility,
    type: 'skill',
    tags: document.getElementById('f-tags').value.split(',').map(t => t.trim()).filter(Boolean),
  };

  submitBtn.disabled = true;
  submittingEl.classList.remove('hidden');

  try {
    const res = await fetch('/api/skills', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    document.getElementById('submit-form').classList.add('hidden');
    document.getElementById('form-success').classList.remove('hidden');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submittingEl.classList.add('hidden');
  }
});
</script>
```

- [ ] **Step 2: Verify build passes**

```bash
pnpm build
```

Expected: `dist/submit/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add src/pages/submit/index.astro
git commit -m "feat(ui): skill submission form at /submit (not linked from nav yet)"
```

---

## Task 8: Homepage — read featuredSlugs from /api/categories

**Files:**
- Modify: `src/pages/index.astro`

### Context

Currently the homepage reads `featuredSlugs` from the hardcoded `CATEGORIES` in `categories.mjs` (all empty). After this task, it fetches `GET /api/categories` first to get the admin-managed `featuredSlugs`, merges them into the static `CATEGORIES` (which holds labels and colors), and then does the BatchGetItem fetch with the merged slug list.

The `CATEGORIES` import is kept for the static config (labels, colors, `slugs`). Only `featuredSlugs` comes from the API.

- [ ] **Step 1: Update the script block in src/pages/index.astro**

In `src/pages/index.astro`, find the script section (starts around line 103). Replace the section that builds `categorySlugs` and calls `Promise.all`:

```js
// Change FROM:
const categorySlugs = [...new Set(
  CATEGORIES.flatMap(c => [...(c.featuredSlugs || []), ...(c.slugs || [])])
)].join(',');

Promise.all([
  fetchApi('/skills?slugs=' + encodeURIComponent(categorySlugs)),
  fetchApi('/skills'),
  fetchApi('/plugins'),
]).then(([{ skills: catSkills }, { skills }, { plugins }]) => {
  document.getElementById('category-grid').innerHTML = renderCategoryGrid(CATEGORIES, catSkills);

// Change TO:
fetchApi('/categories').then(({ categories: apiCategories }) => {
  // Merge dynamic featuredSlugs (from admin panel) into static CATEGORIES (labels, colors, slugs)
  const mergedCategories = CATEGORIES.map(c => {
    const override = apiCategories.find(x => x.id === c.id);
    return { ...c, featuredSlugs: override?.featuredSlugs ?? [] };
  });

  const categorySlugs = [...new Set(
    mergedCategories.flatMap(c => [...(c.featuredSlugs || []), ...(c.slugs || [])])
  )].join(',');

  return Promise.all([
    fetchApi('/skills?slugs=' + encodeURIComponent(categorySlugs)),
    fetchApi('/skills'),
    fetchApi('/plugins'),
    Promise.resolve(mergedCategories),
  ]);
}).then(([{ skills: catSkills }, { skills }, { plugins }, mergedCategories]) => {
  document.getElementById('category-grid').innerHTML = renderCategoryGrid(mergedCategories, catSkills);
```

Also update the `renderNewThisWeek` call (uses `CATEGORIES` → should use `mergedCategories`):
```js
// Change:
document.getElementById('new-this-week').innerHTML = renderNewThisWeek(skills, CATEGORIES);
// To:
document.getElementById('new-this-week').innerHTML = renderNewThisWeek(skills, mergedCategories);
```

Update the `.catch` handler to handle the new chained structure (it already works, no change needed).

- [ ] **Step 2: Verify build passes**

```bash
pnpm build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(homepage): fetch featuredSlugs from /api/categories for admin-managed featured slots"
```

---

## Task 9: Anthropic built-in sync script

**Files:**
- Create: `scripts/sync-anthropic-builtin-skills.mjs`

### Context

This script calls `GET /v1/skills?source=anthropic`, maps the 4 results to DynamoDB records, and upserts them into the skills table. It uses the same `--env` argument pattern as `sync-registry-v2.mjs`. `ANTHROPIC_API_KEY` must be set in the environment.

Run: `node scripts/sync-anthropic-builtin-skills.mjs --env staging`

- [ ] **Step 1: Create scripts/sync-anthropic-builtin-skills.mjs**

```js
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const env = envFlag !== -1 ? args[envFlag + 1] : null;

if (!env || !['staging', 'prod'].includes(env)) {
  console.error('Usage: node sync-anthropic-builtin-skills.mjs --env staging|prod');
  process.exit(1);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const TABLE = `skills-registry-skills-${env}`;

const DESCRIPTIONS = {
  xlsx: 'Read and write Excel spreadsheets via Claude code execution in the Anthropic Messages API.',
  pptx: 'Generate and modify PowerPoint presentations via Claude code execution in the Anthropic Messages API.',
  pdf:  'Extract and process PDF content via Claude code execution in the Anthropic Messages API.',
  docx: 'Read and write Word documents via Claude code execution in the Anthropic Messages API.',
};

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

async function fetchAnthropicSkills() {
  const res = await fetch('https://api.anthropic.com/v1/skills?source=anthropic', {
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'skills-2025-10-02',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.data ?? [];
}

async function upsertSkill(skill) {
  const now = new Date().toISOString();
  const item = {
    slug: skill.id,
    name: skill.display_title,
    description: DESCRIPTIONS[skill.id] ?? skill.display_title,
    source: 'anthropic-builtin',
    type: 'tool',
    status: 'approved',
    visibility: 'public',
    version: skill.latest_version,
    tags: [],
    plugin: 'anthropic',
    repo: 'anthropic',
    path: '',
    author: 'Anthropic',
    compatibility: [],
    last_updated: skill.updated_at,
    updated_at: now,
    created_at: skill.created_at,
  };

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: item,
    ConditionExpression: 'attribute_not_exists(#slug) OR #src = :builtin',
    ExpressionAttributeNames: { '#slug': 'slug', '#src': 'source' },
    ExpressionAttributeValues: { ':builtin': 'anthropic-builtin' },
  }));

  console.log(`  ✓ upserted: ${skill.id} (v${skill.latest_version})`);
}

async function main() {
  console.log(`Syncing Anthropic built-in skills → ${TABLE}`);
  const skills = await fetchAnthropicSkills();
  console.log(`Found ${skills.length} Anthropic skills`);

  for (const skill of skills) {
    try {
      await upsertSkill(skill);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`  ↷ skipped: ${skill.id} (non-builtin record exists — slug collision)`);
      } else {
        throw err;
      }
    }
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Test the script in dry-run mode (staging)**

```bash
ANTHROPIC_API_KEY=<your-key> node scripts/sync-anthropic-builtin-skills.mjs --env staging
```

Expected output:
```
Syncing Anthropic built-in skills → skills-registry-skills-staging
Found 4 Anthropic skills
  ✓ upserted: xlsx (v20260203)
  ✓ upserted: pptx (v20260304)
  ✓ upserted: pdf (v20260203)
  ✓ upserted: docx (v20260212)
Done.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-anthropic-builtin-skills.mjs
git commit -m "feat(sync): Anthropic built-in skills sync script (xlsx, pptx, pdf, docx)"
```

---

## Task 10: GitHub Actions cron workflow

**Files:**
- Create: `.github/workflows/sync-anthropic.yml`

### Context

Weekly cron that runs the sync script against both staging and prod environments. Uses OIDC AWS auth (same as existing `deploy.yml`). `ANTHROPIC_API_KEY` is added as a GitHub Actions secret in both environments.

Before this workflow can succeed, add `ANTHROPIC_API_KEY` to GitHub Actions secrets:
- Repository → Settings → Secrets and variables → Actions → New repository secret
- Name: `ANTHROPIC_API_KEY`
- Add to both `staging` and `production` environments

- [ ] **Step 1: Create .github/workflows/sync-anthropic.yml**

```yaml
name: Sync Anthropic Built-in Skills

on:
  schedule:
    - cron: '0 9 * * 1'   # Every Monday at 9am UTC
  workflow_dispatch:        # Allow manual trigger

jobs:
  sync-staging:
    name: Sync to staging
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install root dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: us-east-1

      - name: Sync Anthropic built-in skills (staging)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/sync-anthropic-builtin-skills.mjs --env staging

  sync-prod:
    name: Sync to prod
    runs-on: ubuntu-latest
    environment: production
    needs: sync-staging
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install root dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: us-east-1

      - name: Sync Anthropic built-in skills (prod)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/sync-anthropic-builtin-skills.mjs --env prod
```

- [ ] **Step 2: Run full test suite one final time**

```bash
pnpm vitest run
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync-anthropic.yml
git commit -m "feat(ci): weekly cron to sync Anthropic built-in skills to staging and prod"
```

---

## Post-Implementation Checklist (Human Steps)

After all tasks are committed and deployed to staging:

- [ ] Add `ANTHROPIC_API_KEY` to GitHub Actions secrets (staging + production environments)
- [ ] Run `terraform apply -var-file=terraform.staging.tfvars` to push updated CloudFront edge function (adds `/admin` and `/submit` routing)
- [ ] Run `node scripts/sync-anthropic-builtin-skills.mjs --env staging` to populate built-in skills
- [ ] Promote yourself to `admin` in DynamoDB directly: `aws dynamodb update-item --table-name skills-registry-users-staging --key '{"user_id":{"S":"corytrimm@navapbc.com"}}' --update-expression "SET #r = :r" --expression-attribute-names '{"#r":"role"}' --expression-attribute-values '{":r":{"S":"admin"}}' --region us-east-1`
- [ ] Verify `/admin` page loads and all 5 tabs function
- [ ] Verify `/submit` page loads and form submits successfully
- [ ] Verify category grid on homepage shows featured skills after setting them via admin panel
- [ ] For prod: repeat terraform apply, sync script, and role promotion against prod resources
