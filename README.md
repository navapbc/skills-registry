# Nava Skills Registry

A skills marketplace for the navapbc org — browses `SKILL.md`, `AGENT.md`, and `agents/*` across all repos and surfaces them in a searchable UI.

**Stack:** Astro (static) · AWS S3 + CloudFront · Lambda (Google OAuth) · GitHub Actions · Terraform

---

## Architecture

```
GitHub Org (navapbc)
  └── any repo with SKILL.md / agents/*/AGENT.md
        │
        ▼  (sync-registry workflow, every 6h)
skills-registry repo
  └── registry/index.json  ──── S3 ──── CloudFront (edge auth) ──── Browser
                                              │
                               Lambda Function URL (Google OAuth)
```

- **CloudFront** is the only public endpoint — S3 is never exposed directly
- A **CloudFront Function** runs on every viewer request and validates the `__session` JWT before serving anything. Unauthenticated users hit `/login`.
- A **Lambda Function URL** handles the Google OAuth flow and issues the signed JWT cookie
- No containers, no servers

---

## Prerequisites

- AWS account with permissions to create S3, CloudFront, Lambda, SSM, IAM
- Terraform >= 1.7
- Node.js >= 20
- A Google Cloud project with OAuth 2.0 credentials configured

---

## First-time Setup

### 1. Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Leave Authorized Redirect URIs blank for now — you'll add the Lambda URL after Terraform runs
4. Copy the client ID and secret

### 2. AWS Bootstrap (Terraform state bucket)

Create an S3 bucket for Terraform state before the first apply:

```bash
aws s3 mb s3://navapbc-terraform-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket navapbc-terraform-state \
  --versioning-configuration Status=Enabled
```

### 3. Configure Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init \
  -backend-config="bucket=navapbc-terraform-state" \
  -backend-config="key=skills-registry/terraform.tfstate" \
  -backend-config="region=us-east-1"

terraform plan
terraform apply
```

After apply, note the outputs:
```
cloudfront_domain     = "https://d1234abcd.cloudfront.net"
oauth_redirect_uri    = "https://xxxx.lambda-url.us-east-1.on.aws/auth/callback"
login_url             = "https://xxxx.lambda-url.us-east-1.on.aws/auth/login"
```

### 4. Register OAuth Redirect URI

In Google Cloud Console, add the `oauth_redirect_uri` output value to your OAuth client's **Authorized Redirect URIs**.

### 5. Set up GitHub Actions secrets

In the skills-registry repo Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN with S3/CloudFront/Lambda deploy permissions |
| `S3_BUCKET_NAME` | From Terraform output `s3_bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | From Terraform output `cloudfront_distribution_id` |
| `AUTH_LAMBDA_FUNCTION_NAME` | From Terraform output `lambda_auth_function_name` |
| `AUTH_LAMBDA_URL` | From Terraform output `lambda_auth_function_url` |
| `REGISTRY_SCAN_TOKEN` | Fine-grained PAT with `read:org` + `contents:read` on navapbc |

### 6. IAM Role for GitHub Actions (OIDC)

Create an IAM role trusted by GitHub Actions OIDC with a policy that allows:
- `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the site bucket
- `cloudfront:CreateInvalidation` on the distribution
- `lambda:UpdateFunctionCode` on the auth Lambda

See [AWS docs on GitHub OIDC](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html).

### 7. Deploy

```bash
git push origin main
```

This triggers the deploy workflow. After it completes, your site is live at the CloudFront domain.

---

## Adding skills to a repo

Add a `SKILL.md` at the root of any navapbc repo with this frontmatter:

```yaml
---
name: my-skill
description: When the user wants to... (this is what Claude uses to decide when to load the skill)
author: your-github-handle
version: 1.0.0
compatibility: [claude-code, claude-ai]
sensitive_data: false
---

Your skill content here...
```

For agents, add `agents/my-agent/AGENT.md` with additional fields:

```yaml
---
name: my-agent
description: When the user wants to...
author: your-github-handle
version: 1.0.0
compatibility: [claude-code]
sensitive_data: true
tools_used: [skill-one, skill-two]
human_in_loop: Describe where human review happens in the loop
---
```

The registry syncs every 6 hours. Trigger it manually from the Actions tab if you need it immediately.

---

## Local Development

```bash
npm install
npm run dev          # Astro dev server at http://localhost:4321
npm run sync         # Rebuild registry/index.json from live GitHub org
```

The dev server doesn't enforce auth — the CloudFront Function only runs in AWS.

---

## Styles

The site ships with unstyled HTML structure and semantic class names. Drop your CSS into `public/styles/main.css`. See `src/layouts/Base.astro` for the class naming conventions used throughout.
