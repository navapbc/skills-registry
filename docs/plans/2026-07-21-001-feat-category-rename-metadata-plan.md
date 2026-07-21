---
title: "feat: Rename categories, add metadata, and populate featured slugs"
type: feat
status: active
date: 2026-07-21
---

# feat: Rename categories, add metadata, and populate featured slugs

## Summary

Rename the 5 hub categories (both their ids/slugs and display labels), add four new presentation-metadata fields (subtitle, hero description, accent color, icon) to each category and surface them through `GET /api/categories`, normalize the `category` frontmatter on the 14 org-wide skills to the new slugs, and populate per-category featured slugs via the admin panel in staging and prod. This unblocks P0-2 (unhiding the homepage category tiles).

---

## Problem Frame

The hub's 5 categories still carry working names (Planning, Writing & Comms, Dev & Code, etc.) and expose no browse metadata. Category identity is duplicated across two hardcoded sources — `src/lib/categories.mjs` (frontend) and `functions/api/routes/admin.mjs` (`CATEGORY_IDS` / `CATEGORY_LABELS`) — and none of the requested metadata (subtitle, hero description, accent color, icon) exists anywhere yet. The homepage tiles are currently hidden and cannot be turned on (P0-2) until the categories have real names, metadata, correct skill mappings, and featured slugs.

---

## Requirements

- R1. All 5 categories renamed — both `id`/slug and display `label` — consistently across the frontend config and the API, in staging and prod. (issue Scope §1)
- R2. Four metadata fields (subtitle, hero description, accent color, icon) populated for all 5 categories. (issue Scope §2)
- R3. `GET /api/categories` response includes the metadata fields. (issue AC)
- R4. Featured slugs set for all categories via the admin panel, in staging and prod. (issue Scope §3)
- R5. The 14 org-wide published skills have a `category` value matching the new slugs; `skills-governance-reviewer` is intentionally left uncategorized. (issue Scope §4)

---

## Scope Boundaries

- Not adding a database-backed category table or making metadata admin-editable — metadata is static config (see Key Technical Decisions). Only featured slugs remain admin-editable, as today.
- Not adding new categories or removing any — this is a rename + enrich of the existing 5.
- Not building the homepage tile UI (that is P0-2, which this issue unblocks). Rendering wiring here is limited to making the new fields available and consumed by the existing category-detail page.
- Not changing the CloudFront edge routing — `/category/*` is already a wildcard (`functions/edge/auth-check.js.tpl:30`), so slug renames need no terraform.

### Deferred to Follow-Up Work

- Reconciling the hand-maintained `slugs` arrays in `src/lib/categories.mjs` with the `category`-frontmatter membership: [Open Question below; likely a P0-2-adjacent follow-up]. This plan renames those arrays' owning categories but does not re-curate their contents.
- Unhiding the homepage category grid: separate issue P0-2.

---

## Context & Research

### Relevant Code and Patterns

- `src/lib/categories.mjs` — frontend `CATEGORIES` array: `id`, `label`, `borderColor`, `textColor`, `featuredSlugs` (empty), `slugs[]`. The richest category definition; consumed by Astro pages.
- `functions/api/routes/admin.mjs:8-15` — `CATEGORY_IDS` array + `CATEGORY_LABELS` map (duplicates ids/labels). Lines 34-43 = `GET /api/categories`; 198-210 = `GET /api/admin/categories`; 212-236 = `PUT /api/admin/categories/:id/featured`.
- Featured slugs are stored as synthetic DynamoDB rows keyed `slug = "category::<id>"`, `source: "category-config"`, with a `featuredSlugs` array (`admin.mjs:224-232`); read back by `getCategoryOverrides()` (`admin.mjs:17-30`) and filtered out of admin listings by `source !== 'category-config'` (`admin.mjs:61`).
- `src/lib/render.mjs` — `renderCategoryGrid` (423-493), `renderNewThisWeek` (496-526), `renderCategoryDetail` (528-565). Styling reads `cat.borderColor`/`cat.textColor`/`cat.label`. `renderCategoryGrid:433` matches enterprise skills by `s.category === cat.id`. Grid is currently commented out (`src/pages/index.astro:20-25`); `/category/[id]` detail pages are live.
- `src/lib/parse-skill.mjs:91` — `record.category = meta.category ?? ''`; `scripts/sync-ddb.mjs:31,58` writes `category` to DDB; `scripts/sync-registry-v2.mjs` syncs skills via GitHub code search. Skill `category` source of truth is SKILL.md frontmatter.
- `src/scripts/admin/categories.mjs` — admin panel UI for featured slugs (renders one row per category from `GET /admin/categories`, PUTs to `/admin/categories/:id/featured`).
- Enterprise skills live at `enterprise/<slug>/SKILL.md`. Frontmatter `category` values today are inconsistent — some correct (`daily-briefing-template` → `planning`), some malformed (`proposal-review-template` → `writing, comms, proposal`), some missing (`sage-bot`, `central-ops-review`, `confluence-editor`).
- Deploy: `main` → staging, `release` → prod (`docs/DEPLOY.md`). API Lambda is zipped from `functions/api/` only (`.github/workflows/deploy.yml:122-124`) — files outside that dir are not in the bundle.

