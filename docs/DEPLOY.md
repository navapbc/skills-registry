# Deployment Guide

All infrastructure is managed by Terraform (`terraform/`). GitHub Actions handles ongoing deploys automatically on push.

---

## Architecture at a glance

```
Browser → CloudFront (edge JWT check)
               │
               ├─ /auth/*   → Auth Lambda (Google OAuth)
               ├─ /api/*    → API Gateway → API Lambda → DynamoDB
               └─ /*        → S3 (static Astro build)
```

- **CloudFront Function** — validates `__session` JWT on every viewer request; redirects to `/login` if missing or expired
- **Auth Lambda** — handles `/auth/login`, `/auth/callback`, `/auth/logout`; restricts to `@navapbc.com`; issues 8-hour session cookie; proxied through CloudFront `/auth/*` so the cookie lands on the hub domain
- **API Lambda** — Hono router handling all `/api/*` routes (skills, plugins, users, audit); validates same JWT; backed by DynamoDB
- **S3** — hosts the compiled Astro build output
- **DynamoDB** — 4 tables per environment: `skills`, `plugins`, `users`, `audit-log`
- **Terraform** — all AWS resources in `terraform/`
- **GitHub Actions** — deploys on push to `main` (staging) or `release` (prod)

---

## Environments

| Branch | Environment | Domain |
|---|---|---|
| `main` | staging | `staging.hub.navapbc.com` |
| `release` | prod | `hub.navapbc.com` |

---

## First-time deploy

Work through these sections in order. Some steps have dependencies on outputs from earlier steps.

---

### 1. Prerequisites

