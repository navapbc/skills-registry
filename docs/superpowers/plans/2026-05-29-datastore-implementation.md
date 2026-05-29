# Data Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static GitHub-synced JSON registry with DynamoDB tables and an API Gateway + Lambda CRUD API, enabling non-technical users to create/manage skills through the hub.

**Architecture:** Four DynamoDB tables (skills, plugins, users, audit_log) are managed by Terraform. A single Node.js Lambda behind HTTP API Gateway v2 handles all CRUD at `/api/*`, proxied through the existing CloudFront distribution. JWT from the `__session` cookie is validated on every request; the user's role is fetched from DynamoDB to enforce admin-only operations.

**Tech Stack:** Node.js 20 ESM, Hono v4 (router + AWS Lambda adapter), AWS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` + `@aws-sdk/client-ssm`), Terraform, Vitest

---

## File Map

**Create:**
- `terraform/dynamodb.tf` — all 4 DynamoDB tables + GSIs
- `terraform/api_gateway.tf` — HTTP API Gateway v2, Lambda integration, Lambda invoke permission
- `functions/api/package.json`
- `functions/api/index.mjs` — Hono app entry point, exports `app` and `handler`
- `functions/api/middleware/auth.mjs` — JWT validation + user upsert, exports `verifyJWT` and `authMiddleware`
- `functions/api/lib/dynamo.mjs` — DynamoDB document client, `upsertUser`, `tableName`
- `functions/api/lib/permissions.mjs` — pure `can(user, action, resource?)` function
- `functions/api/lib/audit.mjs` — `writeAudit(user, action, resourceType, resourceId, metadata?)`
- `functions/api/routes/skills.mjs` — exports `skillsRoutes(app)`
- `functions/api/routes/plugins.mjs` — exports `pluginsRoutes(app)`
- `functions/api/routes/users.mjs` — exports `usersRoutes(app)`
- `functions/api/routes/audit.mjs` — exports `auditRoutes(app)`
- `scripts/migrate-to-dynamodb.mjs` — one-time import from `public/registry/index.json`
- `tests/api/middleware.test.mjs`
- `tests/api/permissions.test.mjs`
- `tests/api/routes/skills.test.mjs`
- `tests/api/routes/plugins.test.mjs`
- `tests/api/routes/users.test.mjs`

**Modify:**
- `terraform/lambda.tf` — add API Lambda function, IAM role + policy
- `terraform/iam.tf` — expand GitHub deploy role to include API Lambda
- `terraform/cloudfront.tf` — add API Gateway origin + `/api/*` cache behavior
- `terraform/outputs.tf` — add API Lambda function name output
- `.github/workflows/deploy.yml` — add API Lambda deploy step
- `vitest.config.ts` — add `functions/api` to coverage include

---

## Task 1: DynamoDB Terraform

**Files:**
- Create: `terraform/dynamodb.tf`

- [ ] **Step 1: Create `terraform/dynamodb.tf`**

```hcl
resource "aws_dynamodb_table" "skills" {
  name         = "${var.project_name}-skills-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slug"

  attribute { name = "slug";       type = "S" }
  attribute { name = "created_by"; type = "S" }
  attribute { name = "created_at"; type = "S" }
  attribute { name = "status";     type = "S" }
  attribute { name = "plugin";     type = "S" }

  global_secondary_index {
    name            = "byCreator"
    hash_key        = "created_by"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "byStatus"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "byPlugin"
    hash_key        = "plugin"
    range_key       = "slug"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "plugins" {
  name         = "${var.project_name}-plugins-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slug"

  attribute { name = "slug"; type = "S" }
}

resource "aws_dynamodb_table" "users" {
  name         = "${var.project_name}-users-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute { name = "user_id"; type = "S" }
}

resource "aws_dynamodb_table" "audit_log" {
  name         = "${var.project_name}-audit-log-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "event_key"

  attribute { name = "user_id";      type = "S" }
  attribute { name = "event_key";    type = "S" }
  attribute { name = "resource_key"; type = "S" }

  global_secondary_index {
    name            = "byResource"
    hash_key        = "resource_key"
    range_key       = "event_key"
    projection_type = "ALL"
  }
}
```

- [ ] **Step 2: Verify the file parses**

```bash
cd terraform && terraform validate
```

Expected: `Success! The configuration is valid.`

---

## Task 2: API Gateway Terraform

**Files:**
- Create: `terraform/api_gateway.tf`

- [ ] **Step 1: Create `terraform/api_gateway.tf`**

```hcl
resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins     = compact([var.site_url])
    allow_methods     = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    allow_headers     = ["Content-Type", "Authorization"]
    allow_credentials = true
    max_age           = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "catch_all" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
```

---

## Task 3: API Lambda + IAM Terraform

**Files:**
- Modify: `terraform/lambda.tf`
- Modify: `terraform/iam.tf`

- [ ] **Step 1: Append to `terraform/lambda.tf`**

Add this block after the existing auth Lambda resources:

```hcl
data "archive_file" "api_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder-api.zip"

  source {
    content  = "export const handler = async () => ({ statusCode: 200, body: 'Deploying...' });"
    filename = "index.mjs"
  }
}

data "aws_iam_policy_document" "lambda_api_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_api_policy" {
  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid       = "ReadJwtSecret"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.jwt_secret_lambda.arn]
  }

  statement {
    sid    = "DynamoDB"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Scan", "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.skills.arn,
      "${aws_dynamodb_table.skills.arn}/index/*",
      aws_dynamodb_table.plugins.arn,
      "${aws_dynamodb_table.plugins.arn}/index/*",
      aws_dynamodb_table.users.arn,
      aws_dynamodb_table.audit_log.arn,
      "${aws_dynamodb_table.audit_log.arn}/index/*",
    ]
  }
}

resource "aws_iam_role" "lambda_api" {
  name               = "${var.project_name}-api-lambda-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_api_assume.json
}

resource "aws_iam_role_policy" "lambda_api" {
  name   = "api-lambda-policy"
  role   = aws_iam_role.lambda_api.id
  policy = data.aws_iam_policy_document.lambda_api_policy.json
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-api-${var.environment}"
  role             = aws_iam_role.lambda_api.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  filename         = data.archive_file.api_placeholder.output_path
  source_code_hash = data.archive_file.api_placeholder.output_base64sha256

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  environment {
    variables = {
      JWT_SECRET_PARAM     = aws_ssm_parameter.jwt_secret_lambda.name
      SKILLS_TABLE         = aws_dynamodb_table.skills.name
      PLUGINS_TABLE        = aws_dynamodb_table.plugins.name
      USERS_TABLE          = aws_dynamodb_table.users.name
      AUDIT_TABLE          = aws_dynamodb_table.audit_log.name
      ALLOWED_EMAIL_DOMAIN = var.allowed_email_domain
    }
  }
}
```

- [ ] **Step 2: Expand GitHub deploy role in `terraform/iam.tf`**

Find the `LambdaDeploy` statement inside `data "aws_iam_policy_document" "github_deploy"` and replace it:

```hcl
  # Lambda: update auth and api function code
  statement {
    sid    = "LambdaDeploy"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = [
      aws_lambda_function.auth.arn,
      aws_lambda_function.api.arn,
    ]
  }
```

---

## Task 4: CloudFront + Outputs Terraform

**Files:**
- Modify: `terraform/cloudfront.tf`
- Modify: `terraform/outputs.tf`

- [ ] **Step 1: Add API Gateway origin to CloudFront distribution**

In `terraform/cloudfront.tf`, inside the `resource "aws_cloudfront_distribution" "site"` block, add a new `origin` block after the existing `lambda-auth` origin:

```hcl
  origin {
    domain_name = trimprefix(aws_apigatewayv2_api.api.api_endpoint, "https://")
    origin_id   = "api-gateway"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
```

- [ ] **Step 2: Add `/api/*` cache behavior**

In the same `aws_cloudfront_distribution` resource, add an `ordered_cache_behavior` block **before** the existing `/_astro/*` block. The `/api/*` behavior must appear earlier in the list than `/_astro/*`:

```hcl
  # /api/* → API Gateway — no caching, forwards cookies for JWT auth
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "api-gateway"
    viewer_protocol_policy = "redirect-to-https"
    compress               = false

    # CachingDisabled
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AllViewerExceptHostHeader — forwards Cookie and all headers except Host
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }
```

- [ ] **Step 3: Add outputs to `terraform/outputs.tf`**

Append to `terraform/outputs.tf`:

```hcl
output "api_lambda_function_name" {
  description = "API Lambda function name — set as AWS_API_LAMBDA_FUNCTION_NAME in GitHub environment secrets"
  value       = aws_lambda_function.api.function_name
}

output "api_gateway_endpoint" {
  description = "API Gateway base URL (internal — use CloudFront /api/* in the browser)"
  value       = aws_apigatewayv2_api.api.api_endpoint
}
```

- [ ] **Step 4: Validate all Terraform**

```bash
cd terraform && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit Terraform changes**

```bash
git add terraform/dynamodb.tf terraform/api_gateway.tf terraform/lambda.tf terraform/iam.tf terraform/cloudfront.tf terraform/outputs.tf
git commit -m "feat(infra): add DynamoDB tables, API Gateway, and API Lambda terraform"
```

---

## Task 5: Apply Terraform to Staging

- [ ] **Step 1: Run plan**

```bash
cd terraform
terraform plan \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=staging.tfstate" \
  -var-file=terraform.staging.tfvars
```

Expected: plan shows new resources — 4 DynamoDB tables, 1 API Gateway, 1 Lambda, 1 IAM role, 4 IAM policies.

- [ ] **Step 2: Apply**

```bash
terraform apply \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=staging.tfstate" \
  -var-file=terraform.staging.tfvars
```

- [ ] **Step 3: Note the output**

```bash
terraform output api_lambda_function_name
```

Copy the value. Add it as `AWS_API_LAMBDA_FUNCTION_NAME` in the **staging** GitHub environment secrets (Settings → Environments → staging → Add secret).

---

## Task 6: API Lambda Package

**Files:**
- Create: `functions/api/package.json`

- [ ] **Step 1: Create `functions/api/package.json`**

```json
{
  "name": "skills-registry-api",
  "version": "1.0.0",
  "type": "module",
  "main": "index.mjs",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/client-ssm": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0",
    "hono": "^4.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd functions/api && npm install
```

Expected: `node_modules/` created with hono, aws-sdk packages.

---

## Task 7: JWT Middleware (TDD)

**Files:**
- Create: `tests/api/middleware.test.mjs`
- Create: `functions/api/middleware/auth.mjs`

> **Note:** `auth.mjs` imports `lib/dynamo.mjs` — Task 8 must be complete before this test runs end-to-end, but the test only imports `verifyJWT` (a pure function). Mock `dynamo.mjs` in this test so the import chain resolves without the actual file.

- [ ] **Step 1: Write the failing test**

Create `tests/api/middleware.test.mjs`:

```js
import { vi, describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

// auth.mjs imports dynamo.mjs — mock it so the module resolves before dynamo.mjs is written
vi.mock('../../functions/api/lib/dynamo.mjs', () => ({ upsertUser: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: vi.fn() })),
  GetParameterCommand: vi.fn(),
}));

import { verifyJWT } from '../../functions/api/middleware/auth.mjs';

const SECRET = 'test-secret-value-32-chars-min!!';

function signJWT(payload, secret = SECRET) {
  const b64 = (s) =>
    Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}

describe('verifyJWT', () => {
  it('returns payload for a valid token', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = verifyJWT(token, SECRET);
    expect(result).not.toBeNull();
    expect(result.sub).toBe('user@navapbc.com');
  });

  it('returns null for an expired token', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyJWT(token, SECRET)).toBeNull();
  });

  it('returns null when signed with a different secret', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret');
    expect(verifyJWT(token, SECRET)).toBeNull();
  });

  it('returns null for a tampered payload', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 });
    const [h, , sig] = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin@navapbc.com', exp: 9999999999 }))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(verifyJWT(`${h}.${fakePayload}.${sig}`, SECRET)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyJWT('not-a-jwt', SECRET)).toBeNull();
    expect(verifyJWT('only.two', SECRET)).toBeNull();
    expect(verifyJWT('', SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/middleware.test.mjs
```

Expected: FAIL — `Cannot find module '../../functions/api/middleware/auth.mjs'`

- [ ] **Step 3: Create `functions/api/middleware/auth.mjs`**

```js
import { createHmac } from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { getCookie } from 'hono/cookie';
import { upsertUser } from '../lib/dynamo.mjs';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const paramCache = {};

async function getParam(name) {
  if (paramCache[name]) return paramCache[name];
  const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  paramCache[name] = res.Parameter.Value;
  return paramCache[name];
}

export function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (expected.length !== sig.length) return null;
  let xor = 0;
  for (let i = 0; i < expected.length; i++) {
    xor |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (xor !== 0) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authMiddleware(c, next) {
  const jwtSecret = await getParam(process.env.JWT_SECRET_PARAM);
  const token = getCookie(c, '__session');

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = verifyJWT(token, jwtSecret);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const user = await upsertUser({
    user_id: payload.sub,
    email: payload.sub,
    name: payload.name ?? payload.sub,
    avatar_url: payload.picture ?? null,
  });

  c.set('user', user);
  await next();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test tests/api/middleware.test.mjs
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/api/middleware.test.mjs functions/api/middleware/auth.mjs
git commit -m "feat(api): JWT middleware with verifyJWT pure function"
```

---

## Task 8: DynamoDB Helpers

**Files:**
- Create: `functions/api/lib/dynamo.mjs`

- [ ] **Step 1: Create `functions/api/lib/dynamo.mjs`**

```js
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client);

export const tables = {
  skills: () => process.env.SKILLS_TABLE,
  plugins: () => process.env.PLUGINS_TABLE,
  users: () => process.env.USERS_TABLE,
  audit: () => process.env.AUDIT_TABLE,
};

export async function upsertUser({ user_id, email, name, avatar_url }) {
  const now = new Date().toISOString();

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id },
      UpdateExpression: `SET
        email = :email,
        #name = :name,
        avatar_url = :avatar_url,
        last_seen_at = :now,
        #role = if_not_exists(#role, :defaultRole),
        created_at = if_not_exists(created_at, :now)`,
      ExpressionAttributeNames: { '#name': 'name', '#role': 'role' },
      ExpressionAttributeValues: {
        ':email': email,
        ':name': name,
        ':avatar_url': avatar_url,
        ':now': now,
        ':defaultRole': 'user',
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes;
}

export { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand };
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/lib/dynamo.mjs
git commit -m "feat(api): DynamoDB document client helpers"
```

---

## Task 9: Permissions Module (TDD)

**Files:**
- Create: `tests/api/permissions.test.mjs`
- Create: `functions/api/lib/permissions.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/api/permissions.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { can } from '../../functions/api/lib/permissions.mjs';

const admin = { user_id: 'admin@navapbc.com', role: 'admin' };
const user  = { user_id: 'user@navapbc.com',  role: 'user'  };

const publicApproved = { slug: 'x', visibility: 'public',   status: 'approved', created_by: user.user_id };
const internalApproved = { slug: 'x', visibility: 'internal', status: 'approved', created_by: user.user_id };
const ownPending     = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: user.user_id };
const otherPending   = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: 'other@navapbc.com' };
const ownPrivate     = { slug: 'x', visibility: 'private',  status: 'approved', created_by: user.user_id };
const otherPrivate   = { slug: 'x', visibility: 'private',  status: 'approved', created_by: 'other@navapbc.com' };

describe('can — read:skill', () => {
  it('user can read public approved skill', () => {
    expect(can(user, 'read:skill', publicApproved)).toBe(true);
  });
  it('user can read internal approved skill', () => {
    expect(can(user, 'read:skill', internalApproved)).toBe(true);
  });
  it('user can read their own pending skill', () => {
    expect(can(user, 'read:skill', ownPending)).toBe(true);
  });
  it('user cannot read another user pending skill', () => {
    expect(can(user, 'read:skill', otherPending)).toBe(false);
  });
  it('user can read their own private skill', () => {
    expect(can(user, 'read:skill', ownPrivate)).toBe(true);
  });
  it('user cannot read another user private skill', () => {
    expect(can(user, 'read:skill', otherPrivate)).toBe(false);
  });
  it('admin can read any skill', () => {
    expect(can(admin, 'read:skill', otherPending)).toBe(true);
    expect(can(admin, 'read:skill', otherPrivate)).toBe(true);
  });
});

describe('can — create:skill', () => {
  it('any authenticated user can create a skill', () => {
    expect(can(user, 'create:skill')).toBe(true);
  });
});

describe('can — update:skill / delete:skill', () => {
  it('user can update their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot update another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
  it('user can delete their own skill', () => {
    expect(can(user, 'delete:skill', publicApproved)).toBe(true);
  });
  it('user cannot delete another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'delete:skill', otherSkill)).toBe(false);
  });
  it('admin can update or delete any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(admin, 'update:skill', otherSkill)).toBe(true);
    expect(can(admin, 'delete:skill', otherSkill)).toBe(true);
  });
});

describe('can — approve:skill / reject:skill', () => {
  it('user cannot approve or reject', () => {
    expect(can(user, 'approve:skill', ownPending)).toBe(false);
    expect(can(user, 'reject:skill', ownPending)).toBe(false);
  });
  it('admin can approve or reject', () => {
    expect(can(admin, 'approve:skill', ownPending)).toBe(true);
    expect(can(admin, 'reject:skill', ownPending)).toBe(true);
  });
});

describe('can — admin-only actions', () => {
  it('user cannot access admin actions', () => {
    expect(can(user, 'read:users')).toBe(false);
    expect(can(user, 'set:role')).toBe(false);
    expect(can(user, 'manage:plugins')).toBe(false);
    expect(can(user, 'read:audit')).toBe(false);
  });
  it('admin can perform all admin actions', () => {
    expect(can(admin, 'read:users')).toBe(true);
    expect(can(admin, 'set:role')).toBe(true);
    expect(can(admin, 'manage:plugins')).toBe(true);
    expect(can(admin, 'read:audit')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/permissions.test.mjs
```

Expected: FAIL — `Cannot find module '../../functions/api/lib/permissions.mjs'`

- [ ] **Step 3: Create `functions/api/lib/permissions.mjs`**

```js
const ADMIN_ONLY = new Set(['approve:skill', 'reject:skill', 'read:users', 'set:role', 'manage:plugins', 'read:audit']);

export function can(user, action, resource = null) {
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;

  switch (action) {
    case 'read:skill': {
      if (!resource) return false;
      if (resource.created_by === user.user_id) return true;
      return resource.status === 'approved' &&
        (resource.visibility === 'public' || resource.visibility === 'internal');
    }
    case 'create:skill':
      return true;
    case 'update:skill':
    case 'delete:skill':
      return resource?.created_by === user.user_id;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test tests/api/permissions.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/api/permissions.test.mjs functions/api/lib/permissions.mjs
git commit -m "feat(api): permissions module with can() pure function"
```

---

## Task 10: Audit Lib

**Files:**
- Create: `functions/api/lib/audit.mjs`

- [ ] **Step 1: Create `functions/api/lib/audit.mjs`**

```js
import { randomUUID } from 'crypto';
import { ddb, tables, PutCommand } from './dynamo.mjs';

export async function writeAudit(user, action, resourceType, resourceId, metadata = {}) {
  const now = new Date().toISOString();
  const eventKey = `${now}#${randomUUID()}`;

  await ddb.send(
    new PutCommand({
      TableName: tables.audit(),
      Item: {
        user_id: user.user_id,
        event_key: eventKey,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_key: `${resourceType}#${resourceId}`,
        metadata,
        timestamp: now,
      },
    })
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/lib/audit.mjs
git commit -m "feat(api): append-only audit log writer"
```

---

## Task 11: Skills Routes (TDD)

**Files:**
- Create: `tests/api/routes/skills.test.mjs`
- Create: `functions/api/routes/skills.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/api/routes/skills.test.mjs`:

```js
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const TEST_SECRET = 'test-secret-value-32-chars-min!!';

// vi.hoisted so mockSend is available inside vi.mock factory closures
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({ Parameter: { Value: TEST_SECRET } }),
  })),
  GetParameterCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn((p) => ({ type: 'Get', params: p })),
  PutCommand: vi.fn((p) => ({ type: 'Put', params: p })),
  UpdateCommand: vi.fn((p) => ({ type: 'Update', params: p })),
  DeleteCommand: vi.fn((p) => ({ type: 'Delete', params: p })),
  ScanCommand: vi.fn((p) => ({ type: 'Scan', params: p })),
  QueryCommand: vi.fn((p) => ({ type: 'Query', params: p })),
}));

import { app } from '../../functions/api/index.mjs';

function makeSessionCookie(email = 'user@navapbc.com', role = 'user') {
  const b64 = (s) =>
    Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', TEST_SECRET)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const USER_RECORD = { user_id: 'user@navapbc.com', email: 'user@navapbc.com', name: 'Test', role: 'user' };
const ADMIN_RECORD = { user_id: 'admin@navapbc.com', email: 'admin@navapbc.com', name: 'Admin', role: 'admin' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/skills', () => {
  it('returns 401 without session cookie', async () => {
    const res = await app.request('/api/skills');
    expect(res.status).toBe(401);
  });

  it('returns approved public skills for authenticated user', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: USER_RECORD }) // upsertUser in authMiddleware
      .mockResolvedValueOnce({
        Items: [
          { slug: 'test-skill', name: 'Test', status: 'approved', visibility: 'public', created_by: 'system' },
          { slug: 'private', name: 'Private', status: 'approved', visibility: 'private', created_by: 'other@navapbc.com' },
        ],
      });

    const res = await app.request('/api/skills', {
      headers: { Cookie: makeSessionCookie() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].slug).toBe('test-skill');
  });
});

describe('POST /api/skills', () => {
  it('creates skill with status=pending for regular user', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: USER_RECORD }) // upsertUser
      .mockResolvedValueOnce({}) // PutCommand (create skill)
      .mockResolvedValueOnce({}); // writeAudit PutCommand

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'new-skill',
        name: 'New Skill',
        description: 'A new skill',
        plugin: 'my-plugin',
        repo: 'navapbc/my-plugin',
        path: 'skills/new-skill/SKILL.md',
        author: 'user@navapbc.com',
        compatibility: ['claude-code'],
        type: 'skill',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.created_by).toBe('user@navapbc.com');
    expect(body.source).toBe('user-submitted');
  });

  it('creates skill with status=approved for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD }) // upsertUser
      .mockResolvedValueOnce({}) // PutCommand
      .mockResolvedValueOnce({}); // writeAudit

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'admin-skill',
        name: 'Admin Skill',
        description: 'An admin-created skill',
        plugin: 'my-plugin',
        repo: 'navapbc/my-plugin',
        path: 'skills/admin-skill/SKILL.md',
        author: 'admin@navapbc.com',
        compatibility: [],
        type: 'skill',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });

  it('returns 400 for missing required fields', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing slug' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/skills/:slug', () => {
  it('allows user to delete their own skill', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: USER_RECORD }) // upsertUser
      .mockResolvedValueOnce({ Item: { slug: 'my-skill', created_by: 'user@navapbc.com', status: 'pending' } }) // GetItem
      .mockResolvedValueOnce({}) // DeleteItem
      .mockResolvedValueOnce({}); // writeAudit

    const res = await app.request('/api/skills/my-skill', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });

    expect(res.status).toBe(200);
  });

  it('returns 403 when user tries to delete another user skill', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: USER_RECORD }) // upsertUser
      .mockResolvedValueOnce({ Item: { slug: 'other-skill', created_by: 'other@navapbc.com', status: 'approved' } }); // GetItem

    const res = await app.request('/api/skills/other-skill', {
      method: 'DELETE',
      headers: { Cookie: makeSessionCookie() },
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/skills/:slug/approve', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });

    const res = await app.request('/api/skills/some-skill/approve', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie() },
    });

    expect(res.status).toBe(403);
  });

  it('approves skill for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD }) // upsertUser
      .mockResolvedValueOnce({ Item: { slug: 'some-skill', status: 'pending', created_by: 'user@navapbc.com' } }) // GetItem
      .mockResolvedValueOnce({ Attributes: { slug: 'some-skill', status: 'approved' } }) // UpdateItem
      .mockResolvedValueOnce({}); // writeAudit

    const res = await app.request('/api/skills/some-skill/approve', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com') },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/routes/skills.test.mjs
```

Expected: FAIL — `Cannot find module '../../functions/api/index.mjs'`

- [ ] **Step 3: Create `functions/api/routes/skills.mjs`**

```js
import { randomUUID } from 'crypto';
import { ddb, tables, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

const REQUIRED_FIELDS = ['slug', 'name', 'description', 'plugin', 'repo', 'path', 'author', 'compatibility', 'type'];

export function skillsRoutes(app) {
  app.get('/api/skills', async (c) => {
    const user = c.get('user');
    const { type, plugin } = c.req.query();

    const result = await ddb.send(new ScanCommand({ TableName: tables.skills() }));
    let items = result.Items ?? [];

    if (type) items = items.filter((s) => s.type === type);
    if (plugin) items = items.filter((s) => s.plugin === plugin);

    const visible = items.filter((s) => can(user, 'read:skill', s));
    return c.json({ skills: visible });
  });

  app.get('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const result = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!result.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'read:skill', result.Item)) return c.json({ error: 'Forbidden' }, 403);

    return c.json(result.Item);
  });

  app.post('/api/skills', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const missing = REQUIRED_FIELDS.filter((f) => body[f] === undefined || body[f] === '');
    if (missing.length) return c.json({ error: `Missing fields: ${missing.join(', ')}` }, 400);

    const now = new Date().toISOString();
    const skill = {
      ...body,
      status: user.role === 'admin' ? 'approved' : 'pending',
      visibility: body.visibility ?? 'public',
      source: 'user-submitted',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      version: body.version ?? '1.0.0',
      sensitive_data: body.sensitive_data ?? false,
      content: body.content ?? '',
      last_updated: now,
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: skill }));
    await writeAudit(user, 'created', 'skill', skill.slug);
    return c.json(skill, 201);
  });

  app.put('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'update:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const now = new Date().toISOString();
    const updated = {
      ...existing.Item,
      ...body,
      slug,
      updated_at: now,
      updated_by: user.user_id,
      // Non-admins editing an approved skill resets to pending
      status: user.role === 'admin' ? (body.status ?? existing.Item.status) : 'pending',
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: updated }));
    await writeAudit(user, 'updated', 'skill', slug);
    return c.json(updated);
  });

  app.delete('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'delete:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);

    await ddb.send(new DeleteCommand({ TableName: tables.skills(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'skill', slug);
    return c.json({ deleted: slug });
  });

  app.post('/api/skills/:slug/approve', async (c) => {
    const user = c.get('user');
    if (!can(user, 'approve:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.skills(),
        Key: { slug },
        UpdateExpression: 'SET #status = :approved, visibility = :vis, updated_at = :now, approved_by = :by',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'approved',
          ':vis': body.visibility ?? existing.Item.visibility ?? 'public',
          ':now': now,
          ':by': user.user_id,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    await writeAudit(user, 'approved', 'skill', slug);
    return c.json(result.Attributes);
  });

  app.post('/api/skills/:slug/reject', async (c) => {
    const user = c.get('user');
    if (!can(user, 'reject:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.skills(),
        Key: { slug },
        UpdateExpression: 'SET #status = :rejected, rejection_reason = :reason, updated_at = :now, rejected_by = :by',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':rejected': 'rejected',
          ':reason': body.reason ?? '',
          ':now': now,
          ':by': user.user_id,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    await writeAudit(user, 'rejected', 'skill', slug, { reason: body.reason });
    return c.json(result.Attributes);
  });
}
```

- [ ] **Step 4: Create `functions/api/index.mjs`** (needed for tests to import `app`)

```js
import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { authMiddleware } from './middleware/auth.mjs';
import { skillsRoutes } from './routes/skills.mjs';
import { pluginsRoutes } from './routes/plugins.mjs';
import { usersRoutes } from './routes/users.mjs';
import { auditRoutes } from './routes/audit.mjs';

export const app = new Hono();

app.use('*', authMiddleware);

skillsRoutes(app);
pluginsRoutes(app);
usersRoutes(app);
auditRoutes(app);

export const handler = handle(app);
```

Note: `pluginsRoutes`, `usersRoutes`, and `auditRoutes` stubs are created in the next tasks. Create them as empty stubs now so this file compiles:

Stub for `functions/api/routes/plugins.mjs`:
```js
export function pluginsRoutes(_app) {}
```

Stub for `functions/api/routes/users.mjs`:
```js
export function usersRoutes(_app) {}
```

Stub for `functions/api/routes/audit.mjs`:
```js
export function auditRoutes(_app) {}
```

- [ ] **Step 5: Run skills tests**

```bash
pnpm test tests/api/routes/skills.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/routes/skills.mjs functions/api/routes/plugins.mjs functions/api/routes/users.mjs functions/api/routes/audit.mjs functions/api/index.mjs tests/api/routes/skills.test.mjs
git commit -m "feat(api): skills CRUD routes with approve/reject"
```

---

## Task 12: Plugins Routes (TDD)

**Files:**
- Create: `tests/api/routes/plugins.test.mjs`
- Modify: `functions/api/routes/plugins.mjs` (replace stub)

- [ ] **Step 1: Write the failing test**

Create `tests/api/routes/plugins.test.mjs`:

```js
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const TEST_SECRET = 'test-secret-value-32-chars-min!!';
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({ Parameter: { Value: TEST_SECRET } }) })),
  GetParameterCommand: vi.fn(),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(() => ({})) }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn((p) => ({ type: 'Get', params: p })),
  PutCommand: vi.fn((p) => ({ type: 'Put', params: p })),
  UpdateCommand: vi.fn((p) => ({ type: 'Update', params: p })),
  DeleteCommand: vi.fn((p) => ({ type: 'Delete', params: p })),
  ScanCommand: vi.fn((p) => ({ type: 'Scan', params: p })),
  QueryCommand: vi.fn((p) => ({ type: 'Query', params: p })),
}));

import { app } from '../../functions/api/index.mjs';

function makeSessionCookie(email = 'user@navapbc.com') {
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', TEST_SECRET).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const USER_RECORD  = { user_id: 'user@navapbc.com',  role: 'user',  email: 'user@navapbc.com',  name: 'User'  };
const ADMIN_RECORD = { user_id: 'admin@navapbc.com', role: 'admin', email: 'admin@navapbc.com', name: 'Admin' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/plugins', () => {
  it('returns plugin list for authenticated user', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: USER_RECORD })
      .mockResolvedValueOnce({ Items: [{ slug: 'my-plugin', name: 'My Plugin', visibility: 'public', status: 'approved' }] });

    const res = await app.request('/api/plugins', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins).toHaveLength(1);
  });
});

describe('POST /api/plugins', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });
    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-plugin', name: 'New Plugin', description: 'A plugin', repo: 'navapbc/repo', author: 'admin@navapbc.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin to create a plugin', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD })
      .mockResolvedValueOnce({})  // PutCommand
      .mockResolvedValueOnce({}); // writeAudit

    const res = await app.request('/api/plugins', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-plugin', name: 'New Plugin', description: 'A plugin', repo: 'navapbc/repo', author: 'admin@navapbc.com' }),
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/routes/plugins.test.mjs
```

Expected: FAIL — `plugins.length is not a function` or route returns 404 (stub is empty)

- [ ] **Step 3: Replace `functions/api/routes/plugins.mjs` stub**

```js
import { ddb, tables, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

const REQUIRED_FIELDS = ['slug', 'name', 'description', 'repo', 'author'];

export function pluginsRoutes(app) {
  app.get('/api/plugins', async (c) => {
    const result = await ddb.send(new ScanCommand({ TableName: tables.plugins() }));
    return c.json({ plugins: result.Items ?? [] });
  });

  app.get('/api/plugins/:slug', async (c) => {
    const { slug } = c.req.param();
    const result = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!result.Item) return c.json({ error: 'Not found' }, 404);
    return c.json(result.Item);
  });

  app.post('/api/plugins', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length) return c.json({ error: `Missing fields: ${missing.join(', ')}` }, 400);

    const now = new Date().toISOString();
    const plugin = {
      ...body,
      status: 'approved',
      visibility: body.visibility ?? 'public',
      source: 'user-submitted',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      skills_count: 0,
    };

    await ddb.send(new PutCommand({ TableName: tables.plugins(), Item: plugin }));
    await writeAudit(user, 'created', 'plugin', plugin.slug);
    return c.json(plugin, 201);
  });

  app.put('/api/plugins/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const updated = { ...existing.Item, ...body, slug, updated_at: new Date().toISOString(), updated_by: user.user_id };
    await ddb.send(new PutCommand({ TableName: tables.plugins(), Item: updated }));
    await writeAudit(user, 'updated', 'plugin', slug);
    return c.json(updated);
  });

  app.delete('/api/plugins/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    await ddb.send(new DeleteCommand({ TableName: tables.plugins(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'plugin', slug);
    return c.json({ deleted: slug });
  });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/api/routes/plugins.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/routes/plugins.mjs tests/api/routes/plugins.test.mjs
git commit -m "feat(api): plugins CRUD routes (admin-only write)"
```

---

## Task 13: Users Routes (TDD)

**Files:**
- Create: `tests/api/routes/users.test.mjs`
- Modify: `functions/api/routes/users.mjs` (replace stub)

- [ ] **Step 1: Write the failing test**

Create `tests/api/routes/users.test.mjs`:

```js
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const TEST_SECRET = 'test-secret-value-32-chars-min!!';
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({ Parameter: { Value: TEST_SECRET } }) })),
  GetParameterCommand: vi.fn(),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(() => ({})) }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn((p) => ({ type: 'Get', params: p })),
  PutCommand: vi.fn((p) => ({ type: 'Put', params: p })),
  UpdateCommand: vi.fn((p) => ({ type: 'Update', params: p })),
  DeleteCommand: vi.fn((p) => ({ type: 'Delete', params: p })),
  ScanCommand: vi.fn((p) => ({ type: 'Scan', params: p })),
  QueryCommand: vi.fn((p) => ({ type: 'Query', params: p })),
}));

import { app } from '../../functions/api/index.mjs';

function makeSessionCookie(email = 'user@navapbc.com') {
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub: email, name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', TEST_SECRET).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `__session=${h}.${p}.${sig}`;
}

const USER_RECORD  = { user_id: 'user@navapbc.com',  role: 'user',  email: 'user@navapbc.com',  name: 'User'  };
const ADMIN_RECORD = { user_id: 'admin@navapbc.com', role: 'admin', email: 'admin@navapbc.com', name: 'Admin' };

beforeEach(() => mockSend.mockReset());

describe('GET /api/users/me', () => {
  it('returns current user from context (set by authMiddleware)', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });

    const res = await app.request('/api/users/me', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe('user@navapbc.com');
    expect(body.role).toBe('user');
  });
});

describe('GET /api/users', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });
    const res = await app.request('/api/users', { headers: { Cookie: makeSessionCookie() } });
    expect(res.status).toBe(403);
  });

  it('returns user list for admin', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD })
      .mockResolvedValueOnce({ Items: [USER_RECORD, ADMIN_RECORD] });

    const res = await app.request('/api/users', { headers: { Cookie: makeSessionCookie('admin@navapbc.com') } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
  });
});

describe('PUT /api/users/:id/role', () => {
  it('returns 403 for non-admin', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: USER_RECORD });
    const res = await app.request('/api/users/user@navapbc.com/role', {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin to set a user role', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: ADMIN_RECORD })
      .mockResolvedValueOnce({ Attributes: { ...USER_RECORD, role: 'admin' } });

    const res = await app.request(`/api/users/${encodeURIComponent('user@navapbc.com')}/role`, {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('returns 400 for invalid role value', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: ADMIN_RECORD });
    const res = await app.request(`/api/users/${encodeURIComponent('user@navapbc.com')}/role`, {
      method: 'PUT',
      headers: { Cookie: makeSessionCookie('admin@navapbc.com'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/routes/users.test.mjs
```

Expected: FAIL — routes return 404 (stub is empty)

- [ ] **Step 3: Replace `functions/api/routes/users.mjs` stub**

```js
import { ddb, tables, UpdateCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';

const VALID_ROLES = new Set(['user', 'admin']);

export function usersRoutes(app) {
  app.get('/api/users/me', (c) => {
    return c.json(c.get('user'));
  });

  app.get('/api/users', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:users')) return c.json({ error: 'Forbidden' }, 403);

    const result = await ddb.send(new ScanCommand({ TableName: tables.users() }));
    return c.json({ users: result.Items ?? [] });
  });

  app.put('/api/users/:id/role', async (c) => {
    const user = c.get('user');
    if (!can(user, 'set:role')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body?.role || !VALID_ROLES.has(body.role)) {
      return c.json({ error: 'role must be "user" or "admin"' }, 400);
    }

    const targetId = decodeURIComponent(c.req.param('id'));
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.users(),
        Key: { user_id: targetId },
        UpdateExpression: 'SET #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': body.role },
        ReturnValues: 'ALL_NEW',
      })
    );

    return c.json(result.Attributes);
  });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/api/routes/users.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/routes/users.mjs tests/api/routes/users.test.mjs
git commit -m "feat(api): users routes — me, list (admin), set-role (admin)"
```

---

## Task 14: Audit Routes

**Files:**
- Modify: `functions/api/routes/audit.mjs` (replace stub)

- [ ] **Step 1: Replace `functions/api/routes/audit.mjs` stub**

```js
import { ddb, tables, QueryCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';

export function auditRoutes(app) {
  app.get('/api/audit', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:audit')) return c.json({ error: 'Forbidden' }, 403);

    const result = await ddb.send(new ScanCommand({ TableName: tables.audit() }));
    return c.json({ events: result.Items ?? [] });
  });

  app.get('/api/audit/me', async (c) => {
    const user = c.get('user');

    const result = await ddb.send(
      new QueryCommand({
        TableName: tables.audit(),
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': user.user_id },
        ScanIndexForward: false,
        Limit: 100,
      })
    );

    return c.json({ events: result.Items ?? [] });
  });
}
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS (existing + new api tests).

- [ ] **Step 3: Commit**

```bash
git add functions/api/routes/audit.mjs
git commit -m "feat(api): audit log read routes"
```

---

## Task 15: Update Vitest Config + Deploy Workflow

**Files:**
- Modify: `vitest.config.ts`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Update `vitest.config.ts` coverage include**

Find the `coverage` block and update `include`:

```ts
    coverage: {
      provider: 'v8',
      include: ['scripts/utils.mjs', 'src/lib/**/*.mjs', 'functions/api/**/*.mjs'],
