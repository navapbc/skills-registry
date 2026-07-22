---
title: "refactor: Scope admin Skills & Agents tab to org-wide skills only"
type: refactor
status: active
date: 2026-07-22
---

# refactor: Scope admin Skills & Agents tab to org-wide skills only

## Summary

Restrict the admin **Skills & Agents** tab (`all-content`) so it lists only org-wide skills (`source === 'enterprise'`), hiding community (GitHub-sourced) skills entirely. The tab keeps its existing edit affordances (category, tags, visibility, compatibility) for the org-wide subset; community skill records are left untouched because they can no longer be reached from this tab. Implemented as a data-source filter at load time plus a small extracted, unit-testable predicate.

---

## Problem Frame

The Skills & Agents tab loads `/api/admin/skills`, which returns **every** skill in the registry — community and org-wide alike — and exposes inline editing of category, tags, visibility, and compatibility. Editing community (GitHub-sourced) skills there is largely futile: category and compatibility are overwritten by the next sync (surfaced today by the in-tab amber "Sync note"). The request is to narrow this tab to org-wide skills, so admins manage exactly the records this surface can meaningfully own, and community records are not modified through it.

---

## Requirements

- R1. The Skills & Agents tab lists only skills where `source === 'enterprise'`.
- R2. Community (GitHub-sourced) skills — any record with `source !== 'enterprise'` — do not appear in the tab and cannot be edited from it.
- R3. Existing tab behavior for the org-wide subset is preserved: type filter (All/Skills/Agents), search, item count, and inline edit/save.
- R4. The item count and empty state reflect the org-wide-only set (no "0 of 843" style mismatch implying hidden rows).

---

## Scope Boundaries

- Do not change the `/api/admin/skills` endpoint — it continues to return all skills; filtering happens client-side in the tab loader. (Other admin surfaces — Queue, Validate — still rely on the full list.)
- Do not modify, migrate, or delete any community skill records or their data.
- Do not change what "org-wide" means elsewhere (site badges, `/skills` page, render helpers) — this plan only scopes one admin tab.
- Do not rename the tab label ("Skills & Agents") in this plan — see Key Technical Decisions.

### Deferred to Follow-Up Work

- **Enterprise Skills tab overlap:** With this change, the Skills & Agents tab and the existing **Enterprise Skills** tab (`enterprise`, via `/api/admin/enterprise-skills`) both surface `source === 'enterprise'` records with overlapping edit capability. Consolidating or differentiating the two tabs is intentionally out of scope here — flag as a separate follow-up. (Note the sets are not identical: Enterprise Skills also shows `anthropic-enterprise` and `anthropic-builtin`; Skills & Agents will show `enterprise` only.)

---

## Context & Research

### Relevant Code and Patterns

- `src/scripts/admin/all-content.mjs` — the tab loader. Line 7–8 fetches `/admin/skills` and assigns `const items = skills;` — this is the single seam to filter. Filtering, search, counts, and row rendering all derive from `items`.
- `src/scripts/admin/index.mjs:27` — registers `loadAllContent` under the `all-content` tab id.
- `src/components/admin/AdminTabs.astro:4` — tab definition `{ id: 'all-content', label: 'Skills & Agents' }`.
- `src/lib/parse-skill.mjs:90` — canonical rule: `record.source = 'enterprise'` iff the skill path starts with `enterprise/`. This is the authoritative definition of org-wide used site-wide (e.g. `src/lib/render.mjs:92`, `src/pages/skills/index.astro:160`).
- `src/lib/admin/format.mjs` and `src/lib/admin/validation-view.mjs` — existing pattern of pure, unit-tested helpers imported by admin scripts. New filter predicate should follow this pattern (pure function, exported, tested).
- `functions/api/routes/admin.mjs:52–71` — `/api/admin/enterprise-skills` already filters by source server-side (`enterprise` + `anthropic-enterprise` + `anthropic-builtin`); useful reference for the org-wide definition but intentionally broader than this tab's `enterprise`-only scope.

### Institutional Learnings

- `docs/solutions/` is empty — no prior learnings apply.

### Notes

- Org-wide (`enterprise`) skills **are** GitHub-synced (from the `enterprise/` tree, `scripts/sync-registry-v2.mjs:268`). The tab's amber "Sync note" about category/compatibility being overwritten by sync therefore remains accurate for the org-wide subset and should stay.

---

## Key Technical Decisions

- **Filter client-side at the loader seam, not at the API.** `/api/admin/skills` is shared by other admin surfaces (Queue, Validate); changing it would ripple beyond this tab. Filtering `items` in `all-content.mjs` is the minimal, contained change. Rationale: smallest blast radius, honors R1–R4 without touching the endpoint contract.
- **Extract the predicate into a pure, exported helper** (e.g. `orgWideOnly(skills)` in `src/scripts/admin/all-content.mjs`, or `src/lib/admin/format.mjs` if colocating with other admin helpers reads better). Rationale: the loader manipulates the DOM and fetches, so it isn't unit-testable as-is; the repo already tests pure admin helpers (`format`, `validation-view`). A one-line predicate behind a named export gives a clean test seam and a readable name at the call site.
- **Keep the tab label "Skills & Agents" as-is.** Renaming risks confusion with the Enterprise Skills tab and belongs to the deferred consolidation decision, not this scoping change. Org-wide skills can still be both skills and agents, so the label is not inaccurate.

