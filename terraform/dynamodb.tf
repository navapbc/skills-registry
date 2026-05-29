resource "aws_dynamodb_table" "skills" {
  name         = "${var.project_name}-skills-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slug"

  attribute {
    name = "slug"
    type = "S"
  }
  attribute {
    name = "created_by"
    type = "S"
  }
  attribute {
    name = "created_at"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "plugin"
    type = "S"
  }

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

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "plugins" {
  name         = "${var.project_name}-plugins-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slug"

  attribute {
    name = "slug"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "users" {
  name         = "${var.project_name}-users-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  deletion_protection_enabled = var.environment == "prod"

  attribute {
    name = "user_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "audit_log" {
  name         = "${var.project_name}-audit-log-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "event_key"

  deletion_protection_enabled = var.environment == "prod"

  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "event_key"
    type = "S"
  }
  attribute {
    name = "resource_key"
    type = "S"
  }

  global_secondary_index {
    name            = "byResource"
    hash_key        = "resource_key"
    range_key       = "event_key"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}
