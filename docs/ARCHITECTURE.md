# Architecture

Nava Skills Hub is a serverless AWS application. The Astro frontend is fully static; all dynamic behavior (auth, skill CRUD, admin) is handled by Lambda functions behind CloudFront.

---

## Overview

```
GitHub Org (navapbc)
  └── any repo with SKILL.md / AGENT.md / .claude/skills/*.md
        │
        ▼  (sync every 4h + weekly Anthropic sync)
     DynamoDB ──────────────────────────────────────────────┐
                                                            │
Browser → CloudFront (edge JWT check)                       │
               │                                            │
               ├─ /auth/*  → Auth Lambda ──> Google OAuth   │
               ├─ /api/*   → API Gateway → API Lambda ──────┘
               └─ /*       → S3 (static Astro build)
```

---

## Infrastructure (`terraform/`)

All AWS resources are Terraform-managed. Two independent state files, one per environment.

| File | What it provisions |
|---|---|
| `main.tf` | Provider config, state backend reference |
| `s3.tf` | Site bucket (private, OAC-only access) |
| `cloudfront.tf` | CloudFront distribution, cache behaviors, CloudFront Function, response headers policy |
| `lambda.tf` | Auth Lambda + API Lambda (placeholder zip; code deployed by CI) |
| `api_gateway.tf` | HTTP API v2, default stage, Lambda integration, catch-all route |
| `dynamodb.tf` | Nine DynamoDB tables (skills, plugins, users, audit-log, analytics-events, project-reference, projects, contracts, initiatives) |
| `iam.tf` | GitHub Actions OIDC provider, deploy role, Lambda execution roles |
| `ssm.tf` | SSM parameters for Google OAuth secrets and JWT secret |
| `outputs.tf` | All values needed for CI secrets and Google Cloud Console |
| `variables.tf` | All configurable inputs |

### Naming convention

All resources: `skills-registry-{resource}-{env}` (e.g. `skills-registry-skills-staging`).

### Environments

Two separate Terraform state files share the same module:

```bash
# Staging
terraform init -backend-config="key=skills-registry/staging.tfstate" ...
terraform apply -var-file=terraform.staging.tfvars

# Prod
terraform init -backend-config="key=skills-registry/prod.tfstate" -reconfigure ...
terraform apply -var-file=terraform.prod.tfvars
```

---

## CloudFront

CloudFront is the sole public entry point — S3 and API Gateway are never exposed directly.

### Route behaviors (in priority order)

| Path | Origin | Cache | Auth check |
|---|---|---|---|
| `/auth/*` | Auth Lambda (via Function URL) | Disabled | None — auth happens here |
| `/api/skills` | API Gateway | 5m TTL (shared) | Forwarded cookie |
| `/api/plugins` | API Gateway | 5m TTL (shared) | Forwarded cookie |
| `/api/skills/*` | API Gateway | 5m GET cache | Forwarded cookie |
| `/api/plugins/*` | API Gateway | 5m GET cache | Forwarded cookie |
| `/api/*` | API Gateway | Disabled | Forwarded cookie |
| `/_astro/*` | S3 | 1yr immutable | CloudFront Function |
| `/*` (default) | S3 | Optimized | CloudFront Function |

### CloudFront Function (edge auth)

Runs on every viewer request for S3-backed behaviors. Validates the `__session` JWT (HS256, same secret as Lambda) without calling any backend. Redirects to `/login` if the token is missing or expired. Lives in `functions/edge/auth-check.js.tpl` — rendered by Terraform with the JWT secret baked in.

Note that it is **not** associated with any `/api/*` behavior. API requests are authenticated by the Lambda's own middleware instead — which a CloudFront cache hit skips, since a hit is served without invoking the Lambda at all. That is the constraint behind the caching split described below.

### Security headers

