---
title: "refactor: Remove Categories admin tab & featured skills"
type: refactor
status: active
date: 2026-07-22
origin: docs/brainstorms/2026-07-22-remove-featured-skills-requirements.md
---

# refactor: Remove Categories Admin Tab & Featured Skills

## Summary

Delete the "featured skills" concept end-to-end: the admin Categories tab, both featured endpoints, the public `/api/categories` endpoint (dead — see U3), the `manage:categories` permission, the dead `category-config` guards, the `featuredSlugs` field in static category config, the `category::<id>` DynamoDB rows, and the docs describing them. Category *membership* (Shape A) is untouched. Ordered so code stops referencing the rows before the rows are deleted.

---

## Problem Frame

"Featured skills" was built during the RBAC admin work (PR #39) but never reached the UI — nothing renders `featuredSlugs`. It persists as carrying cost: a live admin tab implying a working feature, a second DynamoDB item shape (`category::<id>` config rows), defensive `source: 'category-config'` filters threaded through unrelated skill routes, and a documented "open decision." See origin for the full pain narrative and the Categories & Featured Skills data model.

---

## Requirements

- R1. Remove the admin Categories tab (origin R1).
- R2. Remove the featured-skills server endpoints (origin R2).
- R3. Remove `getCategoryOverrides` and the override merge; **remove the public `/api/categories` endpoint entirely** (origin R3, revised — see Key Technical Decisions).
- R4. Remove the `manage:categories` permission (origin R4).
- R5. Remove the dead `source: 'category-config'` guards (origin R5).
- R6. Delete the `category::<id>` DynamoDB rows per environment (origin R6).
- R7. Prune docs to Shape A only (origin R7).
- R8. Update/remove tests asserting featured behavior (origin R8).

**Origin actors:** A1 (admin/maintainer — loses the tab, keeps all else), A2 (hub visitor — unaffected).

---

## Scope Boundaries

- Category membership (Shape A) is untouched: `category` frontmatter parsing, `s.category === cat.id` matching, homepage tiles, category detail pages, the "All content" admin category dropdown, and the `categories-parity` test all stay.
- Not filling in sparse category labels on community skills.
- Not redesigning or reintroducing "featured" — deferred until a real need appears.
- No changes to category ids/labels/metadata (the rename work in plans 001/002 is independent).

---

## Context & Research

### Relevant Code and Patterns

- `functions/api/routes/admin.mjs` — `getCategoryOverrides()` (9-22), public `GET /api/categories` (26-34), `GET /api/admin/categories` (189-200), `PUT /api/admin/categories/:id/featured` (202-226), and the `source !== 'category-config'` filter in `GET /api/admin/skills` (52).
- `src/scripts/admin/categories.mjs` — the tab (featured-slugs editor only).
- `src/scripts/admin/index.mjs` — `loadCategories` import (8) and `categories:` loader entry (31).
- `src/components/admin/AdminTabs.astro` — `{ id: 'categories', label: 'Categories' }` (7).
- `src/scripts/admin/dashboard.mjs` — `source !== 'category-config'` filter (51).
- `functions/api/routes/skills.mjs` — `source === 'category-config'` guards in PUT (100), approve (148), reject (179).
- `functions/api/lib/permissions.mjs` — `manage:categories` in `MAINTAIN_PLUS` (5).
- `src/lib/categories.mjs` — `featuredSlugs: []` on all 5 categories + header comments (5, 7, 22, 37, 52, 67, 82).
- `scripts/cleanup-category-rows.mjs` — **existing** one-off deletion script (targets old pre-rename ids only); the safe-delete pattern (Get → verify `source === 'category-config'` → Delete, `--env` + `--dry-run`) is the model for U8.
- `docs/categories-data-model.md`, `docs/ARCHITECTURE.md` (163-168).

### Key verified facts

- The public `GET /api/categories` has **zero consumers** in `src/` or `functions/` — the render layer imports static `src/lib/categories.mjs` directly. Confirmed by grep.
- No code reads `.featuredSlugs` off the static category objects — removing the field is safe.
- `tests/categories-parity.test.mjs` does **not** reference featured — no change needed there (revises origin R8's tentative note).

---

## Key Technical Decisions

- **Remove the public `/api/categories` endpoint entirely (revises origin R3).** Origin assumed it must stay to serve category metadata. Verification shows it has no consumers and exists only to merge `featuredSlugs` (per its own comment). Keeping it as static-metadata plumbing would leave dead code — contrary to the full-purge decision. Removing it is consistent with the brainstorm's rationale ("no orphaned concept left behind"). *Reversible: if an external/undocumented consumer surfaces, restore a static-only version trivially.*
- **Full purge of `category-config` guards (origin decision).** Once no endpoint can create `category::<id>` rows and existing rows are deleted, the `source !== 'category-config'` / `=== 'category-config'` guards protect against nothing. Remove them.
- **Reuse `scripts/cleanup-category-rows.mjs` for U8** rather than writing a new script — extend it to delete the current-id rows. Same safe-delete pattern, one script for all `category::*` cleanup.
- **Sequence code-then-data.** Deploy the code that stops reading/writing the rows before deleting them, so no request can recreate a row post-cleanup. Within this plan, U8 (data) is last and gated on the API units.

---

## Open Questions

### Resolved During Planning

- Does the public `/api/categories` endpoint need to stay? → No; it's dead. Remove it (see Key Technical Decisions).
- Does the parity test touch featured? → No; leave it unchanged.

### Deferred to Implementation

- Exact final shape of `scripts/cleanup-category-rows.mjs` after adding current ids (append vs. replace the old-id list) — decide when editing; both old and current `category::*` rows should end up gone.

---

## Implementation Units

- U1. **Remove the admin Categories tab (frontend)**

**Goal:** The admin panel no longer shows or loads a Categories tab.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Delete: `src/scripts/admin/categories.mjs`
- Modify: `src/scripts/admin/index.mjs` (remove the `loadCategories` import and the `categories:` entry in `loaders`)
- Modify: `src/components/admin/AdminTabs.astro` (remove the `{ id: 'categories', label: 'Categories' }` tab entry)

**Approach:**
- The tab is purely a featured-slugs editor, so deletion is clean. Removing the `loaders` key means no panel is registered; removing the `AdminTabs` entry means no button/panel div is rendered. `activateTab('queue')` default is unaffected.

**Patterns to follow:**
- Mirror how other tabs are wired in `index.mjs`/`AdminTabs.astro` — just the inverse (removal).

**Test scenarios:**
- Test expectation: none — frontend wiring removal with no unit-tested behavior. Verify by the admin panel loading with no Categories tab and no console error (Verification below).

**Verification:**
- Admin panel renders the remaining tabs (Queue, Skills & Agents, Plugins, Enterprise Skills, Validate, Users, Audit Log); no Categories tab; no reference error for `loadCategories`.

---

- U2. **Remove the admin featured endpoints (`GET /api/admin/categories`, `PUT /api/admin/categories/:id/featured`)**

**Goal:** No server route reads or writes featured slugs via the admin surface.

**Requirements:** R2

**Dependencies:** None (independent of U1)

**Files:**
- Modify: `functions/api/routes/admin.mjs` (remove both handlers at 189-226)
- Modify: `tests/api/routes/admin.test.mjs` (remove the `GET /api/admin/categories` and `PUT /api/admin/categories/:id/featured` describe blocks, incl. body-validation block)

**Approach:**
- Delete the two `app.*` handlers under the "Categories (maintain+)" comment and the comment banner. Leave the enterprise and users handlers around them intact.

**Patterns to follow:**
- Adjacent handlers in the same file for the surrounding structure.

**Test scenarios:**
- Happy path: existing admin tests for other routes still pass after the featured describes are removed.
- Error path: (removed) — the 403/404/400 featured tests are deleted, not migrated, since the routes no longer exist.

**Verification:**
- `admin.test.mjs` passes with no references to `/api/admin/categories`; grep for `admin/categories` in `functions/` returns nothing.

---

- U3. **Remove `getCategoryOverrides` and the public `/api/categories` endpoint**

**Goal:** The dead public endpoint and its DDB-reading helper are gone.

**Requirements:** R3

**Dependencies:** None (independent of U1/U2)

**Files:**
- Modify: `functions/api/routes/admin.mjs` (remove `getCategoryOverrides` at 9-22 and the public `GET /api/categories` at 26-34; drop the now-unused `CATEGORY_IDS`/`CATEGORIES` and `BatchGetCommand` imports **only if** no remaining code in the file uses them — verify after U2 removed its `CATEGORY_IDS` use)
- Modify: `tests/api/routes/admin.test.mjs` (remove the `GET /api/categories` describe block: empty-overrides, metadata-fields, and merge-override tests)

**Approach:**
- Confirmed zero consumers. Remove helper + route together. After U2 and U3, `CATEGORIES`/`CATEGORY_IDS` are no longer referenced in `admin.mjs` — remove the import line; likewise `BatchGetCommand` if unused elsewhere in the file.

**Patterns to follow:**
- Import-pruning: check each named import is still referenced before removing.

**Test scenarios:**
- Happy path: suite passes with the `GET /api/categories` block removed.

**Verification:**
- No route responds at `/api/categories`; `admin.mjs` has no unused imports (lint/build clean).

---

- U4. **Remove the `manage:categories` permission**

**Goal:** The permission no longer exists in the RBAC model.

**Requirements:** R4

**Dependencies:** U2 (the only consumers of `manage:categories` are the U2 handlers; remove them first so no route references a deleted permission)

**Files:**
- Modify: `functions/api/lib/permissions.mjs` (remove `'manage:categories'` from `MAINTAIN_PLUS`, line 5)
- Modify: `tests/api/permissions.test.mjs` (remove the "maintain can manage categories" test, ~130-131; adjust the describe title if it names categories)

**Approach:**
- Single-token removal from the `MAINTAIN_PLUS` set. `can()` logic is unchanged.

**Patterns to follow:**
- Existing `MAINTAIN_PLUS` membership tests in `permissions.test.mjs`.

**Test scenarios:**
- Happy path: `can(maintain, 'manage:enterprise')` etc. still return true (unaffected permissions intact).
- Edge case: `can(admin, 'manage:categories')` would now return true via the admin short-circuit even though the token is gone — acceptable and untested (admin allows everything); do not add a test asserting the removed token.

**Verification:**
- grep for `manage:categories` across the repo returns nothing; `permissions.test.mjs` passes.

---

- U5. **Remove the dead `category-config` guards in skill routes and dashboard**

**Goal:** No code branches on `source === 'category-config'` / `!== 'category-config'`.

**Requirements:** R5

**Dependencies:** U2, U3 (removing the write/read paths first means these guards are provably dead before removal)

**Files:**
- Modify: `functions/api/routes/skills.mjs` (remove the `source === 'category-config'` early-return in PUT at 100, approve at 148, reject at 179)
- Modify: `functions/api/routes/admin.mjs` (remove `.filter(s => s.source !== 'category-config')` in `GET /api/admin/skills` at 52 → return `items` directly)
- Modify: `src/scripts/admin/dashboard.mjs` (remove `.filter(s => s.source !== 'category-config')` at 51 → `allItems = skillsRes.skills ?? []`)
- Modify: `tests/api/routes/skills.test.mjs` (remove the three "returns 404 for category-config record(s)" tests for approve/reject/delete at ~293-333, ~482-490)
- Modify: `tests/api/routes/admin.test.mjs` (remove/adjust the `GET /api/admin/skills` case that seeds `{ slug: 'cat-config', source: 'category-config' }` at ~319 and asserts it's filtered out)

**Approach:**
- These guards only ever mattered because `category::<id>` rows shared the skills table. After U8 deletes them and no endpoint recreates them, the guards are inert. Remove branches and the tests that assert filtering, keeping surrounding assertions (e.g., that real skills are returned) intact.

**Patterns to follow:**
- The existing early-return `if (!existing.Item) return c.json({ error: 'Not found' }, 404)` lines stay; only the `category-config` line is removed.

**Test scenarios:**
- Happy path: `PUT/approve/reject /api/skills/:slug` on a normal skill behaves unchanged.
- Integration: `GET /api/admin/skills` returns all real skill items (no category-config seeding, no filter).

**Verification:**
- grep for `category-config` in `functions/` and `src/` returns nothing; `skills.test.mjs` and `admin.test.mjs` pass.

---

- U6. **Remove `featuredSlugs` from static category config**

**Goal:** The static category objects no longer carry a `featuredSlugs` field or featured-related comments.

**Requirements:** R3, R7

**Dependencies:** U1, U3 (the only readers of `.featuredSlugs` — the admin tab and the public endpoint — are gone)

**Files:**
- Modify: `src/lib/categories.mjs` (remove `featuredSlugs: []` from all 5 categories and the header comment lines about featured, 5 & 7)

**Approach:**
- Confirmed no code reads `.featuredSlugs` off these objects. `functions/api/lib/categories.mjs` (the API copy) has no `featuredSlugs` field, so no parity impact. Leave all other metadata fields untouched.

**Patterns to follow:**
- Keep the object shape otherwise identical; the `categories-parity` test asserts `label`/`subtitle`/`hero_description`/`accent_color`/`icon`/`browsable` — none of which change.

**Test scenarios:**
- Integration: `tests/categories-parity.test.mjs` still passes (it never referenced `featuredSlugs`).

**Verification:**
- grep for `featuredSlugs` in `src/lib/` returns nothing; parity test green.

---

- U7. **Prune documentation to Shape A only**

**Goal:** Docs describe category membership only, with no dangling featured references.

**Requirements:** R7

**Dependencies:** None (doc-only; do last among code so it reflects the final state, but no hard code dependency)

**Files:**
- Modify: `docs/categories-data-model.md` (retitle away from "Featured Skills"; drop the plain-terms "featured" question, the Shape B section, and the decoupling/gap section; keep the Shape A / membership content)
- Modify: `docs/ARCHITECTURE.md` (remove the category-config / `featuredSlugs` paragraph at 163-168)

**Approach:**
- Reduce `categories-data-model.md` to "how category membership works." Remove the PR #39 status note about featured being an open decision; the decision is now "removed."

**Patterns to follow:**
- Existing doc voice/structure in `categories-data-model.md`.

**Test scenarios:**
- Test expectation: none — documentation only.

**Verification:**
- grep for `featured`/`category-config`/`category::` in `docs/categories-data-model.md` and `docs/ARCHITECTURE.md` returns nothing (aside from any historical superpowers docs already marked stale, which are out of scope).

---

- U8. **Delete `category::<id>` rows from DynamoDB**

**Goal:** No `category::<id>` items remain in any environment's skills table.

**Requirements:** R6

**Dependencies:** U2, U3, U5 (deploy the code that no longer reads/writes/recreates the rows before deleting, so cleanup is final)

**Files:**
- Modify: `scripts/cleanup-category-rows.mjs` (add the current category ids — `personal-productivity`, `research-and-analyze`, `write-and-review`, `team-automations`, `build-and-ship` — to the deletion set so it removes all `category::*` config rows; keep the existing old-id entries so a single run cleans everything)

**Approach:**
- Reuse the existing safe-delete pattern: Get by `slug`, verify `source === 'category-config'` before deleting, `--dry-run` support, `--env staging|prod`. Run staging → verify → prod. This is a one-off operational step, not part of the deploy.

**Execution note:** Run `--dry-run` first in each env and confirm the printed slugs before the live run.

**Patterns to follow:**
- The existing `main()` loop and safety check in `scripts/cleanup-category-rows.mjs`.

**Test scenarios:**
- Test expectation: none — one-off data-migration script. Verify by inspection: after run, no `category::*` items with `source: 'category-config'` exist, and no non-category-config item was touched (the source guard enforces this).

**Verification:**
- `--dry-run` in prod reports 0 rows would be deleted (i.e., all already gone) after the live run; a `GetCommand` on any `category::<id>` returns no item.

---

## System-Wide Impact

- **Interaction graph:** Removing `manage:categories` (U4) only affects the two U2 handlers, which are deleted in the same plan. `can()` for other actions is unchanged.
- **API surface parity:** Public `/api/categories` removed (U3) — verified no consumers. Admin `/api/admin/categories*` removed (U2). No other interface serves featured data.
- **State lifecycle risks:** The code-then-data ordering (U8 last) prevents a request recreating a `category::<id>` row after cleanup. Between deploy and cleanup, stale rows are harmless — nothing reads them once U2/U3 ship.
- **Unchanged invariants:** Category membership (`s.category === cat.id`), homepage tiles, category detail pages, the "All content" category dropdown, `functions/api/lib/categories.mjs` (API copy, no `featuredSlugs`), and `tests/categories-parity.test.mjs` are explicitly not changed.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Undocumented external consumer of public `/api/categories` | Endpoint has no internal consumers and served only featured data; if one surfaces, restore a static-only version trivially (documented as reversible in Key Technical Decisions). |
| DDB deletion removes a wrong row | Existing script's `source === 'category-config'` safety check + mandatory `--dry-run` per env before the live run. |
| Row recreated after cleanup | Code-then-data ordering: U2/U3 (write/read paths gone) ship before U8. |
| Unused-import lint failure after route removal | U3 explicitly prunes now-unused `CATEGORIES`/`CATEGORY_IDS`/`BatchGetCommand` imports in `admin.mjs`. |

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-22-remove-featured-skills-requirements.md](docs/brainstorms/2026-07-22-remove-featured-skills-requirements.md)
- Data model: [docs/categories-data-model.md](docs/categories-data-model.md)
- Deletion-script precedent: [scripts/cleanup-category-rows.mjs](scripts/cleanup-category-rows.mjs)
- Related plans (independent): docs/plans/2026-07-21-001-feat-category-rename-metadata-plan.md, docs/plans/2026-07-21-002-feat-unhide-category-tiles-browse-plan.md
