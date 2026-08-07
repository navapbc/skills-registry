# Projects & Project Reference Schema

Three DynamoDB tables back the Contract Explorer and the admin **Projects** tab. They are deliberately separate because they have different origins, different audiences, and different blast radii:

| Table | Resource | Origin | Deletion protection |
|---|---|---|---|
| `skills-registry-project-reference-{env}` | [`aws_dynamodb_table.project_reference`](../terraform/dynamodb.tf) | Admin-authored via the API (seeded once) | prod only |
| `skills-registry-projects-{env}` | [`aws_dynamodb_table.projects`](../terraform/dynamodb.tf) | Mirrored from the Nava projects Google Sheet by a scheduled sync | none — fully re-derivable |
| `skills-registry-contracts-{env}` | [`aws_dynamodb_table.contracts`](../terraform/dynamodb.tf) | Mirrored from the AI Survey tab by an operator-run script | prod only |

All three are `PAY_PER_REQUEST` with point-in-time recovery, and none has a GSI: every read is a single `Query` on one partition. Table names reach the Lambda as `PROJECT_REFERENCE_TABLE`, `PROJECTS_TABLE`, and `CONTRACTS_TABLE` ([`terraform/lambda.tf`](../terraform/lambda.tf)), resolved through the `tables.*()` accessors in [`functions/api/lib/dynamo.mjs`](../functions/api/lib/dynamo.mjs).

Counts as sampled 2026-08-07 (prod and staging are identical): 9 reference records, 53 projects + 1 sync-metadata record, 119 contracts + 1 population-metadata record.

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

  // --- 38 mirrored sheet columns (43 headers minus 5 excluded), grouped as the sheet groups them ---
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
  agency:           string;
  office:           string;
  group:            string;
  prime:            string;
  subcontractor:    string;
  program_manager:  string;  // named individual — see Named individuals below
  nava_contract_pp: string;  // named individual; the contracts-side program manager

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

#### Named individuals

`program_manager` and `nava_contract_pp` are mirrored even though both name a person. They were excluded originally on a blanket "no named individuals" rule, which the contracts table then broke anyway: `nava_project_mgr` and `nava_program_mgr` are published to every signed-in user through the Contract Explorer. Withholding the project-side manager protected nothing and left the contract detail page unable to say who runs the project it links to.

Both attributes appear on stored records only from the first sync run after this change; until then the contract detail page simply omits the rows. The `projects` table itself remains `manage:project-reference`-gated — the two reach a general reader only through the field projection in [`functions/api/routes/contracts.mjs`](../functions/api/routes/contracts.mjs), which carries both.

`nava_contract_pp` is presented as **Contracts program manager** — sentence case, like every other row label on that page. The sheet header names no role a reader of the explorer would recognise, and the page already shows two other managers (the project's `program_manager` and the survey's own `nava_program_mgr`), so each is labelled by which one it is.

#### Excluded columns

Five sheet columns are deliberately **not** mirrored (`EXCLUDED_COLUMNS`), so they exist in `column_names` on the metadata record but as no attribute here:

| Column | Why |
|---|---|
| Project Index Owner | Named individual, internal process role |
| Assigned project-index-quality reviewer | Named individual, internal process role |
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
  column_headers: Record<string, string>;    // stored attribute -> original header text (38)
  column_groups:  Record<string, string>;    // stored attribute -> sheet group label (38)
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

## `contracts` table

> Live in staging and prod as of 2026-08-07. There is no read route for general users yet — the Contract Explorer page is [a separate plan](../docs/plans/2026-08-07-002-feat-contract-explorer-page-plan.md). Requirements in [`docs/brainstorms/2026-08-07-contract-explorer-requirements.md`](../docs/brainstorms/2026-08-07-contract-explorer-requirements.md).

**Key:** hash `record_type` (S), range `contract_id` (S).

A contract associates a `project` with a **posture** indirectly, and carries the contract-level AI-use terms behind that posture. Two partitions, mirroring the projects table:

| `record_type` | `contract_id` | Count |
|---|---|---|
| `"contract"` | slug of `portfolio` + `project` | 119 |
| `"seed_meta"` | the literal `"current"` | 1 |

`contract_id` examples: `states-maryland-statewide-agile-teams`, `fedciv-va-disability-benefit-crew`, `labs-aecf`. Both source attributes are populated on every record, which is what makes the key stable — a key drawn from a sparse attribute re-keys itself as data is filled in, and reconcile reads that as a delete plus a create. Longest current id is 170 characters, within DynamoDB's limit but truncated for display and URLs.

Neither `project_code` nor `contract_num` is a safe key. `contract_num` is absent on 60 records and shared by 17 others, and a project may have multiple contracts, so the project reference is many-to-one and never unique.

**Admission rule:** its own table rather than a partition of an existing one. `projects` admits only record types re-creatable by a scheduled sync, and the deploy role holds `DeleteItem` over it. `project_reference` admits only entity types governed by `manage:project-reference`, which is `projects-admin`-only; contracts are readable by every signed-in user.

