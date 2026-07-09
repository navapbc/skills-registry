# Nava Skills Hub

A skills marketplace for the navapbc org — scans `SKILL.md`, `AGENT.md`, and `.claude/skills/*.md` files across all repos and surfaces them in a searchable, authenticated UI.

**Stack:** Astro (static frontend) · AWS S3 + CloudFront · API Gateway · Lambda (Auth + API) · DynamoDB · GitHub Actions · Terraform · pnpm

**Live environments:**
- Staging: https://staging.hub.navapbc.com (deploys from `main`)
- Prod: https://hub.navapbc.com (deploys from `release`)

---

## Architecture

```
GitHub Org (navapbc)
  └── any repo with SKILL.md / AGENT.md / .claude/skills/*.md
        │
        ▼  (sync-registry workflow, every 4h)
     DynamoDB (skills-registry-skills-{env})
        │
        ▼
Browser → CloudFront (edge JWT check)
               │
               ├─ /auth/*   → Auth Lambda (Google OAuth, issues __session cookie)
               ├─ /api/*    → API Gateway → API Lambda → DynamoDB
               └─ /*        → S3 (static Astro build)
```

- **CloudFront Function** runs on every viewer request and validates the `__session` JWT. Unauthenticated requests are redirected to `/login`.
- **Auth Lambda** handles `/auth/login`, `/auth/callback`, and `/auth/logout`. Restricts to `@navapbc.com` accounts. Issues an 8-hour JWT cookie. Proxied through CloudFront so the cookie lands on the hub domain.
- **API Lambda** (Hono router) handles all `/api/*` routes — CRUD for skills, plugins, users, and audit log. Validates the same JWT on every request.
- **S3** hosts the compiled Astro build output.
- No containers, no servers.

---

## Database (DynamoDB)

Four tables per environment (`skills-registry-{table}-{env}`):

| Table | What's stored |
|---|---|
| `skills` | All skill and agent records — from GitHub repos, the `enterprise/` folder in this repo, Anthropic built-ins, and user-submitted. Fields: `slug`, `name`, `description`, `type` (skill/agent), `plugin`, `repo`, `path`, `author`, `compatibility`, `source`, `status` (pending/approved/rejected), `visibility`, `content`, `tags`, `category`, `created_by`, `created_at`, `updated_at`. |
| `plugins` | Plugin groupings (e.g. a tool namespace containing multiple skills). Fields: `slug`, `name`, `description`, `repo`, `author`, `skills_count`, `status`, `visibility`. |
| `users` | One record per authenticated user, created on first API call. Fields: `user_id` (email), `role` (user/maintain/admin), `name`, `avatar_url`, `favorites` (skill slugs), `installed`, `created_at`, `last_seen_at`. |
| `audit-log` | Append-only log of create/update/delete/approve/reject/role-change events. Fields: `user_id`, `event_key` (ISO timestamp + UUID), `action`, `resource_type`, `resource_id`, `metadata`. |

**Not stored in DynamoDB:** JWT session state (stateless signed cookies), Google OAuth tokens (discarded after callback), raw GitHub file content beyond what's in the `content` field.

**Admin promotion:** The first admin must be set directly via DynamoDB CLI. Subsequent role changes go through the admin UI (`PUT /api/users/:id/role`).

```bash
aws dynamodb update-item \
  --table-name skills-registry-users-staging \
  --key '{"user_id":{"S":"your@navapbc.com"}}' \
  --update-expression "SET #r = :r" \
  --expression-attribute-names '{"#r":"role"}' \
  --expression-attribute-values '{":r":{"S":"admin"}}' \
  --region us-east-1
```

---

## Prerequisites

- AWS account with permissions to create S3, CloudFront, Lambda, API Gateway, DynamoDB, SSM, IAM
- Terraform >= 1.7
- Node.js >= 22
- pnpm >= 10
- A Google Cloud project with OAuth 2.0 credentials configured

See [docs/DEPLOY.md](docs/DEPLOY.md) for complete first-time setup instructions. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full technical deep-dive. See [docs/api.md](docs/api.md) for the API reference ([OpenAPI spec](docs/openapi.yaml)) and [SECURITY.md](SECURITY.md) for the security model.

---

## Deploying

Deploys are triggered automatically by CI:

| Branch | Environment | Domain |
|---|---|---|
| `main` | staging | `staging.hub.navapbc.com` |
| `release` | prod | `hub.navapbc.com` |

Each deploy: runs tests → builds Astro site → syncs to S3 → invalidates CloudFront → deploys auth Lambda → deploys API Lambda.

To deploy to prod:
```bash
git checkout release
git merge main
git push origin release
```

