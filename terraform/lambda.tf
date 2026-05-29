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
      "${aws_dynamodb_table.users.arn}/index/*",
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
  memory_size      = 512
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