```

- [ ] **Step 2: Add API Lambda deploy step to `.github/workflows/deploy.yml`**

After the existing `Deploy auth Lambda` step, add:

```yaml
      - name: Deploy API Lambda
        run: |
          cd functions/api
          npm install --omit=dev
          zip -r ../../api.zip .
          cd ../..
          aws lambda update-function-code \
            --function-name ${{ secrets.AWS_API_LAMBDA_FUNCTION_NAME }} \
            --zip-file fileb://api.zip
```

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts .github/workflows/deploy.yml
git commit -m "chore: add API Lambda to deploy workflow and vitest coverage"
```

---

## Task 16: Migration Script

**Files:**
- Create: `scripts/migrate-to-dynamodb.mjs`

- [ ] **Step 1: Create `scripts/migrate-to-dynamodb.mjs`**

```js
#!/usr/bin/env node
/**
 * One-time migration: imports skills/plugins from public/registry/index.json
 * into DynamoDB.
 *
 * Usage:
 *   node scripts/migrate-to-dynamodb.mjs --env staging
 *   node scripts/migrate-to-dynamodb.mjs --env prod
 *
 * Prerequisites: AWS credentials in environment with DynamoDB write access.
 */

import { readFileSync } from 'fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/migrate-to-dynamodb.mjs --env <staging|prod>');
  process.exit(1);
}
const env = args[envIdx + 1];
if (!['staging', 'prod'].includes(env)) {
  console.error('env must be "staging" or "prod"');
  process.exit(1);
}

const PROJECT = 'skills-registry';
const SKILLS_TABLE  = `${PROJECT}-skills-${env}`;
const PLUGINS_TABLE = `${PROJECT}-plugins-${env}`;

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const registry = JSON.parse(readFileSync('public/registry/index.json', 'utf8'));
const now = new Date().toISOString();

console.log(`\nMigrating to ${env}:`);
console.log(`  Skills table:  ${SKILLS_TABLE}`);
console.log(`  Plugins table: ${PLUGINS_TABLE}`);
console.log(`  Skills count:  ${registry.skills.length}`);
console.log(`  Plugins count: ${registry.plugins.length}\n`);

let skillOk = 0, skillErr = 0;
for (const skill of registry.skills) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: SKILLS_TABLE,
        Item: {
          ...skill,
          visibility: 'public',
          status: 'approved',
          source: 'github',
          created_by: 'system',
          created_at: skill.last_updated ?? now,
          updated_at: now,
        },
        // Skip if already imported (idempotent re-run)
        ConditionExpression: 'attribute_not_exists(slug)',
      })
    );
    skillOk++;
    process.stdout.write('.');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      process.stdout.write('s'); // skipped (already exists)
      skillOk++;
    } else {
      console.error(`\nError migrating skill ${skill.slug}:`, err.message);
      skillErr++;
    }
  }
}

console.log(`\n\nSkills: ${skillOk} ok, ${skillErr} errors`);

let pluginOk = 0, pluginErr = 0;
for (const plugin of registry.plugins) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: PLUGINS_TABLE,
        Item: {
          ...plugin,
          visibility: 'public',
          status: 'approved',
          source: 'github',
          created_by: 'system',
          created_at: now,
          updated_at: now,
          skills_count: registry.skills.filter((s) => s.plugin === plugin.slug).length,
        },
        ConditionExpression: 'attribute_not_exists(slug)',
      })
    );
    pluginOk++;
    process.stdout.write('.');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      process.stdout.write('s');
      pluginOk++;
    } else {
      console.error(`\nError migrating plugin ${plugin.slug}:`, err.message);
      pluginErr++;
    }
  }
}

console.log(`\n\nPlugins: ${pluginOk} ok, ${pluginErr} errors`);

if (skillErr === 0 && pluginErr === 0) {
  console.log('\n✓ Migration complete. Verify spot-checks, then disable the GitHub sync workflow.');
  console.log('  In .github/workflows/sync-registry.yml, remove or comment out the `schedule:` trigger.');
}
```

