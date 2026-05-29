# Data Store Design: Skills Hub Backend

**Date:** 2026-05-29  
**Status:** Approved  
**Scope:** Database, API layer, permission model, and migration plan for moving skills/agents/plugins from a static GitHub-synced JSON file to a DynamoDB-backed API.

---

## Problem

The skills registry currently sources all content from a flat JSON file (`public/registry/index.json`) synced from GitHub every 4 hours. This means:

- Non-technical contributors cannot add or manage skills without a GitHub account and a PR workflow.
- There is no visibility control (everything is public to all authenticated users).
- There is no admin approval workflow for new skills.
- There is no record of who created or modified what.

---

## Goals

1. Replace the GitHub-synced JSON with a DynamoDB-backed API.
2. Enable authenticated navapbc.com users to create, read, update, and delete skills/agents/plugins via a UI (no GitHub required).
3. Support visibility controls: `public` (all authenticated users), `internal` (TBD team scope), `private` (creator only).
4. Track user actions in an audit log.
5. Provide an admin approval queue so that user-submitted skills require approval before appearing publicly.
6. Design for future entity types (MCP servers, templates).

**Out of scope for this phase:** Frontend forms/UI for CRUD, admin panel UI, MCP server entity, learning/templates sections.

---

## Architecture

### Stack

- **Database:** AWS DynamoDB (4 tables per environment)
- **API:** Single AWS Lambda function (Node.js, Hono router) behind AWS API Gateway (HTTP API v2)
- **Routing:** CloudFront adds `/api/*` origin behavior pointing at API Gateway (same pattern as existing `/auth/*` → Lambda URL)
- **Auth:** JWT from cookie — same secret as auth Lambda; validated in API Lambda middleware, not at API Gateway
- **Infrastructure:** Terraform-managed, follows existing `{project}-{resource}-{env}` naming convention

---

## DynamoDB Tables

All tables use provisioned-on-demand billing and live under the naming pattern `skills-registry-{table}-{env}`.

### `skills-registry-skills-{env}`

Stores both skill and agent records (differentiated by the `type` field).

| Attribute | Type | Notes |
|---|---|---|
| `slug` | String (PK) | Unique identifier, URL-safe |
| `name` | String | Display name |
| `description` | String | |
| `plugin` | String | Parent plugin slug |
| `repo` | String | GitHub repo (`org/repo`) |
| `path` | String | Path to SKILL.md within repo |
| `author` | String | Original author |
| `version` | String | |
| `compatibility` | List | e.g. `["claude-code"]` |
| `sensitive_data` | Boolean | |
| `type` | String | `skill` or `agent` |
| `content` | String | Raw SKILL.md content |
| `tools_used` | List | Agent-only: composed skill slugs |
| `human_in_loop` | String | Agent-only |
| `last_updated` | String | ISO 8601 |
| `visibility` | String | `public \| internal \| private` |
| `status` | String | `pending \| approved \| rejected` |
| `source` | String | `github \| user-submitted` |
| `created_by` | String | user_id |
| `created_at` | String | ISO 8601 |
| `updated_at` | String | ISO 8601 |
| `rejection_reason` | String | Optional, set on reject |

**Global Secondary Indexes:**

| GSI Name | PK | SK | Purpose |
|---|---|---|---|
| `byCreator` | `created_by` | `created_at` | "My skills" listing |
| `byStatus` | `status` | `created_at` | Admin approval queue |
| `byPlugin` | `plugin` | `slug` | Skills within a plugin |

### `skills-registry-plugins-{env}`

| Attribute | Type | Notes |
|---|---|---|
| `slug` | String (PK) | |
| `name` | String | |
| `description` | String | |
| `repo` | String | |
| `author` | String | |
| `skills_count` | Number | Denormalized for display |
| `visibility` | String | `public \| internal \| private` |
| `status` | String | `pending \| approved \| rejected` |
| `source` | String | `github \| user-submitted` |
| `created_by` | String | |
| `created_at` | String | |
| `updated_at` | String | |

### `skills-registry-users-{env}`

One record per authenticated user, upserted on first `/api/users/me` call.

| Attribute | Type | Notes |
|---|---|---|
| `user_id` | String (PK) | Google OAuth `sub` claim |
| `email` | String | |
| `name` | String | |
| `avatar_url` | String | |
| `role` | String | `user \| admin` |
| `created_at` | String | |
| `last_seen_at` | String | |

**Admin promotion:** First admin must be set directly in DynamoDB. Subsequent promotions go through the admin UI (`PUT /api/users/:id/role`). Cannot demote the last admin.

### `skills-registry-audit-{env}`

Append-only event log.

| Attribute | Type | Notes |
|---|---|---|
| `user_id` | String (PK) | |
| `event_key` | String (SK) | `{ISO timestamp}#{uuid}` |
| `action` | String | `created \| updated \| deleted \| approved \| rejected \| copied` |
| `resource_type` | String | `skill \| agent \| plugin \| user` |
| `resource_id` | String | slug or user_id |
| `metadata` | Map | Action-specific detail |

