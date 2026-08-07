# NOTE: hash_key/range_key trigger a deprecation warning under aws provider 6.x
# (use key_schema instead). We intentionally keep the deprecated syntax — key_schema
# on GSIs has open bugs that cause perpetual drift and destructive GSI recreation
# (all GSIs destroyed/recreated when one is removed), which would break queries on
# the skills/audit_log tables below. Maintainers recommend the deprecated form as
# the workaround. Do NOT migrate until these are fixed:
#   https://github.com/hashicorp/terraform-provider-aws/issues/46601
#   https://github.com/hashicorp/terraform-provider-aws/issues/46335
#   https://github.com/hashicorp/terraform-provider-aws/issues/46513
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

# Admin-owned reference data for the Contract Explorer: delivery archetypes and
# AI-posture policy guidance. Both datasets are small and static — low churn, no
# independent growth or throughput profile — so neither warrants its own table's
# indexes or lifecycle, and they share one table keyed by entity type. This is a
# deliberate divergence from the one-table-per-entity convention above, which
# exists for entities with distinct access patterns; these have none. Each admin
# tab reads its records with a single Query on the partition key, so no GSI is
# needed — every access path is that Query or a direct Get.
#
# Access is table-scoped by construction: one permission action covers the whole
# table, so only entity types meant to be governed by that same action may join it.
resource "aws_dynamodb_table" "project_reference" {
  name         = "${var.project_name}-project-reference-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "entity_type"
  range_key    = "id"

  # Admin-authored and not re-derivable from any sync, unlike skills/plugins.
  deletion_protection_enabled = var.environment == "prod"

  attribute {
    name = "entity_type"
    type = "S"
  }
  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# Projects mirrored from the "All Columns (Full View)" tab of the Nava projects
# sheet, plus one metadata record describing the last sync run. Partitioned by
# record_type so the metadata record can never be mistaken for a project, and so
# each read is a single Query on one partition — no GSI needed.
#
# ADMISSION RULE (deliberately narrower than project_reference's): only record
# types wholly derived from an external sync and re-creatable by re-running it
# may live here. The GitHub deploy role holds DeleteItem on this table, so any
# hub-authored or human-authored record type must NOT join it — including a
# future ai-survey, if surveys are filled in through the hub. `contracts` may,
# if and only if they are sheet-mirrored.
#
# No deletion protection, unlike project_reference: that data is admin-authored
# and unrecoverable, this is fully re-derivable by one workflow run.
resource "aws_dynamodb_table" "projects" {
  name         = "${var.project_name}-projects-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "record_type"
  range_key    = "project_code"

  attribute {
    name = "record_type"
    type = "S"
  }
  attribute {
    name = "project_code"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# Contracts mirrored from the "AI Survey (Contracts and Delivery Completes)" tab,
# plus one metadata record describing the last population run. A contract exists
# to associate a project with an AI posture indirectly and to carry the
# contract-level AI-use terms behind that posture.
#
# Partitioned by record_type so the metadata record can never be returned among
# the contracts, and so each read is a single Query on one partition — no GSI.
#
# Range key is a slug of the source's portfolio and project columns. Both are
# populated on every row, which is the property that matters: a key drawn from a
# sparse column would re-key itself as the survey is filled in, and reconcile
# would read that as a delete plus a create. Neither the contract number nor the
# project is safe alone — one contract number spans 17 rows, and a project may
# have several contracts.
#
# ADMISSION RULE: this table is READABLE BY EVERY SIGNED-IN USER, which is why it
# is its own table rather than a partition of either neighbour. project_reference
# admits only entity types governed by manage:project-reference, and this audience
# is far wider. projects admits only record types re-creatable by a scheduled
# sync, and this is operator-populated. Do not move records between the three.
#
# Deletion protection in prod: the data is re-derivable by re-running the
# population script, but only while its workbook stays shared with the service
# account — a weaker guarantee than the projects sync, which exercises its share
# on a schedule. Nothing here exercises this one.
resource "aws_dynamodb_table" "contracts" {
  name         = "${var.project_name}-contracts-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "record_type"
  range_key    = "contract_id"

  deletion_protection_enabled = var.environment == "prod"

  attribute {
    name = "record_type"
    type = "S"
  }
  attribute {
    name = "contract_id"
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

# Append-only behavioral analytics events (page_view, skill_view, search_query,
# filter_applied). Kept separate from audit_log so behavioral volume never
# pollutes the security trail. Raw rows expire ~200 days after write via TTL,
# bounding table size (and scan cost) while covering the 28-day dashboard window.
# Primary key: user_id + event_key (ISO timestamp + UUID), mirroring audit_log.
resource "aws_dynamodb_table" "analytics_events" {
  name         = "${var.project_name}-analytics-events-${var.environment}"
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

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}