A CloudFront Response Headers Policy applies to all S3 behaviors:
- `Strict-Transport-Security` (1yr, include subdomains, preload)
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Cross-Origin-Opener-Policy: same-origin`

---

## Auth Lambda (`functions/auth/`)

Handles the Google OAuth flow. Deployed as a Lambda Function URL (public) but accessed through CloudFront `/auth/*` so session cookies land on the hub domain.

### Flow

1. **`GET /auth/login`** — builds Google OAuth URL, redirects browser to Google
2. Google redirects back to **`GET /auth/callback`** with auth code
3. Lambda exchanges code for tokens, validates `@navapbc.com` domain, issues two cookies:
   - `__session` — HttpOnly, Secure, 8-hour HS256 JWT (`sub`, `name`, `picture`, `iat`, `exp`)
   - `__user` — non-HttpOnly, base64 JSON of `{name, email, picture}` for client-side display
4. **`GET /auth/logout`** — clears both cookies, redirects to `/login`

Secrets (Google OAuth, JWT) are read from SSM Parameter Store and cached for the Lambda container lifetime.

---

## API Lambda (`functions/api/`)

Node.js Lambda (Hono router) behind API Gateway HTTP v2. All requests require a valid `__session` cookie.

### Auth middleware

On every request: reads `__session` cookie → verifies HS256 JWT → calls `getOrCreateUser()` (DynamoDB GetItem; writes only on first login) → sets `ctx.user`.

### Read caching, and why it is split across two layers

Two caches, and which one an endpoint uses is a security decision rather than a performance one.

| Endpoint | Cached where | TTL |
|---|---|---|
| `GET /api/skills`, `GET /api/plugins` (and `/*` detail routes) | CloudFront | 300s |
| `GET /api/projects`, `GET /api/contracts`, `GET /api/initiatives` | API Lambda (`lib/partition-cache.mjs`) | 60s |
| everything else | not cached | — |

The project-data reads are the heaviest in the API — four to five DynamoDB operations each, joining whole partitions per request — and they are the ones **not** at the edge. The reason is that a CloudFront hit never invokes the Lambda, so no auth middleware and no route gate runs:

- `GET /api/projects` answers 403 or 200 depending on `manage:project-reference`. An edge cache is keyed on the request, not the reader, so it would store whichever response arrived first and serve it to everyone next — leaking project data to an ungated reader, or holding an authorized one behind a cached 403.
- `GET /api/contracts` and `GET /api/initiatives` return the same body to every signed-in user and so are shareable in principle, but only behind an edge auth check. Attaching `auth_check` to an `/api/*` behavior would first need an `/api/` passthrough in its `rewriteUri`, which currently appends `/index.html` to any extension-less path.

Caching in the Lambda instead keeps every request behind the middleware and the gate. What is held is the **partition reads**, not the responses: the joins each route performs still run per request, which preserves resolve-on-read behavior (one minute behind) and keeps `/api/initiatives?id=` correct per id while sharing the records underneath. Sync-metadata reads stay uncached so freshness reporting is live. The cache is per warm container, holds the in-flight promise so concurrent misses issue one query, and evicts on rejection so a transient fault is not pinned for a minute. There is no invalidation.

### Routes

| Group | Endpoints |
|---|---|
| Skills | `GET/POST /api/skills`, `GET/PUT/DELETE /api/skills/:slug`, `POST /api/skills/:slug/approve`, `POST /api/skills/:slug/reject` |
| Plugins | `GET/POST /api/plugins`, `GET/PUT/DELETE /api/plugins/:slug` |
| Users | `GET /api/users/me`, `GET /api/users`, `PUT /api/users/me/favorites`, `PUT /api/users/me/installed`, `PUT /api/users/:id/role` |
| Audit | `GET /api/audit`, `GET /api/audit/me` |
| Admin | `GET /api/admin/skills` (pending queue), `GET /api/admin/analytics` (content analytics, admin-only) |
| Events | `POST /api/hub-log` (behavioral analytics ingest) |
| Categories | `GET /api/categories` |

### Permission model

Three roles: `user` (default), `maintain`, `admin`.

| Action | user | maintain | admin |
|---|---|---|---|
| Read approved public/internal skills | ✅ | ✅ | ✅ |
| Read own pending/private skills | ✅ | ✅ | ✅ |
| Read all pending skills | ❌ | ✅ | ✅ |
| Create skill (→ pending) | ✅ | ✅ | ✅ (→ approved) |
| Edit own skill | ✅ | ✅ | ✅ |
| Edit any skill | ❌ | ❌ | ✅ |
| Approve / reject | ❌ | ✅ | ✅ |
| Manage plugins | ❌ | ❌ | ✅ |
| Manage users / roles | ❌ | ❌ | ✅ |
| View audit log | own | own | full |

---

## DynamoDB

Nine tables per environment. All use on-demand billing and point-in-time recovery.

The four project-data tables — `project-reference`, `projects`, `contracts`, and
`initiatives` — each carry an **admission rule** as a comment on the resource in
`terraform/dynamodb.tf`, stating which record types may live there and why. They are
separate tables rather than partitions of one another because their audiences and
their write surfaces differ, and the rules are what keep that from eroding. Read them
before adding a record type to any of the four. Only `initiatives` is described below;
the other three are covered by [api.md](api.md).

### `skills-registry-skills-{env}`

Stores skills and agents (differentiated by `type`). Primary key: `slug`.

Key fields: `slug`, `name`, `description`, `type` (skill/agent), `plugin`, `repo`, `path`, `author`, `version`, `compatibility`, `sensitive_data`, `content`, `tags`, `category`, `visibility` (public/internal/private), `status` (pending/approved/rejected), `source` (github/enterprise/anthropic/user-submitted), `created_by`, `created_at`, `updated_at`.

GSIs: `byCreator` (for "my skills"), `byStatus` (for admin approval queue), `byPlugin`.

Category membership is the per-skill `category` attribute, matched at render time
as `s.category === cat.id`. See
[Categories — Data Model](categories-data-model.md) for details.

### `skills-registry-plugins-{env}`

Plugin groupings. Primary key: `slug`.

Key fields: `slug`, `name`, `description`, `repo`, `author`, `skills_count`, `status`, `visibility`, `source`, `created_by`, `created_at`, `updated_at`.

### `skills-registry-users-{env}`

One record per authenticated user. Created on first API call via `getOrCreateUser()`. Primary key: `user_id` (email).

Key fields: `user_id`, `email`, `name`, `avatar_url`, `role`, `favorites` (slug array), `installed` (slug array), `created_at`, `last_seen_at`.

### `skills-registry-audit-log-{env}`

Append-only event log. Primary key: `user_id` + `event_key` (ISO timestamp + UUID).

Key fields: `user_id`, `event_key`, `action`, `resource_type`, `resource_id`, `resource_key` (for GSI), `metadata`.

GSI `byResource`: enables "history of a skill" queries by `resource_key`.

### `skills-registry-analytics-events-{env}`

Append-only behavioral analytics, kept separate from `audit-log` so event volume never pollutes the security trail. Primary key: `user_id` + `event_key` (ISO timestamp + UUID).

Events: `page_view`, `skill_view`, `search_query`, `filter_applied`. Captured client-side and POSTed to `/api/hub-log` (path avoids ad-blocker filter lists); `user_email` and `timestamp` are stamped server-side from the JWT (the client body carries only `event` + `props`). Key fields: `user_id`, `event_key`, `event`, `props`, `user_email`, `timestamp`.

Raw rows expire ~200 days after write via DynamoDB TTL (attribute `ttl`, Unix-epoch seconds), bounding table size while covering the dashboard window. The admin dashboard reads aggregated content metrics (top skills, top searches, filter usage) over a rolling 28-day window via `GET /api/admin/analytics`.

### `skills-registry-initiatives-{env}`

AI initiatives mirrored from the `v2` tab of the AI-initiatives workbook, plus one metadata record describing the last sync run. Primary key: `record_type` + `initiative_id`. The metadata record lives in its own partition so it can never be returned among the initiatives, and each read is a single Query on one partition — no GSI.

Key fields: `initiative_id`, `title`, `summary`, `description`, `practice`, `exposure`, `contacts`, `project`, `link`, `submitted_by`, `timestamp`, `use_case`, `ai_governance`, `tags`, `status`, `source_location`, `first_seen_at`, `last_synced_at`.

Attribute names are slugs of the sheet's own headers, 1:1 with no alias layer, so `Use Case` is `use_case` and `Submitted By` is `submitted_by`. Note that `project` here is the sheet's own string and joins to the projects table's `project_name` — the two sides are spelled differently and `functions/api/lib/initiatives.mjs` is the seam. `source_location` is stored but not served.

**Admission rule:** only records wholly derived from the initiatives workbook and re-creatable by re-running the sync. The GitHub deploy role holds `DeleteItem` here — the same rule and the same reason as `projects`. This is deliberately unlike `contracts`, which CI cannot touch at all because that data is operator-populated; do not extend the CI grant to it on a similarity argument.

**The range key is the sheet's own `id` column.** Values are author-prefixed and not uniform — `init-2` … `init-38` on the rows carried over from the v1 tab, `ryan-39` … `ryan-47` on those added since — but they are distinct, populated on every row, and already slug-safe, so they double as the detail-page URL segment unchanged.

This replaced a `title`-derived key on 2026-08-24, and **retitling an initiative is now an ordinary update**: the key holds, `first_seen_at` survives, and the detail URL does not move. The previous rule was the reverse and was documented in several places, so treat any older note claiming a rename is a delete plus a create as stale.

What the sync's delete ceiling now guards is a **renumbering or re-sort of the id column**. The ids form a gapless 2–47 sequence, which is what a position-generated column looks like, so regenerating them after a sort would re-key every row at an unchanged row count. That presents as a near-total delete and is refused rather than applied.

The move off title-derived keys changed every initiative URL once, and there is no redirect map: links made before it 404. `scripts/purge-initiatives.mjs` exists for that migration — reconciliation alone would have presented it as a delete of everything stored.

Read-only from the API — the sheet is the write surface, and the Lambda's IAM grant omits write actions. Unlike its neighbours the read is **not** capability-gated: any signed-in user can browse the Initiatives Hub.

---

## Sync Workflows

### GitHub org sync (`sync.yml`, every 4h)

Runs `scripts/sync-registry-v2.mjs`. Scans the `navapbc` org via GitHub Code Search for:
- `SKILL.md` at any directory depth
- `.claude/skills/*.md`, `.agents/skills/*.md`, `.opencode/skills/*.md`
- `AGENT.md`, `agents.md`, `agent.md`, `.claude/agents/*.md`, etc.
- `enterprise/*/SKILL.md` in this repo (fetched via Git Trees API, bypasses search indexing delay)

Writes/upserts records to DynamoDB with `source=github` or `source=enterprise`. Uses an unchanged-content guard to skip records that haven't changed (override with `--force`).

### Anthropic built-in skills sync (`sync-anthropic.yml`, Mondays 9am UTC)

Runs `scripts/sync-anthropic-builtin-skills.mjs`. Fetches the Anthropic built-in skills catalog via API and upserts with `source=anthropic`. Runs staging first, then prod (sequential).

---

## Frontend (`src/`)

Static Astro site. Pages client-fetch from `/api/*` at runtime (no SSR). Auth state is read from the `__user` cookie (non-HttpOnly) for display; access control is enforced server-side in the API Lambda.

Build artifacts go to `dist/` and are synced to S3 on deploy. Hashed `_astro/` chunks get 1-year immutable cache headers; HTML and registry files get `no-cache`.

---

## CI/CD (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` | Push to `main` or `release` | Runs tests → builds Astro → syncs to S3 → invalidates CloudFront → deploys auth Lambda → deploys API Lambda |
| `sync.yml` | Cron every 4h + `workflow_dispatch` | Syncs GitHub org skills to DynamoDB |
| `sync-anthropic.yml` | Cron Mondays 9am + `workflow_dispatch` | Syncs Anthropic built-in skills to DynamoDB |
| `sync-projects.yml` | Cron Mondays 8am UTC + `workflow_dispatch` | Mirrors the projects sheet, then fails on unresolved archetype values |
| `sync-initiatives.yml` | `workflow_dispatch` only | Mirrors the initiatives sheet's `v2` tab to staging then prod. A stated `Project` matching no project warns rather than failing — prod runs `needs: sync-staging`, so failing there blocked a correct sheet from shipping. No cron until the workbook's shape proves stable |

All workflows use GitHub OIDC to assume AWS roles — no long-lived credentials stored in secrets.

`main` deploys to staging; `release` deploys to prod. `release` is a fast-forward-only pointer to a known-good `main` commit — see [Branching & release model](DEPLOY.md#branching--release-model).
