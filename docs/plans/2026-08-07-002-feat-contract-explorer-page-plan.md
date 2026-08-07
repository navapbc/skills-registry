---
title: "feat: Contract Explorer page"
type: feat
status: completed
date: 2026-08-07
origin: docs/brainstorms/2026-08-07-contract-explorer-requirements.md
---

# feat: Contract Explorer page

## Summary

Adds a read route serving contracts to every signed-in Nava user, a single client-rendered page providing both the card grid and the detail view, a sidebar link, and the CloudFront edge-function change without which detail URLs return a 404 page.

---

## Problem Frame

Plan 1 leaves a correct contracts store that nothing reads. Posture guidance authored in `/projects-admin` still reaches no delivery team member, which was the point of connecting contracts to postures in the first place. Full context in the origin document.

This plan is also where the exposure decision takes effect: all project data is gated to `projects-admin` today, and this is the first hub surface to serve contract-confidential material to every signed-in user. Senongo is the accountable owner (see origin).

---

## Requirements

- R9. A Contract Explorer navigation link is available to every signed-in Nava user.
- R10. Contracts are presented as a card grid, one card per record.
- R11. Cards name each record for what it is — an engagement or agreement — with its contract number shown as the parent where one exists.
- R12. The grid hides contracts with no recorded posture by default, via a visible filter stating how many are hidden and able to be cleared.
- R13. The grid can be narrowed by posture and by portfolio.
- R14. Opening a card shows a detail page with the contract's fields, the associated project's details, and the posture's guidance steps.
- R15. A contract with no recorded posture says so plainly and shows its raw AI-use terms instead.
- R16. Every card and detail page states when the data was captured.
- R17. The explorer is read-only.
- R18. Posture labels, colors, ordering, and guidance come from the posture records, so posture edits need no deploy.

