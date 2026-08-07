---
date: 2026-08-06
topic: projects-sync-and-admin-tab
---

# Projects Sync and Projects Admin Tab

## Summary

A scheduled GitHub Action pulls the project rows out of the Nava projects sheet into a hub-owned `projects` store, and a new Projects tab on `/projects-admin` presents them drift-first: unresolved archetype values named by project and exact offending string at the top, browsable project table below.

---

## Problem Frame

The hub can now read the Nava projects sheet (`scripts/export-sheet.mjs`) and can now author delivery archetypes (`/projects-admin` archetypes tab, seeded from the prototype). Neither half knows about the other. The extractor writes a local snapshot on a developer's laptop and nothing loads it anywhere; the archetype records exist in DynamoDB with no consumer.

The gap has a visible cost today. Every archetype assignment in the sheet is a free-text label typed by a human — 53 rows, two archetype columns, one of them comma-separated, both owned by Practice Leadership rather than by the sheet's general maintainers. Nothing checks those strings against the archetype records they are supposed to name. A typo, a renamed archetype, or a new team category invented in the sheet produces a value the hub will silently fail to resolve, and nobody finds out until the Contract Explorer renders a project with no archetype badge. The reference-count feature built for exactly this purpose (`functions/api/lib/program-data.mjs`) reports "unavailable" because program data has never been loaded.

The sheet is also not uniformly trustworthy row by row. It declares 51 current projects while the tab holds 53 rows; the surplus is one fabricated test row and one row flagged excluded by a code prefix. Both are imported anyway — the tab is admin-only, read-only, and mirrors the sheet, so filtering them would mean maintaining a judgment about row validity that the sheet's own maintainers are better placed to make.

Meanwhile the snapshot goes stale the moment someone edits the sheet, and refreshing it is a manual command run by one person who has the service-account key.

A constraint shapes where this data can live: `navapbc/skills-registry` is public, and these rows carry contract names, agencies, offices, period-of-performance dates, and named individuals.

---

## Actors

- A1. Projects admin: holder of the `projects-admin` role. Opens the Projects tab to check sync health and to find archetype values that need fixing.
- A2. Site admin: same access as A1.
- A3. Practice Leadership: owns both archetype columns in the sheet, per the sheet's own column-ownership row. The recipient of a drift finding — not a hub user in this scope, so a finding has to be legible enough to relay.
- A4. `sync-projects` workflow: the scheduled job that reads the sheet and reconciles the `projects` store against it.
- A5. Google service account (`contract-explorer@…`): the identity the workflow authenticates as; the workbook is already shared with it.

---

## Domain model

The terminology below is the intended model. This scope builds only the project layer.

```
contract ──many──> project ──> ai-survey ──> posture
                      │
                      └──> archetype (primary + additional)
```

- A **project** is the unit this scope imports. Each carries a primary archetype and zero or more additional archetypes.
- A **contract** belongs to a project; a project can have many. Not built here — see Scope Boundaries for why the source cannot express it.
- An **ai-survey** is what associates a project with a policy **posture**. Not imported here, so no project→posture association exists yet.

---

## Key Flows

- F1. Scheduled sync
  - **Trigger:** Cron schedule, or manual dispatch.
  - **Actors:** A4, A5
  - **Steps:** Authenticate to Google with the service-account credential → read the project tab → drop non-project rows and excluded columns → compare against the stored projects → abort if the safety check trips → write creates and updates, delete projects absent from the sheet → record the run's outcome.
  - **Outcome:** The stored projects match the sheet's real project rows, and the run's time and counts are readable by the Projects tab.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8

- F2. Checking for drift
  - **Trigger:** A1 opens the Projects tab.
  - **Actors:** A1, A3
  - **Steps:** Tab loads → drift summary reports how many projects carry an unresolved archetype value → each finding names the project and the exact string → A1 relays the correction to A3, or adds the missing archetype on the Archetypes tab.
  - **Outcome:** A1 knows whether the sheet and the archetype records agree, and has enough to act if they do not.
  - **Covered by:** R10, R11, R12, R13

