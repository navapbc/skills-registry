---
date: 2026-07-22
topic: remove-featured-skills
---

# Remove Categories Admin Tab & "Featured Skills"

## Summary

Remove the "featured skills" concept end-to-end — the admin **Categories** tab, its server endpoints, the `manage:categories` permission, the now-dead `category-config` guards, the `category::<id>` DynamoDB rows, and the documentation describing them. Category *membership* (the `category` label on skills and everything that renders from it) is untouched. Featured skills can be revisited later when the idea is better fleshed out.

---

## Problem Frame

"Featured skills" was built (PR #39 / RBAC admin work) as a way for admins to hand-pick skills to spotlight per category. It never reached the UI: as documented in `docs/categories-data-model.md`, nothing renders `featuredSlugs`, and the render layer imports the static `src/lib/categories.mjs` (`featuredSlugs: []`) rather than the DynamoDB-backed values — so admin-curated lists aren't even passed to the renderer. The result is a control that saves data nobody sees, backed by a second DynamoDB item shape ("Shape B", the `category::<id>` config rows) that exists only to store that invisible data.

The cost is carrying cost: a live admin tab implying a feature that does nothing, a permission, a public/admin endpoint pair, defensive `source: 'category-config'` filters threaded through unrelated skill routes, and a documented "open decision" that lingers. The concept is not mature enough to design around now, so the cheapest correct move is to remove it cleanly and reintroduce it deliberately if a real need appears.

---

## Actors

- A1. **Admin/maintainer**: previously used the Categories tab to set featured slugs (gated by `manage:categories`). Loses that tab; retains all other admin capabilities including the "All content" category dropdown.
- A2. **Hub visitor**: unaffected — never saw featured skills. Continues to browse categories by skill `category` label.

---

## Requirements

**Admin UI**
- R1. Remove the admin **Categories** tab: delete `src/scripts/admin/categories.mjs`, its import/registration in `src/scripts/admin/index.mjs`, and the `{ id: 'categories', label: 'Categories' }` entry in `src/components/admin/AdminTabs.astro`.

**Server / API**
- R2. Remove the featured-skills endpoints in `functions/api/routes/admin.mjs`: `GET /api/admin/categories` and `PUT /api/admin/categories/:id/featured`.
- R3. Remove `getCategoryOverrides()` and its merge into public `GET /api/categories`. The public endpoint remains and returns static category metadata (id/label/metadata) from `CATEGORIES`, with no `featuredSlugs` merge.
- R4. Remove the `manage:categories` permission from `functions/api/lib/permissions.mjs` (and any other reference to it).
- R5. Remove the now-dead `source: 'category-config'` guards: the `source !== 'category-config'` filters in `functions/api/routes/admin.mjs` and `src/scripts/admin/dashboard.mjs`, and the `existing.Item.source === 'category-config'` checks in `functions/api/routes/skills.mjs`.

**Data**
- R6. Delete the `category::<id>` items (Shape B, `source: 'category-config'`) from the `skills-registry-skills-{env}` DynamoDB table via a one-off cleanup script, per environment. (Precedent: the U4 deletion step in `docs/plans/2026-07-21-001-feat-category-rename-metadata-plan.md`.)

**Docs & tests**
- R7. Prune `docs/categories-data-model.md` to Shape A only — retitle away from "Featured Skills", drop the Shape B section, the plain-terms "featured" question, and the decoupling/gap section. Remove the `featuredSlugs`/`category-config` reference in `docs/ARCHITECTURE.md`.
- R8. Update or remove tests that assert featured behavior: `tests/api/routes/admin.test.mjs` (featured PUT/GET, the `category::` fixture), the `category-config` filter cases in `tests/api/routes/skills.test.mjs`, and any `featured`-related assertions in `tests/categories-parity.test.mjs`.

---

## Success Criteria

- The admin panel has no Categories tab; the remaining tabs and admin flows work unchanged.
- No route serves or accepts featured slugs; public `GET /api/categories` still returns category metadata and the homepage tiles + category pages render exactly as before.
- No `category::<id>` items remain in DynamoDB in any environment, and no code references `category-config` or `manage:categories`.
- Full test suite passes; `docs/categories-data-model.md` describes only how category membership works, with no dangling references to featured skills.

---

## Scope Boundaries

- **Category membership (Shape A) is untouched** — `category` frontmatter parsing, the `s.category === cat.id` match, homepage category tiles, category detail pages, and the "All content" admin category dropdown all stay.
- **Not filling in sparse category labels** on community skills — separate cleanup task.
- **Not redesigning or reintroducing "featured"** — explicitly deferred until a real, fleshed-out need appears.
- **No changes to category ids/labels/metadata** — the concurrent rename work (plans 001/002) is independent.

---

## Key Decisions

- **Full purge over dormant code (user-selected).** Remove the defensive `category-config` guards too, not just the tab and data. Rationale: once Shape B rows are deleted and no endpoint can create them, the guards protect against nothing; leaving them preserves a half-alive concept and misleads future readers.
- **Keep public `GET /api/categories`.** The hub depends on category metadata; only the featured merge is removed, not the endpoint.
- **Prune the data-model doc rather than delete it.** Shape A documentation is still accurate and useful; only the featured half is obsolete.

---

## Dependencies / Assumptions

- Assumes nothing outside the files identified above reads `featuredSlugs`, `getCategoryOverrides`, or `manage:categories`. [Verified via grep in this brainstorm; planning should re-confirm after any intervening merges.]
- DB cleanup (R6) requires access to run a one-off script against each environment's DynamoDB table; sequencing (deploy code first vs. delete rows first) is a planning/rollout detail.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] Order of operations for rollout: delete DB rows before or after deploying the code that stops reading them? (Either is safe since nothing renders featured; confirm during planning.)
- [Affects R8][Technical] Whether `tests/categories-parity.test.mjs` has any featured-specific assertions or only membership parity — confirm when editing.