### Institutional Learnings

- `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`: `curatedSlugs` was renamed to `slugs`; `featuredSlugs` is a distinct field left empty until enterprise sync exists. Category ids were the canonical kebab-case enum.
- `docs/superpowers/specs/2026-05-29-datastore-design.md`: no migration framework — DynamoDB data changes are ad-hoc scripts, always run `--env staging`, verify (count + spot-check), then `--env prod`.
- `docs/DEPLOY.md`: staging/prod share `terraform/` with different state files; re-`init -reconfigure` on every env switch. Always branch from `main`, never `release`.

### External References

- None required — this is a well-patterned, self-contained change within existing conventions.

---

## Key Technical Decisions

- **Metadata lives in static config, not DynamoDB.** The issue only asks for admin-editing of *featured slugs*, not metadata. Static config matches the existing `borderColor`/`textColor` pattern, avoids new DDB rows/endpoints, and keeps metadata version-controlled and reviewable. Rationale: least surface area for the requirement.
- **Metadata is duplicated in the API, guarded by a parity test — not shared via import.** The API Lambda zip includes only `functions/api/` (`deploy.yml:122-124`), so `src/lib/categories.mjs` cannot be imported at runtime. Define the API's category metadata alongside the existing `CATEGORY_LABELS` in `functions/api/routes/admin.mjs` (or a sibling `functions/api/lib/categories.mjs`), and add a root-level vitest that imports *both* sources and asserts id/label/metadata parity. This prevents the drift the existing duplication already risks. Rationale: a shared module would require a build/copy step into the zip; a parity test is cheaper and catches drift at CI time.
- **API response field naming: camelCase (`subtitle`, `heroDescription`, `accentColor`, `icon`).** Consistent with the existing `featuredSlugs`. The issue's snake_case (`hero_description`, `accent_color`) is descriptive; confirm with the P0-2 consumer (Open Question). Rationale: internal consistency over verbatim issue transcription.
- **Skill `category` is set in SKILL.md frontmatter, not by direct DDB edit.** Frontmatter is the durable source of truth; a direct DDB write would be overwritten on the next `sync-registry-v2 --force`. Rationale: survives re-sync.
- **Renaming ids requires migrating the `category::<id>` synthetic rows.** Old-id rows (`category::planning`, etc.) become orphaned. Since featured slugs are being repopulated fresh (R4), the migration is a cleanup: delete orphaned old-id rows. Rationale: avoid dead DDB rows and confusion.

---

## Open Questions

### Resolved During Planning

- Do slug renames require terraform/edge changes? No — `/category` is a wildcard prefix in the edge function.
- Where does category metadata belong? Static config + API parity test (see Key Technical Decisions).
- Is there a migration framework? No — ad-hoc scripts, staging-then-prod.

### Deferred to Implementation

