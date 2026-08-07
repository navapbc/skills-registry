# -------------------------------------------------------------------------
# GitHub Actions OIDC — allows GitHub to assume AWS roles without stored keys.
#
# The provider is account-global: exactly one per account keyed by URL
# (token.actions.githubusercontent.com). It is shared by BOTH staging and prod
# deploy roles.
#
# GUARD — do NOT flip create_oidc_provider to true. It is intentionally false in
# every environment because the provider is managed manually (out-of-band), not
# by Terraform. Consequences of flipping it on:
#   - true when the provider already exists → apply fails with EntityAlreadyExists.
#   - true then later back to false (or count 1->0 in any apply) → Terraform
#     DESTROYS the shared provider, breaking OIDC deploys for staging AND prod.
# This exact deletion has already happened once. To let Terraform manage it
# again, `terraform import` it instead of toggling this flag.
#
# When false, the role trust below resolves the provider ARN by convention
# (see local.oidc_provider_arn), so deploys work without Terraform owning it.
# -------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint — stable, verified by AWS
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  # GitHub environment name — must match the environment: key in deploy.yml
  # When a workflow job uses environment:, the OIDC sub claim becomes
  # "repo:{org}/{repo}:environment:{name}" instead of the branch-based form.
  github_environment = var.environment == "prod" ? "production" : "staging"
}

data "aws_caller_identity" "current" {}

# -------------------------------------------------------------------------
# GitHub Actions deploy role — scoped to the correct branch for this env
# -------------------------------------------------------------------------
resource "aws_iam_role" "github_deploy" {
  name        = "${var.project_name}-github-deploy-${var.environment}"
  description = "Assumed by GitHub Actions for ${var.environment} deploys"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = local.oidc_provider_arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            # Jobs using environment: emit sub as "repo:{org}/{repo}:environment:{name}"
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:environment:${local.github_environment}"
          }
        }
      }
    ]
  })
}

data "aws_iam_policy_document" "github_deploy" {
  # S3: sync site files
  statement {
    sid    = "S3Deploy"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.site.arn,
      "${aws_s3_bucket.site.arn}/*",
    ]
  }

  # CloudFront: invalidate cache after deploy
  statement {
    sid    = "CloudFrontInvalidate"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
      "cloudfront:ListInvalidations",
    ]
    resources = [aws_cloudfront_distribution.site.arn]
  }

  # Lambda: update auth function code
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

  # DynamoDB: allow sync scripts to write skills and plugins
  statement {
    sid    = "DynamoDBSync"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [
      aws_dynamodb_table.skills.arn,
      aws_dynamodb_table.plugins.arn,
    ]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-policy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# The projects sync is the first CI job in this repo that DELETES rows, and this
# grant is deliberately NOT part of data.aws_iam_policy_document.github_deploy
# above.
#
# That document is attached twice: to the OIDC role (aws_iam_role_policy
# .github_deploy) and to the human IAM group (aws_iam_group_policy
# .github_automated_deploys, further down this file). Putting DeleteItem there
# would hand every human with manual CLI deploy access direct delete rights on
# non-public contract data, outside the sync's safety gate and reconcile diff
# entirely. Resource scoping does not help — the problem is the principal set,
# not the resource set.
#
# So: a second document, attached to the role alone. Anything added here reaches
# CI only. Do not merge it back into the shared document.
data "aws_iam_policy_document" "github_deploy_projects" {
  statement {
    sid    = "DynamoDBProjectsSync"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.projects.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy_projects" {
  name   = "deploy-policy-projects"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy_projects.json
}

# -------------------------------------------------------------------------
# IAM group for humans who need manual CLI deploy access
# Add users to this group; they get the same scoped permissions as the
# GitHub Actions role. Prefer OIDC roles for automation — avoid storing
# long-lived CLI keys in CI systems.
# -------------------------------------------------------------------------
# Account-global (no env suffix) — must be owned by exactly ONE environment's
# state, gated by manage_shared_iam. If both staging and prod managed it, each
# apply would rewrite the inline policy to its own env-scoped ARNs, flip-flopping
# the group on every deploy. Staging is the owner by convention (see tfvars).
resource "aws_iam_group" "github_automated_deploys" {
  count = var.manage_shared_iam ? 1 : 0

  name = "github-automated-deploys"
  path = "/"
}

resource "aws_iam_group_policy" "github_automated_deploys" {
  count = var.manage_shared_iam ? 1 : 0

  name   = "deploy-policy"
  group  = aws_iam_group.github_automated_deploys[0].name
  policy = data.aws_iam_policy_document.github_deploy.json
}