**GSI `byResource`:** PK=`{resource_type}#{resource_id}`, SK=`event_key` — enables "history of a skill" queries.

---

## API Layer

### API Gateway

- Type: HTTP API v2 (cheaper and simpler than REST v1)
- Single integration: all routes forward to the API Lambda
- CORS: `Allow-Origin: https://hub.navapbc.com, https://staging.hub.navapbc.com`
- Throttle: 1,000 req/s steady, 5,000 burst (well above actual need)
- No auth at Gateway level — Lambda handles it

### API Lambda

- Runtime: Node.js 20.x
- Router: Hono (lightweight, TypeScript-native)
- JWT middleware: validates cookie on every request; populates `ctx.user` (`user_id`, `email`, `role`)
- Same JWT secret as auth Lambda (read from SSM Parameter Store)
- DynamoDB client: AWS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`)

### Endpoints

#### Skills & Agents (`/api/skills`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/skills` | user | Query params: `type`, `plugin`, `status` (admin only for non-approved), `visibility` |
| GET | `/api/skills/:slug` | user | Returns 404 if not visible to requester |
| POST | `/api/skills` | user | `status` forced to `pending` for users, `approved` for admins |
| PUT | `/api/skills/:slug` | owner or admin | Status resets to `pending` if non-admin edits an approved skill |
| DELETE | `/api/skills/:slug` | owner or admin | |
| POST | `/api/skills/:slug/approve` | admin | Optionally set `visibility` |
| POST | `/api/skills/:slug/reject` | admin | Body: `{ reason: string }` |

#### Plugins (`/api/plugins`)

| Method | Path | Auth |
|---|---|---|
| GET | `/api/plugins` | user |
| GET | `/api/plugins/:slug` | user |
| POST | `/api/plugins` | admin |
| PUT | `/api/plugins/:slug` | admin |
| DELETE | `/api/plugins/:slug` | admin |

#### Users (`/api/users`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/users/me` | user | Upserts user record; updates `last_seen_at` |
| GET | `/api/users` | admin | |
| PUT | `/api/users/:id/role` | admin | Cannot demote last admin |

#### Audit (`/api/audit`)

| Method | Path | Auth |
|---|---|---|
| GET | `/api/audit` | admin |
| GET | `/api/audit/me` | user |

### Permission Model

| Action | `user` role | `admin` role |
|---|---|---|
| View approved + public/internal skills | ✅ | ✅ |
| View own pending/rejected skills | ✅ | ✅ |
| View all pending/rejected skills | ❌ | ✅ |
| View own private skills | ✅ | ✅ |
| Create skill (→ pending) | ✅ | ✅ (→ approved) |
| Edit own skill | ✅ | ✅ |
| Edit any skill | ❌ | ✅ |
| Delete own skill | ✅ | ✅ |
| Delete any skill | ❌ | ✅ |
| Approve / reject skills | ❌ | ✅ |
| Manage plugins | ❌ | ✅ |
| Manage users / roles | ❌ | ✅ |
| View audit log | own only | full |

---

## CloudFront Routing Change

Add a new cache behavior in CloudFront:

```
Path pattern:  /api/*
Origin:        API Gateway endpoint URL
Cache policy:  CachingDisabled
TTL:           0
Forward:       All headers (including Cookie for JWT)
```

This follows the same pattern as the existing `/auth/*` → Lambda URL behavior.

---

## Migration Plan

A one-time migration script (`scripts/migrate-to-dynamodb.mjs`) reads `public/registry/index.json` and writes each record to DynamoDB:

- All existing skills/agents: `source=github, status=approved, visibility=public, created_by=system`
- All existing plugins: same
- After import is verified (skill count matches, spot-check 5 slugs): disable the GitHub sync workflow by removing the `schedule` trigger from `.github/workflows/sync-registry.yml`
- Keep `public/registry/index.json` in place temporarily as a fallback read during Astro build transition

Migration can be run with:
```bash
node scripts/migrate-to-dynamodb.mjs --env staging   # test first
node scripts/migrate-to-dynamodb.mjs --env prod
```

---

## Future Extension Points

The schema and API are designed to accommodate additional entity types without structural changes:

- **MCP Servers** — new DynamoDB table `skills-registry-mcp-servers-{env}` with same base fields (slug, name, description, visibility, status, created_by, etc.) plus MCP-specific fields (server_url, auth_type, tools[]). New `/api/mcp-servers` endpoint group.
- **Templates** — similar table + endpoints for golden-path Backstage-style templates.

These are placeholders only. No Terraform resources will be created for them in this phase.

---

## What This Phase Does NOT Include

- Frontend forms for creating/editing skills (follow-on phase)
- Admin panel UI (follow-on phase)
- The automation request board (separate spec: `2026-05-29-hub-expansion-design.md`)
- MCP server entity implementation
- Astro SSR migration (site stays static during this phase; dynamic pages client-fetch from `/api/*`)
