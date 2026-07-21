# Categories & Featured Skills — Data Model

How the hub decides which skills belong to a category, and how "featured" skills
are stored. This trips people up because the two things look related but are
stored and computed in completely different ways.

> Status: current as of PR #39 (P0-2, issue #33). This supersedes the category
> sections of the May-2026 superpowers docs
> (`docs/superpowers/specs/2026-05-30-homepage-category-grid-design.md`,
> `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`), which describe
> the retired `slugs[]` membership model.

---

## In plain terms (no code)

There are **five categories** on the hub — Personal Productivity, Research &
Analyze, Write & Review, Team Automations, Build & Ship. Two separate questions:

**1. Which category is a skill in?**
Each skill can carry a "category" label on itself (set by whoever wrote the
skill, in the skill's own file). A skill shows up under a category when its own
label matches that category — nothing else. If a skill has no label, it simply
doesn't appear under any category (it's still findable by search and in the main
skills list). Today, only the ~14 org-wide ("Org-wide") skills have a label;
community-contributed skills mostly don't yet, so categories look sparse for now.
Filling those in later is a separate cleanup task.

**2. Which skills are "featured" in a category?**
Separately, an admin can hand-pick a list of skills to spotlight for each
category (via the admin panel). This is a *per-category list of skills*, not a
label on the skill. It's stored independently of the category label above.

**Why this matters / the gotcha:** because these are two independent things, a
skill can be on a category's "featured" list without actually having that
category as its own label — in which case it would be featured but wouldn't even
appear on the category's page. And as of the latest change, the "featured" list
is **not shown anywhere in the UI** yet — there's no "Featured" section or badge.
Admins can still set it (it saves), but nothing displays it. Deciding whether to
show it or retire the control is an open follow-up.

---

## Technical model (for engineers)

Both live in the **`skills-registry-skills-{env}` DynamoDB table** (partition key
`slug`). DynamoDB is schemaless, so the table holds two *item shapes*
distinguished by the `source` attribute.

### Shape A — a skill/agent item

Category membership is the `category` **string attribute on the skill item**:

- Set from SKILL.md frontmatter `category:` at parse time
  (`src/lib/parse-skill.mjs` → `record.category = meta.category ?? ''`), so it
  defaults to `''` when the author omits it.
- Written to DynamoDB by the sync scripts (`scripts/sync-ddb.mjs`,
  `scripts/sync-registry-v2.mjs`).
- Also editable via the admin "All content" dropdown
  (`src/scripts/admin/all-content.mjs` → `PUT /api/skills/:slug`), but for
  GitHub-synced skills that DB write is **overwritten on the next
  `sync-registry-v2 --force`**, since sync re-derives `category` from
  frontmatter. Frontmatter is the durable source of truth.

Membership is computed at render time as `s.category === cat.id` — see
`renderCategoryTiles`, `renderCategoryDetail`, and the skill-card badge in
`src/lib/render.mjs`. There is no automatic/keyword classifier.

### Shape B — a category-config item (featured slugs)

Featured skills are **not** an attribute on the skill. They're a synthetic row,
one per category:

```
slug:          "category::<id>"      // e.g. "category::write-and-review"
source:        "category-config"
featuredSlugs: string[]              // list of skill slugs
updated_at:    ISO timestamp
```

- Written by `PUT /api/admin/categories/:id/featured`
  (`functions/api/routes/admin.mjs`), body `{ featuredSlugs: string[] }`.
- Read back by `getCategoryOverrides()` (BatchGet on `category::<id>` keys) and
  merged into `GET /api/categories`.
- The `source: "category-config"` marker is what keeps these rows out of skill
  listings — e.g. `GET /api/admin/skills` filters `s.source !== 'category-config'`.
- The endpoint validates only that `featuredSlugs` is an array; it does **not**
  restrict the slugs to enterprise skills, so a community skill slug is
  mechanically valid too.

### The decoupling (and current gap)

`category` (Shape A) and `featuredSlugs` (Shape B) are independent. A slug in a
category's `featuredSlugs` need not have that category as its own `category`.

As of PR #39, **nothing renders `featuredSlugs`** — the homepage tiles show only
a count and the category page is a flat `s.category`-filtered list; neither reads
the featured list. Note also that the render layer imports the static
`src/lib/categories.mjs` (`featuredSlugs: []`), not the DynamoDB-backed values
from `/api/categories`, so admin-curated featured lists aren't even passed to the
renderer. Open decision: surface featured on the category page, or retire the
admin control.