**Origin actors:** A1 (delivery team member), A2 (policy owner), A4 (Senongo)
**Origin flows:** F1 (look up a contract's posture), F2 (look up an unclassified contract)
**Origin acceptance examples:** AE1 (covers R12), AE2 (covers R12, R15), AE3 (covers R8 from Plan 1, surfaced here), AE4 (covers R11), AE6 (covers R18)

---

## Scope Boundaries

- No change to the contracts table shape, the population script, or the safety gate — all Plan 1.
- No write path: no create, update, or delete of contracts anywhere in the hub.
- No grouping or deduplication of contracts sharing a contract number.
- No inference of posture from free-text terms for the unclassified records.
- No redaction or field-level access control. Every carried column is served.
- No cache-behavior tuning for the contracts endpoint.
- No change to the projects sync or the existing `/projects-admin` surfaces beyond what Plan 1 already did.

---

## Context & Research

### Relevant Code and Patterns

- `src/pages/skills/index.astro` — **one page serves both `/skills` and `/skills/<slug>`**, branching on `window.location.pathname`. Loading skeleton, then client-side fetch, then render. The direct model for this plan's page.
- `src/lib/render.mjs` — `renderSkillGrid`, `renderSkillCard`, `escapeHtml`. Grid is a three-column responsive layout of equal-height cards.
- `src/lib/api.mjs` — `fetchApi`.
- `src/components/Sidebar.astro` — `mainNav` array; each entry is href, icon glyph, id, label.
- `functions/api/routes/projects.mjs` — `queryPartition` paging helper, read-time resolution against `project_reference`, and the shape of a composed response.
- `functions/api/lib/permissions.mjs` — `can`, the ladder, and `CAPABILITY_ROLES`. Note that a plain authenticated read is not currently expressible as a named action; `plugins.mjs` leaves its list open to any signed-in user and is the precedent.
- `functions/edge/auth-check.js.tpl` — `rewriteUri` carries a **hardcoded allowlist** of CSR shell paths (`/skills`, `/plugins`, `/agents`, `/category`, `/admin`, `/submit`). Anything not listed falls through to `uri + '/index.html'`.
- `terraform/cloudfront.tf` — the `auth_check` function resource, the `/api/*` catch-all behavior, and the 404 custom error response pointing at `/404.html`.
- `tests/api/permissions.test.mjs` — enumerates every privileged action against each role; the standing obligation described in `docs/rbac-permissions.md`.

### Institutional Learnings

- Interpolated Tailwind classes emit no CSS. Posture colors come from data and must be applied as inline styles — the same constraint that governs archetype colors today.
- `docs/rbac-permissions.md` records a standing obligation: any new action added to a rank-gated set must be asserted denied for every capability role in `tests/api/permissions.test.mjs`.

### External References

- None. Every pattern has direct in-repo examples.

---

## Key Technical Decisions

- **A contracts entry must be added to the edge function's CSR path allowlist.** Without it, `/contracts` resolves and `/contracts/<id>` falls through to a nonexistent object and serves the 404 page. This is the single highest-risk item in the plan because it fails only on the detail route, which is easy to miss when testing the grid.
- **Served through the uncached `/api/*` catch-all**, not a dedicated 60s cache behavior like `/api/skills`. The read cache policy on those behaviors does not forward cookies, which is fine for a shared public response and wrong for a cookie-authenticated one.
- **One Astro page for grid and detail**, branching on pathname, matching the skills page. Two pages would duplicate the fetch, the loading state, and the not-found rendering.
- **Read gate is authenticated-user, not a new capability role**: the origin decision is that every signed-in user can read this. A capability role would be assigned to nobody and would strip whatever role its holder had, since the role field holds one value.
- **One endpoint returning contracts, postures, and the resolved project details together**, rather than three round trips. The volume is small and a single response means the card grid and the detail view cannot disagree about freshness — the same reasoning already applied to `GET /api/projects`.
- **Posture presentation read from the posture records at request time**, never copied into the contract, so a posture edited in `/projects-admin` changes the explorer with no deploy.
- **Unclassified contracts are filtered in the client, not excluded server-side.** The response carries all records; the default filter is a view state. Excluding them server-side would make the hidden count unavailable and the filter uncleaable without a second request.

---

## Open Questions

### Resolved During Planning

- How do detail URLs resolve for a statically built site? Via the edge function's rewrite allowlist, which must be extended. Confirmed by reading `functions/edge/auth-check.js.tpl`.
- Does serving contracts need a new permission action? No — authenticated-user read, following the `plugins.mjs` precedent.

### Deferred to Implementation

- Truncation point and treatment for the 170-character identifier in the URL and card title.
- Whether the detail page renders the multi-paragraph clause text expanded or behind a disclosure: a layout judgment better made against real content.
- Whether portfolio filtering needs a combined control with posture or two independent ones: settled by seeing the grid at real volume.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
request /contracts/<id>
        │
        ▼
  CloudFront viewer-request  ── auth cookie invalid ─► /login
        │
        ▼
  rewriteUri()   ◄── MUST know about /contracts, or this becomes
        │              /contracts/<id>/index.html ─► S3 404 ─► /404.html
        ▼
  /contracts/index.html   (one page, both views)
        │
        ├── pathname is /contracts        ─► grid view
        └── pathname is /contracts/<id>   ─► detail view
                    │
                    ▼
            GET /api/contracts  ─► { contracts, postures, projects_by_code, captured_at }
```

---

## Implementation Units

- U1. **Contracts read route**

**Goal:** Any signed-in user can read every contract, its posture, and its resolved project in one request.

**Requirements:** R14, R17, R18

**Dependencies:** Plan 1 complete

**Files:**
- Create: `functions/api/routes/contracts.mjs`
- Modify: `functions/api/index.mjs`
- Modify: `functions/api/lib/dynamo.mjs`
- Create: `tests/api/routes/contracts.test.mjs`
- Modify: `tests/api/permissions.test.mjs`

**Approach:**
- One `GET` returning contracts, the posture records, and the project details needed to render a detail view. Volume is small enough that splitting buys nothing.
- Authenticated-user gate. Reject anonymous requests; admit every role including capability roles.
- Resolve project names and postures at request time, case-folded and whitespace-collapsed, reusing the rule from the shared contracts lib rather than reimplementing it.
- Include the capture timestamp in the response so the page never has to derive freshness from record contents.
- No create, update, or delete handler. Note in the module why, as `projects.mjs` does — the write surface is the population script, and the Lambda's IAM grant omits write actions.

**Patterns to follow:**
- `functions/api/routes/projects.mjs` for the paging helper and composed response.
- `functions/api/routes/plugins.mjs` for a read left open to any signed-in user.

**Test scenarios:**
- Happy path: a signed-in user with the base role receives all contracts.
- Happy path: `Covers AE6.` A contract's posture guidance in the response reflects the current posture record, and editing that record changes the response without a redeploy.
- Happy path: the response carries the capture timestamp.
- Happy path: `Covers AE3.` A contract whose project name resolves includes the project's details; one that does not resolve is present with the project marked absent.
- Edge case: an empty contracts table returns an empty collection, not an error.
- Edge case: a contract whose posture value matches no posture record is returned with the posture unresolved rather than omitted.
- Edge case: more contracts than one page of results returns all of them.
- Error path: an unauthenticated request is refused.
- Integration: `maintain`, `admin`, `projects-admin`, and base `user` can all read; the permissions suite asserts each explicitly, per the standing obligation in the RBAC doc.
- Integration: no write verb is routed — a POST, PUT, PATCH, or DELETE to the endpoint does not mutate the table.

**Verification:**
- A base-role session receives all 119 contracts with resolved postures.
- The permissions suite enumerates every role against the new read.

---

- U2. **Edge routing for contract detail URLs**

**Goal:** `/contracts/<id>` serves the explorer page rather than the 404 page.

**Requirements:** R14

**Dependencies:** None

**Files:**
- Modify: `functions/edge/auth-check.js.tpl`
- Modify: `terraform/cloudfront.tf` *(only if the function's publish path requires it)*

**Approach:**
- Add contracts to the CSR shell path allowlist in `rewriteUri`, alongside the six existing entries.
- The function is templated by terraform and published as a CloudFront function, so this ships through an apply rather than the S3 site sync. Sequence it before or with the page, never after — the grid would work while every detail link 404s.
- Leave the auth behavior untouched; this is a rewrite change only.

**Execution note:** Verify the rewrite against a detail-shaped path before building the page, so a routing failure is not mistaken for a rendering bug later.

**Patterns to follow:**
- The six existing entries in `rewriteUri`, and the comment above them explaining why directory-format output needs the rewrite.

**Test scenarios:**
- Happy path: a contracts detail path rewrites to the explorer page's index object.
- Happy path: the bare contracts path rewrites to the same object.
- Edge case: a path with a file extension is passed through unchanged.
- Edge case: an unrelated path still falls through to the default directory-index rewrite.
- Edge case: the existing six allowlisted prefixes rewrite exactly as before.

**Verification:**
- After apply on staging, a detail-shaped URL returns the explorer page shell, not the 404 page.
- The six existing routes are unaffected.

---

- U3. **Explorer page and card grid**

**Goal:** A signed-in user can browse contracts as cards and narrow them.

**Requirements:** R10, R11, R12, R13, R16

**Dependencies:** U1, U2

**Files:**
- Create: `src/pages/contracts/index.astro`
- Modify: `src/lib/render.mjs`
- Create: `tests/frontend/contracts-grid.test.mjs`

**Approach:**
- One page, branching on pathname, with a loading skeleton and a not-found state, mirroring the skills page.
- One card per record. The card names the record as an engagement or agreement, not a contract, and shows its contract number as the parent where one exists — several cards legitimately share a number and must read as related rather than duplicated.
- The default view hides records with no posture. The control is visible, states the hidden count, and clears in one action. Hiding without the count is the failure mode to avoid: a user whose contract is unclassified must not conclude it does not exist.
- Posture and portfolio filters narrow the visible set. Posture options come from the posture records, in their authored display order.
- Posture colors are applied as inline styles. An interpolated class emits no CSS and the badge renders blank.
- The capture date is stated once on the grid rather than repeated on every card.

**Patterns to follow:**
- `src/pages/skills/index.astro` — pathname branch, skeleton, fetch, render, not-found markup.
- `renderSkillGrid` and `renderSkillCard` in `src/lib/render.mjs` for card and grid structure.

**Test scenarios:**
- Happy path: `Covers AE1.` Given 119 contracts of which 82 have no posture, the default grid shows 37 cards and the filter states that 82 are hidden.
- Happy path: `Covers AE1.` Clearing the filter shows all 119.
- Happy path: `Covers AE4.` Contracts sharing a contract number each render their own card, all displaying that number.
- Happy path: filtering by a posture shows only contracts carrying it; filtering by a portfolio shows only that portfolio.
- Happy path: posture options appear in the postures' authored display order, not alphabetically.
- Edge case: a posture badge's color is emitted as an inline style.
- Edge case: an empty response renders an explicit empty state, not a bare grid.
- Edge case: every contract having a posture renders the filter with a zero hidden count rather than hiding the control.
- Edge case: a very long project name is truncated in the card title without breaking the grid layout.
- Error path: a failed fetch renders an error state rather than an indefinite skeleton.
- Integration: combining a posture filter with the default unclassified filter yields the intersection, and clearing one leaves the other applied.

**Verification:**
- The grid lands showing only classified contracts, with an accurate hidden count.
- Filters compose and clear independently.

---

- U4. **Contract detail view**

**Goal:** Opening a card answers the AI-posture question and shows the surrounding context.

**Requirements:** R11, R14, R15, R16, R17

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `src/pages/contracts/index.astro`
- Modify: `src/lib/render.mjs`
- Create: `tests/frontend/contracts-detail.test.mjs`

**Approach:**
- Three regions: the contract's own fields, the resolved project's details, and the posture's guidance steps.
- Guidance steps come from the posture record and render in their authored order.
- When no posture is recorded, say so plainly and show the raw AI-use terms in its place. Every record carries that text, so this region is never empty.
- When the project does not resolve, render the contract fully and mark the project link as missing. The posture answer does not depend on the join.
- State the capture date.
- Long free-text fields — the clause language in particular — need a layout that does not bury the posture answer beneath several paragraphs of contract text.
- No edit affordances anywhere.

**Patterns to follow:**
- The detail branch of `src/pages/skills/index.astro`, including its not-found markup.
- The archetype and posture rendering already used on `/projects-admin`.

**Test scenarios:**
- Happy path: a contract with a posture shows its label, color, and guidance steps in authored order.
- Happy path: `Covers AE2.` A contract with no posture states that plainly and shows its raw AI-use terms.
- Happy path: `Covers AE3.` A contract whose project resolves shows the project's details; one that does not shows the contract fully with the project link marked missing.
- Happy path: `Covers AE6.` Guidance steps reflect the current posture record.
- Happy path: the capture date is shown.
- Edge case: a contract whose optional fields are all empty renders without empty-labelled rows.
- Edge case: multi-paragraph clause text renders with its paragraph breaks intact and does not push the posture answer off-screen.
- Edge case: an unknown identifier in the URL renders the not-found state, not an error.
- Error path: a failed fetch renders an error state.
- Integration: navigating from a card to its detail and back preserves the grid's filter state.

**Verification:**
- A classified contract, an unclassified one, and one with an unresolved project each render correctly.
- No control on the page mutates data.

---

- U5. **Navigation link**

**Goal:** The explorer is reachable without knowing the URL.

**Requirements:** R9

**Dependencies:** U3

**Files:**
- Modify: `src/components/Sidebar.astro`
- Modify: `tests/frontend/contracts-grid.test.mjs`

**Approach:**
- Add an entry to the sidebar's main nav list, following the existing shape.
- Visible to every signed-in user — no role condition. This is the deliberate widening recorded in the origin document; `/projects-admin` remains unlinked.

**Patterns to follow:**
- The `mainNav` entries in `src/components/Sidebar.astro`.

**Test scenarios:**
- Happy path: the link is present for a base-role user and points at the explorer.
- Edge case: the link is present regardless of role, including `projects-admin`.
- Edge case: adding it does not displace or duplicate the existing entries.

**Verification:**
- The link appears for a base-role session and reaches the grid.

---

## System-Wide Impact

- **Interaction graph:** A new endpoint on the API Lambda reading three tables. The edge function gains a branch on the hottest path in the system — every request passes through it.
- **Error propagation:** A missing posture record or unresolvable project must degrade the affected region, never the page. A failed fetch must produce an error state rather than a permanent skeleton.
- **State lifecycle risks:** None on the server — the plan adds no writes. Client-side, filter state is view state and must not persist in a way that makes a later visit silently hide records.
- **API surface parity:** The read is deliberately open where every other project-data read is capability-gated. That asymmetry is the origin decision and should be commented at the route so a future reader does not "fix" it.
- **Integration coverage:** The edge rewrite and the composed three-table read are not provable by unit tests with mocks alone. Both need verification against a deployed staging environment.
- **Unchanged invariants:** `manage:project-reference` grants exactly what it grants today. `/projects-admin` stays unlinked and unchanged. The contracts table shape, the population script, and the projects sync are untouched. No existing route changes its gate.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Edge allowlist omitted or deployed after the page; grid works and every detail link 404s | Medium | High | U2 sequenced before the page, verified independently against staging before U3 begins |
| Contract-confidential material reaches an audience it should not | Low | High | Deliberate decision with a named owner in the origin document; the route is commented so the asymmetry is not mistaken for an oversight |
| Posture badge renders blank | Medium | Low | Inline styles only; asserted in a test |
| Default filter hides a user's contract and they conclude it is not covered | Medium | Medium | Hidden count is on the visible control and asserted; the unclassified detail view states the position plainly |
| Detail page buries the posture answer under clause text | Medium | Medium | Layout treats the posture as the primary region; long-text handling deferred to implementation against real content |
| Edge function change affects every request in the system | Low | High | Rewrite-only change; the six existing prefixes are asserted unchanged |

---

## Documentation / Operational Notes

- The edge function ships via terraform apply, not the S3 site sync. Applying and deploying in the wrong order produces a working grid with broken detail links.
- This is the first hub surface serving contract-confidential material to all signed-in staff. Senongo is the accountable owner; `docs/rbac-permissions.md` should note that contract reads are deliberately outside the capability model.
- No monitoring or feature flag proposed. The page is additive and reversible by removing the nav link.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-07-contract-explorer-requirements.md](docs/brainstorms/2026-08-07-contract-explorer-requirements.md)
- Prerequisite plan: `docs/plans/2026-08-07-001-feat-contracts-table-and-population-plan.md`
- Schema: `db/projects-schema.md`
- Precedents: `src/pages/skills/index.astro`, `functions/api/routes/projects.mjs`, `functions/api/routes/plugins.mjs`, `functions/edge/auth-check.js.tpl`
- Permission model: `docs/rbac-permissions.md`
