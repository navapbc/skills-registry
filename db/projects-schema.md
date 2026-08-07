# Projects & Project Reference Schema

Two DynamoDB tables back the Contract Explorer and the admin **Projects** tab. They are deliberately separate because they have different origins and different blast radii:

| Table | Resource | Origin | Deletion protection |
|---|---|---|---|
| `skills-registry-project-reference-{env}` | [`aws_dynamodb_table.project_reference`](../terraform/dynamodb.tf) | Admin-authored via the API (seeded once) | prod only |
| `skills-registry-projects-{env}` | [`aws_dynamodb_table.projects`](../terraform/dynamodb.tf) | Mirrored from the Nava projects Google Sheet | none — fully re-derivable |

Both are `PAY_PER_REQUEST` with point-in-time recovery, and neither has a GSI: every read is a single `Query` on one partition. Table names reach the Lambda as `PROJECT_REFERENCE_TABLE` and `PROJECTS_TABLE` ([`terraform/lambda.tf`](../terraform/lambda.tf)), resolved through `tables.projectReference()` / `tables.projects()` in [`functions/api/lib/dynamo.mjs`](../functions/api/lib/dynamo.mjs).

Counts as sampled (prod and staging are identical): 9 reference records, 53 projects + 1 sync-metadata record.

---

## `project_reference` table

**Key:** hash `entity_type` (S), range `id` (S).

One table holds two entity types because access is table-scoped by construction — a single permission action (`manage:project-reference`) covers the whole table, so only entity types meant to be governed by that same action may join it. Shape and validation live in [`functions/api/lib/project-reference.mjs`](../functions/api/lib/project-reference.mjs); routes in [`functions/api/routes/project-reference.mjs`](../functions/api/routes/project-reference.mjs).

### Common fields

```typescript
{
  entity_type: "archetype" | "posture";  // partition key
  id:          string;   // slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ — doubles as a DOM/style key
  label:       string;   // display name
  color:       string;   // six-digit hex, e.g. "#651A94" — applied as an inline style
  status:      "active" | "inactive";

  // --- Audit (set by the API/seed, never by the request body) ---
  created_by: string;  // user_id (email), or "seed" for the one-time seed
  created_at: string;  // ISO timestamp
  updated_at: string;  // ISO timestamp
  updated_by?: string; // set by the status-toggle route only
}
```

`color` must be hex, not a Tailwind token: interpolated utility classes emit no CSS, so a non-hex value renders as nothing.

### `entity_type: "archetype"` (5 records)

Delivery archetypes referenced by the `archetype_primary` / `archetype_additional` columns of the projects table.

```typescript
{
  ...common;
  icon:             string;    // one of ARCHETYPE_ICON_NAMES (see below)
  description:      string;    // "" when unset, never absent
  characteristics:  string[];  // [] when unset — 5 entries on every seeded record
  ai_opportunities: string[];  // [] when unset — 5 entries on every seeded record
}
```

| `id` | `label` | `color` | `icon` |
|---|---|---|---|
| `data-modernization-team` | Data Modernization Team | `#F37100` | `database` |
| `enterprise-operations-team` | Enterprise Operations Team | `#08A588` | `settings` |
| `platform-team` | Platform Team | `#282E6C` | `server` |
| `product-team` | Product Team | `#651A94` | `users` |
| `strategic-consulting-team` | Strategic Consulting Team | `#B14092` | `bulb` |

