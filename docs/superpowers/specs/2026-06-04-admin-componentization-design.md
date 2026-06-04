# Admin Page Componentization — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Problem

`src/pages/admin/index.astro` is 1011 lines:
- Lines 1–3: empty frontmatter (no server logic).
- Lines 4–44: a small static shell — header, dashboard skeleton, tab nav (8
  tabs), and 8 empty `tab-panel` mount divs.
- Lines 46–1011: a single ~965-line client `<script>` that fetches data and
  builds every panel via `innerHTML` template strings, then wires events.

It is effectively a hand-rolled client SPA in one file. It already separates
cleanly by concern internally — it just is not split into files. This hurts
readability, makes the logic untestable, and makes the file hard to work in.

## Goal

Refactor the admin page into focused, single-responsibility modules and
components **with identical runtime behavior**, and add unit tests for the parts
that become pure functions. No new dependencies.

## Constraints & Observations

- **Astro `<script>` tags are bundled by Vite and support ESM imports**, so
  client code can be split into modules imported by the page script.
- **Existing precedent:** the script already imports `fetchApi`
  (`src/lib/api.mjs`), `escapeHtml` (`src/lib/render.mjs`), and `analyzeSkillFile`
  (`src/lib/parse-skill.mjs`).
- **Coverage constraint:** `vitest.config.mjs` includes `src/lib/**/*.mjs` in
  coverage with thresholds (lines 80 / functions 80 / branches 70). DOM-
  manipulating modules must therefore live **outside** `src/lib/` so they are not
  pulled into coverage untested. → DOM modules go in a new `src/scripts/admin/`.
- **Shared/cross-tab state to preserve:**
  - `role` — fetched once from `/users/me`; gates admin-only tabs, the dashboard
    admin section, and the enterprise Delete button. Redirects non-privileged
    users to `/`.
  - `currentTab` + `loadTab` dispatcher, including the reload idiom
    (`currentTab = null; loadTab('enterprise')`) used by the enterprise and users
    tabs to refresh after a mutation.
  - `queue-badge` — written by both the dashboard and the queue tab.

## Architecture

### Pure, testable logic → `src/lib/admin/` (covered by vitest; new tests)

- **`format.mjs`** — pure formatters and constants:
  - Constants: `SKILL_CATEGORIES`, `COMPAT_OPTIONS`.
  - `catLabel(cat)`, `catSelectOptions(currentCat)`, `tagChips(tags)`,
    `compatChips(compat)`, `relTime(ts)`, `actorName(users, uid)`.
  - All string-in / string-out (no DOM). `escapeHtml` is imported from
    `../render.mjs` where needed.
- **`validation-view.mjs`** — `renderValidationResults(analysis)` returns an HTML
  string from a plain analysis object. Pure; moved verbatim (imports `escapeHtml`).

### Client/DOM modules → `src/scripts/admin/` (new dir, outside coverage)

- **`api.mjs`** — `apiPost(path, body)`, `apiPut(path, body)`, `apiDelete(path)`.
- **`controller.mjs`** — owns `currentTab`; exports a factory
  `createTabController({ loaders, getPanel })` returning `{ activateTab, reloadTab }`:
  - `activateTab(tabId)` — toggles `.tab-btn` active classes, shows the matching
    `.tab-panel`, and calls `loadTab` only when the tab changed.
  - `loadTab(tabId)` (internal) — sets the panel to Loading, calls
    `loaders[tabId](panel, ctx)`, renders errors into the panel on throw.
  - `reloadTab(tabId)` — resets the change guard and forces `loadTab(tabId)`;
    replaces the `currentTab = null; loadTab(...)` idiom.
- **One module per tab**, each exporting `async load(panel, ctx)`:
  `dashboard.mjs`, `queue.mjs`, `enterprise.mjs`, `categories.mjs`,
  `validate.mjs`, `users.mjs`, `all-content.mjs`, `plugins.mjs`, `audit.mjs`.
  Tab-local helpers (e.g. dashboard's `statCard`/`ACTION_STYLE`, all-content's
  filtering/`renderRows`/`wireRows`) stay inside their module.
- **`index.mjs`** — entry point `initAdmin()`:
  1. `fetchApi('/users/me')`; redirect to `/` if missing or `role === 'user'`.
  2. Reveal `.admin-only` elements when `role === 'admin'`.
  3. Build the `loaders` registry (tabId → tab module's `load`).
  4. Create the controller; wire `.tab-btn` click handlers to `activateTab`.
  5. `dashboard.load(...)` then `activateTab('queue')`.

- **`ctx` object** passed to every loader: `{ role, activateTab, reloadTab }`.
  - dashboard uses `activateTab` (stat-card click targets).
  - enterprise and users use `reloadTab` + `role`.
  - others ignore the fields they do not need.

### Static shell → `src/components/admin/` (the "B" extraction)

- **`AdminDashboard.astro`** — the dashboard skeleton mount (current lines 11–19),
  keeping `id="admin-dashboard"`.
- **`AdminTabs.astro`** — renders the tab nav **and** the empty `tab-panel` mount
  divs from a single shared `tabs` array so the two stay in sync. Each entry:
  `{ id, label, adminOnly?, badgeId? }`. Preserves all existing ids/classes
  (`tab-btn`, `data-tab`, `tab-panel`, `tab-<id>`, `queue-badge`, `admin-only`).

### Page — `src/pages/admin/index.astro`

Becomes ~15 lines: imports `Base`, `AdminDashboard`, `AdminTabs`; renders the
header + both components; and a thin `<script>` that imports and calls
`initAdmin()` from `../../scripts/admin/index.mjs`.

## Behavior Preservation

- Same API endpoints, payloads, and methods.
- Same DOM structure, ids, classes, and tab order.
- Same role gating and redirect.
- Same badge, search/filter, inline-edit, and reload behaviors.

Because ids/classes are unchanged, the later responsive plan's `.admin-table`
edits (Task 7 there) still apply — they simply land in the per-tab modules now.

## Testing

- **New unit tests:**
  - `tests/frontend/admin-format.test.mjs` — covers `catLabel` (string + array +
    unknown + empty), `tagChips` (≤3, >3, empty), `compatChips` (≤2, >2, empty),
    `catSelectOptions` (selected marking), `relTime` (m/h/d boundaries, empty),
    `actorName` (match, email fallback, missing).
  - `tests/frontend/admin-validation-view.test.mjs` — `renderValidationResults`
    for valid vs invalid analysis, with/without warnings, with/without ignored
    keys; assert key markers (✅/❌, counts, escaped content) appear.
- **Regression verification:** `pnpm run test`, `pnpm run check`,
  `pnpm run build`, then a manual click-through of all 8 tabs (as admin) +
  dashboard, confirming each loads, mutates, and refreshes as before.

## Out of Scope

- Responsive/mobile changes (separate, sequenced plan; runs after this).
- Any change to API routes or data shapes.
- Adding a client UI framework or web components.
- Behavioral changes or feature additions.
