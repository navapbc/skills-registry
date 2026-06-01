# -------------------------------------------------------------------------
# GitHub Actions OIDC — allows GitHub to assume AWS roles without stored keys.
# One OIDC provider per AWS account. Set create_oidc_provider = false if one
# already exists in this account (e.g., from another project).
# -------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
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

  # DynamoDB: allow sync scripts to write built-in and enterprise skills
  statement {
    sid    = "DynamoDBSyncSkills"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
    ]
    resources = [aws_dynamodb_table.skills.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-policy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# -------------------------------------------------------------------------
# IAM group for humans who need manual CLI deploy access
# Add users to this group; they get the same scoped permissions as the
# GitHub Actions role. Prefer OIDC roles for automation — avoid storing
# long-lived CLI keys in CI systems.
# -------------------------------------------------------------------------
resource "aws_iam_group" "github_automated_deploys" {
  name = "github-automated-deploys"
  path = "/"
}

resource "aws_iam_group_policy" "github_automated_deploys" {
  name   = "deploy-policy"
  group  = aws_iam_group.github_automated_deploys.name
  policy = data.aws_iam_policy_document.github_deploy.json
}
