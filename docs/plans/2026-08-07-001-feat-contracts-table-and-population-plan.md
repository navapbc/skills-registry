---
title: "feat: Contracts table and population"
type: feat
status: completed
date: 2026-08-07
origin: docs/brainstorms/2026-08-07-contract-explorer-requirements.md
---

# feat: Contracts table and population

## Summary

Adds a `contracts` DynamoDB table, an operator-run population script that reconciles it against the AI Survey sheet, and unresolved-project-name reporting on the existing `/projects-admin` Projects tab. No user-facing page — this plan's output is a correct, verifiable data store that Plan 2 builds on.

---

## Problem Frame

Four AI postures with their guidance steps were seeded into `project_reference` in the previous cycle, and 53 projects were synced in the cycle after that. Nothing connects them: no stored record says which posture applies to which engagement, so posture guidance authored in `/projects-admin` reaches no reader. The connecting data exists only in a Google Sheet. Full context in the origin document.

---

## Requirements

- R1. Contracts are stored separately from the projects and reference tables.
- R2. A contract is identified by portfolio and project, slugified.
- R3. Every survey column is carried except the unnamed first column and the duplicate posture column.
- R4. Each contract records when it was captured.
- R5. Population is a single command against staging and prod, reconciling rather than inserting, reporting creates, updates, and deletes.
- R6. A contract's posture resolves to the posture record that owns its guidance.
- R7. A contract references at most one project; a project may be referenced by many contracts. The project reference is never a unique key.
- R8. Unresolved project names are still imported and are reported to policy owners on the existing admin projects surface.

**Origin actors:** A2 (policy owner, `projects-admin`), A3 (operator), A4 (Senongo, accountable owner)
**Origin acceptance examples:** AE3 (covers R8), AE5 (covers R5), AE7 (covers R2)

---

## Scope Boundaries

- No Contract Explorer page, read route for general users, or navigation change — all Plan 2.
- No change to the projects sync, its lib, its table, or its safety gate.
- No scheduled or recurring workflow. Population is operator-run.
- No inference of posture from free-text terms, and no write path back into the sheet.
- No generalization of the existing drift-rendering code into a shared component.

### Deferred to Follow-Up Work

- Serving contracts to every signed-in user, and the exposure widening that implies: Plan 2.

---

## Context & Research

### Relevant Code and Patterns

- `terraform/dynamodb.tf` — table definitions carrying their admission rules as comments; follow `aws_dynamodb_table.projects` for a `PAY_PER_REQUEST` table with PITR and no GSI.
- `terraform/lambda.tf` — IAM statement listing table ARNs, and the `environment` block mapping table names to env vars.
- `terraform/iam.tf` — the deploy role's grants; note the read-only-and-must-stay-that-way comment on the reference table.
- `functions/api/lib/dynamo.mjs` — `tables.*()` accessors reading env vars.
- `functions/api/lib/projects.mjs` — record-type constants, meta key, sync states, and `collectArchetypeIssues`, the label-resolution rule shared by read path and sync. The direct model for a contracts equivalent.
- `scripts/lib/sync-projects.mjs` — pure shaping, column exclusion, `slugColumn`, `reconcile`, and `safetyVerdict`. Nothing in it performs I/O, which is what makes the delete path testable.
- `scripts/lib/sync-projects-apply.mjs` — `syncProjects` writes an in-progress marker before any record write, then applies creates/updates/deletes, then writes completion metadata. `checkDrift` runs after apply.
- `scripts/sync-projects.mjs` — CLI entry: arg parsing, Google auth, tab fetch, apply, summary.
- `scripts/seed-project-reference.mjs` — operator posture: `--env staging|prod`, `--dry-run`, explicit note that the GitHub deploy role deliberately lacks write access.
- `scripts/lib/sheet-export.mjs` — `parseSpreadsheetId`, `selectTabs`, `rowsToObjects`.
- `functions/api/routes/projects.mjs` — `queryPartition`, the read-time archetype resolution, and the `drift` block in the response.
- `src/scripts/projects-admin/projects.mjs` — `renderDriftSummary`, the unresolved/missing finding blocks to mirror.
- `tests/sync-projects-lib.test.mjs`, `tests/api/routes/projects.test.mjs` — test shapes to follow.

