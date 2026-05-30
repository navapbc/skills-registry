# Homepage Category Grid Design

**Date:** 2026-05-30  
**Status:** Approved  
**Scope:** Add a 5-category grid section ABOVE the existing Skills/Agents/Plugins browse sections on the homepage. The grid surfaces curated enterprise skills by use case for a non-technical audience, without removing the existing engineer-facing browse experience.

---

## Problem

The current homepage is organized by technical type (Skills, Agents, Plugins) and raw plugin names — terminology that engineers understand but most Nava staff don't. Non-technical staff have no obvious entry point for "what can AI help me do right now?"

---

## Design

### Visual

A 3-column grid of 6 cells sits between the search bar and the existing Skills/Plugins/Agents sections:

- **5 category cards** (Writing & Comms, Research & Analysis, Planning, Dev & Code, Ops & Automation), each showing 3 curated skill names and a total count
- **1 submit CTA cell** (dashed border, plum) — links to the existing Google Form
- **"New this week" strip** directly below the grid — skills with `last_updated` within the last 7 days

Category cards use a thin muted color bar on top (3px) as the only color indicator — no emojis, no icons. Card body is white with gray borders, consistent with the rest of the site.

"new" badge appears next to skills added within the last 7 days.

### Categories

| Category | Accent | Text color | Default curated slugs |
|---|---|---|---|
| Writing & Comms | `#c4b5fd` (muted violet) | `#7c3aed` | `nava-labs-style` + 2 more (ops team to fill in) |
| Research & Analysis | `#94a3b8` (muted slate) | `#475569` | `diagram`, `index-inputs`, `interface-contracts` |
| Planning | `#6ee7b7` (muted sage) | `#059669` | `digital-service-orchestra-plan-review`, `prioritize-epics`, `review-ruleset` |
| Dev & Code | `#fcd34d` (muted amber) | `#92400e` | `frontend-design`, `init`, `e2e-test` |
| Ops & Automation | `#d1d5db` (muted cool gray) | `#374151` | `generate-ui`, `flow-screenshots` |

### Curation mechanism

The curated skill slugs for each category are defined in a single config file: `src/lib/categories.mjs`. The ops team updates this file (via PR or, eventually, admin UI) to control what appears in each category card.

Skills not assigned to any category remain discoverable via search and the existing browse sections.

### "New this week"

Computed at runtime from the `/api/skills` response. A skill is considered "new" if `last_updated >= Date.now() - 7 days`. The strip shows up to 3 skills. Each links to its detail page.

---

## Architecture

### New files

- `src/lib/categories.mjs` — category definitions (id, label, color, textColor, curatedSlugs). This is the ops team's curation control. No API or database involvement — it's a source-controlled config.

### Modified files

- `src/lib/render.mjs` — add `renderCategoryGrid(categories, allSkills)` function
- `src/pages/index.astro` — insert category grid section between search bar and the existing browse sections; update the client script to call `renderCategoryGrid` after skills are fetched

### Data flow

No new API calls needed. The homepage already calls `fetchApi('/skills')` and `fetchApi('/plugins')`. The category grid consumes the same skill list — `renderCategoryGrid` filters it by curated slug and computes "new" badges.

```
fetchApi('/skills') → allSkills array
  → renderCategoryGrid(CATEGORIES, allSkills)   [category grid]
  → renderGrid(allSkills.filter(type=skill))     [existing Skills section]
  → renderGrid(allSkills.filter(type=agent))     [existing Agents section]
```

---

## What this phase does NOT include

- Admin UI for editing category assignments (that's a future admin panel feature)
- Tags field in DynamoDB (categories are frontend-only config for now; DynamoDB tags come later)
- Removal of the existing Skills/Agents/Plugins browse sections
- Changing the page title or nav (still "Skills Marketplace" for now)