- Exact API field names (camelCase vs the issue's snake_case): confirm against the P0-2 tile-rendering consumer before finalizing the response shape.
- Icon rendering: `icon` values (`calendar-check`, `search`, `file-text`, `repeat`, `code`) are Lucide-style names. Whether the frontend maps these to an existing icon set or ships new SVGs is a P0-2 concern; this plan only stores the string.
- Whether to re-curate the static `slugs` arrays to reflect the new enterprise membership (see Deferred to Follow-Up Work).
- For the 14 skills: whether their canonical SKILL.md lives in this repo's `enterprise/` tree or in separate org repos found via code search — determines where frontmatter edits land. Confirm at implementation time via `sync-registry-v2` source resolution.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Two hardcoded category sources must stay in sync; a parity test is the guard:

```
                        ┌─────────────────────────────┐
  Astro static build ──▶│ src/lib/categories.mjs       │  id,label,accentColor,
  (homepage, /category) │  CATEGORIES[]                │  subtitle,heroDescription,
                        └─────────────────────────────┘  icon, slugs, featuredSlugs
                                     ▲
                                     │  parity test asserts
                                     │  id/label/metadata match
                                     ▼
  Lambda API ──────────▶ ┌─────────────────────────────┐
  GET /api/categories    │ functions/api/.../admin.mjs  │  same id,label + metadata
  (zip = functions/api/  │  CATEGORY_IDS/LABELS/META    │  (featuredSlugs merged
   only)                 └─────────────────────────────┘   from DDB category:: rows)

  Skill mapping (independent):  SKILL.md frontmatter `category: <new-slug>`
     ──▶ sync-registry-v2 ──▶ DDB skill.category ──▶ render grid match (s.category === cat.id)
```

Rename map (id → id, label):

| Old id | New id / slug | New label |
|---|---|---|
| `planning` | `personal-productivity` | Personal Productivity |
| `research-analysis` | `research-and-analyze` | Research & Analyze |
| `writing-comms` | `write-and-review` | Write & Review |
| `ops-automation` | `team-automations` | Team Automations |
| `dev-code` | `build-and-ship` | Build & Ship |

---

## Implementation Units

- U1. **Rename category ids and labels across both sources**

**Goal:** Rename all 5 categories' `id`/slug and `label` in the frontend config and the API, keeping the two in sync.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/lib/categories.mjs` (5 `id` + `label` values)
- Modify: `functions/api/routes/admin.mjs` (`CATEGORY_IDS`, `CATEGORY_LABELS`)
- Test: `tests/api/routes/admin.test.mjs` (update `categories[0].id` and any id assertions)
- Test: `tests/frontend/render.test.mjs` (update any hardcoded id/label expectations)

**Approach:**
- Apply the rename map above. `id` is the join key used by `render.mjs:433` (`s.category === cat.id`) and the DDB `category::<id>` rows, so it must match the new skill `category` values (U5) exactly.
- Leave `borderColor`/`textColor` as-is for now (U2 adds `accentColor`; render switch is U3).

**Patterns to follow:** Existing `CATEGORIES`/`CATEGORY_LABELS` shape.

**Test scenarios:**
- Happy path: `GET /api/categories` returns 5 categories whose ids are exactly the 5 new slugs and labels are the 5 new labels.
- Edge case: no old id (`planning`, `writing-comms`, `dev-code`, `research-analysis`, `ops-automation`) appears in either source or in the API response.

**Verification:** `pnpm test` passes; `GET /api/categories` returns new ids/labels; no old id string remains in `src/lib/categories.mjs` or `functions/api/routes/admin.mjs`.

---

- U2. **Add metadata fields to config + API response, with a parity test**

**Goal:** Add `subtitle`, `heroDescription`, `accentColor`, `icon` to each category in the frontend config and echo them through `GET /api/categories` and `GET /api/admin/categories`.

**Requirements:** R2, R3

**Dependencies:** U1

**Files:**
- Modify: `src/lib/categories.mjs` (add 4 fields per category, values from issue Scope §2)
- Modify: `functions/api/routes/admin.mjs` (add a `CATEGORY_META` map; include fields in both category response literals, lines ~37-42 and ~204-208)
- Create: `tests/categories-parity.test.mjs` (assert frontend config and API config agree on id/label/metadata)
- Test: `tests/api/routes/admin.test.mjs` (assert metadata fields present in responses)

**Approach:**
- Use the exact metadata values from the issue table (subtitle, hero description, accent color hex, icon name).
- Populate `accentColor` from the issue's `#RRGGBB` values; keep existing `borderColor`/`textColor` untouched.
- Parity test imports `CATEGORIES` from `src/lib/categories.mjs` and the API's category config and asserts the id set, labels, and all four metadata values match.

**Patterns to follow:** Existing `getCategoryOverrides()` merge and response-literal construction in `admin.mjs`.

**Test scenarios:**
- Happy path: `GET /api/categories` response for each category includes `subtitle`, `heroDescription`, `accentColor`, `icon` with the issue's values.
- Happy path: `GET /api/admin/categories` (maintain+) includes the same metadata.
- Integration: parity test fails if a label or metadata value is changed in only one of the two sources.
- Edge case: `featuredSlugs` still merges correctly from DDB overrides alongside the new metadata fields.

**Verification:** `pnpm test` passes including the new parity test; API responses carry all four fields for all 5 categories.

---

- U3. **Wire metadata into category rendering**

**Goal:** Make the category-detail page consume the new metadata (subtitle/hero description as header text, accent color for the accent bar) so the fields are live before P0-2.

**Requirements:** R2 (consumption)

**Dependencies:** U2

**Files:**
- Modify: `src/lib/render.mjs` (`renderCategoryDetail`, ~528-565; optionally `renderCategoryGrid` accent)
- Test: `tests/frontend/render.test.mjs`

**Approach:**
- In `renderCategoryDetail`, render `subtitle` and/or `heroDescription` under the `<h1>`, and use `accentColor` for the accent bar (`border-left` at line 558). Keep changes minimal and backward-compatible with categories that lack metadata (they won't, but guard defensively).
- Do not build the homepage tile grid (P0-2). Icon rendering is deferred (store-only) unless an existing icon set trivially covers the names.

**Patterns to follow:** Existing `escapeHtml` usage and inline-style pattern in `render.mjs`.

**Test scenarios:**
- Happy path: `renderCategoryDetail` output includes the category's subtitle/hero description text and applies `accentColor`.
- Edge case: a category object missing a metadata field renders without throwing.

**Verification:** `pnpm test` passes; a `/category/<new-slug>` page shows the new name, subtitle/hero text, and accent color.

---

- U4. **Migrate/clean up orphaned `category::<id>` DDB rows**

**Goal:** Remove the synthetic featured-slug rows keyed by the old ids so no dead category-config rows remain after the rename.

**Requirements:** R1 (data-consistency), R4 (prerequisite)

**Dependencies:** U1

**Files:**
- Create: `scripts/cleanup-category-rows.mjs` (or a documented one-off using the `scripts/sync-ddb.mjs` AWS-SDK resolution pattern)

**Approach:**
- Delete DDB items `category::planning`, `category::writing-comms`, `category::dev-code`, `category::research-analysis`, `category::ops-automation` from `skills-registry-skills-<env>`.
- Run `--env staging` first, verify, then `--env prod` (per datastore learnings). New-id rows are created fresh by U6 via the admin panel.

**Patterns to follow:** `scripts/migrate-to-dynamodb.mjs` / `scripts/sync-ddb.mjs` (createRequire AWS SDK from `functions/api`, env flag, staging-then-prod).

**Test scenarios:**
- Test expectation: none — one-off data-migration script. Verify by inspection: after run, no `category::<old-id>` items exist and no `category::<new-id>` items are accidentally deleted.

**Verification:** DDB scan in each env shows no orphaned old-id category rows; `GET /api/categories` returns empty `featuredSlugs` for new ids until U6 populates them.

---

- U5. **Normalize skill `category` frontmatter to new slugs for the 14 org-wide skills**

**Goal:** Ensure 14 of 15 org-wide published skills carry a `category` value matching the new slugs; leave `skills-governance-reviewer` uncategorized.

**Requirements:** R5

**Dependencies:** U1 (new slugs must be finalized)

**Files:**
- Modify: `enterprise/<slug>/SKILL.md` frontmatter `category:` for the 14 skills (or the canonical source repo if the skill's SKILL.md lives elsewhere — resolve via `sync-registry-v2` at implementation time)
- Then run: `scripts/sync-registry-v2.mjs --env staging` then `--env prod` (`--force` to backfill changed fields)

**Approach:**
- Assign each of the 14 skills the correct new slug. Derive assignments from the issue's featured-slug table plus each skill's purpose (e.g. `daily-briefing-template`, `week-kickoff-template`, `weekly-brag-log` → `personal-productivity`; `sage-bot`, `project-index-search`, `policy-document-analysis`, `policy-requirements-explorer` → `research-and-analyze`; `proposal-review-template`, `change-mgmt-template`, `plain-language`, `actionable-feedback` → `write-and-review`; `central-ops-review`, `finance-onboarding-check` → `team-automations`; `confluence-editor` → `build-and-ship`; plus `evp-interview-assistant`, `skill-enterprise-transform` mapped to their best fit to reach 14).
- Replace malformed values (e.g. `proposal-review-template`'s `writing, comms, proposal`) with the single new slug.
- Leave `skill-governance-reviewer`/`skills-governance-reviewer` with no `category`.
- Confirm the final 14-vs-15 list with the issue author if any skill's category is ambiguous.

**Execution note:** Frontmatter is the durable source; a direct DDB edit would be overwritten by the next sync.

**Patterns to follow:** Existing enterprise SKILL.md frontmatter; `scripts/sync-registry-v2.mjs` staging-then-prod flow.

**Test scenarios:**
- Happy path: after sync, `GET /api/skills` (or a DDB spot-check) shows each of the 14 skills with `category` equal to its new slug.
- Edge case: `skills-governance-reviewer` has an empty/absent `category`.
- Integration: `renderCategoryGrid` (via `s.category === cat.id`) groups each categorized enterprise skill under the correct renamed category.

**Verification:** 14 skills report the correct new-slug category in each env; the excluded skill remains uncategorized.

---

- U6. **Populate featured slugs via the admin panel (operational, staging → prod)**

**Goal:** Set each category's featured slugs to the issue's lists through the admin panel, in staging then prod.

**Requirements:** R4

**Dependencies:** U1 (new ids deployed), U4 (old rows cleaned), U5 (featured skills categorized and published so they render)

**Files:**
- None (operational data entry via `src/scripts/admin/categories.mjs` UI → `PUT /api/admin/categories/:id/featured`)

**Approach:**
- In staging admin (`manage:categories` role), for each renamed category enter the issue's featured slugs (§3), Save, and confirm. Repeat in prod after staging verification.
- Featured slugs: `personal-productivity` → daily-briefing-template, week-kickoff-template, weekly-brag-log; `research-and-analyze` → sage-bot, project-index-search, policy-document-analysis, policy-requirements-explorer; `write-and-review` → proposal-review-template, change-mgmt-template, plain-language, actionable-feedback; `team-automations` → central-ops-review, finance-onboarding-check; `build-and-ship` → confluence-editor.

**Test scenarios:**
- Test expectation: none — operational data entry. Verify via `GET /api/categories`.

**Verification:** `GET /api/categories` in each env returns the exact featured-slug lists per category; each featured slug resolves to a published skill on the `/category/<slug>` detail page.

---

## System-Wide Impact

- **Interaction graph:** Category `id` is the join key across three surfaces — the API response, the `category::<id>` DDB rows, and `render.mjs:433` skill matching (`s.category === cat.id`). All three must use the new slugs consistently (U1 + U4 + U5).
- **API surface parity:** `GET /api/categories`, `GET /api/admin/categories` both change shape (new fields) and both must carry metadata (U2).
- **State lifecycle risks:** Renaming ids orphans old `category::<id>` DDB rows (U4). Featured slugs must be re-entered under new ids (U6), not migrated, since the admin panel is the intended entry point.
- **Unchanged invariants:** `PUT /api/admin/categories/:id/featured` contract (`{ featuredSlugs: string[] }`) is unchanged; permission model (`manage:categories`, maintain+) is unchanged; the `source: "category-config"` synthetic-row mechanism is unchanged.
- **Integration coverage:** The parity test (U2) is the cross-source guard; the render test (U3, U5) proves skill→category grouping end to end.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Frontend config and API metadata drift (two hardcoded sources) | Parity test in U2 fails CI on any mismatch |
| Old-id DDB rows left orphaned, or new-id skill matches broken by inconsistent slugs | U4 cleanup + U1/U5 use identical slug strings; render integration test |
| API field-name mismatch with the P0-2 tile consumer (camelCase vs snake_case) | Open Question flagged; confirm before finalizing response shape |
| The 14 skills' canonical SKILL.md may live in other org repos, not `enterprise/` | Resolve source via `sync-registry-v2` at implementation; edit frontmatter at true source |
| Prod/staging terraform state footgun during any script run | Scripts use env flags only (no terraform); follow staging-then-prod verify discipline |
| Featured slug points at an unpublished/misnamed skill (e.g. dir/name mismatch on governance reviewer) | U6 verification confirms each featured slug resolves to a published skill |

---

## Documentation / Operational Notes

- Deploy order: land U1–U3 + tests via a PR to `main` (→ staging), verify, then fast-forward `release` (→ prod).
- Data ops (U4 cleanup, U5 sync, U6 featured slugs): run against staging first, verify (count + spot-check), then prod. Never branch from `release`.
- Consider capturing the static-config→API parity pattern and the `category::<id>` rename/cleanup as a `/ce-compound` learning afterward (repo has no `docs/solutions/` store yet).

---

## Sources & References

- Origin issue: [navapbc/skills-registry#32](https://github.com/navapbc/skills-registry/issues/32)
- Category config: `src/lib/categories.mjs`; API: `functions/api/routes/admin.mjs`
- Rendering: `src/lib/render.mjs`; admin UI: `src/scripts/admin/categories.mjs`
- Skill mapping: `src/lib/parse-skill.mjs`, `scripts/sync-registry-v2.mjs`, `scripts/sync-ddb.mjs`
- Deploy: `docs/DEPLOY.md`, `.github/workflows/deploy.yml`
- Prior art: `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`, `docs/superpowers/specs/2026-05-29-datastore-design.md`
