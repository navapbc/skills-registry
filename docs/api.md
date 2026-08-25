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
| `maintain` | Can approve/reject skills, manage enterprise skills, edit any skill. |
| `admin` | Full access, including user management, deletion, and audit log. |
| `projects-admin` | Manages Contract Explorer reference data only. Sits outside the ladder — grants nothing else privileged. See [rbac-permissions.md](rbac-permissions.md). |

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

## Project reference data

Admin-owned reference data for the Contract Explorer: delivery `archetype` records and AI-posture `posture` records. Both live in one table partitioned by `:entityType`, which must be `archetype` or `posture` — anything else is a 400.

Every endpoint below, **including the reads**, requires `projects-admin` or `admin`. This differs from Skills and Plugins, whose list endpoints are open to any authenticated user.

There is deliberately no delete endpoint. A record referenced by program data must not be removable, so records are deactivated instead.

### `GET /api/project-reference/:entityType`

List all records of one entity type, active and inactive. Returns `{ "records": [...] }`.

### `GET /api/project-reference/:entityType/:id`

Get a single record. Deactivated records are still retrievable.

### `POST /api/project-reference/:entityType`

Create a record. Required for both types: `id` (slug-safe), `label`, `color` (six-digit hex). Archetypes also require `icon` (from the curated menu in `src/lib/icons.mjs`) and accept `description`, `characteristics`, `ai_opportunities`. Postures also require `position` (integer, display order only — no severity meaning) and `steps` (non-empty list of non-empty strings, order preserved).

Returns 409 if the id already exists.

### `PUT /api/project-reference/:entityType/:id`

Replace a record. The path owns the id; an `id` in the body is ignored. Whole-record write, last writer wins.

### `PUT /api/project-reference/:entityType/:id/status`

Set `status` to `active` or `inactive`. Separate from the update endpoint so the audit trail records `deactivated` / `reactivated` rather than a generic update.

---

## Projects

Projects mirrored from the "All Columns (Full View)" tab of the Nava Projects and Programs Database by `scripts/sync-projects.mjs`. The sheet is authoritative and is the only write surface.

Requires `projects-admin` or `admin` — the same capability as project reference data, reads included. These records carry contract names, agencies, offices, and period-of-performance dates.

**Read-only.** There is no create, update, or delete endpoint, and the API Lambda's IAM grant on this table omits write actions, so a write route added later would fail against infrastructure rather than succeed quietly.

### `GET /api/projects`

Everything the Projects admin tab needs in one response — the drift summary and the project table cannot disagree about freshness if they come from the same read.

```json
{
  "projects": [
    { "project_code": "FC026", "project_name": "CO COBEES", "archetype_primary": "Product Team", "...": "" }
  ],
  "column_groups":  { "database_code": "IDENTITY", "archetype_primary": "FRAMEWORKS" },
  "column_headers": { "database_code": "Database code", "archetype_primary": "Archetype (Primary)" },
  "sync": {
    "state": "complete",
    "last_run_at": "2026-08-06T08:00:00.000Z",
    "row_count": 53,
    "created": 1, "updated": 2, "deleted": 0,
    "new_columns": []
  },
  "drift": {
    "archetype_count": 5,
    "unresolved": [
      { "project_code": "FC026", "project_name": "CO COBEES", "column": "Archetype (Primary)", "raw_value": "Prodcut Team" }
    ],
    "missing": [
      { "project_code": "LB007", "project_name": "New Project", "column": "Archetype (Primary)" }
    ]
  }
}
```

Attribute names are slugs derived from the sheet headers; `column_headers` maps each back to the header it came from, and `column_groups` to the group the sheet declares above it. Columns preceding the sheet's first group label are grouped as `IDENTITY`.

`sync.state` is one of:

- `never_synced` — no sync has run. Not an error.
- `in_progress` — a run wrote projects and then died, so the table is mid-flight and its contents should not be trusted.
- `complete` — the recorded counts describe a finished run.

`sync.new_columns` lists headers that appeared since the previous run, as recorded by the sync (which is the only thing that sees both header sets). A renamed column is indistinguishable from a new one, which is the point: a rename can re-admit a column the sync's exclusion list was dropping.