### Institutional Learnings

- `docs/solutions/` does not exist in this repo; no institutional learnings to carry.
- Known repo failure mode: interpolated Tailwind classes emit no CSS. Any color driven by data must be applied as an inline style. Relevant to the drift badges in U4.

### External References

- None. Every pattern this plan needs has multiple direct examples in-repo.

---

## Key Technical Decisions

- **Its own table, not a partition of an existing one**: derived from the admission rules written into `terraform/dynamodb.tf`. `projects` admits only records re-creatable by a scheduled sync and the deploy role holds `DeleteItem` over it; `project_reference` admits only entity types governed by `manage:project-reference`. Contracts satisfy neither (see origin: `docs/brainstorms/2026-08-07-contract-explorer-requirements.md`).
- **New lib module rather than extending the projects sync's lib**: the projects safety gate has tuned thresholds and an absolute floor calibrated to 53 projects. Sharing the module invites a change to one path silently altering the other, and the projects sync destroys real data when its gate is wrong.
- **Narrower safety gate than the projects sync**: contracts have no baseline history and a different volume. Zero rows is never overridable; a delete ceiling bounds the shifted-header case. The row-drop and absolute-floor conditions do not carry over — there is no established baseline to measure against on the first runs.
- **Posture and project resolved on read, not stored**: mirrors the archetype pattern. Adding a missing posture or fixing a project name clears findings on the next page load rather than the next population run.
- **Empty string rather than absent attributes**: matches the projects table, and Plan 2's default filter depends on being able to distinguish "no posture recorded" from "posture recorded" without a schema change.
- **Unresolved reporting extends the existing gated projects response** rather than adding a new admin route: the audience is identical (`manage:project-reference`), and a second endpoint with the same gate would be unused surface.

---

## Open Questions

### Resolved During Planning

- Where does the unresolved list surface without a public contracts route? Extend the existing `GET /api/projects` response, which is already gated to the same audience.
- Does the population script need the projects table? Yes, read-only, to resolve project names for the drift report.

### Deferred to Implementation

- Whether reconcile should carry forward any prior attribute beyond `first_seen_at`: known once the first real run's diff is observed.
- Exact truncation point for the 170-character identifier: a display concern that Plan 2 settles.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
sheet grid (header row 3)
        │
        ▼
  shapeContracts()          pure — drops column A and the duplicate posture column,
        │                          slugifies portfolio+project into contract_id,
        │                          rejects duplicate ids and blank keys
        ▼
   reconcile(incoming, stored)  ──►  { creates, updates, deletes }
        │
        ▼
   safetyVerdict()          zero rows never overridable; delete ceiling overridable
        │
        ├── refusal ──► report, write nothing
        ▼
   applyContracts()         in-progress marker ─► record writes ─► completion metadata
        │
        ▼
   checkContractDrift()     resolves project names against the projects table
                            and postures against project_reference