Allowed `icon` values: `users`, `server`, `database`, `settings`, `bulb`, `building`, `shield-check`, `chart-bar`, `world`, `briefcase`, `rocket`, `puzzle`. This list is duplicated in `src/lib/icons.mjs` (the Lambda zip can't import from `src/`); `tests/project-icons-parity.test.mjs` fails if the two drift.

### `entity_type: "posture"` (4 records)

AI-posture policy guidance shown in the Contract Explorer.

```typescript
{
  ...common;
  position: number;    // integer, display order only — carries no severity semantics
  steps:    string[];  // non-empty; every entry a non-empty string
}
```

| `id` | `label` | `color` | `position` | `steps` |
|---|---|---|---|---|
| `allowed` | AI ALLOWED — how to proceed | `#e0f5f0` | 1 | 6 |
| `restricted` | AI RESTRICTED — how to proceed | `#fff8e1` | 2 | 7 |
| `silent` | AI SILENT — how to proceed | `#faf0f7` | 3 | 8 |
| `prohibited` | AI PROHIBITED — hard stop | `#fce8e8` | 4 | 5 |

Postures store no `icon`, `description`, `characteristics`, or `ai_opportunities`; archetypes store no `position` or `steps`. `normalizeRecord` writes only the fields for the given entity type, so absent-vs-empty is meaningful: a missing key means "not applicable to this type", not "unset".

---

## `projects` table

**Key:** hash `record_type` (S), range `project_code` (S).

Mirrored from the "All Columns (Full View)" tab of the Nava projects sheet by [`scripts/sync-projects.mjs`](../scripts/sync-projects.mjs) (logic in [`scripts/lib/sync-projects.mjs`](../scripts/lib/sync-projects.mjs)). Two partitions:

| `record_type` | `project_code` | Count |
|---|---|---|
| `"project"` | the sheet's **Database code** (`FC001`, `ST033`, …) | 53 |
| `"sync_meta"` | the literal `"current"` | 1 |

The metadata record lives in its own partition so it can never be returned among the projects, and so `GET /api/projects` reads each with one `Query`/`GetItem`.

**Admission rule** (narrower than `project_reference`'s): only record types wholly derived from an external sync and re-creatable by re-running it may live here. The GitHub deploy role holds `DeleteItem` on this table, so hub- or human-authored record types must not join it.

**Write surface:** the sheet only. There is no create/update/delete route, and the API Lambda's IAM grant on this table omits write actions, so a future write route fails against infrastructure rather than succeeding quietly.

### `record_type: "project"`

Every attribute except the three below is a string mirrored verbatim from a sheet cell — **empty string, never absent and never null**. Attribute names are derived from sheet headers by `slugColumn()` (lowercase, non-alphanumerics → `_`, leading number moved to the end, so "2026 Capabilities" → `capabilities_2026`). New sheet columns are carried automatically; there is no allowlist.

```typescript
{
  record_type:    "project";
  project_code:   string;  // range key, from the "Database code" column

  // --- Written by the sync, not read from the sheet ---
  first_seen_at:  string;  // ISO timestamp of the run that created this record
  last_synced_at: string;  // ISO timestamp of the run that last wrote it

  // --- 36 mirrored sheet columns (43 headers minus 7 excluded), grouped as the sheet groups them ---
  // IDENTITY
  database_project_code: string;  // present but empty on all 53 rows (see notes)
  database_code:         string;  // duplicates project_code
  portfolio:             string;  // FEDCIV | FEDHEALTH | STATES | LABS | Unbillable
  project_name:          string;

  // OVERVIEW
  contract_name:         string;
  contract_type:         string;  // LH | FFP | T&M | "FFP & T&M" | GRANT | Corporate | ""
  prime_sub:             string;  // free text — "Prime Contract", "Subcontract", JV variants
  vehicle_org:           string;
  vehicle:               string;
  program_review_channel: string; // Slack channel name
  project_index:         string;

  // TIMELINES  (dates are sheet strings like "6/03/2021", not ISO)
  pop_start:        string;
  pop_end:          string;
  active_period:    string;   // e.g. "OP 4"
  active_pop_start: string;
  active_pop_end:   string;
  year_start:       string;
  year_end:         string;
  pop_periods:      string;   // multi-line: newline-separated POP/BP/OP lines

  // TEAM
  agency:        string;
  office:        string;
  group:         string;
  prime:         string;
  subcontractor: string;

  // FRAMEWORKS
  archetype_primary:    string;  // must match a project_reference archetype label
  archetype_additional: string;  // comma-separated archetype labels; "" on 31 rows
  capabilities:         string;  // comma-separated
  government_domain:    string;  // comma-and-newline separated, inconsistently cased
  research_indexes_and_repositories: string;

  // CAPABILITIES
  capabilities_2026: string;  // comma-separated

  // HEALTH  (links only — the assessments themselves are excluded)
  link_to_program_health: string;
  link_to_team_health:    string;

  // OTHER
  other_confluence_links: string;
  other_links:            string;

  // PROJECT INDEX
  aliases_alternative_naming: string;
  project_index_code:         string;
}
```

#### Excluded columns

Seven sheet columns are deliberately **not** mirrored (`EXCLUDED_COLUMNS`), so they exist in `column_names` on the metadata record but as no attribute here:

| Column | Why |
|---|---|
| Program Manager | Named individual |
| Nava Contract PP | Named individual |
| Project Index Owner | Named individual |
| Assigned project-index-quality reviewer | Named individual |
| Program Health Status | Health assessment |
| Team Health Status | Health assessment |
| CPARS | Contractor performance rating |

The two health **link** columns are kept on purpose: they hold Confluence URLs, and the assessment behind them sits behind that page's own access control.

#### Archetype drift

`archetype_primary` / `archetype_additional` hold sheet **labels**, not archetype ids, and nothing enforces referential integrity at write time. `GET /api/projects` resolves them against the archetype partition on read (case-folded, whitespace-collapsed) and reports `drift.unresolved` / `drift.missing`, so adding a missing archetype clears findings on the next page load rather than the next sync. All 53 current rows resolve.

### `record_type: "sync_meta"` (one record, `project_code: "current"`)

```typescript
{
  record_type:  "sync_meta";
  project_code: "current";
  status:       "in_progress" | "complete";
  last_run_at:  string;   // ISO timestamp
  row_count:    number;   // projects surviving the run (53)
  created:      number;   // counts from the last run
  updated:      number;
  deleted:      number;
  new_columns:  string[]; // headers that appeared since the previous run — [] when none
  column_names:   string[];                  // every sheet header, including excluded ones (43)
  column_headers: Record<string, string>;    // stored attribute -> original header text (36)
  column_groups:  Record<string, string>;    // stored attribute -> sheet group label (36)
}
```

`status` is written as `in_progress` before a run applies and overwritten on completion. Absent metadata is a third state (`never_synced`) rather than an error — a run that wrote projects and then died would otherwise leave a populated table reading as empty. `describeSync()` in [`functions/api/routes/projects.mjs`](../functions/api/routes/projects.mjs) maps these three states.

`new_columns` matters for governance: the sync's exclusion list is a denylist, so a **renamed** sensitive column would be silently re-admitted. Surfacing newly appeared headers in the admin tab is the compensating control.

Group labels currently in use: `IDENTITY` (synthetic — columns before the sheet's first group label), `OVERVIEW`, `TIMELINES`, `TEAM`, `FRAMEWORKS`, `CAPABILITIES`, `HEALTH`, `OTHER`, `PROJECT INDEX`.

### Sync safety gate

The sync refuses to write when ([`safetyVerdict`](../scripts/lib/sync-projects.mjs)):

| Condition | Overridable |
|---|---|
| The sheet returned zero rows | Never |
| Row count dropped >10% below the previous run's `row_count` | Yes |
| The run would delete >10% of stored projects | Yes |
| Fewer than 40 projects would survive (`ABSOLUTE_FLOOR`) | Yes |

The delete ceiling is not redundant with the row-count check: a header row shifted two columns keys projects on "Project Name" and produces 53 deletes plus 53 creates at an unchanged count of 53. `shapeProjects` also hard-fails on a missing "Database code" header, a populated row with a blank code, a duplicate code, or two headers slugging to the same attribute.

### Notes from the sampled data

- `database_project_code` is empty on all 53 rows. The sheet carries two code columns and only "Database code" is populated — keying on the other would fail on every row.
- Codes are not uniformly formatted: `ST0028` (four digits), `xLB001.2` (lowercase prefix), and a row literally coded `TEST PROJECT`. The sync applies no code-prefix rule by design — bad rows are fixed at the sheet, not filtered here.
- `government_domain` values contain embedded newlines and inconsistent casing (`Integrated eligibility & enrollment` vs `Integrated Eligibility`). Treat it as free text, not an enum.
- Every mirrored column is populated on at least some rows; the emptiest are `archetype_additional` (31/53 empty), `aliases_alternative_naming` (19), `capabilities` (16), and `capabilities_2026` (15).

---

See [`skills-schema.md`](skills-schema.md) for the skills, agents, and plugins tables.
