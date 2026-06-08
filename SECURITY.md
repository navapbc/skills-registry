# Security

This document describes how the Nava Skills Hub is secured. For vulnerability reporting, contact the Nava engineering team via internal channels.

---

## Access control

The site is restricted to `@navapbc.com` Google accounts. All access paths go through CloudFront — S3 and API Gateway are never exposed directly.

### Authentication flow

1. Users authenticate via **Google OAuth** at `/auth/login`
2. The Auth Lambda validates the Google ID token and enforces the `@navapbc.com` email domain
3. A signed **HS256 JWT** is issued as an `__session` cookie (HttpOnly, Secure, SameSite=Lax, 8-hour expiry)
4. A non-auth `__user` cookie carries display-only info (name, email, picture) for client-side rendering — it carries no access control weight

### Session validation — two layers

Sessions are validated at two independent points on every request:

1. **CloudFront Function (edge)** — validates the JWT signature and expiry before any request reaches S3. Runs in CloudFront's edge PoP, not a Lambda. Unauthenticated requests are redirected to `/login` before any content is served.

2. **API Lambda middleware** — independently validates the JWT on every `/api/*` request. The API Lambda does not trust CloudFront to have pre-validated the session.

The JWT secret is stored in **AWS SSM Parameter Store** (SecureString) and read at Lambda startup. It is never hardcoded or committed to git.

---

## Role-based access control (RBAC)

Three roles: `user` (default) → `maintain` → `admin`.

| Capability | user | maintain | admin |
|---|---|---|---|
| Browse approved public/internal skills | ✅ | ✅ | ✅ |
| Browse own pending/private skills | ✅ | ✅ | ✅ |
| Browse all pending skills | ❌ | ✅ | ✅ |
| Submit a skill (lands as pending) | ✅ | ✅ | ✅ |
| Approve/reject skills | ❌ | ✅ | ✅ |
| Edit any skill | ❌ | ✅ | ✅ |
| Manage plugins and categories | ❌ | ✅ | ✅ |
| Delete skills/plugins | ❌ | ❌ | ✅ |
| Manage user roles | ❌ | ❌ | ✅ |
| View full audit log | ❌ | ❌ | ✅ |

Roles are stored in DynamoDB. The first admin must be promoted via AWS CLI. All subsequent role changes are performed through the admin UI and written to the audit log.

---

## Infrastructure security

### Network

- **No public S3** — S3 is blocked from all public access. CloudFront uses Origin Access Control (SigV4-signed requests) to fetch from S3.
- **No public API Gateway** — API Gateway is accessible only from CloudFront via its endpoint URL. There is no public Lambda Function URL for the API Lambda.
- **Auth Lambda Function URL** — the Auth Lambda has a public Function URL (required for OAuth), but it is proxied through CloudFront `/auth/*` for all normal usage. The Function URL itself is not registered as the OAuth redirect URI; the CloudFront domain is.

### Transport

- HTTPS only. CloudFront redirects all HTTP to HTTPS.
- TLS 1.2 minimum (`TLSv1.2_2021` policy).
- HSTS header: `max-age=31536000; includeSubDomains; preload`.

### Response headers (CloudFront Response Headers Policy)

Applied to all S3-backed responses:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

### Secrets management

| Secret | Storage |
|---|---|
| Google OAuth client ID | SSM Parameter Store (SecureString) |
| Google OAuth client secret | SSM Parameter Store (SecureString) |
| JWT signing secret | SSM Parameter Store (SecureString) |
| GitHub Actions AWS role | OIDC (no stored credentials) |
| GitHub PAT (registry scan) | GitHub Actions secret |
| Anthropic API key | GitHub Actions secret |

Terraform variable files (`terraform.*.tfvars`) contain secrets and are **git-ignored**. They are never committed.

---

## GitHub Actions / CI security

- **OIDC authentication** — GitHub Actions assumes AWS IAM roles via OIDC web identity federation. No long-lived AWS access keys are stored in secrets.
- **Scoped IAM roles** — the deploy role has least-privilege permissions: S3 sync, CloudFront invalidation, Lambda code updates, and DynamoDB write for the sync scripts. It cannot modify IAM, SSM, or other infrastructure.
- **Environment protection** — the `production` GitHub environment requires human reviewer approval before deploys run.
- **Sync token** — the GitHub PAT used for org scanning has read-only `Contents` and `Metadata` permissions only.

---

## Data and privacy

- **No PII beyond what Google provides** — user records store Google account email, display name, and avatar URL. No passwords are stored.
- **No session state in database** — JWT sessions are stateless. There is no server-side session table.
- **Audit log** — all create/update/delete/approve/reject/role-change events are written to an append-only DynamoDB table (`skills-registry-audit-log-{env}`). This is used for accountability, not surveillance.
- **Deletion protection** — the `users` and `audit-log` DynamoDB tables in production have `deletion_protection_enabled = true`.

---

## Skill content security

- Skills sourced from GitHub (`source=github`, `source=enterprise`) are synced automatically. They are displayed as-is — skill content is Markdown rendered in the browser.
- User-submitted skills (`source=user-submitted`) land with `status=pending` and are not visible to other users until a maintainer or admin approves them.
- Anthropic built-in skills (`source=anthropic-builtin`) are read-only and cannot be edited via the API.

---

## Known limitations

- `'unsafe-inline'` is required in the CSP for Astro's inline scripts and Tailwind inline styles. This prevents enforcement of script injection via CSP for inline content.
- The Auth Lambda Function URL is publicly accessible (required by AWS for OAuth callbacks). It is not the registered OAuth redirect URI, but it does respond to direct requests.
