# API Reference

The Skills Hub exposes a REST API at `/api/*`, served by an API Lambda behind API Gateway and routed through CloudFront. All endpoints require authentication.

A machine-readable [OpenAPI 3.1 spec](openapi.yaml) is also available.

---

## Authentication

All requests must include a valid `__session` cookie. Obtain one by completing the Google OAuth flow:

1. Visit `/auth/login` (or `GET /auth/login?return_to=/some-path`)
2. Authenticate with your `@navapbc.com` Google account
3. The callback sets an 8-hour `__session` JWT cookie (HttpOnly, Secure, SameSite=Lax)

The JWT is validated in the API Lambda middleware on every request — not at API Gateway. Expired or invalid cookies return `401`.

---

## Roles

| Role | Description |
|---|---|
| `user` | Default. All authenticated `@navapbc.com` users. |
| `maintain` | Can approve/reject skills, manage categories, edit any skill. |
| `admin` | Full access, including user management, deletion, and audit log. |

Roles are set in DynamoDB. The first admin must be promoted [directly via CLI](DEPLOY.md#14-promote-first-admin-manual--after-first-deploy). Subsequent promotions go through `PUT /api/admin/users/:id/role`.

---

## Response format

All responses are JSON. Errors always have shape `{ "error": "message" }`.

Common status codes:

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `400` | Bad request — missing/invalid fields |
| `401` | Missing or expired `__session` cookie |
| `403` | Authenticated but insufficient role or ownership |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate slug) |

---

## Auth endpoints