Install locally:
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.7
- [Node.js](https://nodejs.org) >= 22
- [pnpm](https://pnpm.io/installation) >= 10
- [AWS CLI](https://aws.amazon.com/cli/) configured with admin credentials
- Access to the AWS account where you're deploying

---

### 2. Terraform state bucket (manual — one-time)

Terraform needs an S3 bucket to store state. Create it manually before the first `init`:

```bash
aws s3api create-bucket \
  --bucket navapbc-skills-registry-tf-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket navapbc-skills-registry-tf-state \
  --versioning-configuration Status=Enabled
```

---

### 3. ACM certificate (manual — one-time per environment, can skip for initial demo)

> **Skip this step if you want to demo immediately.** Leave `site_domain` and `acm_certificate_arn` blank in your tfvars and use the CloudFront URL that Terraform outputs. Add the custom domain later by filling in these values and re-running `terraform apply` — no downtime.

CloudFront requires SSL certificates to be in `us-east-1`.

```bash
# Request staging cert
aws acm request-certificate \
  --domain-name staging.hub.navapbc.com \
  --validation-method DNS \
  --region us-east-1

# Request prod cert
aws acm request-certificate \
  --domain-name hub.navapbc.com \
  --validation-method DNS \
  --region us-east-1
```

After requesting, AWS will give you CNAME records to add to your DNS for validation. Add them and wait for status to show `ISSUED` before proceeding. Copy the ARN for each cert — you'll need it in step 5.

---

### 4. Google OAuth app (manual — one-time, shared across both environments)

One OAuth app covers both staging and prod — you'll add both redirect URIs to the same client after Terraform apply.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create Project (or use existing Nava project)
3. **Create OAuth Client ID** → Web application
4. Name it `Nava Skills Hub`
5. Leave **Authorized Redirect URIs** blank for now — you'll add them after Terraform apply (steps 6 & 8)
6. Copy the **Client ID** and **Client Secret** — you'll use the same values in both staging and prod tfvars

---

### 5. Terraform tfvars (manual)

Create two files from the example — **never commit these**:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.staging.tfvars
cp terraform/terraform.tfvars.example terraform/terraform.prod.tfvars
```

Fill in `terraform/terraform.staging.tfvars`:
```hcl
environment          = "staging"
site_domain          = "staging.hub.navapbc.com"
acm_certificate_arn  = "arn:aws:acm:us-east-1:..."  # from step 3
google_client_id     = "..."                          # from step 4
google_client_secret = "..."                          # from step 4
jwt_secret           = ""                             # generate below
create_oidc_provider = true                           # creates OIDC once
site_url             = "https://staging.hub.navapbc.com"
```

Fill in `terraform/terraform.prod.tfvars`:
```hcl
environment          = "prod"
site_domain          = "hub.navapbc.com"
acm_certificate_arn  = "arn:aws:acm:us-east-1:..."  # from step 3
google_client_id     = "..."                          # same app, same values
google_client_secret = "..."
jwt_secret           = ""                             # generate separately below
create_oidc_provider = false                          # already created by staging
site_url             = "https://hub.navapbc.com"
```

Generate JWT secrets (use a different one per environment):
```bash
openssl rand -hex 32  # run twice — one for staging, one for prod
```

---

### 6. Terraform apply — staging

All Terraform commands must be run from the `terraform/` directory:

```bash
cd terraform

terraform init \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=skills-registry/staging.tfstate" \
  -backend-config="region=us-east-1"

terraform apply -var-file=terraform.staging.tfvars
```

After apply succeeds, capture the outputs:
```bash
terraform output
```

You'll get:
- `cloudfront_domain` — your staging site URL (before DNS)
- `cloudfront_distribution_id` — needed for GitHub secrets
- `s3_bucket_name` — needed for GitHub secrets
- `lambda_auth_function_name` — needed for GitHub secrets
- `api_lambda_function_name` — needed for GitHub secrets
- `github_deploy_role_arn` — needed for GitHub secrets
- `oauth_redirect_uri` — **add this to Google Cloud Console now** (step 7)
- `login_url` — needed for GitHub secrets (`AUTH_LAMBDA_URL`)

---

### 7. Add OAuth redirect URI to Google (manual — after step 6)

1. Go back to your Google OAuth app in Cloud Console
2. Edit the Web application credential
3. Add the `oauth_redirect_uri` output (format: `https://{your-domain}/auth/callback`) to **Authorized Redirect URIs**
4. Do this for both staging and prod after running each apply

---

### 8. Terraform apply — prod

From the `terraform/` directory:

```bash
terraform init \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=skills-registry/prod.tfstate" \
  -backend-config="region=us-east-1" \
  -reconfigure

terraform apply -var-file=terraform.prod.tfvars
```

Capture prod outputs the same way. Add the prod `oauth_redirect_uri` to Google Cloud Console.

---

### 9. DNS records (manual — after steps 6 & 8)

Add CNAME records in your DNS provider:

| Name | Type | Value |
|---|---|---|
| `staging.hub.navapbc.com` | CNAME | `<staging cloudfront_domain>` (without `https://`) |
| `hub.navapbc.com` | CNAME | `<prod cloudfront_domain>` |

---

### 10. GitHub environments & secrets (manual)

In the GitHub repo → **Settings → Environments**, create two environments:

**`staging`** (no required reviewers):

| Secret name | Value (from step 6 terraform output) |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `github_deploy_role_arn` |
| `AWS_S3_BUCKET_NAME` | `s3_bucket_name` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id` |
| `AWS_AUTH_LAMBDA_FUNCTION_NAME` | `lambda_auth_function_name` |
| `AWS_API_LAMBDA_FUNCTION_NAME` | `api_lambda_function_name` |
| `AUTH_LAMBDA_URL` | `login_url` |

**`production`** (add required reviewers — recommended: yourself + one other):

Same secret names, but prod values from step 8 outputs.

---

### 11. Registry sync token (manual)

The sync workflow needs a GitHub PAT to scan the `navapbc` org for SKILL.md files.

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
2. Create a token with:
   - **Resource owner**: `navapbc`
   - **Repository access**: All repositories (read-only)
   - **Permissions**: `Contents: Read`, `Metadata: Read`
3. In the GitHub repo → Settings → Secrets → Actions, add:
   - `REGISTRY_SCAN_TOKEN` = your token

This secret lives at the **repository level** (not inside an environment).

---

### 12. Anthropic built-in skills sync token (manual)

The weekly Anthropic sync needs an API key:

1. Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
2. In the GitHub repo → Settings → Secrets → Actions, add:
   - `ANTHROPIC_API_KEY` = your key

---

### 13. First deploy

Push to `main` to trigger the staging deploy:

```bash
git push origin main
```

Watch it run in the repo's **Actions** tab. When it completes, verify:
- The login page loads
- Signing in with a `@navapbc.com` Google account works
- A non-`@navapbc.com` account gets a 403

To deploy to prod, merge into `release`:

```bash
git checkout release
git merge main
git push origin release
```

The `production` GitHub environment requires reviewer approval before the deploy runs.

---

### 14. Promote first admin (manual — after first deploy)

The first admin must be set directly in DynamoDB. Log in first to create your user record, then:

```bash
aws dynamodb update-item \
  --table-name skills-registry-users-staging \
  --key '{"user_id":{"S":"your@navapbc.com"}}' \
  --update-expression "SET #r = :r" \
  --expression-attribute-names '{"#r":"role"}' \
  --expression-attribute-values '{":r":{"S":"admin"}}' \
  --region us-east-1
```

Repeat with `skills-registry-users-prod` for production. Subsequent promotions go through the admin UI.

---

## Ongoing — automated

| Trigger | What happens |
|---|---|
| Push to `main` | Build + deploy to staging (no approval needed) |
| Push to `release` | Build + deploy to prod (requires reviewer approval) |
| Every 4 hours | `sync.yml` scans GitHub org for SKILL.md/AGENT.md + `enterprise/` folder, writes records to DynamoDB |
| Mondays 9am UTC | `sync-anthropic.yml` fetches Anthropic built-in skills via API, writes to DynamoDB |
| Manual `workflow_dispatch` | Can trigger either workflow from the Actions tab |

---

## Secrets reference

### Repository-level secrets (not environment-scoped)

| Secret | Used by | Description |
|---|---|---|
| `REGISTRY_SCAN_TOKEN` | `sync.yml` | GitHub PAT for org-wide repo scanning |
| `ANTHROPIC_API_KEY` | `sync-anthropic.yml` | Anthropic API key for built-in skills sync |

### Environment secrets (staging + production, same names)

| Secret | Used by | Description |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `deploy.yml` | IAM role assumed via OIDC |
| `AWS_S3_BUCKET_NAME` | `deploy.yml` | S3 bucket for site files |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `deploy.yml` | For cache invalidation |
| `AWS_AUTH_LAMBDA_FUNCTION_NAME` | `deploy.yml` | Auth Lambda to update on deploy |
| `AWS_API_LAMBDA_FUNCTION_NAME` | `deploy.yml` | API Lambda to update on deploy |
| `AUTH_LAMBDA_URL` | `deploy.yml` | Passed to Astro build as `PUBLIC_LOGIN_URL` |

---

## Troubleshooting

**Login redirects loop** — `AUTH_LAMBDA_URL` secret is missing or wrong. Check the `login_url` Terraform output matches the secret value.

**403 after login** — The `oauth_redirect_uri` isn't registered in Google Cloud Console. The redirect URI is `https://{your-domain}/auth/callback` — it goes through CloudFront, not the Lambda Function URL directly.

**Deploy fails on `configure-aws-credentials`** — The OIDC provider isn't set up, the role ARN is wrong, or the branch/environment mismatch means the role's trust policy rejects the token. Check that `main` deploys to `staging` and `release` deploys to `production`.

**Sync workflow fails** — `REGISTRY_SCAN_TOKEN` is expired or missing required permissions. Regenerate with `Contents: Read` and `Metadata: Read`.

**`/api/*` returns 500** — Check Lambda logs in CloudWatch. Common cause: DynamoDB IAM permissions missing (run `terraform apply` to sync IAM changes).

**CloudFront still serving old content** — Invalidation may have failed. Run manually:
```bash
aws cloudfront create-invalidation \
  --distribution-id <id> \
  --paths "/*"
```