The `production` GitHub environment requires reviewer approval before the deploy runs.

---

## GitHub Actions secrets

Two GitHub environments (`staging`, `production`) each need:

| Secret | Source |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_deploy_role_arn` |
| `AWS_S3_BUCKET_NAME` | `terraform output s3_bucket_name` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `terraform output cloudfront_distribution_id` |
| `AWS_AUTH_LAMBDA_FUNCTION_NAME` | `terraform output lambda_auth_function_name` |
| `AWS_API_LAMBDA_FUNCTION_NAME` | `terraform output api_lambda_function_name` |
| `AUTH_LAMBDA_URL` | `terraform output login_url` (used as `PUBLIC_LOGIN_URL` in Astro build) |

Repository-level (not environment-scoped):

| Secret | Purpose |
|---|---|
| `REGISTRY_SCAN_TOKEN` | Fine-grained PAT with `Contents: Read` + `Metadata: Read` on navapbc repos |
| `ANTHROPIC_API_KEY` | Used by the weekly Anthropic built-in skills sync |

---

## IAM Role for GitHub Actions (OIDC)

Create an IAM role trusted by GitHub Actions OIDC with a policy allowing:
- `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject`, `s3:ListBucket` on the site bucket
- `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation`, `cloudfront:ListInvalidations`
- `lambda:UpdateFunctionCode`, `lambda:GetFunction`, `lambda:GetFunctionConfiguration` on both auth and API Lambdas
- `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem` on the skills and plugins tables (for sync scripts)

See [AWS docs on GitHub OIDC](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html). Terraform provisions this automatically via `terraform/iam.tf`.

---

## Scheduled workflows

| Schedule | Workflow | What it does |
|---|---|---|
| Every 4 hours | `sync.yml` | Scans GitHub org for SKILL.md/AGENT.md files + `enterprise/` folder, writes to DynamoDB |
| Mondays 9am UTC | `sync-anthropic.yml` | Fetches Anthropic built-in skills via API, writes to DynamoDB |

Trigger either manually from the Actions tab (`workflow_dispatch`). The sync workflow defaults to staging; select `production` for prod.

---

## Adding skills to a repo

Add a `SKILL.md` at the root of any navapbc repo (or in `.claude/skills/`, `.agents/skills/`, etc.). Most frontmatter fields are optional — the pipeline derives what it can from the file path, repo metadata, and the first line of the body. At minimum, just `name` and `description` get a useful record:

```yaml
---
name: plain-language
description: When the user wants to rewrite government or technical content in plain language for a general audience.
author: your-github-handle
version: 1.0.0
compatibility: [claude-chat, claude-cowork, claude-code]
sensitive_data: false
category: writing
tags: [plain-language, writing, accessibility]
---

Your skill content here...
```

For agents, add `agents/my-agent/AGENT.md` with the additional agent fields:

```yaml
---
name: snap-eligibility-agent
description: When the user wants to run a full SNAP eligibility review.
author: your-github-handle
version: 1.0.0
compatibility: [claude-code]
sensitive_data: true
type: agent
tools_used: [skill-one, skill-two]
human_in_loop: Describe where human review happens before outputs are used
---
```

See [`registry/schema.md`](registry/schema.md) for the complete frontmatter field reference — required vs. optional, defaults, agent-only fields, and submission metadata fields.

Enterprise-only skills (not sourced from a public GitHub repo) go in `enterprise/<slug>/SKILL.md` in this repository. They're synced directly via the Git Trees API, bypassing GitHub's search indexing delay.

The sync runs every 4 hours. Trigger it manually from the Actions tab for immediate pickup.

---

## Local Development

> **Always branch from `main`.** `main` is the single source of truth; `release` only ever fast-forwards from it (see [Branching & release model](docs/DEPLOY.md#branching--release-model)). Cutting a feature branch from `release` pulls in prod-only merge history and makes the eventual PR diff wrong.

```bash
git checkout main && git pull      # start from an up-to-date main
git checkout -b feat/my-change     # then branch

pnpm install
pnpm dev          # Astro dev server at http://localhost:4321
pnpm sync:v2      # Sync GitHub org skills into DynamoDB (requires AWS + GITHUB_TOKEN)
pnpm test         # Run vitest test suite
```

The dev server doesn't enforce auth — CloudFront auth only runs in AWS. API calls from the local dev server will fail unless you have a valid `__session` cookie or run against a deployed environment.

---

## Styles

The site uses Tailwind CSS v4 (via `@tailwindcss/vite`). Global styles are in `public/styles/main.css`. See `src/layouts/Base.astro` for class naming conventions.
