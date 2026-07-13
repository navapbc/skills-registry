# -------------------------------------------------------------------------
# Terraform drift detection — CI reads state vs reality on a schedule so
# out-of-band drift is caught in days, not the 6 weeks that let the prod
# analytics table/env/grant silently go missing (see PROD_STATE_REPAIR.md).
#
# This role can only OBSERVE: AWS-managed ReadOnlyAccess + kms:Decrypt scoped
# to SSM (so `terraform plan` can refresh the SecureString parameters). It can
# never mutate infrastructure. Assumed via GitHub OIDC from the same per-env
# GitHub environment as deploys. Consumed by .github/workflows/terraform-drift.yml.
# -------------------------------------------------------------------------
resource "aws_iam_role" "terraform_drift" {
  name        = "${var.project_name}-terraform-drift-${var.environment}"
  description = "Read-only role for CI terraform drift detection (${var.environment})"

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
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:environment:${local.github_environment}"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "terraform_drift_readonly" {
  role       = aws_iam_role.terraform_drift.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess intentionally excludes kms:Decrypt. `terraform plan` refreshes
# the SecureString SSM parameters (jwt_secret, google_client_secret) to diff
# them, which needs decrypt on the key that encrypts them. Scoped via kms:ViaService
# to SSM only, so this grants nothing beyond parameter refresh.
resource "aws_iam_role_policy" "terraform_drift_kms" {
  name = "drift-kms-decrypt"
  role = aws_iam_role.terraform_drift.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com" }
        }
      }
    ]
  })
}
