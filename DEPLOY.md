# Deployment Guide

This app deploys as a static Astro site on AWS (S3 + CloudFront), with a Node.js Lambda handling Google OAuth. All infrastructure is managed by Terraform. GitHub Actions handles ongoing deploys automatically.

---

## Architecture at a glance

```
User → CloudFront (edge auth check) → S3 (static site)
                                    ↘ Lambda (Google OAuth /auth/*)
```

- **CloudFront edge function** — validates JWT session cookie on every request; redirects to `/login` if missing or expired
- **Lambda** — handles `/auth/login` and `/auth/callback`; checks `@navapbc.com` domain; issues 8-hour session cookie
- **S3** — hosts the static Astro build output
- **Terraform** — provisions all AWS resources
- **GitHub Actions** — deploys on push to `main` (staging) or `release` (prod)

---

## Environments

| Branch | Environment | Domain |
|---|---|---|
| `main` | staging | `skills-staging.navapbc.com` |
| `release` | prod | `skills.navapbc.com` |

---

## First-time deploy

Work through these sections in order. Some steps have dependencies on outputs from earlier steps.

---

### 1. Prerequisites

Install locally:
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.7
- [Node.js](https://nodejs.org) >= 20
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

### 3. ACM certificate (manual — one-time per environment)

CloudFront requires SSL certificates to be in `us-east-1`.

```bash
# Request staging cert
aws acm request-certificate \
  --domain-name skills-staging.navapbc.com \
  --validation-method DNS \
  --region us-east-1

# Request prod cert
aws acm request-certificate \
  --domain-name skills.navapbc.com \
  --validation-method DNS \
  --region us-east-1
```

After requesting, AWS will give you CNAME records to add to your DNS for validation. Add them and wait for status to show `ISSUED` before proceeding. Copy the ARN for each cert — you'll need it in step 5.

---

### 4. Google OAuth app (manual — one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create Project (or use existing Nava project)
3. **Create OAuth Client ID** → Web application
4. Name it `Nava Skills Registry`
5. Leave **Authorized Redirect URIs** blank for now — you'll add it after the first Terraform apply (step 6)
6. Copy the **Client ID** and **Client Secret** — you'll need them in step 5

---

### 5. Terraform tfvars (manual)

Create two files from the example — **never commit these**:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.staging.tfvars
cp terraform/terraform.tfvars.example terraform/terraform.prod.tfvars
```

Fill in `terraform.staging.tfvars`:
```hcl
environment          = "staging"
site_domain          = "skills-staging.navapbc.com"
acm_certificate_arn  = "arn:aws:acm:us-east-1:..." # from step 3
google_client_id     = "..."                         # from step 4
google_client_secret = "..."                         # from step 4
jwt_secret           = ""                            # generate below
create_oidc_provider = true                          # creates OIDC once
```

Fill in `terraform.prod.tfvars`:
```hcl
environment          = "prod"
site_domain          = "skills.navapbc.com"
acm_certificate_arn  = "arn:aws:acm:us-east-1:..." # from step 3
google_client_id     = "..."                         # same app, same values
google_client_secret = "..."
jwt_secret           = ""                            # generate separately below
create_oidc_provider = false                         # already created by staging
```

Generate JWT secrets (use a different one per environment):
```bash
openssl rand -hex 32  # run twice — one for staging, one for prod
```

---

### 6. Terraform apply — staging (automated infrastructure)

```bash
cd terraform

# Staging
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
- `github_deploy_role_arn` — needed for GitHub secrets
- `oauth_redirect_uri` — **add this to Google Cloud Console now** (step 7)
- `login_url` — needed for GitHub secrets (`AUTH_LAMBDA_URL`)

---

### 7. Add OAuth redirect URI to Google (manual — after step 6)

1. Go back to your Google OAuth app in Cloud Console
2. Edit the Web application credential
3. Add the `oauth_redirect_uri` output from step 6 to **Authorized Redirect URIs**
4. Do this for both staging and prod outputs (you'll need to run prod apply first in step 8 to get the prod URI)

---

### 8. Terraform apply — prod (automated infrastructure)

```bash
# Switch to prod workspace
terraform init \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=skills-registry/prod.tfstate" \
  -backend-config="region=us-east-1" \
  -reconfigure

terraform apply -var-file=terraform.prod.tfvars
```

Capture the prod outputs the same way. Add the prod `oauth_redirect_uri` to Google Cloud Console.

---

### 9. DNS records (manual — after steps 6 & 8)

Add CNAME records in your DNS provider (or Route 53):

| Name | Type | Value |
|---|---|---|
| `skills-staging.navapbc.com` | CNAME | `<staging cloudfront_domain>` (without `https://`) |
| `skills.navapbc.com` | CNAME | `<prod cloudfront_domain>` |

DNS propagation can take a few minutes to a few hours.

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

This secret lives at the **repository level** (not inside an environment), since the sync workflow doesn't deploy to an environment.

---

### 12. First deploy (automated)

Push to `main` to trigger the staging deploy:

```bash
git push origin main
```

Watch it run in the repo's **Actions** tab. When it completes, visit your staging CloudFront URL (or `skills-staging.navapbc.com` once DNS propagates) and verify:
- The login page loads
- Signing in with a `@navapbc.com` Google account works
- A non-`@navapbc.com` account gets a 403

To deploy to prod, merge or push to `release`:

```bash
git checkout release
git merge main
git push origin release
```

The `production` GitHub environment will require reviewer approval before the deploy runs.

---

## Ongoing — automated

| Trigger | What happens |
|---|---|
| Push to `main` | Build + deploy to staging (no approval needed) |
| Push to `release` | Build + deploy to prod (requires reviewer approval) |
| Every 4 hours | `sync-registry.mjs` scans GitHub org, updates `registry/index.json`, commits to `main`, which triggers staging deploy |
| Manual `workflow_dispatch` | Can trigger either workflow from the Actions tab (sync requires environment approval) |

---

## Secrets reference

### Repository-level secrets (not environment-scoped)
| Secret | Used by | Description |
|---|---|---|
| `REGISTRY_SCAN_TOKEN` | `sync.yml` | GitHub PAT for org-wide repo scanning |

### Environment secrets (staging + production, same names)
| Secret | Used by | Description |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `deploy.yml` | IAM role assumed via OIDC |
| `AWS_S3_BUCKET_NAME` | `deploy.yml` | S3 bucket for site files |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `deploy.yml` | For cache invalidation |
| `AWS_AUTH_LAMBDA_FUNCTION_NAME` | `deploy.yml` | Auth Lambda to update on deploy |
| `AUTH_LAMBDA_URL` | `deploy.yml` | Passed to Astro build as `PUBLIC_LOGIN_URL` |

---

## Troubleshooting

**Login redirects loop** — `AUTH_LAMBDA_URL` secret is missing or wrong. Check the `login_url` Terraform output matches the secret value.

**403 after login** — The `oauth_redirect_uri` isn't registered in Google Cloud Console, or the Lambda URL changed after a re-apply.

**Deploy fails on `configure-aws-credentials`** — The OIDC provider isn't set up, the role ARN is wrong, or the branch/environment mismatch means the role's trust policy rejects the token. Check that `main` deploys to `staging` and `release` deploys to `production`.

**Sync workflow fails** — `REGISTRY_SCAN_TOKEN` is expired or missing `read:org` scope. Regenerate and update the secret.

**CloudFront still serving old content** — Invalidation may have failed. Run manually:
```bash
aws cloudfront create-invalidation \
  --distribution-id <id> \
  --paths "/*"
```
