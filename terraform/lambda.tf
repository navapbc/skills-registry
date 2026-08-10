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
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid     = "ReadSecrets"
    effect  = "Allow"
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
      ALLOWED_EMAIL_DOMAIN       = var.allowed_email_domain
      SITE_URL                   = var.site_url
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
      "dynamodb:BatchGetItem",
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
      aws_dynamodb_table.analytics_events.arn,
      "${aws_dynamodb_table.analytics_events.arn}/index/*",
      aws_dynamodb_table.project_reference.arn,
      "${aws_dynamodb_table.project_reference.arn}/index/*",
    ]
  }

  # Projects are READ-ONLY to the API. Deliberately a separate statement rather
  # than another ARN on the one above: that statement's action list includes
  # PutItem/UpdateItem/DeleteItem for every table it names, so adding the
  # projects ARN there would make the API able to rewrite synced project data.
  #
  # The sheet is the only write surface for projects (see the plan's R17). This
  # statement is what enforces that in infrastructure rather than by the mere
  # absence of a write route — a future write route fails against IAM instead of
  # quietly succeeding.
  statement {
    sid       = "DynamoDBProjectsRead"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.projects.arn]
  }

  # Contracts are READ-ONLY to the API, for the same reason as projects above and
  # enforced the same way — a separate statement, because the general DynamoDB
  # statement grants writes to every table it names.
  #
  # The population script is the only write surface, and it runs as an operator
  # with its own credentials. A future write route on this table fails against
  # IAM rather than quietly succeeding.
  statement {
    sid       = "DynamoDBContractsRead"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.contracts.arn]
  }

  # Initiatives are READ-ONLY to the API, for the same reason as the two above and
  # enforced the same way — a separate statement, because the general DynamoDB
  # statement grants writes to every table it names.
  #
  # The sync workflow is the only write surface. Write actions are omitted here on
  # purpose: /api/initiatives has no create, update, or delete route, and this is
  # what makes a future one fail against IAM rather than quietly succeeding.
  statement {
    sid       = "DynamoDBInitiativesRead"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.initiatives.arn]
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
      JWT_SECRET_PARAM        = aws_ssm_parameter.jwt_secret_lambda.name
      SKILLS_TABLE            = aws_dynamodb_table.skills.name
      PLUGINS_TABLE           = aws_dynamodb_table.plugins.name
      USERS_TABLE             = aws_dynamodb_table.users.name
      AUDIT_TABLE             = aws_dynamodb_table.audit_log.name
      ANALYTICS_TABLE         = aws_dynamodb_table.analytics_events.name
      PROJECT_REFERENCE_TABLE = aws_dynamodb_table.project_reference.name
      PROJECTS_TABLE          = aws_dynamodb_table.projects.name
      CONTRACTS_TABLE         = aws_dynamodb_table.contracts.name
      INITIATIVES_TABLE       = aws_dynamodb_table.initiatives.name
      ALLOWED_EMAIL_DOMAIN    = var.allowed_email_domain
    }
  }
}