- F3. Reading a project
  - **Trigger:** A1 wants to see what the hub holds for a given project.
  - **Actors:** A1
  - **Steps:** Tab loads → A1 locates the project in the table → reads its fields, grouped as the sheet groups them, with any unresolved archetype value marked in place.
  - **Outcome:** A1 can confirm what the hub knows without opening the sheet.
  - **Covered by:** R9, R14, R15

---

## Requirements

**Sync**

- R1. A scheduled GitHub Action, also manually dispatchable, reads the sheet's project tab and reconciles a hub-owned `projects` store against it. It runs against staging before production, matching the existing sync workflows.
- R2. The workflow authenticates to Google using a service-account credential supplied as a repository secret. No interactive consent flow, and the credential is never written to the repository or printed to logs.
- R3. Every column of the source tab is carried through **except** columns naming individuals (program manager, Nava contract PP, project index owner, assigned quality reviewer) and the health *assessment* columns: program health status, team health status, and CPARS. The two health *link* columns are carried, since they hold Confluence URLs whose content sits behind that page's own access control. No filtering or derived fields beyond that exclusion; column values are carried verbatim.
- R4. Every row of the source tab is imported as a project. The sync applies no validity judgment of its own: it does not consult the sheet's stated current-project count, does not interpret code prefixes, and maintains no denylist. Rows the sheet should not contain are removed at the sheet.
- R5. A project is identified by its sheet-assigned project code, which is unique and populated on every row.
- R6. The sheet is authoritative. A project present in the store but absent from the sheet's real project rows is deleted.
- R7. The workflow refuses to write anything when the source tab yields zero rows, or when its row count has dropped by more than 10% since the last successful run. The refusal names what tripped it and is overridable by an operator on a manual run.
- R8. Each successful run records when it ran and how many projects it created, updated, and deleted, in a form the Projects tab can read.

**Projects tab**

- R9. A new Projects tab on `/projects-admin`, alongside the existing archetypes and policy tabs, available to the same two roles and no others.
- R10. The tab leads with a drift summary: how many projects carry an archetype value that resolves to no archetype record, and how current the data is.
- R11. When no project carries an unresolved value, the drift summary says so plainly rather than rendering as an empty region.
- R12. Each drift finding names the project it came from and reproduces the offending string exactly as the sheet holds it, so the value can be corrected at the source.
- R13. Both the primary and additional archetype columns are validated. The additional column holds a comma-separated list; each value is separated, trimmed of surrounding whitespace, and resolved independently.
- R14. Below the summary, the tab presents the stored projects as a readable table. Column grouping follows the groups the sheet already declares above its header row rather than an ordering invented here.
- R15. Unresolved archetype values are marked in place on the project row they belong to, not only in the summary.

**Access and data handling**

- R16. Every read of project data is authorized server-side against the same capability that governs the existing reference-data tabs. An unauthorized signed-in user gets an explicit refusal, not an empty table.
- R17. No project field is editable from the hub. The sheet is the only write surface.

---

## Acceptance Examples

- AE1. **Covers R3.** Given a source row with a populated program-manager column, when the sync runs, the stored project carries no program-manager value.
- AE2. **Covers R4.** Given the source tab's fabricated test row and its code-prefixed excluded row, when the sync runs, both are present in the store as ordinary projects.
- AE3. **Covers R4.** Given a source tab whose row count disagrees with its stated current-project count, when the sync runs, the disagreement changes nothing about what is imported.
- AE4. **Covers R6.** Given a project in the store whose code no longer appears in the source tab, when the sync runs, that project is gone from the store afterward.
- AE5. **Covers R7.** Given a source tab that returns zero rows, when the sync runs, it exits non-zero, names zero-rows as the reason, and the store is unchanged.
- AE6. **Covers R7.** Given a source tab whose row count has dropped more than 10% below the last successful run, when the sync runs without an override, it writes nothing and names both counts.
- AE7. **Covers R13.** Given a project whose additional-archetype cell reads `Strategic Consulting Team, Data Modernization Team`, when the tab renders, both values are resolved separately, the leading space on the second is not treated as part of the label, and neither is reported unresolved on account of the comma.
- AE8. **Covers R10, R12.** Given a project whose primary archetype reads `Prodcut Team`, when the tab renders, the drift summary reports one unresolved value, names that project, and shows `Prodcut Team` verbatim.
- AE9. **Covers R11.** Given every project's archetype values resolve, when the tab renders, the drift summary states that no unresolved values were found.
- AE10. **Covers R16.** Given a signed-in user holding neither role, when they request project data, the request is refused server-side and the tab shows a refusal.
- AE11. **Covers R8, R10.** Given a successful sync, when the tab renders, it reports when that sync ran.
- AE12. **Covers R15.** Given a project carrying one unresolved and one resolved archetype value, when the tab renders its row, the unresolved value is marked and the resolved one is not.
- AE13. **Covers R14.** Given the source tab's declared column groups, when the tab renders a project's fields, they appear under those group names rather than as one undifferentiated list.