These are handled by the Auth Lambda, proxied through CloudFront at `/auth/*`. They do not require a session cookie.

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login` | Redirects to Google OAuth. Optional `?return_to=/path` |
| `GET` | `/auth/callback` | OAuth callback. Sets `__session` cookie, redirects to `return_to`. |
| `GET` | `/auth/logout` | Clears session cookies, redirects to `/login`. |

---

## Skills

Skills represent individual `SKILL.md` or `AGENT.md` files. The `type` field distinguishes `skill` from `agent`.

### `GET /api/skills`

List all skills visible to the caller. Users see approved public/internal skills plus their own skills at any status. Maintainers and admins see all.

**Query params:**

| Param | Description |
|---|---|
| `type` | Filter by `skill` or `agent` |
| `plugin` | Filter by plugin slug |
| `slugs` | Comma-separated slug list for batch fetch (max 100). Used by homepage category grids. |

**Response:** `{ skills: Skill[] }`

---

### `GET /api/skills/:slug`

Get a single skill. Returns `403` (not `404`) if the skill exists but is not visible to the caller.

---

### `POST /api/skills`

Create a skill. Required fields: `slug`, `name`, `description`, `plugin`, `repo`, `path`, `author`, `compatibility`, `type`.

Status is set to `pending` for `user` role, `approved` for `admin`. Source is forced to `user-submitted`.

**Response:** `201` with the created skill record.

---

### `PUT /api/skills/:slug`

Update a skill. Owners can edit their own skills; maintainers and admins can edit any skill. If a non-admin edits an already-approved skill, status resets to `pending`. Provenance fields (`slug`, `source`, `created_by`, `created_at`) cannot be overwritten.

---

### `DELETE /api/skills/:slug`

Delete a skill. Admin only.

---

### `POST /api/skills/:slug/approve`

Approve a pending skill. Maintain+ only. Optional body: `{ visibility: "public" | "internal" | "private" }`.

---

### `POST /api/skills/:slug/reject`

Reject a pending skill. Maintain+ only. Optional body: `{ reason: "string" }`.

---

## Plugins

Plugin records group skills under a shared namespace (e.g. a repo's tool directory).

### `GET /api/plugins`

List all plugins.

### `GET /api/plugins/:slug`

Get a single plugin.

### `POST /api/plugins`

Create a plugin. Admin only. Required fields: `slug`, `name`, `description`, `repo`, `author`.

### `PUT /api/plugins/:slug`

Update a plugin. Admin only.

### `DELETE /api/plugins/:slug`

Delete a plugin. Admin only.

---

## Users

### `GET /api/users/me`

Returns the current user's record. Creates the record in DynamoDB on first call (role defaults to `user`).

### `PUT /api/users/me/favorites`

Replace the current user's favorites list.

**Body:** `{ favorites: string[] }` — full replacement, array of skill slugs.

### `PUT /api/users/me/installed`

Replace the current user's installed list.

**Body:** `{ installed: string[] }` — full replacement, array of skill slugs.

### `GET /api/users`

List all users. Admin only.

### `PUT /api/users/:id/role`

Update a user's role. Admin only. URL-encode the user ID (email) in the path.

**Body:** `{ role: "user" | "maintain" | "admin" }`

---

## Audit

### `GET /api/audit`

Full audit log. Admin only.

### `GET /api/audit/me`

The current user's audit events. Returns up to 100 most recent events.

**Event shape:** `{ user_id, event_key, action, resource_type, resource_id, metadata, timestamp }`

**Actions:** `created`, `updated`, `deleted`, `approved`, `rejected`, `role-changed`, `copied`

---

## Admin

### `GET /api/categories`

Returns the 5 homepage categories (`personal-productivity`, `research-and-analyze`, `write-and-review`, `team-automations`, `build-and-ship`) with their `featuredSlugs` and metadata (`subtitle`, `hero_description`, `accent_color`, `icon`). Used by the homepage grid. No special role required beyond authentication.

### `GET /api/admin/queue`

Pending approval queue — all skills with `status=pending`, sorted newest first. Maintain+ only.

### `GET /api/admin/enterprise-skills`

All skills with `source=anthropic-enterprise` or `source=anthropic-builtin`. Maintain+ only.

### `POST /api/admin/enterprise-skills`

Create an enterprise skill (source=`anthropic-enterprise`, status=`approved`). Maintain+ only.

Required fields: `slug`, `name`, `description`. Optional: `tags`, `docs_url`.

Returns `409` if slug already exists.

### `PUT /api/admin/enterprise-skills/:slug`

Update an enterprise skill. Maintain+ only. Cannot edit `anthropic-builtin` source records.

### `DELETE /api/admin/enterprise-skills/:slug`

Delete an enterprise skill. Admin only.

### `GET /api/admin/categories`

Get categories with featured slug lists. Maintain+ only.

### `PUT /api/admin/categories/:id/featured`

Replace the featured skills list for a category. Maintain+ only.

Valid `id` values: `personal-productivity`, `research-and-analyze`, `write-and-review`, `team-automations`, `build-and-ship`.

**Body:** `{ featuredSlugs: string[] }`

### `GET /api/admin/users`

List all users sorted newest first. Admin only.

### `PUT /api/admin/users/:id/role`

Update a user's role. Admin only.

### `GET /api/admin/audit`

Audit log with optional `?limit=N` (max 200, default 50). Admin only.

### `GET /api/admin/analytics`

Aggregated content analytics over a rolling 28-day window. Admin only. Returns `{ topSkills, topSearches, filterUsage, window_days }` — counts of skill views, searches (query + representative result count), and filter usage, each sorted by count.

---

## Analytics

### `POST /api/hub-log`

Behavioral analytics ingest. Body: `{ event, props }` where `event` is one of `page_view`, `skill_view`, `search_query`, `filter_applied`. `user_email` and `timestamp` are stamped server-side from the session — client-supplied identity is ignored. Unknown event names return 400; write failures are swallowed and still return `204` (best-effort). Any authenticated user may call it. (Path avoids `events`/`analytics` so ad blockers don't drop the request.)

---

## Skill object reference

```json
{
  "slug": "summarize-doc",
  "name": "Summarize Document",
  "description": "When the user wants to summarize a long document...",
  "type": "skill",
  "plugin": "nava-writing",
  "repo": "navapbc/platform-tools",
  "path": ".claude/skills/summarize-doc/SKILL.md",
  "author": "cory-nava",
  "version": "1.0.0",
  "compatibility": ["claude-code", "claude-ai"],
  "sensitive_data": false,
  "content": "...",
  "tags": ["writing", "productivity"],
  "category": "write-and-review",
  "visibility": "public",
  "status": "approved",
  "source": "github",
  "created_by": "user@navapbc.com",
  "created_at": "2026-06-01T00:00:00.000Z",
  "updated_at": "2026-06-01T00:00:00.000Z"
}
```

`source` values:

| Value | Origin |
|---|---|
| `github` | Synced from a navapbc GitHub repo via the 4-hour sync workflow |
| `enterprise` | From the `enterprise/` folder in this repo |
| `anthropic-builtin` | Synced from Anthropic's built-in skills catalog (read-only) |
| `anthropic-enterprise` | Created via the admin UI for Nava-internal Anthropic usage |
| `user-submitted` | Created by an authenticated user via `POST /api/skills` |
