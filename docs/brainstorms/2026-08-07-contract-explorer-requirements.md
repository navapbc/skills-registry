---
date: 2026-08-07
topic: contract-explorer
---

# Contract Explorer

## Summary

A Contract Explorer page that lets any signed-in Nava user browse contracts as cards and open one to see its details, the project it belongs to, and the AI posture guidance that applies — backed by a new contracts store populated once from the AI Survey tab, in staging and prod.

---

## Problem Frame

A delivery team member who wants to know whether AI may be used on their contract has nowhere in the hub to look. The answer exists: the AI Survey tab of the contracts workbook records an AI posture per engagement, and the four postures with their step-by-step guidance were seeded into the hub in the previous cycle. Nothing connects the two. The postures are stored and editable but reference nothing; the 53 synced projects carry no posture at all.

The pieces were built in sequence and each deferred this join. The sheets export CLI (2026-08-05) named the Contract Explorer as its reason for existing and put the page out of scope. The archetypes and policy admin work (2026-08-06) seeded the postures and put the page out of scope. The projects sync (2026-08-06) landed the project data and put the page out of scope. This is the piece all three were waiting on.

The cost of the gap is that posture guidance authored by policy owners reaches nobody. A posture edited in `/projects-admin` today changes a record that no page renders. Meanwhile the underlying survey is only 31% classified — 82 of 119 engagements carry free-text AI-use terms but no posture — and nothing surfaces that backlog to the people who could close it.

---

## Actors

- A1. Delivery team member: arrives knowing their project, wants to know the AI posture on their contract and what steps follow from it. The primary audience, and the reason the page is open to all signed-in users.
- A2. Policy owner (`projects-admin`): authors postures and their guidance steps in `/projects-admin`, and is the person who sees the list of contracts whose project name resolves to nothing.
- A3. Operator: runs the population script against staging and prod, and re-runs it when the survey has been updated enough to warrant a refresh.
- A4. Senongo: accountable owner for the decision to serve contract-confidential material to every signed-in Nava user.

---

## Key Flows

- F1. Look up a contract's AI posture
  - **Trigger:** A1 wants to know whether AI may be used on their work.
  - **Actors:** A1
  - **Steps:** Opens Contract Explorer from the nav. Sees a grid of cards, classified contracts only by default. Finds their engagement by project name, optionally narrowing by portfolio or posture. Opens the card.
  - **Outcome:** A1 sees the posture, its guidance steps, the contract's own survey fields, and the associated project's details — plus when the data was captured.
  - **Covered by:** R9, R10, R12, R13, R14, R16

- F2. Look up an unclassified contract
  - **Trigger:** A1's engagement has no recorded posture, so it is absent from the default view.
  - **Actors:** A1
  - **Steps:** Sees the default filter and the count of contracts it is hiding. Clears it. Finds their engagement and opens it.
  - **Outcome:** A1 sees "posture not yet recorded" and the contract's raw AI-use terms text, and understands the answer exists but has not been classified — rather than concluding their contract is not covered.
  - **Covered by:** R12, R15

- F3. Populate or refresh the store
  - **Trigger:** A3 runs the population script, either for the first time or after the survey has been updated.
  - **Actors:** A3
  - **Steps:** Runs one command against staging, then prod. The run reconciles the sheet against what is stored, reporting what it created, updated, and deleted, and lists any project names that resolved to nothing.
  - **Outcome:** Both environments match the sheet, and A2 has a list of names to fix.
  - **Covered by:** R5, R8

---

## Requirements

**Contract data**

- R1. Contracts are stored separately from the projects and reference data, because their origin and their audience differ from both.
- R2. A contract is identified by its portfolio and project together. Both are recorded on every row today, so an identifier stays stable as the rest of the survey is filled in.
- R3. Every survey column is carried except two: the unnamed first column, which holds a named individual, and the duplicate posture column, which is identical to the posture column on every row.
- R4. Each contract records when it was captured from the sheet.
- R5. Population is a single command run against staging and prod. It reconciles rather than inserts, so re-running it after the sheet changes produces a correct store without a rewrite, and reports what it created, updated, and deleted.
- R6. A contract's posture is resolved to the posture record that owns its guidance, so the explorer renders authored guidance rather than a copy of it.
- R7. A contract references at most one project, and a project may be referenced by many contracts. The project reference is never treated as a unique identifier for a contract.
- R8. When a contract's project name matches no project, the contract is still stored and still shown. The unresolved name is reported to policy owners on the existing admin projects surface.

**Explorer page**

- R9. A Contract Explorer navigation link is available to every signed-in Nava user.
- R10. The explorer presents contracts as a card grid, one card per survey row, consistent with how the skills page presents skills.
- R11. Cards name each record for what it is — an engagement or agreement — and show its contract number as the parent where one exists, so several records sharing a contract number are legible as such rather than as duplicates.
- R12. The grid hides contracts with no recorded posture by default. The filter doing so is visible, states how many contracts it is hiding, and can be cleared.
- R13. The grid can be narrowed by posture and by portfolio.
- R14. Opening a card shows a detail page carrying the contract's own fields, the associated project's details, and the posture's guidance steps.
- R15. When a contract has no recorded posture, its detail page says so plainly and shows the contract's raw AI-use terms text instead.
- R16. Every card and detail page states when the data was captured.
- R17. The explorer is read-only. Contracts cannot be created, edited, or deleted from the hub.
- R18. Posture labels, colors, ordering, and guidance come from the posture records, so a policy owner adding or editing a posture changes the explorer with no deploy.

---

