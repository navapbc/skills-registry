---
title: "feat: Unhide category tiles and style the browse experience (P0-2)"
type: feat
status: completed
date: 2026-07-21
---

# feat: Unhide category tiles and style the browse experience (P0-2)

## Summary

Turn on category-based browsing now that P0-1 has renamed the categories and populated their metadata. Unhide the homepage category tiles (accent bar, Tabler icon, name, subtitle, dynamic skill count), replace the `skills-registry` plugin badge on skill cards with a color-coded category badge, and restyle the `/category/[slug]` detail page to the approved design (breadcrumb, tinted-icon hero, client-side tag filter bar, vertical skill-row list, category-specific contribution prompt, empty state). Category membership is driven entirely by each skill's `category` field (`s.category === cat.id`); the legacy hand-maintained `slugs[]` arrays are retired.

---

## Problem Frame

The homepage category tiles have been commented out since the hub launched (`src/pages/index.astro:20-25`), and the `/category/[slug]` detail page renders an older card-grid layout that does not match the approved design. P0-1 (categories renamed, metadata populated, org-wide skills categorized) removed the blockers, so the browse experience can go live. Membership today is defined two incompatible ways — the static `slugs[]` arrays in `categories.mjs` (a May-2026 hand-curation stopgap that predates per-skill `category` metadata) and the per-skill `category` frontmatter populated by P0-1. The approved mockup uses the latter (tile counts 3/4/4/2/1 = the 14 org-wide skills), so P0-2 standardizes on `s.category` and retires `slugs[]`.

---

## Requirements