---

## Success Criteria

- A projects admin can answer "does the sheet agree with our archetype records, and how current is this?" in one page load, without opening the sheet or asking anyone.
- When someone mistypes an archetype in the sheet, it is found on the next sync rather than when a page renders a missing badge — and the finding contains enough for Practice Leadership to fix it at the source.
- What the hub shows and what the sheet holds are the same set of rows, so a discrepancy is always the sheet's to fix and never the sync's to explain.
- The projects data refreshes without anyone running a command, and a bad upstream state produces a refusal rather than a wiped table.
- `ce-plan` does not have to decide what a project is, which columns are excluded, what happens to removed rows, how archetype values are matched, how the table is grouped, or who can read the data.

---

## Scope Boundaries

- A `contracts` entity, and project-has-many-contracts modeling. The source tab is already flattened to one row per project with a single contract's attributes inline; the cardinality is not recoverable from it.
- Importing ai-surveys, and therefore any project→posture association.
- Posture reference counts and posture orphan surfacing. Postures reach projects only through ai-surveys, so no source exists for them yet.
- Lighting up the archetype reference counts and orphan list on the existing Archetypes tab. That feature stays in its unavailable state; drift is surfaced only on the Projects tab.
- The other sheet tabs, including the two contract-level tabs and the project-index and capability tabs.
- Surfacing the sheet's per-column ownership as data. It informs who a finding routes to and how the table groups, but the owning-team labels are not imported.
- Editing, annotating, or adding projects from the hub.
- The Contract Explorer read path and its page.
- Migrating Google authentication to Workload Identity Federation.
- Auto-creating an archetype record from an unrecognized sheet value.
- Change detection or diffing beyond what the safety check and the run summary require.
- Reconciling this data against the Confluence project index that `enterprise/project-index-search/SKILL.md` treats as project source-of-truth. Two overlapping records of Nava project history will exist; which is authoritative is a separate question.

---

## Key Decisions

- **Archetype values are matched by label, not by identifier**: the sheet carries display labels only (`Product Team`), while archetype records key on a slug identifier with the label as a separate field. Matching is on the label, normalized for case and surrounding whitespace, because that is the only thing the two sides share. The cost is that renaming an archetype's label breaks every project referencing it — which is exactly the drift the tab exists to surface.
- **The additional-archetype column is a list**: 4 of 53 rows carry two values separated by a comma, and the value after the comma carries a leading space. Treating the cell as a single value would report every one of those rows as unresolved, burying real findings under false ones.
- **Drift is expected to be empty**: every archetype value in the sheet today, after separating and trimming, draws from the same five labels. The steady state is zero findings, so the summary is an alarm rather than a worklist, and it must read as reassuring when quiet (R11).
- **Every row is imported; the sync makes no validity judgment**: the sheet contains a fabricated test row and an `x`-prefixed row, and the alternatives for filtering them — a code-prefix convention, the stated current-project count, a denylist — each encode a guess about the sheet's conventions that only its maintainers can confirm, and each fails silently in a different direction when the conventions shift. Mirroring everything keeps one rule ("the hub shows what the sheet holds") and puts row hygiene where the authority for it lives. The accepted cost is a fake project visible in an admin-only, read-only tab until it is deleted upstream.
- **The project code is the identity, not the project name**: both are unique and populated across all 53 rows, but a name is edited casually and a code is not. The column that looks purpose-built for a project key is empty on every row and cannot be used.
- **Table grouping is borrowed from the sheet, not designed**: the sheet declares a group per column above its header row, and those groups are how the people who maintain this data already think about it. Inventing a different grouping would make the hub and the sheet disagree about the shape of the same record for no gain.
- **Reads are gated, unlike some existing list endpoints**: this data carries contract names, agencies, offices, and period-of-performance dates on a public repository's deployed hub. The precedent set by the reference-data routes — reads authorized, not just mutations — carries forward here.
- **Delete-on-absence, with a floor**: mirroring the sheet keeps the mental model simple and avoids a stale-record state nobody maintains. A strict mirror also lets one upstream accident — a filtered view, a shifted header row, a revoked share — empty the table, so the sync refuses to write on an implausible drop instead. Nothing downstream references projects yet, which is what makes deletion cheap today.
- **Contract fields are project attributes, not a contract entity**: the source has already collapsed the relationship. Naming them project fields keeps the model honest about what is known, and leaves a later contract entity unobstructed.
- **Freshness is part of the drift surface**: a drift alarm that cannot say when it last looked is not trustworthy. The run summary is what makes an empty finding list mean something.
- **Archetype reference counts stay dark**: the seam that would light them up assumes one archetype per program, and this data has two columns and multi-value cells. Widening it is real work with no requirement behind it in this scope, and the tab already handles the unavailable state.
- **Service-account key as a repository secret, not federated credentials**: matches how the repository's existing non-AWS secrets work, and the extractor already authenticates this way — no auth-path change. The cost is a long-lived Google private key in GitHub with manual rotation.

