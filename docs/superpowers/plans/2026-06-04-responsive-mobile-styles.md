# Responsive / Mobile Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Skills Registry usable on phone, tablet, and desktop — a collapsible sidebar (icon rail on mobile, user-toggle on desktop) plus a full responsive pass over every grid, form, and the admin tables.

**Architecture:** A single `data-sidebar-collapsed` attribute on `<html>` is the source of truth for sidebar state. It's persisted in `localStorage` and applied pre-paint to avoid FOUC. Mobile-first CSS renders the sidebar as an icon rail by default and expands it to the full labeled `w-56` at `md`+ *unless* the user has collapsed it. All content grids gain mobile-first breakpoints (including the ones injected via JS template strings); admin tables become horizontally scrollable on small screens.

**Tech Stack:** Astro 6, Tailwind v4 (utility classes + a small hand-written CSS block in `src/styles/main.css`), vanilla client `<script>` modules, Vitest (for the one piece of extractable logic).

**A note on testing:** This project has no `.astro`/DOM component-test harness — Vitest coverage targets `.mjs` logic only (`src/lib`, `functions/api`, `scripts`). Adding a component harness is out of scope. Therefore:
- The one piece of real logic (collapse-state read/serialize) is extracted into `src/lib/sidebar-state.mjs` and unit-tested with Vitest (TDD).
- All presentational changes (markup, CSS, grid classes) are verified with `pnpm run check` (astro type/template check), `pnpm run build` (catches broken templates/syntax), and **manual viewport checks at 375 / 768 / 1280px**. These are real verification steps, not placeholders — run them and confirm the described output before checking the box.