- [ ] **Step 2: Verify the script can parse the registry**

```bash
node -e "
import { readFileSync } from 'fs';
const r = JSON.parse(readFileSync('public/registry/index.json', 'utf8'));
console.log('skills:', r.skills.length, 'plugins:', r.plugins.length);
"
```

Expected: `skills: 177 plugins: 24` (or similar counts)

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-to-dynamodb.mjs
git commit -m "feat: one-time migration script for DynamoDB import"
```

---

## Task 17: Deploy to Staging + Verify + Migrate

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

The GitHub Actions `Deploy` workflow will run: tests → build → S3 sync → API Lambda deploy.

- [ ] **Step 2: Check GitHub Actions**

In GitHub → Actions → Deploy, confirm all steps succeed, especially `Deploy API Lambda`.

- [ ] **Step 3: Smoke test the API (replace URL with actual staging domain)**

```bash
# Should return 401 (no session cookie)
curl -s https://staging.hub.navapbc.com/api/skills | python3 -m json.tool
```

Expected: `{"error": "Unauthorized"}`

- [ ] **Step 4: Add GitHub secret for staging**

From the Terraform output in Task 5 Step 3, the `api_lambda_function_name` value should already be added as `AWS_API_LAMBDA_FUNCTION_NAME` in the staging GitHub environment secrets. Confirm it's set.

- [ ] **Step 5: Run migration against staging**

```bash
AWS_PROFILE=<your-profile> node scripts/migrate-to-dynamodb.mjs --env staging
```

Expected: `177 skills`, `24 plugins` migrated (dots across the terminal).

- [ ] **Step 6: Spot-check migration via AWS Console**

In DynamoDB → Tables → `skills-registry-skills-staging` → Explore items, confirm:
- At least 3 skills are present with `status=approved`, `visibility=public`, `source=github`

---

## Task 18: Apply Terraform to Prod + Deploy + Migrate

- [ ] **Step 1: Run terraform plan for prod**

```bash
cd terraform
terraform plan \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=prod.tfstate" \
  -var-file=terraform.prod.tfvars
