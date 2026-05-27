data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_auth_policy" {
  statement {
    sid     = "Logs"
    effect  = "Allow"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid    = "ReadSecrets"
    effect = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      aws_ssm_parameter.google_client_id.arn,
      aws_ssm_parameter.google_client_secret.arn,
      aws_ssm_parameter.jwt_secret_lambda.arn,
    ]
  }
}

resource "aws_iam_role" "lambda_auth" {
  name               = "${var.project_name}-auth-lambda-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda_auth" {
  name   = "auth-lambda-policy"
  role   = aws_iam_role.lambda_auth.id
  policy = data.aws_iam_policy_document.lambda_auth_policy.json
}

# Placeholder zip for initial terraform apply.
# The deploy workflow replaces function code via aws lambda update-function-code.
data "archive_file" "auth_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder-auth.zip"

  source {
    content  = "export const handler = async () => ({ statusCode: 200, body: 'Deploying...' });"
    filename = "index.mjs"
  }
}

resource "aws_lambda_function" "auth" {
  function_name    = "${var.project_name}-auth-${var.environment}"
  role             = aws_iam_role.lambda_auth.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  filename         = data.archive_file.auth_placeholder.output_path
  source_code_hash = data.archive_file.auth_placeholder.output_base64sha256

  # Ignore code changes - managed by deploy workflow, not Terraform
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  environment {
    variables = {
      GOOGLE_CLIENT_ID_PARAM     = aws_ssm_parameter.google_client_id.name
      GOOGLE_CLIENT_SECRET_PARAM = aws_ssm_parameter.google_client_secret.name
      JWT_SECRET_PARAM           = aws_ssm_parameter.jwt_secret_lambda.name
      ALLOWED_EMAIL_DOMAIN = var.allowed_email_domain
      SITE_URL             = var.site_url
    }
  }
}

# Public function URL - this is the OAuth redirect URI registered in Google Cloud Console
resource "aws_lambda_function_url" "auth" {
  function_name      = aws_lambda_function.auth.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [var.site_url]
    allow_methods = ["GET"]
  }
}
