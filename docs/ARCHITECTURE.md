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
| `dynamodb.tf` | Five DynamoDB tables (skills, plugins, users, audit-log, analytics-events) |
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

Five tables per environment. All use on-demand billing and point-in-time recovery.

### `skills-registry-skills-{env}`

Stores skills and agents (differentiated by `type`). Primary key: `slug`.

Key fields: `slug`, `name`, `description`, `type` (skill/agent), `plugin`, `repo`, `path`, `author`, `version`, `compatibility`, `sensitive_data`, `content`, `tags`, `category`, `visibility` (public/internal/private), `status` (pending/approved/rejected), `source` (github/enterprise/anthropic/user-submitted), `created_by`, `created_at`, `updated_at`.

GSIs: `byCreator` (for "my skills"), `byStatus` (for admin approval queue), `byPlugin`.

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

All workflows use GitHub OIDC to assume AWS roles — no long-lived credentials stored in secrets.

`main` deploys to staging; `release` deploys to prod. `release` is a fast-forward-only pointer to a known-good `main` commit — see [Branching & release model](DEPLOY.md#branching--release-model).
