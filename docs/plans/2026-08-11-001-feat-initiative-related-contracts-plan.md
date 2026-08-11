---
title: "feat: Link related contracts from the initiative detail page"
type: feat
status: completed
date: 2026-08-11
---

# feat: Link related contracts from the initiative detail page

## Summary

When an initiative resolves to a project, the initiative detail page should show the contracts that resolve to that same project, each linked to its Contract Explorer detail page. The join happens server-side in `functions/api/routes/initiatives.mjs` but only when the request names a single initiative (`?id=<initiative_id>`), so the grid view keeps its current single-partition cost. A new section renders after the existing Project section.

---

## Problem Frame

The Initiatives Hub already answers "which project does this initiative run on" — `renderProjectSection` in [src/lib/initiatives-render.mjs:353](src/lib/initiatives-render.mjs#L353) shows the resolved project's portfolio, agency, managers, and archetypes. It does not answer the follow-up question a reader almost always has next: *what are the contract terms for that project's AI work?* That answer exists at `/contracts/<contract_id>`, but a reader has to leave the page, go to the Contract Explorer, and search for the project by name — a name they can only guess at, since the contracts survey records its own `project` string that frequently differs from the project record's `project_name`.

The two datasets already share a join key: both `resolveProject` implementations ([functions/api/lib/initiatives.mjs:74](functions/api/lib/initiatives.mjs#L74) and [functions/api/lib/contracts.mjs:69](functions/api/lib/contracts.mjs#L69)) resolve to records in the same projects table. Nothing surfaces that shared edge to the reader.

---

## Requirements

- R1. When an initiative resolves to a project, the detail page lists the contracts that resolve to that same project.
- R2. Each listed contract links to its own detail page at `/contracts/<contract_id>`.
- R3. The section appears after the Project section in the detail layout.
- R4. An initiative with no resolved project shows no contracts section (there is nothing to join on).
- R5. An initiative whose project resolves but which no contract names says so, rather than rendering an empty or absent block. The claim is that no contract *names* the project — not that the project has no contract, which the join cannot establish.
- R6. The grid view (`/initiatives` with no id) does not pay for the contracts read.

---

## Scope Boundaries

- No change to the contracts table, the contracts sync, or the Contract Explorer page itself.
- No reverse link — the contract detail page does not gain an "initiatives on this project" section. That is a separate, larger change to `/api/contracts` and its renderer.
- No posture badge on the listed contracts. Resolving `ai_posture` to a display label requires the project-reference partition, which `/api/initiatives` does not read (see Key Technical Decisions).
- No new filter or facet on the grid view derived from contract data.
- No widening of the contracts projection beyond the fields the section renders.

---

## Context & Research

### Relevant Code and Patterns

- [functions/api/routes/initiatives.mjs](functions/api/routes/initiatives.mjs) — `serveInitiatives` already queries two partitions (initiatives, projects) and resolves on read. `INITIATIVE_FIELDS` and `PROJECT_FIELDS` are allowlists, deliberately, because the sync upstream uses a denylist.
- [functions/api/lib/initiatives.mjs](functions/api/lib/initiatives.mjs) — `resolveProject` for initiatives (matches `project_name` only, measured).
- [functions/api/lib/contracts.mjs:69](functions/api/lib/contracts.mjs#L69) — `resolveProject` for contracts (matches `project_name` **or** `contract_name`, measured at 23 of 37). The two rules differ on purpose; both must be used as-is.
- [functions/api/routes/contracts.mjs](functions/api/routes/contracts.mjs) — `CONTRACT_FIELDS`, the existing allowlist to draw the narrow projection from. Also the source of the `queryPartition` shape duplicated in the initiatives route.
- [src/lib/initiatives-render.mjs:353](src/lib/initiatives-render.mjs#L353) — `renderProjectSection`, the section the new one sits after; [line 447](src/lib/initiatives-render.mjs#L447) is the call site inside `renderInitiativeDetail`.
- [src/lib/contracts-render.mjs:123](src/lib/contracts-render.mjs#L123) — `renderContractCard`, which establishes the contract's display name (`contract.project || contract.contract_id`) and the `/contracts/<id>` href with `encodeURIComponent`.
- [src/pages/initiatives/index.astro:42](src/pages/initiatives/index.astro#L42) — where `initiativeId` is derived from the pathname, before the single `fetchApi('/initiatives')` call.
- [terraform/lambda.tf:175](terraform/lambda.tf#L175) — `DynamoDBContractsRead` already grants the API Lambda read on the contracts table. No infrastructure change is needed.

### Institutional Learnings

- Tailwind classes must be complete literal strings, never assembled by interpolation — see the `EXPOSURE_CLASSES` comment at [src/lib/initiatives-render.mjs:121](src/lib/initiatives-render.mjs#L121). Any new badge or colour in this work follows that rule.
- `navy` is not a registered Tailwind theme colour in this project; `bg-navy-100` emits no CSS.
- The resolved-project field is named `resolved_project`, not `project`, because the sheet could gain a column of that name. The new field should follow the same defensive naming.

---

## Key Technical Decisions

- **Join server-side, gated on `?id=<initiative_id>`** (user decision): the route keeps returning the full initiative list so the page's existing `find()` still works, but performs the contracts query and attaches `related_contracts` only to the named initiative. Rationale: the grid view never renders contracts, so making all 37 records carry them would read a whole extra partition on every hub load for data one record uses. The client already knows the id before it fetches.
- **Ask the contracts rule a one-project question.** For the named initiative, resolve its project (initiatives rule), then apply the contracts-side `resolveProject` against a list holding only that project, keeping the contracts it answers for. Matching the two sheets' project-name strings directly would silently drop every contract that resolves via `contract_name`, which is a substantial share of the survey — so the contracts rule has to be the one used.

  *Amended during implementation.* The plan originally said to resolve each contract across the whole projects table and test the answer for identity with the target project. Review found that wrong: the contracts rule returns the first record matching on `project_name` **or** `contract_name`, so when one project's `contract_name` collides with another's `project_name` the contract is handed to the wrong record and the membership test finds nothing — rendering "no contracts" for a project that has one. Three live project records share `contract_name: "dmod 2.0"`. Comparing `project_code` instead of identity fails the same way. Asking the one-project question cannot, and is O(contracts) rather than O(contracts × projects).
- **`related_contracts` is a narrow projection, an allowlist.** Same discipline as `PROJECT_FIELDS`: `contract_id`, `project`, `contract_num`, `vehicle`, `customer`, `agreement_type`. Both datasets are already readable by every signed-in user, so this widens no audience, but spreading whole contract records would ship survey columns to this page with no review step.
- **Absent field vs. empty array carries meaning.** `related_contracts` is absent on every record in a grid-view response (not computed) and is an array — possibly empty — on the named record in a detail-view response. The renderer distinguishes them: absent means "not asked for", `[]` means "asked, and no contract on file names this project". `[]` is *not* evidence the project has no contract: only 43 of 119 contracts record a project name at all, so the empty result usually means the link has not been made.
- **No posture badge.** Rendering `ai_posture` would either show a raw id (`allowed`) with no label, or require the route to read the project-reference partition purely for display. The link to `/contracts/<id>` is where posture is answered properly.
- **Contract display name mirrors `renderContractCard`**: `contract.project || contract.contract_id`, so the same contract reads the same way on both pages.

---

## Open Questions

### Resolved During Planning

- *Does the API Lambda have read access to the contracts table?* Yes — `DynamoDBContractsRead` at [terraform/lambda.tf:175](terraform/lambda.tf#L175). Same Lambda serves both routes.
- *Which resolveProject rule applies to the contracts side?* The contracts one, from `functions/api/lib/contracts.mjs`. The two rules are deliberately different and both are measured; neither should be widened for symmetry.
- *Does an unresolved-project initiative need a contracts section?* No. R4 — there is no join key, and the Project section already explains why in both of its unresolved variants.

### Deferred to Implementation

- Exact ordering of the contract list. Alphabetical by display name is the presumed default; whether `contract_num` or recency reads better is a judgement made against real data.
- Whether the section reuses `rowShell`/`row` from the renderer or gets its own list markup. Depends on how the fields lay out once rendered.
- Whether the query parameter is named `id` or `initiative_id`. Pick whichever reads better against the sibling routes at implementation time and document it consistently.

---

## Implementation Units

- U1. **Attach `related_contracts` to a single-initiative request**

**Goal:** `/api/initiatives?id=<initiative_id>` returns the same payload as today, plus a `related_contracts` array on the matching record.

**Requirements:** R1, R4, R5, R6

**Dependencies:** None

**Files:**
- Modify: `functions/api/routes/initiatives.mjs`
- Modify: `functions/api/lib/initiatives.mjs` (join helper + the contracts projection allowlist)
- Test: `tests/api/routes/initiatives.test.mjs`
- Test: `tests/api/lib/initiatives.test.mjs`

**Approach:**
- Add a helper to `functions/api/lib/initiatives.mjs` that, given a project record, the contract records, and the project records, returns the contracts resolving to that project. It imports `resolveProject` from `./contracts.mjs` — a sibling import inside `functions/api/lib/`, which respects the Lambda-zip dependency direction documented at the top of both files.
- In `serveInitiatives`, read the `id` query parameter. When absent, behave exactly as today: no contracts-table read, no `related_contracts` key on any record.
- When present, look up the named initiative in the already-fetched list. Skip the contracts read entirely when the id matches nothing, or when the matched initiative has no resolved project — both cases render without a contracts section.
- Otherwise query the contracts partition (reuse the route's existing `queryPartition`), filter by the join, project each through the new allowlist, and attach.
- Guard the contracts table name the way the existing 503 guards `table` and `projectsTable` — but only on the `?id=` path, so a missing `CONTRACTS_TABLE` cannot 503 the grid view that never needed it.

**Patterns to follow:**
- `project_summary` / `PROJECT_FIELDS` in the same file, for the projection shape.
- The `resolved_project` naming comment for why the key is not called `contracts`.

**Test scenarios:**
- Happy path: request with `?id=` for an initiative whose project owns three contracts → response carries `related_contracts` with those three, each holding exactly the allowlisted fields.
- Happy path: a contract that resolves to the project via `contract_name` rather than `project_name` is included.
- Edge case: request with no `id` → no contracts-partition read is issued (assert on the mocked DynamoDB client), and no record carries `related_contracts`.
- Edge case: `?id=` names an initiative with no resolved project → no contracts read, and `related_contracts` is absent from the record.
- Edge case: `?id=` names an initiative whose project no contract names → `related_contracts` is `[]`, not absent.
- Edge case: `?id=` names an initiative that does not exist → response is the unchanged full list, no contracts read, HTTP 200 (the page renders its own not-found).
- Edge case: a contract with an empty `project_name` never joins to anything.
- Error path: the contracts partition query throws → the route's existing catch returns 500 with the generic message, rather than degrading to a silent empty list.
- Integration: the projection carries no field outside the allowlist even when the stored contract record has extra attributes.

**Verification:**
- Grid-view responses are byte-identical to before the change.
- A detail-view response contains linkable contract ids that exist in the contracts table.

---

- U2. **Render the related-contracts section**

**Goal:** A section after the Project section listing each related contract as a link to `/contracts/<contract_id>`.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** U1

**Files:**
- Modify: `src/lib/initiatives-render.mjs`
- Test: `tests/frontend/initiatives-render.test.mjs`

**Approach:**
- Export `renderRelatedContractsSection(initiative)` and call it from `renderInitiativeDetail` immediately after `renderProjectSection(initiative)`.
- Three states: field absent → render nothing (the grid view and the no-project case both land here); empty array → a section saying no contract on file names this project, hedged because most contracts record no project name at all; non-empty → a list.
- Each entry: display name (`contract.project || contract.contract_id`) as the link text, with contract number, vehicle, and customer as secondary text where present. Escape everything; build the href with `encodeURIComponent` on `contract_id`.
- These are internal links, so no `target="_blank"` / `rel="noopener"` — unlike `renderOneLink`, which handles sheet-authored external URLs.
- Reuse the section shell markup (`rounded-lg p-4 border border-gray-200 bg-white`, `text-sm font-semibold` heading) and the `text-plum-700 underline` link treatment already used in this file. All Tailwind classes are written as complete literals.

**Patterns to follow:**
- `renderProjectSection` for the section shell and the `aria-label` convention.
- `renderContractCard` in `src/lib/contracts-render.mjs` for the display-name expression and href construction.
- `NONE_LISTED` styling for the "no contracts" copy, so an absent answer never reads as a real one.

**Test scenarios:**
- Happy path: two contracts → two anchors with `href="/contracts/<id>"` and the expected display names.
- Happy path: a contract with no `project` value falls back to showing its `contract_id`.
- Edge case: `related_contracts` absent → the function returns an empty string and `renderInitiativeDetail` emits no section.
- Edge case: `related_contracts` is `[]` → the section renders with the hedged "no contract on file names this project" message.
- Edge case: a contract id containing a space or slash is percent-encoded in the href.
- Edge case: a contract whose optional secondary fields are all empty renders the name alone without stray separators.
- Security: a contract whose `project` contains `<script>` is escaped in the output.
- Integration: `renderInitiativeDetail` places the section after the Project section — assert on the relative index of the two `aria-label` markers in the emitted HTML.

**Verification:**
- Rendering an initiative with no project produces exactly the markup it produced before this change.

---

- U3. **Request the join from the detail view**

**Goal:** The page asks for `related_contracts` when, and only when, it is rendering a detail view.

**Requirements:** R1, R6

**Dependencies:** U1

**Files:**
- Modify: `src/pages/initiatives/index.astro`

**Approach:**
- `initiativeId` is already derived from the pathname before the fetch. Append the query parameter to the `fetchApi` path when it is non-empty, and leave the call untouched otherwise.
- Encode the id into the query string; the same malformed-escape fallback that exists today still applies, and a nonsense id is handled by U1 returning the plain list.
- No other change to the page — the detail branch still finds its record in `data.initiatives`, and the grid branch is unaffected.

**Patterns to follow:**
- The existing `fetchApi` usage and the `Unauthorized` suppression around it.

**Test scenarios:**
- Test expectation: none — this is a one-line request-shape change with no unit-testable seam in the Astro page; its behaviour is covered by U1's route tests and U2's renderer tests. Verify by hand.

**Verification:**
- Loading `/initiatives` issues one API request with no `id` parameter; loading `/initiatives/<id>` issues one with it.
- A detail page for an initiative on a contracted project shows the section, and its links land on the right contract pages.

---

- U4. **Document the endpoint change**

**Goal:** The API reference and OpenAPI schema describe `related_contracts` and the `?id=` parameter.

**Requirements:** R1

**Dependencies:** U1

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/openapi.yaml`

**Approach:**
- Extend the `GET /api/initiatives` section: document the query parameter, the example payload, and — importantly — that `related_contracts` is absent rather than empty when not requested, plus why the join uses the contracts-side resolution rule.
- Mirror the existing prose style, which explains the *reason* for each projection rather than only listing fields.
- Add the parameter and the new schema property to `docs/openapi.yaml` alongside the existing initiatives entry.

**Patterns to follow:**
- The `resolved_project` paragraph at `docs/api.md` under the initiatives section.

**Test scenarios:**
- Test expectation: none — documentation only.

**Verification:**
- The documented payload matches what U1's tests assert.

---

## System-Wide Impact

- **Interaction graph:** `/api/initiatives` gains a read of the contracts partition on the detail path only. Same Lambda, existing IAM grant, no Terraform change.
- **Error propagation:** A contracts-read failure on a detail request surfaces as the route's existing 500 and the page's error state. It does not degrade to a page that silently claims the project has no contracts — that would be a false answer to R5's question.
- **State lifecycle risks:** None; every write surface is the sync workflow and nothing here writes.
- **API surface parity:** `/api/contracts` is unchanged. The reverse link (initiatives on a contract page) is explicitly out of scope, so the two pages are asymmetric after this work — an intentional gap, not an oversight.
- **Integration coverage:** The absent-vs-empty distinction on `related_contracts` spans the route and the renderer; a test in each is what proves the pair agrees.
- **Unchanged invariants:** The grid-view response shape, `INITIATIVE_FIELDS`, `PROJECT_FIELDS`, both `resolveProject` rules, and the non-capability-gated read posture of both endpoints.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The two `resolveProject` rules drift apart, quietly changing which contracts appear | The helper imports the contracts rule rather than reimplementing it; U1's `contract_name`-resolution test fails if it is swapped for the initiatives rule |
| The absent-vs-empty contract is misread, so the grid renders a spurious "no contracts" block | Renderer tests cover both states explicitly; the grid never calls the detail renderer anyway |
| Contracts-partition read latency on every detail load | 119 records, one query, on a page that already reads two partitions. Detail-only gating keeps it off the hub landing page |
| A future spread replaces the `related_contracts` allowlist and ships survey columns | The allowlist carries the same comment as `PROJECT_FIELDS` explaining it is the review step the upstream denylist gives up |

---

## Sources & References

- Related code: [functions/api/routes/initiatives.mjs](functions/api/routes/initiatives.mjs), [functions/api/lib/contracts.mjs](functions/api/lib/contracts.mjs), [src/lib/initiatives-render.mjs](src/lib/initiatives-render.mjs)
- Prior plans: [docs/plans/2026-08-10-001-feat-initiatives-hub-and-sync-plan.md](docs/plans/2026-08-10-001-feat-initiatives-hub-and-sync-plan.md), [docs/plans/2026-08-07-002-feat-contract-explorer-page-plan.md](docs/plans/2026-08-07-002-feat-contract-explorer-page-plan.md)
- API docs: [docs/api.md](docs/api.md)