## Acceptance Examples

- AE1. **Covers R12.** Given 119 stored contracts of which 82 have no posture, when a user opens the explorer, the grid shows 37 cards and a visible filter stating that 82 are hidden.
- AE2. **Covers R12, R15.** Given a contract with no recorded posture, when a user clears the default filter and opens that contract, the detail page states that the posture has not been recorded and shows the contract's raw AI-use terms text.
- AE3. **Covers R8.** Given a contract whose project name matches no project, when a user opens it, the contract's own fields and posture guidance render, the missing project link is marked, and the name appears in the unresolved list on the admin projects surface.
- AE4. **Covers R11.** Given 17 contracts sharing one contract number, when a user browses the grid, each appears as its own card and all 17 display that same contract number as their parent.
- AE5. **Covers R5.** Given a populated store and a sheet in which one row has changed and one has been removed, when the operator re-runs population, the run reports one update and one deletion and leaves every other contract untouched.
- AE6. **Covers R18.** Given a policy owner who edits a posture's guidance steps, when a user next opens a contract with that posture, the revised steps are shown and no deploy has occurred.
- AE7. **Covers R2.** Given a contract whose contract number is blank at first population and filled in before a later run, when the later run executes, the contract keeps its identity and its original capture date is not lost.

---

## Success Criteria

- A delivery team member who knows only their project name can reach their contract's AI posture and its guidance steps without asking anyone.
- A team member whose contract is unclassified learns that, rather than concluding their contract is not covered.
- Posture guidance authored in `/projects-admin` is visible to the people it was written for, closing a loop that has been open across three cycles.
- Policy owners can see which project names in the survey resolve to nothing, and the count trends down as they are fixed.
- Planning can proceed without inventing the storage shape, the identifier, the carry policy, or the behavior of any of the three degraded states (no posture, no project, stale data).

---

## Scope Boundaries

- Any scheduled or recurring sync. Population is operator-run.
- Inferring a posture from the free-text AI-use terms on the 82 unclassified contracts.
- Backfilling missing posture values, or any write path from the hub back into the survey.
- The workbook's other two tabs, Compliance and Enterprise AI Tools Inventory.
- Any change to the projects sync, its table, or its safety gate.
- Redaction, field-level access control, or per-column visibility rules.
- Grouping or deduplicating contracts that share a contract number.

---

## Key Decisions

- **A separate contracts store, not a partition of an existing table**: derived from the two admission rules already written into `terraform/dynamodb.tf`. The projects table admits only records re-creatable by a scheduled sync, and the deploy role holds delete rights over it. The reference table admits only entity types governed by its single permission action, which is `projects-admin`-only. Contracts satisfy neither.
- **Identified by portfolio and project**: the only combination measured unique across all 119 rows whose columns are also fully populated. Keying on contract identifiers collapsed 63 rows into 2 identifiers; including the contract number alongside the project reached uniqueness but re-keyed 60 records as the survey gets completed.
- **Visible to every signed-in Nava user**: chosen deliberately, and it reverses the gate that currently restricts all project data to `projects-admin`. Senongo is the accountable owner for this decision and for the class of material it exposes — named individuals, contract and task-order numbers, customers, and verbatim contract clause language.
- **Every column carried, including named individuals and verbatim contract terms**: chosen after the exposure was surfaced. The alternative of carrying only posture-answering fields was declined.
- **Unclassified contracts are hidden by default, not excluded**: the survey is 31% classified, so showing everything would make the default view mostly unanswered. Hiding them behind a visible, clearable filter keeps the default useful without making 82 contracts undiscoverable.
- **Cards named for the grain of the data**: a survey row is an engagement under a contract, not a contract. One contract number spans 17 rows. Naming cards accordingly avoids presenting 17 records as 17 contracts.
- **Population reconciles rather than inserts**: a one-time seed written as a one-time insert makes the first refresh a rewrite, and a refresh is certain given a 31%-classified source.

---

## Dependencies / Assumptions

- The AI Survey workbook (`1GdeIJI92Rb6LipM3l6FhWte7BYXCXe-zPKgJvvmu8G4`) is a different workbook from the projects sync's and required its own share with the service account. That share is now in place; it must stay in place for any refresh.
- Row 3 is the header row. It was carrying a duplicate column name, fixed at the sheet on 2026-08-07 and re-verified clean: 27 columns, no duplicates, no slug collisions.
- Posture values in the survey are already exact posture identifiers, so no mapping rule is needed. Verified: `silent` on 31 rows, `allowed` on 4, `restricted` on 2, empty on 82. No contract carries `prohibited`.
- Project-name resolution is measured, not assumed: of the 37 contracts with a project name, 23 resolve against the projects table and 14 do not. Separately, the survey's BEAM portfolio covers 48 rows and has no counterpart in the projects table at all, so those contracts have no project to resolve to by construction.
- The full field inventory, measured column population, join match rates, and rejected identifier candidates are recorded in `db/projects-schema.md`.

---

## Outstanding Questions

Nothing blocks planning.

### Deferred to Planning

- [Affects R2][Technical] The longest identifier is 170 characters, from one row whose project name is a full change-order title. Display and URL truncation strategy.
- [Affects R8][Technical] Whether the unresolved-name report reuses the existing drift-reporting shape on the admin projects surface or needs its own section.
- [Affects R14][Technical] How the detail page renders the survey's long free-text fields, several of which run to multiple paragraphs of contract clause text.
- [Affects R11][Needs research] Whether "engagement" or "agreement" is the term Nava's contracts team actually uses for a task order under a vehicle.