**Write surface:** the population script only. No create, update, or delete route.

### `record_type: "contract"`

Attribute names are snake_case, consistent with every other table here. Every attribute is a string and is **empty string when unset, never absent and never null** — except the two audit timestamps.

```typescript
{
  record_type: "contract";
  contract_id: string;  // range key — slug of portfolio + project

  // --- Written at population time ---
  first_seen_at:  string;  // ISO timestamp of the run that created this record
  last_synced_at: string;  // ISO timestamp of the run that last wrote it; the
                           // "captured on" date shown on cards and detail pages

  // --- Identity ---
  portfolio: string;  // FEDCIV | FEDHEALTH | STATES | LABS | BEAM
  project:   string;  // the engagement's own name; distinct on every record

  // --- Contract identifiers ---
  agreement_type:   string;  // PRIME CONTRACT | SUBCONTRACT | BPA | BOA | MAS | MSA
                             //   | STATEWIDE CONTRACT | JV variants | ""
  contract_num:     string;  // absent on 60 records; one value spans 17
  vehicle:          string;
  vehicle_fullname: string;
  task_order:       string;
  customer:         string;

  // --- People (named individuals) ---
  nava_project_mgr: string;
  nava_program_mgr: string;
  subcontractors:   string;

  // --- AI posture and terms ---
  ai_posture:            string;  // "" or a posture id — see Joins below
  ai_use_terms:          string;  // free text, populated on every record
  ai_use_terms_language: string;  // verbatim contract clause text, multi-paragraph
  terms_detail:          string;  // curated summary of the clause text

  // --- Policy ---
  client_policy:         string;  // raw answer: is there a client AI-use policy?
  client_policy_summary: string;  // curated summary of that answer
  client_policy_link:    string;
  nava_policy:           string;  // is there a Nava program-specific AI-use policy?

  // --- AI use in performance ---
  ai_used:        string;  // Yes | No | narrative
  tools:          string;
  usage:          string;
  review_process: string;

  // --- Other ---
  project_name: string;  // the project this contract belongs to — see Joins below
  notes:        string;
}
```

Two source columns are deliberately not stored: a contracts-team-member column holding a named individual, and a duplicate of `ai_posture` that was byte-identical to it on every record.

### Joins

Both joins are free-text label matches with no write-time integrity, resolved on read — the same pattern as `archetype_primary` on the projects table.

**`project_name` → `projects.project_name` / `projects.contract_name`**, case-folded and whitespace-collapsed. Only 37 records carry a `project_name` at all, and 23 of those resolve. Unresolved contracts are still stored and still shown, carrying their posture, with the missing link marked on the detail page and the name reported on the `projects-admin` surface.

Note that `portfolio` here includes `BEAM`, which has no counterpart in the projects table (`FEDCIV`, `FEDHEALTH`, `STATES`, `LABS`, `Unbillable`), so BEAM contracts have no project to resolve to by construction.

**`ai_posture` → `project_reference` posture `id`.** Values are already exact posture ids, so no mapping is applied:

| Value | Records |
|---|---|
| `silent` | 31 |
| `allowed` | 4 |
| `restricted` | 2 |
| `""` | 82 |

No record carries `prohibited`. The 82 records without a posture still carry `ai_use_terms`, which the detail page shows in place of posture guidance. Posture labels, colors, ordering, and guidance steps are read from the posture record rather than copied here, so editing a posture changes the explorer with no deploy.

### `record_type: "seed_meta"` (one record, `contract_id: "current"`)

```typescript
{
  record_type: "seed_meta";
  contract_id: "current";
  status:      "in_progress" | "complete";
  last_run_at: string;  // ISO timestamp
  row_count:   number;  // contracts surviving the run
  created:     number;  // counts from the last run
  updated:     number;
  deleted:     number;
}
```

Population is operator-run against staging and prod by [`scripts/sync-contracts.mjs`](../scripts/sync-contracts.mjs), written to reconcile rather than insert so a refresh is one command. As with `sync_meta` on the projects table, absent metadata is a distinct third state from `in_progress` and `complete`, so a populated table cannot read as never-populated.

There is no workflow calling this and the GitHub deploy role has no access to the table — unlike the projects sync, nothing exercises the workbook share on a schedule. A refresh depends on that share still being in place.

### Sensitivity

Every signed-in Nava user can read this table, which is a wider audience than any other table documented here. It carries named individuals (`nava_project_mgr`, `nava_program_mgr`, and the resolved project's `program_manager` and `nava_contract_pp`), contract and task-order numbers, customer names, and verbatim contract clause language in `ai_use_terms_language`. That exposure is a deliberate decision with a named accountable owner — see the requirements document.

---

See [`skills-schema.md`](skills-schema.md) for the skills, agents, and plugins tables.