`drift.unresolved` and `drift.missing` are deliberately distinct. Unresolved means a value is present and matches no archetype label — a typo or a rename, and what fails the scheduled sync. Missing means the primary archetype is empty, which is an unassigned new project rather than an error, and carries no `raw_value` because there is nothing to reproduce. Deactivated archetype records count as resolved. Values are compared case- and whitespace-insensitively, but `raw_value` is always the sheet's exact string.

**Cached for 60s.** The project, archetype, contract, and posture records behind this response are held in the API Lambda for up to a minute, so an archetype added or renamed in the admin tab can take that long to clear its drift finding. `sync` is read live on every request. See [Caching](#caching).

---

## Contracts

Contract records mirrored from the "AI Survey (Contracts and Delivery Completes)" tab by `scripts/sync-contracts.mjs`. The survey is authoritative and is the only write surface.

Population is **operator-run, not scheduled** — unlike Projects and Initiatives there is no workflow, and the GitHub deploy role has no access to the table. A refresh is `node scripts/sync-contracts.mjs --env <staging|prod>`, run per environment.

Requires only a session — **not** capability-gated, on the same reasoning as Initiatives: the Contract Explorer exists so any delivery team member can answer "may I use AI on my contract?", and a capability role would be assigned to nobody.

**Read-only.** No create, update, or delete endpoint, and the API Lambda's IAM grant on this table omits write actions.

### `GET /api/contracts`

Everything the Contract Explorer needs in one response — the grid, the detail view, the posture guidance, and the capture date, so none of them can disagree about freshness.

```json
{
  "contracts": [
    {
      "contract_id": "user-facing-ai",
      "portfolio": "LABS",
      "project": "User-Facing AI",
      "contract_num": "47QRAA21D0064",
      "vehicle": "GSA MAS",
      "customer": "Nava Labs",
      "agreement_type": "Task order",
      "ai_posture": "allowed",
      "posture_id": "allowed",
      "project_name": "User-Facing AI",
      "resolved_project": { "project_code": "LB001", "…": "…" }
    }
  ],
  "postures": [ { "id": "allowed", "label": "…", "position": 1 } ],
  "population": { "state": "complete", "captured_at": "…", "row_count": 119 }
}
```

The served fields are a fixed **allowlist** (`CONTRACT_FIELDS` in `functions/api/routes/contracts.mjs`), for the same reason as Initiatives: the population uses a denylist so new survey columns reach the table automatically, and the allowlist is the review step that keeps one from reaching every signed-in user unannounced.

`posture_id` is `null` rather than omitted when unresolved, because the page distinguishes "no posture recorded" from "posture names no record" from a resolved one. 82 of 119 rows carry no posture, which is the survey's state rather than an error.

`resolved_project` is the project a contract's `project_name` matches on either the project's `project_name` **or** its `contract_name` — two fields because the survey's naming follows neither consistently. It is the same nine-field projection Initiatives uses, and for the same reason: contracts are readable by every signed-in user while the projects table is not.

`postures` is served in authored display order, so adding or reordering a posture on the Policy Guidance tab needs no deploy.

`population.state` carries the same three values as Initiatives below.

Returns 503 when the contracts, project-reference, or projects table is unconfigured, and 500 when the read fails — an error rather than an empty list, since the page *is* the contracts.

**Cached for 60s.** The contract, posture, and project records behind this response are held in the API Lambda for up to a minute, so a posture edited on the Policy Guidance tab can take that long to appear. `population` is read live on every request. See [Caching](#caching).

---

## Initiatives

AI initiatives mirrored from the `v2` tab of the AI-initiatives workbook by `scripts/sync-initiatives.mjs`, run from the `sync-initiatives` workflow on manual dispatch. The sheet is authoritative and is the only write surface.

Requires only a session — **not** capability-gated, matching the Contract Explorer and unlike Projects above. The hub exists so any delivery team member can see what AI work is running and where; a capability role would be assigned to nobody.

**Read-only.** There is no create, update, or delete endpoint, and the API Lambda's IAM grant on this table omits write actions, so a write route added later would fail against infrastructure rather than succeed quietly.

### `GET /api/initiatives`

Everything the Initiatives Explorer needs in one response — the grid, the detail view, and the capture date cannot disagree about freshness if they come from the same read.

```json
{
  "initiatives": [
    {
      "initiative_id": "init-2",
      "title": "Benefits navigator prototype",
      "summary": "Prototype for a multi-benefit navigator.",
      "description": "Exploring a navigator for multiple benefit types.",
      "practice": "",
      "exposure": "Client",
      "contacts": "Ada Lovelace; Grace Hopper",
      "link": "Demo: https://example.gov/demo",
      "submitted_by": "Ada Lovelace",
      "timestamp": "Jun 25, 2026, 7:00:00 PM",
      "use_case": "AI-powered benefits assistant",
      "ai_governance": "",
      "tags": "internal",
      "status": "Apr 7–14, 2026",
      "project": "User-Facing AI",
      "resolved_project": {
        "project_code": "LB001",
        "project_index_code": "UFAI",
        "project_name": "User-Facing AI",
        "portfolio": "LABS",
        "agency": "Nava Labs",
        "program_manager": "Nancy Nussear",
        "nava_contract_pp": "Priya Contracts",
        "archetype_primary": "Product Team",
        "archetype_additional": ""
      },
      "first_seen_at": "2026-08-24T12:00:00.000Z",
      "last_synced_at": "2026-08-24T12:00:00.000Z"
    }
  ],
  "population": {
    "state": "complete",
    "captured_at": "2026-08-24T12:00:00.000Z",
    "row_count": 46
  }
}
```

`initiative_id` is the sheet's own `id` column, and doubles as the detail-page URL segment. Values are author-prefixed and not uniform (`init-12`, `ryan-41`) but are distinct, populated on every row, and already slug-safe. **Retitling an initiative is an ordinary update** — the key holds, `first_seen_at` survives, and the URL does not move. This reversed on 2026-08-24, when the key moved off a slug of `title`; that move changed every initiative URL once, with no redirect map, so links made before it return the not-found state.

Attribute names are slugs derived from the sheet headers. Unlike Projects, the served set is a fixed **allowlist** rather than whatever the sheet holds: the sync carries new columns into the table automatically so none is ever silently dropped, so the allowlist here is the review step that keeps a new column from reaching every signed-in user unannounced. A column added to the sheet is invisible to this endpoint until it is added to `INITIATIVE_FIELDS`. `source_location` is currently in that position deliberately: stored, empty on every row, and not served.

`resolved_project` is the project whose `project_name` matches this initiative's `project`, case- and whitespace-insensitively, or `null`. The two sides are spelled differently because the sheet's column is `Project` and the projects table's attribute is `project_name`. It is a nine-field projection rather than the whole project record — initiatives are readable by every signed-in user while the projects table is not, and the full record carries period-of-performance dates and health links this audience has no reason to receive. Resolution happens on read, so correcting a name in the sheet fixes the page on the next load rather than the next sync.

`project` is served even when it resolves, so a client can name the value that failed when it does not. It is the sheet's own string, never the resolved record — the resolved record is always under `resolved_project`. Two distinct non-resolving cases:

- `project` empty — the initiative names no project. Normal, not a defect; 23 of 46 rows as of 2026-08-24, and plenty of initiatives are internal.
- `project` set but matching nothing — real drift, and worth fixing in the sheet. It does **not** fail the sync: the run warns, and the detail page shows the name as the sheet spells it followed by `(Could not find registered project name)`. 4 of 46 rows as of 2026-08-24, all naming one project that appears to have been renamed in the projects table.

**`?id=<initiative_id>`** — optional. The response is unchanged except that the named record additionally carries `related_contracts`: the contracts belonging to its `resolved_project`, each with enough to identify it and a `contract_id` that addresses `/contracts/<contract_id>`.

```json
"related_contracts": [
  {
    "contract_id": "user-facing-ai",
    "project": "User-Facing AI",
    "contract_num": "47QRAA21D0064",
    "vehicle": "GSA MAS",
    "customer": "Nava Labs",
    "agreement_type": "Task order"
  }
]
```

Three things about this are load-bearing:

- **It is detail-only.** The grid renders no contracts, so computing the join for all 37 records would read the whole contracts partition on every hub load for data one record uses. The client knows the id before it fetches, so it asks. A list request never touches the contracts table at all.
- **The field has four states, and none of them collapses into another.**

  | Value | Meaning |
  |---|---|
  | absent | The join was not requested — every record of a list request, and any initiative whose `resolved_project` is `null`. |
  | `null` | Requested, and the read failed. |
  | `[]` | Requested, and no contract on file names this project. |
  | `[…]` | The contracts. |

  A client that conflates `null` with `[]` will report an absence during an outage that nobody established. One that conflates absent with `[]` will claim a project has no contracts when the join was never run.

  Note that a failed contracts read **degrades rather than failing the request**: the response is still 200 and still carries the full initiative, because the contracts are one section of a page whose answer is the initiative. This includes the case where `CONTRACTS_TABLE` is unconfigured, which yields `null` rather than the 503 that a missing initiatives or projects table produces.

  `[]` is **not** evidence that the project has no contract. Only 43 of 119 contracts record a project name at all, so for the other 76 the join has nothing to work with. The two sheets can also spell the same project differently, in which case a contract that exists resolves to nothing — as of 2026-08-11 one contract still does, `HOR AARS`, matching no project record. Five of the 37 initiatives return `[]` today, and all five look genuine. Present the empty result as "no link recorded", not as "no contract exists".
- **The join runs the contracts-side resolution rule**, which matches a project's `project_name` **or** its `contract_name`. The initiatives rule above matches the project's `project_name` alone; using it here would silently drop every contract named the other way, which is a substantial share of the survey. The rule is applied against a list holding only the target project, which asks "does this contract name this project?" rather than "which project does this contract resolve to first?" — the latter mis-assigns contracts whenever one project's `contract_name` collides with another's `project_name`.

The projection is narrower than `/api/contracts` on purpose — these entries are links, not records, and the contract's own page answers the rest. `ai_posture` is deliberately excluded: resolving a posture id to its display label needs the project-reference partition, which this route does not read, and a bare id badge would be worse than none.

`population.state` is one of:

- `never_populated` — no sync has run. Not an error.
- `in_progress` — a run wrote initiatives and then died, so the table is mid-flight and its contents should not be trusted.
- `complete` — `captured_at` and `row_count` describe a finished run.

**Cached for 60s.** The initiative, project, and contract records behind this response are held in the API Lambda for up to a minute. The `?id=` join itself is **not** cached — it is computed per request over those held records, so two ids asked in the same minute each get their own contracts. `population` is read live on every request. See [Caching](#caching).

---

## Caching

Two layers, and which one an endpoint gets is a security decision rather than a performance one.

**CloudFront (edge).** `/api/skills`, `/api/skills/*`, `/api/plugins`, and `/api/plugins/*` are cached at the edge for 300s. Every other `/api/*` path falls through to a `CachingDisabled` behavior. A CloudFront cache **hit is served without invoking the API Lambda**, which means the auth middleware never runs on a hit.

**API Lambda (in-process).** `GET /api/projects`, `GET /api/contracts`, and `GET /api/initiatives` cache their underlying DynamoDB partition reads for 60s in `functions/api/lib/partition-cache.mjs`. The cache is per warm Lambda container, so each holds its own copy with its own expiry.

These three are cached in the Lambda and **not** at the edge, deliberately:

- The cache sits behind the auth middleware and behind each route's own gate, so nothing becomes readable without a session and no response is shared between users.
- `/api/projects` answers 403 or 200 depending on the reader's capability. An edge cache is keyed on the request, not the reader, so it would store whichever response arrived first and serve it to everyone who asked next — leaking project data to an ungated reader, or blocking an authorized one behind a cached 403.
- `/api/contracts` and `/api/initiatives` return the same body to every signed-in user, so they could in principle be shared — but only behind an edge auth check, which the current cached behaviors do not have.

What the cache holds is the *records*; the joins each route performs over them still run per request. Resolve-on-read behavior is therefore preserved, one minute behind. Sync-metadata reads (`sync`, `population`) are deliberately uncached so freshness reporting stays live.

There is no invalidation. A sheet sync or an admin edit to reference data becomes visible when the entry expires.

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