```

- [ ] **Step 2: Apply**

```bash
terraform apply \
  -backend-config="bucket=navapbc-skills-registry-tf-state" \
  -backend-config="key=prod.tfstate" \
  -var-file=terraform.prod.tfvars
```

- [ ] **Step 3: Add GitHub secret for prod**

```bash
terraform output api_lambda_function_name
```

Add the output value as `AWS_API_LAMBDA_FUNCTION_NAME` in the **production** GitHub environment secrets.

- [ ] **Step 4: Merge main → release**

```bash
git checkout release && git merge main && git push origin release
```

The Deploy workflow will run for prod with reviewer approval gate.

- [ ] **Step 5: Run migration against prod**

```bash
AWS_PROFILE=<your-profile> node scripts/migrate-to-dynamodb.mjs --env prod
```

Expected: same output as staging, no errors.

- [ ] **Step 6: Spot-check prod DynamoDB**

In DynamoDB → Tables → `skills-registry-skills-prod` → Explore items, confirm skills are present.

- [ ] **Step 7: Disable GitHub sync workflow**

In `.github/workflows/sync-registry.yml` (or whichever file has the 4-hour cron), comment out or remove the `schedule:` trigger:

```yaml
on:
  # schedule:
  #   - cron: '0 */4 * * *'
  workflow_dispatch:  # keep for manual runs
```

Commit and push to main, then merge to release.

```bash
git add .github/workflows/
git commit -m "chore: disable automated GitHub sync (DynamoDB is now source of truth)"
git push origin main
```