**Run commands** use `pnpm` (the repo's package manager, per `package.json`).

---

### Task 1: Extract and unit-test the sidebar collapse-state logic

**Files:**
- Create: `src/lib/sidebar-state.mjs`
- Test: `tests/frontend/sidebar-state.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/frontend/sidebar-state.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { STORAGE_KEY, isCollapsed, serialize } from '../../src/lib/sidebar-state.mjs';

describe('sidebar-state', () => {
  it('uses the documented storage key', () => {
    expect(STORAGE_KEY).toBe('sidebar-collapsed');
  });

  it('treats "1" as collapsed', () => {
    expect(isCollapsed('1')).toBe(true);
  });

  it('treats "0", null, undefined, and junk as expanded', () => {
    expect(isCollapsed('0')).toBe(false);
    expect(isCollapsed(null)).toBe(false);
    expect(isCollapsed(undefined)).toBe(false);
    expect(isCollapsed('true')).toBe(false);
  });

  it('serializes collapsed booleans to the stored string', () => {
    expect(serialize(true)).toBe('1');
    expect(serialize(false)).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/frontend/sidebar-state.test.mjs`
Expected: FAIL — cannot resolve `../../src/lib/sidebar-state.mjs` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sidebar-state.mjs`:

```js
// Single source of truth for the collapsible-sidebar preference.
// The pre-paint inline script in Base.astro duplicates the "=== '1'" check
// inline because it must run before the bundle loads (see Task 3).
export const STORAGE_KEY = 'sidebar-collapsed';

/** Returns true when the stored raw value means the sidebar is collapsed. */
export function isCollapsed(raw) {
  return raw === '1';
}

/** Serializes a collapsed boolean to the string persisted in localStorage. */
export function serialize(collapsed) {
  return collapsed ? '1' : '0';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/frontend/sidebar-state.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sidebar-state.mjs tests/frontend/sidebar-state.test.mjs
git commit -m "feat(sidebar): add tested collapse-state helper"
```

---

### Task 2: Add the sidebar collapse CSS block

**Files:**
- Modify: `src/styles/main.css` (append after the `code, pre` rule at the end)

This block centralizes every state-dependent layout rule. "Rail" is the default
(mobile-first); the `md`+ media query restores the full sidebar only when the
user has *not* collapsed it. The same mechanism also handles the admin tables.

- [ ] **Step 1: Append the CSS**

Add to the end of `src/styles/main.css`:

```css
/* ── Collapsible sidebar ──────────────────────────────────────────────
   Rail (icon-only) is the default. At md+ the sidebar expands to its full
   labeled width unless the user collapsed it (data-sidebar-collapsed on
   <html>). Phones are always rail because the media query never applies. */
#app-sidebar { width: 3.5rem; }            /* w-14 rail */
.sidebar-label { display: none; }          /* text labels hidden on the rail */
.sidebar-tip { display: block; }           /* hover tooltips available on rail */
.sidebar-nav-link { justify-content: center; }
.sidebar-footer { flex-direction: column; align-items: center; }

@media (min-width: 768px) {
  html:not([data-sidebar-collapsed]) #app-sidebar { width: 14rem; }       /* w-56 */
  html:not([data-sidebar-collapsed]) .sidebar-label { display: inline; }
  html:not([data-sidebar-collapsed]) .sidebar-tip { display: none; }
  html:not([data-sidebar-collapsed]) .sidebar-nav-link { justify-content: flex-start; }
  html:not([data-sidebar-collapsed]) .sidebar-footer { flex-direction: row; align-items: center; }
}

/* ── Admin: wide data tables scroll horizontally on small screens ────── */
@media (max-width: 767px) {
  .admin-table { display: block; overflow-x: auto; white-space: nowrap; }
}
```

- [ ] **Step 2: Verify the build still compiles**

Run: `pnpm run build`
Expected: build succeeds (no CSS/Tailwind errors). The sidebar will look
half-changed until Tasks 3–5 land — that's fine; we're only checking it compiles.

- [ ] **Step 3: Commit**

```bash
git add src/styles/main.css
git commit -m "feat(sidebar): add collapse + admin-table responsive CSS"
```

---

### Task 3: Add the pre-paint state script and responsive padding in Base.astro

**Files:**
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Add the pre-paint inline script in `<head>`**

In `src/layouts/Base.astro`, find the closing `</head>` (line ~19, right after the favicon `<link>`). Insert this `is:inline` script immediately before `</head>`:

```astro
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <!-- Apply saved sidebar state before paint to avoid a flash. Mirrors
         isCollapsed() in src/lib/sidebar-state.mjs; kept inline because it
         must run before the bundle loads. -->
    <script is:inline>
      try {
        if (localStorage.getItem('sidebar-collapsed') === '1') {
          document.documentElement.setAttribute('data-sidebar-collapsed', '');
        }
      } catch (e) {}
    </script>
  </head>
```

- [ ] **Step 2: Make the content padding responsive**

In the same file, find (line ~26):

```astro
        <div class="max-w-5xl mx-auto px-8 py-8">
```

Replace with:

```astro
        <div class="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
```

- [ ] **Step 3: Verify**

Run: `pnpm run check && pnpm run build`
Expected: both succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "feat(layout): pre-paint sidebar state + responsive content padding"
```

---

### Task 4: Convert the Sidebar to a collapsible rail

**Files:**
- Modify: `src/components/Sidebar.astro`

This replaces the whole component. It adds `id="app-sidebar"`, wraps every label
in `.sidebar-label`, adds `aria-label` + a `.sidebar-tip` hover tooltip to each
nav link, gives links the `.sidebar-nav-link` class, and adds a `md`+ toggle
button wired to the state helper from Task 1.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/Sidebar.astro` with:

```astro
---
import UserFooter from './UserFooter.astro';

// Each nav item: href, short icon glyph, label, accessible name, and whether
// it's an external resource link.
const mainNav = [
  { id: 'nav-marketplace', href: '/',          icon: '⊞', label: 'Marketplace' },
  { id: 'nav-my-skills',   href: '/my-skills', icon: '◈', label: 'My Skills' },
  { id: 'nav-whats-new',   href: '/whats-new', icon: '★', label: "What's New" },
  { id: 'nav-contribute',  href: '/contribute',icon: '+', label: 'Add a Skill' },
];

const resources = [
  { href: 'https://navasage.atlassian.net/wiki/spaces/NH/pages/3137536013/FAQ+Claude+Skills', icon: '?', label: 'FAQ: Claude Skills' },
  { href: 'https://navasage.atlassian.net/wiki/spaces/CB/pages/1984135232/AI+Community+of+Practice', icon: '◎', label: 'Community of Practice' },
  { href: 'https://navasage.atlassian.net/wiki/spaces/CB/pages/3211788396/AI+Office+Hours', icon: '◷', label: 'AI Office Hours' },
];
---
<aside id="app-sidebar" class="flex-shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-y-auto" aria-label="Site sidebar">

  <!-- Logo -->
  <div class="px-2 md:px-4 py-4 border-b border-gray-200">
    <a href="/" class="sidebar-nav-link flex items-center gap-2 no-underline text-gray-900 hover:text-plum-700" aria-label="Nava Skills home">
      <span class="text-plum-600 font-bold text-base leading-none" aria-hidden="true">✦</span>
      <span class="sidebar-label font-semibold text-sm">Nava Skills</span>
    </a>
  </div>

  <!-- Nav -->
  <nav class="flex-1 px-2 py-3 space-y-4" aria-label="Main navigation">
    <!-- Collapse/expand toggle (desktop/tablet only; phones stay on the rail) -->
    <button
      id="sidebar-toggle"
      type="button"
      aria-label="Collapse sidebar"
      aria-pressed="false"
      class="hidden md:flex sidebar-nav-link items-center gap-2 w-full px-2 py-1.5 text-sm text-gray-500 rounded hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
    >
      <span aria-hidden="true" class="text-gray-400 text-xs">⇤</span>
      <span class="sidebar-label">Collapse</span>
    </button>

    <div>
      <p class="sidebar-label px-2 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider" aria-hidden="true">Navigation</p>
      <ul class="space-y-0.5 list-none p-0 m-0">
        {mainNav.map((item) => (
          <li>
            <a href={item.href} id={item.id} aria-label={item.label} class="sidebar-nav-link group/nav relative flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 hover:text-gray-900 no-underline transition-colors">
              <span aria-hidden="true" class="text-gray-400 text-xs">{item.icon}</span>
              <span class="sidebar-label">{item.label}</span>
              <span class="sidebar-tip pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 z-20 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 group-hover/nav:opacity-100 transition-opacity shadow-lg">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>

    <!-- Resources -->
    <div>
      <p class="sidebar-label px-2 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider" aria-hidden="true">Resources</p>
      <ul class="space-y-0.5 list-none p-0 m-0">
        {resources.map((item) => (
          <li>
            <a href={item.href} target="_blank" rel="noopener" aria-label={item.label} class="sidebar-nav-link group/nav relative flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 hover:text-gray-900 no-underline transition-colors">
              <span aria-hidden="true" class="text-gray-400 text-xs">{item.icon}</span>
              <span class="sidebar-label">{item.label}</span>
              <span class="sidebar-tip pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 z-20 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 group-hover/nav:opacity-100 transition-opacity shadow-lg">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  </nav>

  <UserFooter />
</aside>

<script>
  import { STORAGE_KEY, serialize } from '../lib/sidebar-state.mjs';

  const btn = document.getElementById('sidebar-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const root = document.documentElement;
      const collapsed = !root.hasAttribute('data-sidebar-collapsed');
      if (collapsed) {
        root.setAttribute('data-sidebar-collapsed', '');
      } else {
        root.removeAttribute('data-sidebar-collapsed');
      }
      try { localStorage.setItem(STORAGE_KEY, serialize(collapsed)); } catch (e) {}
      btn.setAttribute('aria-pressed', String(collapsed));
      btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    });
  }
</script>
```

- [ ] **Step 2: Verify**

Run: `pnpm run check && pnpm run build`
Expected: both succeed. (The active-nav highlighting script in `Base.astro` still
targets `nav-marketplace` etc. by id — those ids are preserved above, so it keeps
working.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.astro
git commit -m "feat(sidebar): collapsible icon rail with tooltips, a11y labels, toggle"
```

---

### Task 5: Make the UserFooter rail-aware

**Files:**
- Modify: `src/components/UserFooter.astro`

In rail mode the footer stacks vertically (avatar over logout); the email label
hides via `.sidebar-label`. The `.sidebar-footer` class drives the row/column
switch (see Task 2 CSS).

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/UserFooter.astro` with:

```astro
---
---
<div class="px-3 py-3 border-t border-gray-200">
  <div class="sidebar-footer flex items-center gap-2">
    <span class="w-7 h-7 rounded-full bg-plum-100 text-plum-700 text-xs font-semibold flex items-center justify-center flex-shrink-0 overflow-hidden" id="user-avatar">?</span>
    <span class="sidebar-label text-xs text-gray-500 truncate flex-1 min-w-0" id="user-email"></span>
    <a href="/auth/logout" title="Sign out" class="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors no-underline" aria-label="Sign out">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
    </a>
  </div>
</div>
```

- [ ] **Step 2: Verify**

Run: `pnpm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/UserFooter.astro
git commit -m "feat(sidebar): footer collapses to avatar + logout on the rail"
```

---

### Task 6: Add responsive breakpoints to all content grids

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/pages/my-skills.astro`
- Modify: `src/pages/skills/index.astro`
- Modify: `src/pages/agents/index.astro`
- Modify: `src/pages/category/index.astro`
- Modify: `src/pages/submit/index.astro`
- Modify: `src/pages/contribute.astro`
- Modify: `src/pages/admin/index.astro`

All edits are mechanical class-string substitutions. The card grids appear both
as static markup and inside JS template strings — the substitutions below cover
both because they match on the class string itself.

- [ ] **Step 1: Card grids — replace every `grid grid-cols-3 gap-3`**

In each of these files, replace **all** occurrences of the exact substring
`grid grid-cols-3 gap-3` with `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`:

- `src/pages/index.astro` (4 occurrences: 2 with ` animate-pulse` suffix, 2 plain)
- `src/pages/my-skills.astro` (2 occurrences)
- `src/pages/skills/index.astro` (2 occurrences, both `animate-pulse`)
- `src/pages/agents/index.astro` (1 occurrence, `animate-pulse`)
- `src/pages/category/index.astro` (1 occurrence)

The ` animate-pulse` suffix is preserved automatically since it follows the
matched substring.

- [ ] **Step 2: Plugins grid — `src/pages/index.astro`**

Replace the single occurrence of `grid grid-cols-4 gap-2` with
`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2`.

- [ ] **Step 3: Form field grids — `src/pages/submit/index.astro`**

Replace **all** occurrences of `grid grid-cols-2 gap-4` with
`grid grid-cols-1 sm:grid-cols-2 gap-4` (2 occurrences).

- [ ] **Step 4: Contribute stat row — `src/pages/contribute.astro`**

Replace `grid grid-cols-3 gap-4 mb-6` with
`grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6`.

- [ ] **Step 5: Admin stat grid — `src/pages/admin/index.astro`**

Replace `grid grid-cols-2 gap-3 mb-3` with
`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3`.

- [ ] **Step 6: Verify no stale non-responsive grids remain**

Run:
```bash
grep -rn "grid-cols-[0-9]" src --include="*.astro" | grep -v "sm:grid-cols\|md:grid-cols\|lg:grid-cols"
```
Expected: **no output** (every grid now has a responsive prefix). If any line
prints, fix it using the matching mapping above.

- [ ] **Step 7: Verify the build**

Run: `pnpm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/pages
git commit -m "feat(responsive): mobile-first breakpoints for all grids and forms"
```

---

### Task 7: Make admin tables horizontally scrollable

**Files:**
- Modify: `src/pages/admin/index.astro`

Add the `admin-table` class (CSS from Task 2 makes it scroll at `<768px`) to
every `<table>` opening tag. There are 9 tables across 3 distinct opening-tag
strings.

- [ ] **Step 1: Add the class to the seven border-collapse tables**

Replace **all** occurrences of:
```
<table class="w-full text-sm border-collapse">
```
with:
```
<table class="admin-table w-full text-sm border-collapse">
```
(7 occurrences — lines 252, 321, 342, 620, 785, 919, 992.)

- [ ] **Step 2: Add the class to the two `text-left` field tables**

Replace `<table class="w-full text-left">` with
`<table class="admin-table w-full text-left">` (1 occurrence), and
`<table class="w-full text-left opacity-70">` with
`<table class="admin-table w-full text-left opacity-70">` (1 occurrence).

- [ ] **Step 3: Verify all tables are covered**

There are 9 `<table>` tags total (7 border-collapse + 2 text-left). Confirm every
one now carries the class:
```bash
grep -n "<table" src/pages/admin/index.astro | grep -v "admin-table"
```
Expected: **no output** (no table lacks `admin-table`). As a cross-check,
`grep -c "<table" src/pages/admin/index.astro` and
`grep -c "admin-table" src/pages/admin/index.astro` should both return `9`.

- [ ] **Step 4: Verify the build**

Run: `pnpm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat(responsive): admin tables scroll horizontally on small screens"
```

---

### Task 8: Full manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and build**

Run: `pnpm run test && pnpm run check && pnpm run build`
Expected: all unit tests pass, astro check is clean, build succeeds.

- [ ] **Step 2: Start the dev server**

Run: `pnpm run dev`
Open the printed local URL. Use browser devtools device toolbar to test the
three widths below.

- [ ] **Step 3: Phone (375px) checks**

- [ ] Sidebar renders as a narrow icon rail; no text labels visible.
- [ ] Hovering a nav icon shows its text tooltip; each link still navigates.
- [ ] No collapse toggle is shown (it's `md`+ only) and there is no FOUC on reload.
- [ ] Footer shows the avatar stacked above the logout icon; no email text.
- [ ] Marketplace skills/agents/favorites render **1 column**; plugins **2 columns**.
- [ ] Submit form fields stack to **1 column**.
- [ ] Admin tables scroll horizontally instead of overflowing the page.

- [ ] **Step 4: Tablet (768px) checks**

- [ ] Full labeled sidebar is shown by default.
- [ ] Clicking "Collapse" shrinks it to the icon rail; reloading a page keeps it
      collapsed (localStorage persists); expanding again persists too.
- [ ] Skills/agents/favorites render **2 columns**; plugins **3 columns**.
- [ ] Submit form fields render **2 columns**.

- [ ] **Step 5: Desktop (1280px) checks**

- [ ] Full sidebar by default; collapse/expand toggle works and persists across
      navigation between pages.
- [ ] Skills/agents/favorites render **3 columns**; plugins **4 columns**.
- [ ] Active-nav highlighting (current page) still works in both states.

- [ ] **Step 6: Commit any fixes**

If manual checks surfaced issues, fix them and commit with a descriptive message.
If everything passed with no code changes, there is nothing to commit for this task.

---

## Done

All tasks complete when: Vitest passes, `astro check` is clean, `astro build`
succeeds, and the three viewport passes in Task 8 are confirmed.