---

## Dependencies / Assumptions

- The archetype records must be seeded before the drift summary means anything. The seed script exists (`scripts/seed-project-reference.mjs`) but is operator-run against external source files; whether it has been run in either environment is unverified.
- The seeded archetype labels are assumed to match the sheet's five values (`Product Team`, `Platform Team`, `Data Modernization Team`, `Strategic Consulting Team`, `Enterprise Operations Team`). **Unverified** — the seed's source JSON lives outside this repository and could not be read.
- The `x` prefix on a project code probably means excluded or retired, and the sheet's stated current-project count probably excludes it and the test row. Both are **unverified** and neither is acted on (R4), so being wrong about them costs nothing here — but a later decision to filter rows would need them confirmed first.
- The source tab's header sits on row 6 and the extractor needs to be told so; auto-detection gets it wrong on this tab. The group and ownership rows sit above it and are only reachable through the extractor's raw grid, not its header-keyed rows.
- The 53 project rows and 43 columns reflect a snapshot taken 2026-08-05. Column names, groups, and row count will drift; the sync must not assume a fixed column set.
- The workbook remains shared with the service account, and the Google Sheets API stays enabled on its GCP project.
- Nothing currently reads project data, so deletion has no referential consequence. That changes the moment the Contract Explorer or ai-surveys land.
- The projects store's provisioning is not yet in place; the existing reference-data table was provisioned by hand-applied Terraform, and CI does not apply Terraform.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] How the operator override on the safety check is expressed, and whether it is available on scheduled runs or only on manual dispatch.
- [Affects R1][Technical] Whether the workflow runs the existing extractor and loads its output, or loads the sheet directly through the extractor's library. The extractor writes files to disk by design, which suits a local operator better than a job.
- [Affects R5, R6][Technical] Whether the projects store is its own table or joins the existing entity-type-partitioned reference table. Projects are a different order of magnitude in size and churn than reference records, and the existing table's access grant is deliberately table-scoped.
- [Affects R8][Technical] Where the run summary lives so both the workflow and the tab can reach it.
- [Affects R3][Technical] How the excluded-column list is expressed so that a new column appearing in the sheet is carried by default rather than silently dropped — exclusion by name, not inclusion by name.
- [Affects R14][Technical] How the column-group metadata reaches the tab, given it lives above the header row and the group runs are not contiguous by column position. Whether it is synced alongside the projects or restated hub-side.
- [Affects R13][Technical] Whether any archetype cell uses a separator other than a comma, and what happens to a cell containing only whitespace between separators.
- [Affects R1][Technical] Whether Terraform for any new storage must be applied before the workflow's first run, and how that is sequenced given CI does not apply Terraform.
