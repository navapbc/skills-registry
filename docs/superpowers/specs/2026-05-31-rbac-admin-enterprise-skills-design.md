# RBAC + Admin Panel + Enterprise Skills Sync — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the role system to user → maintain → admin, build an admin panel for content curation, add a `/submit` page for skill submissions, and sync Anthropic built-in skills (xlsx, pptx, pdf, docx) into DynamoDB on a weekly cron.

**Architecture:** All backend changes are in the existing Hono Lambda (`functions/api`). The admin panel is a new CSR Astro page (`/admin`) following the same fetch-on-load pattern as existing pages. The Anthropic sync is a standalone Node script run via GitHub Actions cron.

**Tech Stack:** Hono (Lambda router), DynamoDB (existing tables), Astro CSR, GitHub Actions cron, Anthropic `/v1/skills` API (`skills-2025-10-02` beta).

---

## 1. Data Model

### Users table — role values

The `role` field on user records gains a third value:

| Value | Meaning |
|---|---|
| `user` | Default for all logged-in users |
| `maintain` | Trusted content curators — approve/reject, edit skills, manage enterprise skills and categories |
| `admin` | Full access — everything maintain can do, plus user management, deletes, audit log |

No migration needed. Existing records keep their current role. New `maintain` assignments are made via the admin panel.

### Skills table — new source and type values

| `source` | `type` | Meaning |
|---|---|---|
| `github` | `skill` / `agent` | Synced from GitHub repos (existing) |
| `user-submitted` | `skill` / `agent` | Submitted via the hub form (existing backend, new frontend) |
| `anthropic-builtin` | `tool` | Synced from Anthropic `/v1/skills?source=anthropic` (new) |
| `anthropic-enterprise` | `skill` | Manually curated org-level skills — daily-briefing, proposal-review, etc. (new) |

### Tags field

All skills records gain a `tags: string[]` field (DynamoDB list attribute). Treated as empty if absent — no migration script required. Tags are freeform labels (`testing`, `documentation`, `federal`, `security`, etc.) distinct from category assignments.

**Category vs. Tag distinction:**
- **Category**: Admin-curated navigation grouping. A skill appears in a category because a maintainer assigned it. Limited set (the 5 existing categories). Top-level navigation on the hub.
- **Tag**: Freeform label on the skill itself. Many per skill. Added by the author on submission or by a maintainer. Used for future search filtering and discovery — not navigation. Tag browsing UI is deferred to a future spec.

---

## 2. Permission Matrix

See also: `docs/rbac-permissions.md` (canonical reference).

| Action | user | maintain | admin |
|---|---|---|---|
| Browse / search public skills | ✓ | ✓ | ✓ |
| Submit a skill (→ pending) | ✓ | ✓ | ✓ |
| Edit own pending submission | ✓ | ✓ | ✓ |
| Approve / reject pending submissions | ✗ | ✓ | ✓ |
| Edit any skill (content, tags, category) | ✗ | ✓ | ✓ |
| Add / edit enterprise skills | ✗ | ✓ | ✓ |
| Manage category featuredSlugs | ✗ | ✓ | ✓ |
| Add / edit / delete plugins | ✗ | ✓ | ✓ |
| Delete any skill | ✗ | ✗ | ✓ |
| Manage user roles | ✗ | ✗ | ✓ |
| View audit log | ✗ | ✗ | ✓ |

Operations mapped in `permissions.mjs`:

```
read:skill            → user+
submit:skill          → user+
approve:skill         → maintain+
reject:skill          → maintain+
edit:any-skill        → maintain+
manage:plugins        → maintain+
manage:enterprise     → maintain+  (new)
manage:categories     → maintain+  (new)
delete:skill          → admin
delete:plugin         → admin
manage:users          → admin
view:audit            → admin
```

---

## 3. Backend Changes

### 3a. `functions/api/lib/permissions.mjs`

Update `can()` to handle `maintain` between `user` and `admin`. The role hierarchy is linear: admin ⊇ maintain ⊇ user. A helper `atLeast(user, minRole)` makes the hierarchy explicit.

```js
const ROLE_RANK = { user: 0, maintain: 1, admin: 2 };
const atLeast = (user, role) => (ROLE_RANK[user?.role] ?? 0) >= (ROLE_RANK[role] ?? 99);
```

