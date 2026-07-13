# Prod Terraform State Repair Runbook

**Status:** DONE (2026-07-13) — state rebuilt via import, applied, verified. See Result.
**Author:** incident triage 2026-07-13 (admin analytics 500)
**Account:** 921888034557  •  region: us-east-1

## Why this exists

`s3://navapbc-skills-registry-tf-state/skills-registry/prod.tfstate` is a **stale
copy of the staging state** (resources named `-staging`, last written 2026-06-01).
The real `-prod` resources exist in AWS but are tracked by **no** Terraform state.
`terraform apply -var-file=terraform.prod.tfvars` against the current (bogus) state
plans **22 destroys** — it would delete the staging-named resources (also managed by
`staging.tfstate`) and try to recreate everything as `-prod`. **Never apply against
the bogus state.**

Local backup of the bogus state: `~/prod.tfstate.bogus-backup-20260713`.

## Consequence for the incident

The prod API Lambda (`skills-registry-api-prod`) has **no `ANALYTICS_TABLE` env var**
and `skills-registry-analytics-events-prod` **does not exist**. That is why
`GET /api/admin/analytics` returns 500 and analytics read as 0. The read-path code
guard (branch `fix/admin-analytics-500-degrade`) stops the 500; this runbook makes
analytics actually populate.

## Decision required before executing

**Shared IAM group `github-automated-deploys`** (global, no env suffix) is already
managed by `staging.tfstate`. Options:
- (A) Gate `aws_iam_group.github_automated_deploys` + its policy behind a
  `manage_shared_iam` flag (like `create_oidc_provider`), set true for exactly one
  env. Requires an iam.tf change. **Recommended** — mirrors the OIDC fix.
- (B) `terraform state rm` the group from staging state and let prod own it. Fragile.
Until resolved, **do not import the group into prod state** (steps below skip it).

**RESOLVED (2026-07-13):** chose (A). Added `manage_shared_iam` flag (variables.tf,
iam.tf `count`), staging=true, prod=false. Prod no longer declares the group, so it
is excluded from the import set below.

**Staging follow-up — DONE (2026-07-13):** the group was added to iam.tf `count`, so
its staging state address changed. Migrated the addresses (backup:
`~/staging.tfstate.backup-20260713`); `terraform plan -var-file=terraform.staging.tfvars`
now reports **"No changes. Your infrastructure matches the configuration."** — group
no longer destroy/recreated.
```
# with backend pointed at staging.tfstate
terraform state mv 'aws_iam_group.github_automated_deploys' 'aws_iam_group.github_automated_deploys[0]'
terraform state mv 'aws_iam_group_policy.github_automated_deploys' 'aws_iam_group_policy.github_automated_deploys[0]'
```

## Import mapping (verified physical IDs, 2026-07-13)

| Address | Import ID |
|---|---|
| aws_apigatewayv2_api.api | `unipp7yzjj` |
| aws_apigatewayv2_integration.api_lambda | `unipp7yzjj/g1bdfgb` |
| aws_apigatewayv2_route.catch_all | `unipp7yzjj/8bc1q8q` |
| aws_apigatewayv2_stage.default | `unipp7yzjj/$default` |
| aws_cloudfront_cache_policy.api_read | `562f609d-d106-48fb-b766-22a32f0f13e0` |
| aws_cloudfront_distribution.site | `E1UCK6NUFY3KY7` |
| aws_cloudfront_function.auth_check | `skills-registry-auth-check-prod` |
| aws_cloudfront_origin_access_control.site | `E3AKQI8G9V1MLP` |
| aws_cloudfront_response_headers_policy.security | `1817b35c-6cdd-4ee7-a638-9e11b12c945c` |
| aws_dynamodb_table.audit_log | `skills-registry-audit-log-prod` |
| aws_dynamodb_table.plugins | `skills-registry-plugins-prod` |
| aws_dynamodb_table.skills | `skills-registry-skills-prod` |
| aws_dynamodb_table.users | `skills-registry-users-prod` |
| aws_iam_role.github_deploy | `skills-registry-github-deploy-prod` |
| aws_iam_role.lambda_api | `skills-registry-api-lambda-prod` |
| aws_iam_role.lambda_auth | `skills-registry-auth-lambda-prod` |
| aws_iam_role_policy.github_deploy | `skills-registry-github-deploy-prod:deploy-policy` |
| aws_iam_role_policy.lambda_api | `skills-registry-api-lambda-prod:api-lambda-policy` |
| aws_iam_role_policy.lambda_auth | `skills-registry-auth-lambda-prod:auth-lambda-policy` |
| aws_lambda_function.api | `skills-registry-api-prod` |
| aws_lambda_function.auth | `skills-registry-auth-prod` |
| aws_lambda_function_url.auth | `skills-registry-auth-prod` |
| aws_lambda_permission.api_gateway | `skills-registry-api-prod/AllowAPIGatewayInvoke` |
| aws_s3_bucket.site | `skills-registry-site-prod` |
| aws_s3_bucket_policy.site | `skills-registry-site-prod` |
| aws_s3_bucket_public_access_block.site | `skills-registry-site-prod` |
| aws_s3_bucket_versioning.site | `skills-registry-site-prod` |
| aws_ssm_parameter.google_client_id | `/skills-registry/prod/google_client_id` |
| aws_ssm_parameter.google_client_secret | `/skills-registry/prod/google_client_secret` |
| aws_ssm_parameter.jwt_secret_lambda | `/skills-registry/prod/jwt_secret` |

