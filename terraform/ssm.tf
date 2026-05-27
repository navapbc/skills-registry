# SSM parameters store secrets used by the Lambda auth handler.
# The JWT secret is stored separately for Lambda vs the edge KVS
# so each can be rotated independently if needed.

resource "aws_ssm_parameter" "google_client_id" {
  name        = "/${var.project_name}/${var.environment}/google_client_id"
  description = "Google OAuth client ID"
  type        = "SecureString"
  value       = var.google_client_id
}

resource "aws_ssm_parameter" "google_client_secret" {
  name        = "/${var.project_name}/${var.environment}/google_client_secret"
  description = "Google OAuth client secret"
  type        = "SecureString"
  value       = var.google_client_secret
}

resource "aws_ssm_parameter" "jwt_secret_lambda" {
  name        = "/${var.project_name}/${var.environment}/jwt_secret"
  description = "JWT signing secret (must match KVS value for edge validation)"
  type        = "SecureString"
  value       = var.jwt_secret
}