### 3b. `functions/api/routes/skills.mjs`

- `POST /api/skills`: Auto-approve if `maintain` or `admin` (currently admin-only).
- `PUT /api/skills/:slug`: Allow `maintain` to edit any skill (currently admin-only).
- No change to `DELETE /api/skills/:slug` — remains admin-only.

### 3c. `functions/api/routes/users.mjs`

- `PUT /api/users/:id/role`: Accept `maintain` as a valid role value (add to validation allowlist).

### 3d. `functions/api/routes/admin.mjs` (new file)

All routes require `maintain` or `admin` unless noted. Mounted in `index.mjs` as `adminRoutes(app)`.

**Skills queue:**
- `GET /api/admin/queue` — returns skills where `status=pending`, sorted by `created_at` desc. (maintain+)

**Enterprise skills:**
- `GET /api/admin/enterprise-skills` — returns skills where `source=anthropic-enterprise` or `source=anthropic-builtin`. (maintain+)
- `POST /api/admin/enterprise-skills` — creates a skill with `source=anthropic-enterprise`, `status=approved`, `type=skill`. Required fields: slug, name, description, tags. (maintain+)
- `PUT /api/admin/enterprise-skills/:slug` — edit name, description, tags. (maintain+)
- `DELETE /api/admin/enterprise-skills/:slug` — hard delete. (admin only)

**Categories:**
- `GET /api/admin/categories` — returns current CATEGORIES config with each category's `featuredSlugs` and `slugs`. (maintain+)
- `PUT /api/admin/categories/:id/featured` — accepts `{ featuredSlugs: string[] }`, writes to a `categories` DynamoDB record (see note below). (maintain+)

> **Categories persistence note:** `featuredSlugs` are currently hardcoded in `categories.mjs`. The admin panel needs to persist changes. Rather than require a code deploy on every change, the `PUT` endpoint writes `featuredSlugs` to a record in the skills table with `slug=category::{id}` and `source=category-config`. The frontend `GET /api/admin/categories` merges static `categories.mjs` config with any overrides from DynamoDB. This avoids a new DynamoDB table while keeping category layout editable without a deploy. The homepage `renderCategoryGrid` continues to read `featuredSlugs` from the skill objects it receives — no frontend change needed once the data is correct.

**Users:**
- `GET /api/admin/users` — paginated list of all users, sorted by `created_at` desc. (admin only)
- `PUT /api/admin/users/:id/role` — set role to `user`, `maintain`, or `admin`. (admin only)

**Audit log:**
- `GET /api/admin/audit` — paginated audit log, sorted by `timestamp` desc. Accepts `?limit=50`. (admin only)

---

## 4. Admin Panel UI — `/admin`

New Astro CSR page at `src/pages/admin/index.astro`. CloudFront edge function gets one new routing rule: `/admin/*` → `/admin/index.html`.

Access gate: page checks user role client-side on load. If `user` role, redirects to `/`. If `maintain`, shows maintain-level tabs only. If `admin`, shows all tabs.

### Tab: Skills Queue (maintain+)

Table columns: Skill name | Author | Plugin | Submitted date | Actions (Approve / Reject).

Approve calls `POST /api/skills/:slug/approve`. Reject opens an inline text field for rejection reason, then calls `POST /api/skills/:slug/reject`. Tab header shows pending count badge.

### Tab: Enterprise Skills (maintain+)

Two sections:

**Anthropic Built-ins** (read-only rows): xlsx, pptx, pdf, docx — sourced from the weekly cron sync. Shows name, version, last synced date. Not editable.

**Org Skills** (editable): skills with `source=anthropic-enterprise`. Table with Add / Edit / Delete actions. Add/Edit form fields: Name, Slug (auto-generated, editable), Description, Tags (comma-separated input), Claude Desktop link (optional URL).

### Tab: Categories (maintain+)

Shows the 5 categories. Each row has a "Featured Skills" slot — a search-and-add autocomplete that looks up skills by name/slug and adds them to `featuredSlugs`. Removable chips for each featured skill. Save calls `PUT /api/admin/categories/:id/featured`.

### Tab: Users (admin only)

Table: Name | Email | Role | Last seen. Role is an inline dropdown (user / maintain / admin). Change saves on selection via `PUT /api/admin/users/:id/role`. No confirmation dialog — role change is audited and reversible.

