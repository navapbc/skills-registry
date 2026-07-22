# Categories — Data Model

How the hub decides which skills belong to a category.

> Status: current as of the featured-skills removal (July 2026). The earlier
> "featured skills" concept (admin-curated per-category spotlight lists, stored as
> synthetic `category::<id>` DynamoDB rows) has been removed — it never reached
> the UI. This also supersedes the category sections of the May-2026 superpowers
> docs (`docs/superpowers/specs/2026-05-30-homepage-category-grid-design.md`,
> `docs/superpowers/plans/2026-05-30-hub-routes-categories.md`), which describe
> the retired `slugs[]` membership model.

---

## In plain terms (no code)

There are **five categories** on the hub — Personal Productivity, Research &
Analyze, Write & Review, Team Automations, Build & Ship.

**Which category is a skill in?**
Each skill can carry a "category" label on itself (set by whoever wrote the
skill, in the skill's own file). A skill shows up under a category when its own
label matches that category — nothing else. If a skill has no label, it simply
doesn't appear under any category (it's still findable by search and in the main
skills list). Today, only the ~14 org-wide ("Org-wide") skills have a label;
community-contributed skills mostly don't yet, so categories look sparse for now.
Filling those in later is a separate cleanup task.

---

## Technical model (for engineers)

Skills and agents live in the **`skills-registry-skills-{env}` DynamoDB table**
(partition key `slug`). Category membership is the `category` **string attribute
on the skill item**:

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

Category metadata (id, label, subtitle, hero description, accent color, icon,
`browsable`) is defined statically in `src/lib/categories.mjs`, duplicated into
`functions/api/lib/categories.mjs` for the API Lambda, and kept in sync by
`tests/categories-parity.test.mjs`.