```

---

## Implementation Units

- U1. **Contracts table in terraform**

**Goal:** The table, its IAM grants, and its env var exist in both environments.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `terraform/dynamodb.tf`
- Modify: `terraform/lambda.tf`
- Modify: `terraform/iam.tf`

**Approach:**
- Hash `record_type`, range `contract_id`, `PAY_PER_REQUEST`, PITR on, no GSI — same shape as `aws_dynamodb_table.projects`.
- Carry the admission rule as a comment on the resource, as the neighbouring tables do. State what may join this table and what may not, and why the audience differs from `project_reference`.
- Deletion protection: prod only. The data is re-derivable from the sheet, but only while the sheet remains shared with the service account, which is a weaker guarantee than the projects sync's scheduled re-derivation.
- Grant the API Lambda read on the table now; write access belongs to the operator, not the role. Do **not** grant the GitHub deploy role anything.

**Patterns to follow:**
- `aws_dynamodb_table.projects` and its surrounding comment block in `terraform/dynamodb.tf`.
- The `DynamoDBProjectsRead` statement in `terraform/lambda.tf` for a read-only grant.

**Test scenarios:**
- Test expectation: none — infrastructure declaration with no behavioral logic. Verified by plan and apply, below.

**Verification:**
- `terraform plan` against staging shows exactly one table create and the expected IAM and environment diffs, with no changes to the existing tables.
- After apply, the API Lambda's environment carries the new table name and the table exists in both environments.

---

- U2. **Pure shaping, keying, reconcile, and safety logic**

**Goal:** Every decision the population makes is a pure function of its inputs and is unit-testable without credentials.

**Requirements:** R2, R3, R4, R7

**Dependencies:** None

**Files:**
- Create: `scripts/lib/sync-contracts.mjs`
- Create: `tests/sync-contracts-lib.test.mjs`
- Create: `functions/api/lib/contracts.mjs`

**Approach:**
- `functions/api/lib/contracts.mjs` holds only what both the API and the script need: the record-type constants, the meta key, and the posture/project resolution rule. It must not import from `scripts/` or `src/` — the Lambda zip is built from `functions/api/` alone. `scripts/` importing from it is the established direction.
- `scripts/lib/sync-contracts.mjs` performs no I/O. It shapes the grid, derives `contract_id`, reconciles against stored records, and returns a safety verdict.
- Header row is 3 and is not auto-detected. Assert the expected machine names are present before shaping; a shifted header row otherwise produces a plausible-looking result.
- Drop exactly two source columns: the unnamed first column and the duplicate posture column. Name them explicitly with the reason, as `EXCLUDED_COLUMNS` does.
- Reject rather than resolve: a duplicate `contract_id`, a row that is populated but yields a blank key, and two headers slugging to the same attribute.
- Every carried attribute is a string, empty when the cell is blank — never absent, never null.
- Reconcile compares only carried attributes. `record_type`, `contract_id`, `first_seen_at`, and `last_synced_at` must be excluded from the comparison, or every record reports as updated on every run forever.
- The safety verdict returns a refusal reason or null. Zero rows is never overridable; a delete ceiling is overridable.

**Execution note:** Implement the reconcile and safety functions test-first. A wrong diff destroys real data and the failure is invisible until someone notices missing contracts.

**Patterns to follow:**
- `scripts/lib/sync-projects.mjs` — the module docstring explains why the split exists; the same reasoning applies here.
- `NON_CARRIED_FIELDS` and `carriedFieldsDiffer` in that file.
- `functions/api/lib/projects.mjs` for the shared-constants module and its dependency-direction comment.

**Test scenarios:**
- Happy path: a grid with the expected header row and three populated rows yields three records, each keyed to the slug of its portfolio and project.
- Happy path: `Covers AE7.` A record whose contract number is blank in one grid and populated in the next reconciles as an update, not a delete plus create, and its identifier is unchanged.
- Happy path: every carried attribute is present as a string on a record whose source cells are blank.
- Edge case: a row where both key columns are populated but every other cell is blank still produces a record.
- Edge case: a grid whose only populated rows are below a blank spacer row skips the spacer and counts it.
- Edge case: reconcile against an empty stored set reports all rows as creates and no deletes.
- Edge case: reconcile where incoming and stored are byte-identical reports zero creates, zero updates, zero deletes.
- Error path: a grid missing an expected machine name in row 3 fails with a message naming the missing column and the expected row.
- Error path: two rows producing the same identifier fail with both source values named.
- Error path: a populated row whose portfolio and project are both blank fails rather than being silently dropped.
- Error path: `Covers AE5.` A verdict on zero incoming rows refuses and states that the refusal is not overridable.
- Error path: a verdict where deletes exceed the ceiling refuses, and the same input with the override set returns null.
- Edge case: the two excluded columns never appear as attributes on any produced record.

**Verification:**
- The lib has no import of `fs`, `process`, or any AWS or Google client.
- Unit tests cover every refusal branch and both reconcile directions.

---

- U3. **Population script**

**Goal:** One command populates or refreshes either environment, and reports what it did.

**Requirements:** R5, R6, R8

**Dependencies:** U1, U2

**Files:**
- Create: `scripts/sync-contracts.mjs`
- Create: `scripts/lib/sync-contracts-apply.mjs`
- Create: `tests/sync-contracts-apply.test.mjs`

**Approach:**
- CLI surface mirrors the two precedents: `--env staging|prod` required, plus `--dry-run`, `--credentials`, `--spreadsheet`, `--table`, and an override flag for the surmountable refusals.
- The workbook and tab are different from the projects sync's. Default to the AI Survey workbook id, overridable, and fail with the available tab names when the tab is absent.
- Write an in-progress marker before any record write and completion metadata after. Absent metadata must remain distinguishable from both states, so a run that dies mid-apply cannot leave a populated table reading as never-populated.
- The in-progress marker must not overwrite the previous run's `row_count`; the baseline has to keep describing the last completed run.
- After apply, resolve project names against the projects table and postures against `project_reference`, and print both findings. Unresolved names warn rather than fail: 82 rows currently have no posture and 14 named projects resolve to nothing, so failing the run would make every run red and train the operator to ignore it.
- Print a summary the operator can act on: counts, refusal reason if any, and the unresolved lists.

**Execution note:** Cover the apply path against a fake DynamoDB client before wiring real credentials.

**Patterns to follow:**
- `scripts/sync-projects.mjs` for arg parsing, auth, and tab fetch.
- `scripts/lib/sync-projects-apply.mjs` for the marker-then-write-then-complete ordering and the injected-command signature that makes it testable.
- `scripts/seed-project-reference.mjs` for the operator-credentials posture and the `--dry-run` contract.

**Test scenarios:**
- Happy path: `Covers AE5.` Given a populated store and a grid with one changed row and one removed row, the run reports one update and one delete and writes no other records.
- Happy path: a first run against an empty table reports all rows created and writes completion metadata carrying the row count.
- Happy path: a re-run against an unchanged grid reports zero creates, zero updates, zero deletes, and still refreshes the capture timestamp only on records it writes.
- Integration: the in-progress marker is written before the first record write and replaced by completion metadata after the last one.
- Integration: `Covers AE3.` A contract whose project name matches nothing is written to the table and appears in the run's unresolved list.
- Error path: a refusal from the safety verdict writes nothing at all — no marker, no records, no metadata.
- Error path: `--dry-run` writes nothing and still reports the full diff.
- Error path: a missing tab exits non-zero and lists the tab names the workbook does have.
- Error path: credentials rejected by Google exits non-zero with a message distinguishing that from a missing credential file.
- Edge case: a run that dies after the marker leaves metadata whose state reads as in-progress, not complete and not absent.

**Verification:**
- A dry run against staging reports 119 incoming records and refuses nothing.
- A real run against staging produces 119 contract records plus one metadata record.
- An immediate second run reports zero creates, zero updates, zero deletes.

---

- U4. **Unresolved-name reporting on the Projects tab**

**Goal:** Policy owners can see which contract project names resolve to nothing, without a new page or a new permission.

**Requirements:** R8

**Dependencies:** U1, U3

**Files:**
- Modify: `functions/api/routes/projects.mjs`
- Modify: `functions/api/lib/contracts.mjs`
- Modify: `src/scripts/projects-admin/projects.mjs`
- Modify: `tests/api/routes/projects.test.mjs`
- Modify: `tests/frontend/projects-admin-projects.test.mjs`

**Approach:**
- Extend the existing gated projects response with a contracts-drift block. The gate is unchanged — this is the same audience that already reads the tab.
- Resolve on read, case-folded and whitespace-collapsed, exactly as the archetype resolution does. A fixed sheet value or a newly added project clears the finding on the next page load.
- Report two distinct findings, because they have different fixes: contracts whose project name matches nothing, and contracts with no posture recorded. The first is fixed in the sheet or by adding a project; the second is fixed by the survey being completed.
- Render as a section alongside the archetype drift summary rather than replacing it. Any color must be an inline style.
- Report counts even when zero, so the tab distinguishes "nothing to fix" from "not checked".

**Patterns to follow:**
- The `drift` block and `collectArchetypeIssues` call in `functions/api/routes/projects.mjs`.
- `renderDriftSummary` in `src/scripts/projects-admin/projects.mjs`, including its zero-records special case.

**Test scenarios:**
- Happy path: `Covers AE3.` A contract whose project name matches no project appears in the response's unresolved list with the name as stored.
- Happy path: a contract whose project name differs only by case and surrounding whitespace resolves and does not appear as unresolved.
- Happy path: contracts with no posture are counted separately from contracts with an unresolvable project.
- Edge case: an empty contracts table yields zero counts and empty lists rather than an error or a missing key.
- Edge case: a contract that is both unresolved and posture-less appears in both findings.
- Error path: a request from a user without the existing capability is refused, unchanged from today.
- Integration: the rendered tab shows both the archetype findings and the contract findings without either suppressing the other.
- Integration: a posture badge renders its color via an inline style, not an interpolated class.

**Verification:**
- The Projects tab shows the contract findings with counts matching a direct table scan.
- Fixing one name in the sheet and re-running population removes exactly that entry on the next page load.

---

- U5. **Populate staging and prod**

**Goal:** Both environments carry the real data, verified.

**Requirements:** R4, R5

**Dependencies:** U1, U2, U3, U4

**Files:**
- Modify: `db/projects-schema.md`

**Approach:**
- Dry run against staging, inspect the diff, then apply. Repeat for prod.
- Re-run each environment immediately to prove idempotence before declaring the unit done.
- Update the contracts section of the schema doc to drop its "planned — not yet created" status and record the observed counts, matching how the live tables are documented.

**Patterns to follow:**
- The counts-as-sampled line at the top of `db/projects-schema.md`.

**Test scenarios:**
- Test expectation: none — an operational run. Its correctness is asserted by U2 and U3 tests plus the verification below.

**Verification:**
- Both environments hold 119 contract records and one metadata record.
- A second run in each environment reports zero creates, zero updates, zero deletes.
- Every record carries a non-empty capture timestamp.
- Every record has the posture attribute present, empty string where unrecorded — the property Plan 2's default filter depends on.
- Spot-checking three records against the sheet shows matching values, including one record whose contract number is blank.

---

## System-Wide Impact

- **Interaction graph:** `GET /api/projects` gains a second table read. It already reads two tables; a third adds latency to a page used by a handful of people, which is acceptable, but the read must not fail the whole response if the contracts table is empty or absent.
- **Error propagation:** A failed contracts read on the projects route should degrade to empty findings rather than a 500 — the Projects tab's existing function must not regress because a table added later is unavailable.
- **State lifecycle risks:** A run dying between the marker and completion leaves in-progress metadata; the read path must treat that as a distinct third state, as the projects sync does.
- **API surface parity:** None. No new route in this plan.
- **Integration coverage:** The marker-then-write-then-complete ordering, and the read-time resolution against two other tables, are not provable by unit tests with mocks alone.
- **Unchanged invariants:** The projects table, its sync, its safety gate, and its thresholds are untouched. `manage:project-reference` grants exactly what it grants today. The GitHub deploy role gains no access to the new table.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Sheet access is revoked or the workbook moves, making the data non-re-derivable | Prod deletion protection, PITR, and a documented note that this table's re-derivability depends on a share that no scheduled job exercises |
| Header row 3 shifts or a machine name is renamed | Shaping asserts expected names and fails loudly rather than producing a plausible wrong result |
| A wrong reconcile silently drops records | Zero-rows refusal is unconditional; a delete ceiling bounds the shifted-header case; the diff is unit-tested in both directions |
| The survey gains a sensitive column and it is carried automatically | Every column is carried by decision, so this is expected behavior, not a defect — but the run summary should print newly appeared headers so the widening is visible |
| Operator runs prod before verifying staging | `--dry-run` is the documented first step, and U5 sequences staging first |

---

## Documentation / Operational Notes

- The population script requires operator AWS credentials; the GitHub deploy role deliberately cannot write this table.
- The workbook must remain shared with the service account for any refresh. This is a different workbook from the projects sync's and was shared on 2026-08-07.
- `db/projects-schema.md` carries the designed schema and is updated in U5 once the table is live.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-07-contract-explorer-requirements.md](docs/brainstorms/2026-08-07-contract-explorer-requirements.md)
- Designed schema: `db/projects-schema.md`
- Precedents: `scripts/sync-projects.mjs`, `scripts/lib/sync-projects.mjs`, `scripts/lib/sync-projects-apply.mjs`, `scripts/seed-project-reference.mjs`
- Follow-on plan: `docs/plans/2026-08-07-002-feat-contract-explorer-page-plan.md`