### Tab: Audit Log (admin only)

Paginated table: Timestamp | Actor (name + email) | Action | Entity type | Entity slug. Load more button for pagination.

---

## 5. Skill Submission — `/submit` Page

New Astro CSR page at `src/pages/submit/index.astro`. CloudFront edge function gets routing rule: `/submit/*` → `/submit/index.html`.

**Not linked from the homepage yet.** The existing Google Form button remains unchanged. The `/submit` route exists and works but is not surfaced in navigation until a future PR switches over.

Form fields:

| Field | Input type | Notes |
|---|---|---|
| Name | text | Required |
| Slug | text | Auto-generated from name (lowercase, hyphens), editable |
| Description | textarea | Required, max 500 chars |
| Plugin / repo | text | GitHub org/repo format |
| File path | text | e.g. `skills/my-skill/SKILL.md` |
| Compatibility | checkboxes | claude-code, cursor, github-copilot |
| Tags | text | Comma-separated, freeform |
| Author | pre-filled | From logged-in user session |

On submit: `POST /api/skills`. On success: shows confirmation message ("Your skill is pending review"). On error: shows inline field errors.

---

## 6. Anthropic Built-in Sync

### Script: `scripts/sync-anthropic-builtin-skills.mjs`

```
node scripts/sync-anthropic-builtin-skills.mjs --env staging|prod
```

Calls `GET /v1/skills?source=anthropic` with `ANTHROPIC_API_KEY`. For each skill in the response, upserts into DynamoDB skills table:

```js
{
  slug: skill.id,                    // "xlsx", "pptx", "pdf", "docx"
  name: skill.display_title,
  source: 'anthropic-builtin',
  type: 'tool',
  status: 'approved',
  visibility: 'public',
  version: skill.latest_version,
  tags: [],
  description: BUILTIN_DESCRIPTIONS[skill.id] ?? skill.display_title,
  last_updated: skill.updated_at,
  updated_at: new Date().toISOString(),
}
```

`BUILTIN_DESCRIPTIONS` is a small hardcoded map in the script (the API returns no descriptions):

```js
const BUILTIN_DESCRIPTIONS = {
  xlsx: 'Read and write Excel spreadsheets via Claude code execution.',
  pptx: 'Generate and modify PowerPoint presentations via Claude code execution.',
  pdf:  'Extract and process PDF content via Claude code execution.',
  docx: 'Read and write Word documents via Claude code execution.',
};
```

Uses `PutCommand` with `ConditionExpression: 'attribute_not_exists(slug) OR source = :src'` to prevent overwriting non-builtin skills if a slug collision occurs.

### GitHub Actions cron — `.github/workflows/sync-anthropic.yml`

Runs weekly: `0 9 * * 1` (Monday 9am UTC). Uses OIDC AWS auth (same as existing deploy workflow). Requires:
- `ANTHROPIC_API_KEY` — GitHub Actions secret (staging + prod environments)
- `AWS_ROLE_TO_ASSUME` — existing secret
- `SKILLS_TABLE` — existing env var

---

## 7. Frontend Display Changes

### Tag chips

`renderSkillCard()` and `renderSkillDetail()` in `src/lib/render.mjs` render tags as small gray chips below the description when `skill.tags?.length > 0`. Read-only in this spec — no filtering UI.

### Anthropic tool badge

Skills with `source=anthropic-builtin` get a distinct "Anthropic Tool" badge on cards and detail pages. Detail page includes a note: "This is a code execution tool — used via the Anthropic Messages API, not as a SKILL.md workflow."

### Category grid featured section

No code change needed. `renderCategoryGrid` already renders featured skills at the top of each category card when `featuredSlugs` is populated. The admin panel manages the data; the frontend renders it automatically.

---

## 8. Permissions Documentation

A standalone doc `docs/rbac-permissions.md` is created alongside this implementation as the canonical reference for the role system. It mirrors the permission matrix in Section 2 and is updated whenever roles or operations change.

---

## 9. Out of Scope (Deferred)

- Tag browsing / filter UI on the frontend
- Dynamic category membership driven by tags
- Switching the homepage "Submit a skill" button from Google Form to `/submit`
- Enterprise admin-configured Claude Desktop skills (daily-briefing, proposal-review, etc.) — pending Anthropic API availability
- Admin panel notifications / email on new submissions
