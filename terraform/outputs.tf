output "cloudfront_domain" {
  description = "CloudFront distribution domain — your site URL before custom domain is wired up"
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — set as AWS_CLOUDFRONT_DISTRIBUTION_ID in GitHub environment secrets"
  value       = aws_cloudfront_distribution.site.id
}

output "s3_bucket_name" {
  description = "S3 bucket name — set as AWS_S3_BUCKET_NAME in GitHub environment secrets"
  value       = aws_s3_bucket.site.bucket
}

output "lambda_auth_function_name" {
  description = "Lambda auth function name — set as AWS_AUTH_LAMBDA_FUNCTION_NAME in GitHub environment secrets"
  value       = aws_lambda_function.auth.function_name
}

output "lambda_auth_function_url" {
  description = "Lambda Function URL — register as the OAuth redirect URI in Google Cloud Console"
  value       = aws_lambda_function_url.auth.function_url
}

output "oauth_redirect_uri" {
  description = "Exact URL to add as Authorized Redirect URI in Google Cloud Console"
  value       = "${aws_lambda_function_url.auth.function_url}auth/callback"
}

output "login_url" {
  description = "Direct OAuth login URL — set as PUBLIC_LOGIN_URL in GitHub environment secrets"
  value       = "${aws_lambda_function_url.auth.function_url}auth/login"
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions — set as AWS_DEPLOY_ROLE_ARN in GitHub environment secrets"
  value       = aws_iam_role.github_deploy.arn
}

output "api_lambda_function_name" {
  description = "API Lambda function name — set as AWS_API_LAMBDA_FUNCTION_NAME in GitHub environment secrets"
  value       = aws_lambda_function.api.function_name
}

output "api_gateway_endpoint" {
  description = "API Gateway base URL (internal — use CloudFront /api/* in the browser)"
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "terraform_drift_role_arn" {
  description = "Read-only role ARN for CI drift detection — set as AWS_DRIFT_ROLE_ARN in the GitHub environment secrets"
  value       = aws_iam_role.terraform_drift.arn
}