---

## Open Questions

### Resolved During Planning

- What counts as "org-wide"? → `source === 'enterprise'` only (user-confirmed). Excludes `anthropic-enterprise` and `anthropic-builtin`.
- Hide community skills or make them read-only? → Hidden entirely (user-confirmed).
- Consolidate with the Enterprise Skills tab? → Not now; note overlap as deferred follow-up (user-confirmed).

### Deferred to Implementation

- Exact home of the extracted predicate (`all-content.mjs` local export vs. `format.mjs`) — decide when touching the file based on what reads cleanest alongside existing helpers.

---

## Implementation Units

- U1. **Scope the Skills & Agents tab to org-wide skills**

**Goal:** The tab lists and edits only `source === 'enterprise'` skills; community skills are excluded from the fetched set, so every downstream behavior (filter, search, count, edit) operates on the org-wide subset automatically.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `src/scripts/admin/all-content.mjs` (introduce and apply the org-wide filter at the `items` assignment; export a pure predicate)
- Test: `tests/frontend/admin-all-content.test.mjs` (new — unit test for the extracted predicate)

**Approach:**
- Replace `const items = skills;` (line 8) with the org-wide-filtered set via a named predicate, e.g. `const items = orgWideOnly(skills);`.
- Define and export `orgWideOnly(skills)` returning `skills.filter(s => s.source === 'enterprise')` — a pure function with no DOM/fetch dependency.
- Leave all downstream logic (`getFiltered`, `renderRows`, `updateCount`, filter buttons, search) unchanged — they already derive from `items`, so the count (`${list.length} of ${items.length}`) and empty state (`No results.`) reflect the org-wide set with no further edits (satisfies R4).
- Keep the amber "Sync note" — it remains accurate because org-wide skills are GitHub-synced.

**Patterns to follow:**
- `src/lib/admin/validation-view.mjs` / `src/lib/admin/format.mjs` — pure exported helpers unit-tested in `tests/frontend/`.
- `src/pages/skills/index.astro:160` and `src/lib/render.mjs:92` — the `source === 'enterprise'` definition of org-wide.

**Test scenarios:**
- Happy path: `orgWideOnly` with a mixed array (records with `source: 'enterprise'`, `source: 'github'`/undefined, `source: 'anthropic-builtin'`, `source: 'anthropic-enterprise'`) returns only the `enterprise` records, preserving order.
- Edge case: empty input array → returns empty array.
- Edge case: no `enterprise` records present → returns empty array (drives the "No results." empty state).
- Edge case: records missing a `source` field are treated as non-org-wide (excluded).
- Edge case: `anthropic-enterprise` and `anthropic-builtin` are excluded (confirms the narrower-than-Enterprise-tab scope, R2).

**Verification:**
- In the admin panel, the Skills & Agents tab shows only org-wide skills; the item count equals the number of `enterprise`-source skills; no community skill rows appear or can be edited.
- The type filter, search, and inline edit/save still work on the org-wide subset.
- `orgWideOnly` unit tests pass under `vitest`.

---

## System-Wide Impact

- **Interaction graph:** Only the `all-content` tab loader is touched. `/api/admin/skills` is unchanged, so Queue and Validate tabs (and any other consumer) are unaffected.
- **API surface parity:** No API change. Server continues to return the full list; scoping is presentation-layer only.
- **Unchanged invariants:** Community skill records, the `/api/admin/skills` and `/api/admin/enterprise-skills` contracts, the site-wide `source === 'enterprise'` org-wide definition, and the Enterprise Skills tab all remain exactly as they are.
- **State lifecycle risks:** None — read-time filter; no writes to community records are possible from this tab after the change.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Admins previously used this tab to edit community skills' tags (tags are sync-safe) and lose that path. | Confirmed acceptable by the scoping decision (community not modified here). Community tag editing, if still needed, is a separate surface — call out in the deferred Enterprise-tab consolidation review. |
| Redundancy/confusion between Skills & Agents and Enterprise Skills tabs (both now org-wide). | Explicitly deferred; documented under Scope Boundaries → Deferred to Follow-Up Work. |

---

## Sources & References

- Tab loader: `src/scripts/admin/all-content.mjs`
- Loader registration: `src/scripts/admin/index.mjs:27`
- Tab definition: `src/components/admin/AdminTabs.astro:4`
- Org-wide source rule: `src/lib/parse-skill.mjs:90`
- Enterprise API (reference for broader source set): `functions/api/routes/admin.mjs:52`