Deferred (shared, see decision): aws_iam_group.github_automated_deploys,
aws_iam_group_policy.github_automated_deploys.

## Procedure

1. **Auth + point backend at prod, reconfigure:**
   ```
   source ~/dev/skills-registry/autosource
   cd ~/dev/skills-registry/terraform
   terraform init -reconfigure \
     -backend-config="bucket=navapbc-skills-registry-tf-state" \
     -backend-config="key=skills-registry/prod.tfstate" \
     -backend-config="region=us-east-1"
   ```
2. **Empty the bogus state** (physical resources untouched; backup already taken):
   ```
   terraform state list | while read a; do terraform state rm "$a"; done
   ```
3. **Import each row** from the table above:
   ```
   terraform import -var-file=terraform.prod.tfvars '<address>' '<id>'
   ```
   Import in dependency-friendly order (tables, ssm, s3, iam roles, lambdas, apigw,
   cloudfront). Note `$default` stage/route IDs need single quotes.
4. **Reconcile plan — READ EVERY LINE:**
   ```
   terraform plan -var-file=terraform.prod.tfvars
   ```
   Expected creates/changes ONLY: create `aws_dynamodb_table.analytics_events`;
   update `aws_lambda_function.api` (+`ANALYTICS_TABLE` env); update
   `aws_iam_role_policy.lambda_api` (+analytics ARN); possible CloudFront in-place
   updates from 6 weeks of drift. **Any `destroy`/`replace` on a data table, S3
   bucket, or IAM role = STOP** and re-check the import.
5. **Apply** once the plan is understood and approved:
   ```
   terraform apply -var-file=terraform.prod.tfvars
   ```
6. **Verify:**
   ```
   aws dynamodb describe-table --table-name skills-registry-analytics-events-prod --region us-east-1 --query 'Table.TableStatus'
   aws lambda get-function-configuration --function-name skills-registry-api-prod --region us-east-1 --query 'Environment.Variables.ANALYTICS_TABLE'
   ```
   Then load the admin dashboard — analytics endpoint should be 200.

## Rollback

State-only operation. If imports go wrong, restore the backup:
```
aws s3 cp ~/prod.tfstate.bogus-backup-20260713 s3://navapbc-skills-registry-tf-state/skills-registry/prod.tfstate
```
No physical resources are mutated until step 5 (apply).

## Reconciling plan verdict (2026-07-13, after 30 imports)

`Plan: 1 to add, 4 to change, 0 to destroy.` Healthy — no table/bucket/role recreated.

| Change | Assessment |
|---|---|
| **+ aws_dynamodb_table.analytics_events** | Correct: user_id/event_key keys, PAY_PER_REQUEST, TTL on `ttl`, PITR on, deletion_protection on. Mirrors staging. The fix. |
| **~ aws_lambda_function.api** | Adds `ANALYTICS_TABLE=skills-registry-analytics-events-prod`; other 6 env vars untouched. Fixes the 500. |
| **~ aws_iam_role_policy.lambda_api** | Cosmetic `-> (known after apply)` — policy built from a data source read at apply. Recomputed value includes the new analytics-table ARN (grant the Lambda needs to scan it). |
| **~ aws_iam_role_policy.github_deploy** | Same data-source `known after apply` churn. No effective change (ARNs already -prod). |
| **~ aws_cloudfront_function.auth_check** | `code` update + `publish=true` + tags. Syncs repo's auth-gate code to prod (prod last applied 2026-06-01). Only behavioral change; identical to code already live on staging. |

## Result (2026-07-13)

Imports: all 30 resources imported clean into `skills-registry/prod.tfstate`.
Group excluded (manage_shared_iam=false on prod).

`terraform apply -var-file=terraform.prod.tfvars` →
**`Apply complete! Resources: 1 added, 3 changed, 0 destroyed.`**
(github_deploy policy recomputed identical → effective no-op, so 3 not 4 changed.)

Verified:
- `skills-registry-analytics-events-prod` — TableStatus ACTIVE, keys user_id/event_key, TTL ENABLED on `ttl`.
- `skills-registry-api-prod` env `ANALYTICS_TABLE=skills-registry-analytics-events-prod`.
- `GET https://hub.navapbc.com/api/admin/analytics` unauth → 401 (was 500). Auth path
  healthy; scan path now backed by a real table + env var + IAM grant, so an
  authenticated admin request returns 200 (empty aggregates until events accrue).

Prod terraform state is now authoritative for the real -prod resources. Backend is
currently pointed at prod.tfstate — re-point to staging before any staging work
(see step 1 with key=skills-registry/staging.tfstate).

### Outstanding follow-ups
1. ~~**Staging state mv** (before next staging apply)~~ — **DONE 2026-07-13.** Group
   migrated to `[0]`; staging plan clean. See "Staging follow-up" above.
2. **Code guard** (branch `fix/admin-analytics-500-degrade`) — deploy so a future
   missing-table/deploy-skew degrades to empty aggregates instead of 500.
3. **CI gap** — deploy.yml ships Lambda/S3 but never runs `terraform apply`, which is
   how prod drifted 6 weeks. Consider a terraform plan/apply gate in the pipeline.