- R1. Category tiles are visible on the homepage, one per `browsable: true` category, each showing a top accent bar (`accent_color`), Tabler icon (`icon`), display name (`label`), subtitle, and a dynamic skill count; clicking a tile navigates to `/category/{slug}`. (issue #33 Scope §1, AC)
- R2. Skill cards show a category badge (category `label` colored with `accent_color`) in place of the `skills-registry` plugin badge; the `Org-wide` badge is retained; skills with no category fall back to the existing `skills-registry` tag. (issue Scope §2, AC)
- R3. `/category/[slug]` renders the approved design: breadcrumb, hero (tinted icon, display name, `hero_description`, skill count), tag filter bar, vertical skill-row list, contribution prompt, empty state. (issue Scope §3, AC)
- R4. Tag filtering works client-side: pills derived from the `tags` of skills in the category, "All" default, multi-select, "All" resets. (issue Scope §3, AC)
- R5. The contribution prompt renders category-specific copy (issue §4) with a "Submit a skill idea" CTA linking to `/contribute`. (issue Scope §4, AC)
- R6. Edge cases: empty categories show hero + contribution prompt only (no filter bar); `/category/nonexistent` → 404; tiles wrap to 2–3 columns below 768px. (issue Scope §5, AC)
- R7. Category membership, tile counts, detail-page skill list, and tag pills are all derived from `s.category === cat.id`; the `slugs[]` arrays are removed and their consumers rewired. (planning decision, confirmed)

**Origin issue:** [navapbc/skills-registry#33](https://github.com/navapbc/skills-registry/issues/33) — depends on P0-1 (#32, landed).

---

## Scope Boundaries

- Not changing how a skill's category is *assigned* — that is `category:` frontmatter (durable) or the admin "All content" dropdown (`src/scripts/admin/all-content.mjs`). P0-2 only consumes `s.category`.
- Not adding an automatic/keyword category classifier — none exists and none is in scope.
- Not making category metadata (accent color, icon, copy) admin-editable — it stays static config, per P0-1.
- Not adding new categories or altering the P0-1 rename/metadata.

### Deferred to Follow-Up Work

- **Community-skill category backfill:** community skills carry no `category` frontmatter, so at launch categories contain only the 14 org-wide skills. Assigning community skills to categories (editing their SKILL.md frontmatter in source repos) is the P0-1-deferred backfill and remains a separate follow-up. P0-2 ships correctly with sparse categories.

---

## Context & Research

### Relevant Code and Patterns

- `src/lib/categories.mjs` — frontend `CATEGORIES`: `id`, `label`, `subtitle`, `hero_description`, `accent_color`, `icon`, `borderColor`, `textColor`, `featuredSlugs`, `slugs`. Consumed by Astro pages via static import. Snake_case metadata keys were set in P0-1 (#37).
- `functions/api/lib/categories.mjs` — duplicated API copy (`CATEGORIES`, `CATEGORY_IDS`); the Lambda zip only bundles `functions/api/`. `GET /api/categories` (`functions/api/routes/admin.mjs:26-34`) spreads `...cat`, so all config fields already flow to the API.
- `tests/categories-parity.test.mjs` — guards frontend↔API drift on `['label','subtitle','hero_description','accent_color','icon']`, asserts `accent_color` is 6-digit hex, and checks `SKILL_CATEGORIES` (`src/lib/admin/format.mjs`) matches the canonical id/label set. Does **not** check `slugs`, `browsable`, or `contribution_prompt`.
- `src/lib/render.mjs` — `renderSkillCard` (43-115; `pluginBadge` at 54-56, `orgWideBadge` at 66-68, `skill.tags` at 69-73), `renderCategoryGrid` (423-494, homepage tiles — currently hidden), `renderNewThisWeek` (496-526, **live**; uses `slugs` reverse-lookup at 505), `renderCategoryDetail` (528-565; card grid + `slugs` at 532, already reads `accent_color`/`hero_description`).
- `src/pages/index.astro` — category section commented out (20-25), `#category-grid` mount point, imports `renderCategoryGrid`/`CATEGORIES` (158-159), fetches `/skills` (229-232). Note the comment at 226-228: do **not** reintroduce a `?slugs=` scoped fetch (it poisoned the CloudFront cache); compute counts from the already-fetched `/skills`.
- `src/pages/category/index.astro` — detail-page shell + client script; resolves category by `CATEGORIES.find(c => c.id === catSlug)`, renders 404 via `notFoundHtml` when unknown (satisfies R6 404), calls `renderCategoryDetail`.
- `src/pages/contribute.astro` — exists; CTA target for R5 (plain page, no query param needed).
- `s.category` is `''` when frontmatter omits it (`src/lib/parse-skill.mjs:91`, `scripts/sync-ddb.mjs:58`) — so `s.category === cat.id` cleanly excludes uncategorized skills and truthiness cleanly drives the badge fallback.

### Institutional Learnings

- `docs/plans/2026-07-21-001-feat-category-rename-metadata-plan.md` (P0-1): metadata is static config guarded by a parity test; frontmatter is the durable source of skill `category`; the two `categories.mjs` copies cannot share a module at runtime.
- `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`: `slugs` (formerly `curatedSlugs`) was the original hand-curated membership mechanism; `featuredSlugs` is distinct and stays.

### External References

- None required — self-contained frontend change within existing conventions. Tabler icon SVG paths are copied from the Tabler icon set (MIT) for the 5 names in use.

---

## Key Technical Decisions

- **Membership = `s.category === cat.id`, `slugs[]` removed.** Single source of truth, matches the approved mockup, kills frontend↔metadata drift. (Confirmed with user.) Consequence: community skills are absent from categories until the deferred backfill. **Why `slugs[]` is retired, not kept:**
  - **It is a parallel, unconstrained membership system.** `slugs[]` (category-side hand-list) never reads a skill's own `category` and can drift from it arbitrarily — the exact duplication P0-1 set out to eliminate.
  - **Its membership is not unique-safe.** Nothing prevents the same slug appearing in two categories' `slugs[]`. Today it happens to be clean (54 entries, 54 unique), so the hazard is latent — but if a duplicate were introduced, the code handles it inconsistently and silently: `renderNewThisWeek`'s `categories.find(c => c.slugs.includes(slug))` (`render.mjs:505`) returns only the *first* match in array order (order-dependent, no warning), while the detail page and grid iterate each category's own `slugs[]` and would show the skill on *both* pages (double membership).
  - **`s.category` makes the invalid state unrepresentable.** A skill carries exactly one `category` string, so it belongs to exactly one category *by construction*. Removing `slugs[]` eliminates the cross-category ambiguity, the order-dependent `find()`, and the need for any dedup logic — no runtime handling required because duplicates can no longer exist.
  - **Skill-record slugs remain unique regardless** — `slug` is the DynamoDB partition key, so `bySlug` lookups stay collision-free.
- **Tabler icons rendered as an inline SVG map, not a dependency.** Add `src/lib/icons.mjs` exporting SVG markup for the 5 names in use (`file-text`, `search`, `calendar-check`, `code`, `repeat`). Pure strings, usable in the SSR-string render layer, no build/bundle change. Unknown icon name → render nothing (or a neutral fallback), never throw.
- **`browsable` added to both `categories.mjs` copies; `contribution_prompt` frontend-only.** `browsable` is a structural field a future server-side consumer may want, so mirror it and extend the parity test. `contribution_prompt` is presentational copy the API never serves, so it lives only in the frontend copy and stays out of parity. All 5 categories ship `browsable: true`.
- **Tile skill count includes org-wide skills.** Count over the full `/skills` payload (`skills.filter(s => s.category === cat.id).length`) *before* the homepage's community/enterprise split — otherwise categories (currently only org-wide) would count zero.
- **Tag filtering is client-side in `category/index.astro`.** `renderCategoryDetail` emits pills + rows carrying `data-tags`; the page script toggles row visibility. No API change.

---

## Open Questions

### Resolved During Planning

- What defines category membership? `s.category === cat.id`; `slugs[]` retired. (Confirmed.)
- What is `s.category` when frontmatter omits it? `''` — no guard needed for the filter; drives the badge fallback.
- How do community skills get categorized after `slugs[]` removal? Manually via frontmatter/admin dropdown; no auto-classifier. Backfill is deferred.
- Does the API need the new fields? `GET /api/categories` already spreads `...cat`; homepage/detail read the static frontend copy, so only `src/lib/categories.mjs` is strictly required, with `browsable` mirrored to the API copy for parity.
- Icon rendering approach? Inline SVG map (`src/lib/icons.mjs`).

### Deferred to Implementation

- Exact tinted-hero-background technique (e.g. `accent_color` at ~10% via an `rgba()`/hex-alpha suffix) — pick whatever renders cleanly with the existing inline-style pattern.
- Whether "platform badges" on detail rows reuse the compatibility-badge markup from `renderSkillDetail` or a compact variant — match the mockup at build time.
- Precise responsive breakpoints for 2 vs 3 columns — align with the existing `sm:`/`lg:` grid conventions; verify against the mockup.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Membership + rendering data flow after P0-2:

```
  SKILL.md `category:` ──sync──▶ DDB skill.category ──▶ GET /api/skills ──┐
                                                                          │
  src/lib/categories.mjs CATEGORIES (id,label,subtitle,hero_description,  │
     accent_color,icon,browsable,contribution_prompt,featuredSlugs)       │
        │                                                                 │
        ├─▶ renderCategoryTiles(cats, skills)  ── count = skills.filter(s.category===cat.id)
        │      homepage #category-grid (browsable only) ── link ▶ /category/{id}
        │                                                                 │
        ├─▶ renderSkillCard(skill)  ── badge = cat.label @ accent_color   │
        │      (fallback: skills-registry when s.category==='')  ◀────────┘
        │
        └─▶ renderCategoryDetail(cat, skills)  ── skills.filter(s.category===cat.id)
               breadcrumb · tinted-icon hero · tag pills (∪ s.tags) · skill rows · contribution prompt
               client script (category/index.astro) toggles rows by selected tags

  RETIRED: cat.slugs[]  (removed from both copies; renderNewThisWeek rewired to s.category)
```

---

## Implementation Units

- U1. **Add `browsable` + `contribution_prompt` config; extend parity**

**Goal:** Add `browsable: true` and category-specific `contribution_prompt` (issue §4 copy) to the frontend `CATEGORIES`; mirror `browsable` to the API copy; extend the parity test.

**Requirements:** R1 (browsable gate), R5 (copy), R7

**Dependencies:** None

**Files:**
- Modify: `src/lib/categories.mjs` (add `browsable`, `contribution_prompt` to all 5)
- Modify: `functions/api/lib/categories.mjs` (add `browsable` to all 5)
- Test: `tests/categories-parity.test.mjs`

**Approach:**
- Set `browsable: true` for all 5 categories in both copies. Add `contribution_prompt` (frontend only) using the exact issue §4 strings per category.
- Add `browsable` to the parity `METADATA_FIELDS`; leave `contribution_prompt` out of parity (frontend-only, presentational).

**Patterns to follow:** Existing snake_case metadata fields; parity test structure.

**Test scenarios:**
- Happy path: every frontend category has `browsable === true` and a non-empty `contribution_prompt`.
- Integration: parity test fails if `browsable` is set on the frontend but missing/mismatched on the API copy.
- Edge case: a category missing `contribution_prompt` is caught (assert all 5 present).

**Verification:** `pnpm test` passes including the extended parity test.

---

- U2. **Add Tabler icon SVG map**

**Goal:** Provide inline SVG markup for the 5 icon names in use, renderable from the SSR-string layer.

**Requirements:** R1 (tile icon), R3 (hero icon)

**Dependencies:** None

**Files:**
- Create: `src/lib/icons.mjs` (`renderIcon(name, opts?)` → SVG string for `file-text`, `search`, `calendar-check`, `code`, `repeat`)
- Test: `tests/frontend/icons.test.mjs`

**Approach:**
- Export a map of name → `<svg>…</svg>` (Tabler paths, `currentColor` stroke, size via a class or attr so callers control color/size). Unknown name returns `''` (or a neutral fallback) — never throws.

**Patterns to follow:** Pure string-returning helpers in `render.mjs` (e.g. `avatarHtml`).

**Test scenarios:**
- Happy path: `renderIcon('search')` returns an `<svg>` string containing a `path`.
- Edge case: `renderIcon('does-not-exist')` returns `''` (no throw).
- Edge case: all 5 canonical `CATEGORIES.icon` values resolve to non-empty SVG.

**Verification:** `pnpm test` passes; each category's `icon` renders an SVG.

---

- U3. **Homepage category tiles**

**Goal:** Render visible tiles for `browsable` categories with accent bar, icon, name, subtitle, and dynamic count; wire them into the homepage and unhide the section.

**Requirements:** R1, R6 (responsive wrap), R7 (count source)

**Dependencies:** U1, U2

**Files:**
- Modify: `src/lib/render.mjs` (replace `renderCategoryGrid` with `renderCategoryTiles(categories, allSkills)`)
- Modify: `src/pages/index.astro` (uncomment the category section 20-25, update import, inject tiles, drop obsolete grid wiring)
- Test: `tests/frontend/render.test.mjs` (replace the `renderCategoryGrid` describe block)

**Approach:**
- `renderCategoryTiles` filters to `cat.browsable`, and for each renders: 3px top accent bar (`border-top:3px solid accent_color`), `renderIcon(cat.icon)`, `cat.label`, `cat.subtitle`, and count = `allSkills.filter(s => s.category === cat.id).length` shown as "N skills". Whole tile links to `/category/${cat.id}`.
- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (2–3 cols below/at 768px per R6). Keep or drop the "Submit a skill" cell to match the mockup.
- In `index.astro`, compute counts from the already-fetched `/skills` array (full payload, before the community/enterprise split) and inject into `#category-grid`; unhide the heading + mount. Do not add a scoped `?slugs=` fetch (cache-poisoning regression noted at 226-228).

**Patterns to follow:** Existing tile/grid markup and inline-style color pattern in `render.mjs`; `renderGrid` injection pattern in `index.astro`.

**Test scenarios:**
- Happy path: `renderCategoryTiles` emits one tile per browsable category with label, subtitle, icon SVG, accent bar color, and `/category/{id}` href.
- Happy path: count reflects `s.category === cat.id` (e.g. a category with 4 matching skills shows "4 skills"), and uncategorized skills (`category: ''`) are not counted in any tile.
- Edge case: a category with 0 matching skills renders "0 skills" without error.
- Edge case: a `browsable: false` category (hypothetical) renders no tile.
- Edge case: XSS — a crafted label/subtitle is escaped.

**Verification:** `pnpm test` passes; homepage shows 5 tiles with correct counts, icons, colors; clicking navigates to the detail page; tiles wrap on a narrow viewport.

---

- U4. **Color-coded category badge on skill cards**

**Goal:** Replace the `skills-registry` plugin badge with the skill's category `label` colored by `accent_color`; retain `Org-wide`; fall back to `skills-registry` when uncategorized.

**Requirements:** R2

**Dependencies:** U1

**Files:**
- Modify: `src/lib/render.mjs` (`renderSkillCard`; import `CATEGORIES`, build an id→{label, accent_color} lookup)
- Test: `tests/frontend/render.test.mjs` (`renderSkillCard` describe block)

**Approach:**
- Build a category lookup from `CATEGORIES`. If `skill.category` is truthy and found, render a badge with `cat.label` and inline `accent_color` (text or background tint consistent with the mockup); else keep the existing `skills-registry`/plugin badge. `Org-wide` badge logic unchanged.
- Only replace the badge when `skill.plugin === 'skills-registry'` behavior applies (the issue's before/after is `[skills-registry]`→`[Write & Review]`); confirm the badge shown today for these skills so the swap is surgical.

**Patterns to follow:** Existing `pluginBadge`/`orgWideBadge` construction (54-68).

**Test scenarios:**
- Happy path: a skill with `category: 'write-and-review'` shows a "Write & Review" badge styled with `#D4537E`, not `skills-registry`.
- Happy path: an enterprise skill still shows `Org-wide` alongside its category badge.
- Edge case: `category: ''` → badge falls back to `skills-registry`.
- Edge case: `category` set to an unknown id → falls back (no crash, no empty badge).
- Edge case: XSS in a (spoofed) category value is escaped.

**Verification:** `pnpm test` passes; skill cards on the homepage/grids show category-colored badges with the org-wide badge retained.

---

- U5. **Restyle `/category/[slug]` detail page**

**Goal:** Rebuild `renderCategoryDetail` + the page script to the approved design: breadcrumb, tinted-icon hero, client-side tag filter bar, vertical skill-row list, contribution prompt, empty state.

**Requirements:** R3, R4, R5, R6 (empty state, 404 already handled), R7 (membership)

**Dependencies:** U1, U2, U4

**Files:**
- Modify: `src/lib/render.mjs` (`renderCategoryDetail`; add a `renderCategorySkillRow` helper)
- Modify: `src/pages/category/index.astro` (client-side tag-filter behavior)
- Test: `tests/frontend/render.test.mjs` (`renderCategoryDetail` describe block)

**Approach:**
- Membership: `skills = allSkills.filter(s => s.category === category.id)` (drop `slugs`/`featuredSlugs`-driven sections here).
- Breadcrumb: `Marketplace > {label}` with `Marketplace` → `/`.
- Hero: `renderIcon(category.icon)` on a tinted background (~10% `accent_color`), `<h1>` = `label`, `hero_description`, and "N skills in this category".
- Tag filter bar: derive pills from `∪ skill.tags` across the category's skills, "All" default. Emit rows with `data-tags` so the page script filters client-side (multi-select; "All" resets). Omit the bar when the category has 0 skills or no tags.
- Skill list: vertical rows (not the card grid) via `renderCategorySkillRow` — author, `#hashtags`, platform/compat badges, save star, full untruncated description.
- Contribution prompt: `category.contribution_prompt` + "Submit a skill idea" CTA → `/contribute`. Always shown.
- Empty state (R6): 0 skills → hero + contribution prompt only, no filter bar, no list.

**Patterns to follow:** `renderSkillDetail` compat badges + `renderFavoriteButton`/`fav-btn` for the save star; `renderWhatsNewGroups` `skillRow` for row layout; existing `escapeHtml`/inline-style usage; client-init pattern already in `category/index.astro` (`initFavoriteButtons`, `initGithubLinks`).

**Test scenarios:**
- Happy path: detail page for a category with skills renders breadcrumb, hero (label, `hero_description`, icon SVG, count), tag pills, and one row per `s.category === cat.id` skill with full (untruncated) description.
- Happy path: contribution prompt shows the category's exact §4 copy and a CTA linking to `/contribute`.
- Edge case (R6 empty): a category with 0 matching skills renders hero + contribution prompt only — no filter bar, no "No skills" grid leftover.
- Edge case: a category whose skills have no tags renders no filter bar.
- Edge case: tag pills are the deduped union of skill tags; XSS in a tag/description is escaped.
- Integration (client filter, R4): selecting a tag pill hides non-matching rows; selecting multiple is additive; "All" restores all rows. *(Covered by an `index.astro` script test or a focused DOM test if the suite supports it; otherwise verify manually per Verification.)*

**Verification:** `pnpm test` passes; `/category/research-and-analyze` shows hero + rows + working tag filter; an empty category shows hero + prompt only; `/category/nonexistent` still 404s.

---

- U6. **Retire `slugs[]` and rewire remaining consumers**

**Goal:** Remove the `slugs` arrays from both `categories.mjs` copies and repoint the last remaining consumer (`renderNewThisWeek`) to `s.category`.

**Requirements:** R7

**Dependencies:** U3 (tiles no longer read `slugs`), U5 (detail no longer reads `slugs`)

**Files:**
- Modify: `src/lib/categories.mjs` (delete `slugs` from all 5)
- Modify: `functions/api/lib/categories.mjs` (delete `slugs` if present)
- Modify: `src/lib/render.mjs` (`renderNewThisWeek` label lookup 504-507 → `categories.find(c => c.id === skill.category)`)
- Modify: `src/lib/categories.mjs` header comment (drop the `slugs`/curate line)
- Test: `tests/frontend/render.test.mjs` (`renderNewThisWeek` block + any fixtures referencing `slugs`)

**Approach:**
- Confirm (grep) no remaining reader of `.slugs` after U3/U5 except `renderNewThisWeek`; rewire it to read the skill's own `category` and map to the category label (empty when uncategorized).
- Delete the `slugs` field from both copies. Update fixtures/tests that constructed categories with `slugs`.

**Patterns to follow:** Existing `renderNewThisWeek` structure.

**Test scenarios:**
- Happy path: a recently-updated skill with `category: 'build-and-ship'` shows the "Build & Ship" label in New This Week.
- Edge case: an uncategorized (`category: ''`) new skill renders no category label (no crash).
- Integration: grep asserts (or code review) confirms zero references to `.slugs` remain in `src/` and `functions/`.

**Verification:** `pnpm test` passes; `grep -rn "\.slugs" src functions` returns nothing; New This Week still labels categorized skills.

---

## System-Wide Impact

- **Interaction graph:** `s.category` (from `/api/skills`) is now the single join key for tiles (U3), badges (U4), detail list + tag pills (U5), and New This Week (U6). `cat.id` must equal the skill `category` strings from P0-1.
- **API surface parity:** `GET /api/categories` already returns all config fields via `...cat`; adding `browsable` to the API copy keeps parity green and exposes it for any future server-side filter. `contribution_prompt` is intentionally frontend-only.
- **State lifecycle risks:** None persistent — no DDB writes. Removing `slugs` is config-only; the risk is a missed `.slugs` reader, mitigated by the U6 grep gate.
- **Unchanged invariants:** `featuredSlugs` and its admin flow (`category::<id>` rows, `PUT /api/admin/categories/:id/featured`) are untouched; the `/category/*` edge route and 404 behavior are unchanged; P0-1 metadata values are unchanged.
- **Integration coverage:** Client-side tag filtering (U5) and the homepage count computation (U3) are behaviors unit-string-tests only partially prove — cover with the DOM/manual verification noted in those units.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Categories look sparse at launch (only 14 org-wide skills categorized) | Expected + confirmed; matches mockup. Community backfill is deferred follow-up, called out in Scope. |
| A `.slugs` reader is missed, breaking a surface after removal | U6 grep gate + tests; U6 sequenced after U3/U5. |
| Parity test breaks from asymmetric field additions | `browsable` mirrored to both copies + added to `METADATA_FIELDS`; `contribution_prompt` deliberately excluded. |
| Tile count wrong if computed after the homepage community/enterprise split | U3 computes count over the full `/skills` payload before the split. |
| Reintroducing a scoped `?slugs=` fetch re-poisons the CloudFront cache | Compute counts from the existing `/skills` fetch; documented in U3. |
| Badge swap changes cards for non-`skills-registry` skills unintentionally | U4 keys off `skill.category` truthiness with `skills-registry` fallback; test the fallback + unknown-id cases. |

---

## Documentation / Operational Notes

- Pure frontend/config change: land via a PR to `main` (→ staging), verify the homepage tiles, a populated category page, an empty category page, the skill-card badges, and New This Week; then fast-forward `release` (→ prod). No data scripts, no terraform.
- Consider a `/ce-compound` learning afterward: "membership single-sourced on `s.category`; `slugs[]` retired" and the Tabler-inline-SVG approach.

---

## Sources & References

- Origin issue: [navapbc/skills-registry#33](https://github.com/navapbc/skills-registry/issues/33) (mockups: `nava_hub_mockup.html`, `nava_hub_category_detail.html`)
- Predecessor: `docs/plans/2026-07-21-001-feat-category-rename-metadata-plan.md` (P0-1)
- Config: `src/lib/categories.mjs`, `functions/api/lib/categories.mjs`; parity: `tests/categories-parity.test.mjs`
- Rendering: `src/lib/render.mjs`; pages: `src/pages/index.astro`, `src/pages/category/index.astro`, `src/pages/contribute.astro`
- Category assignment: `src/lib/parse-skill.mjs`, `scripts/sync-ddb.mjs`, `src/scripts/admin/all-content.mjs`
- Prior art: `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`
