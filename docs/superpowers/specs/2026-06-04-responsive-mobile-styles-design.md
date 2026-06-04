# Responsive / Mobile Styles — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Problem

The Skills Registry frontend has essentially no mobile styles. The app is built
with Astro + Tailwind v4, and the viewport meta tag is present, but:

- **Shell** (`Base.astro`): a fixed `flex h-screen` layout with a hardcoded
  `w-56` (224px) sidebar that is always rendered beside a scrollable `main` with
  `px-8` padding. On a 375px phone the sidebar alone consumes ~60% of the width.
- **Grids are hardcoded with no breakpoints**: `grid-cols-3` (skills, agents,
  favorites), `grid-cols-4` (plugins), `grid-cols-2` (forms, admin stats). None
  use `sm:`/`md:`/`lg:` prefixes, so phones render 3–4 cramped columns. Many of
  these grids are injected as **JS template strings** inside page `<script>`
  blocks, not just static markup — the responsive pass must touch the JS too.
- **Admin tables** use `whitespace-nowrap` and overflow the viewport on phones.

The app should work on desktop, tablet, and mobile. The key constraint from the
user: **the left sidebar must stay present on mobile** (not collapse into a
hamburger drawer).

## Decisions

- **Sidebar on mobile:** icon-only rail (narrow vertical strip of icons, no text
  labels), pinned on the left. The rail is always present, satisfying the
  constraint.
- **Collapsible:** the sidebar has two states — **expanded** (full labeled
  `w-56`) and **collapsed** (icon rail). Phones default to the rail; tablets and
  desktop default to the full sidebar but the user can manually toggle to the
  rail, and the preference persists.
- **Breakpoint:** phones (`<768px`, Tailwind `md`) get the rail by default;
  `md`+ gets the full sidebar (subject to the user toggle).
- **Icon labels / a11y:** each nav link gets an `aria-label`, plus a text
  tooltip (reusing `Tooltip.astro`) shown only in rail mode.
- **Scope:** full responsive pass — shell + sidebar + all content grids + forms
  + admin tables.

## Approach

**Single sidebar, state-driven collapse** (chosen over duplicate-markup or
JS-rerender approaches).

A `data-sidebar-collapsed` attribute on `<html>` is the single source of truth:
- Written to `localStorage` (`sidebar-collapsed`) when toggled.
- Applied by a tiny pre-paint inline script in `<head>` to avoid a
  flash-of-unstyled-content (FOUC).
- Mobile-first CSS: the sidebar renders as the icon rail by default; at `md`+ it
  expands to the full labeled `w-56` **unless** `data-sidebar-collapsed` is set.

Rejected alternatives:
- **Two sidebars toggled by responsive `hidden`/`md:flex`** — responsive
  utilities are viewport-based only, so a manual desktop toggle can't layer on
  cleanly, and links/labels get duplicated (a11y + maintenance hazard).
- **JS re-render / client framework** — overkill; this is static Astro with no
  client framework.

## Components & Changes

### 1. Shell — `src/layouts/Base.astro`
- Keep `flex h-screen overflow-hidden`.
- Add a pre-paint inline script in `<head>`: read `localStorage.sidebar-collapsed`
  and set `data-sidebar-collapsed` on `<html>` before first paint.
- Content padding goes responsive: `px-8 py-8` → `px-4 py-6 sm:px-6 lg:px-8`.

### 2. `src/components/Sidebar.astro`
- Give the `<aside>` `id="app-sidebar"`.
- Width: rail `w-14` by default; the CSS block (below) sets `w-56` at `md`+ when
  expanded.
- Wrap every text label in `<span class="sidebar-label">…</span>`; center icons
  in rail mode.
- Add `aria-label` to each nav link.
- Add a Tooltip (reusing `Tooltip.astro`) per nav item, shown only in rail mode.
- Add a collapse/expand toggle button (chevron), visible `md`+, that flips
  `data-sidebar-collapsed` on `<html>` and writes `localStorage`.

### 3. `src/components/UserFooter.astro`
- Rail mode: show avatar + logout icon only; hide the email label.
- Expanded mode: unchanged.

### 4. `src/styles/main.css`
Add one commented block:
```css
/* Sidebar: rail by default; md+ expands to labeled unless user collapsed it */
.sidebar-label { display: none; }
@media (min-width: 768px) {
  html:not([data-sidebar-collapsed]) .sidebar-label { display: inline; }
  html:not([data-sidebar-collapsed]) #app-sidebar { width: 14rem; }
}
```

### 5. Responsive grids
Add mobile-first breakpoints everywhere, **including the JS template strings**:

| Location | Current | New |
|---|---|---|
| Skills/agents/favorites cards (`index.astro` lines 76, 100, 160, 291; `my-skills.astro` 45, 63; `skills/index.astro` 61, 67; `agents/index.astro` 52; `category/index.astro` 11) | `grid-cols-3` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| Plugins (`index.astro` 226) | `grid-cols-4` | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` |
| Submit form fields (`submit/index.astro` 14, 31) | `grid-cols-2` | `grid-cols-1 sm:grid-cols-2` |
| Contribute stat row (`contribute.astro` 26) | `grid-cols-3` | `grid-cols-1 sm:grid-cols-3` |
| Admin stat grid (`admin/index.astro` 365) | `grid-cols-2` | `grid-cols-1 sm:grid-cols-2` |

### 6. Admin tables — `src/pages/admin/index.astro`
Wrap each `whitespace-nowrap` data table in a `overflow-x-auto` container so it
scrolls horizontally on phones instead of breaking layout. Light touch; admin is
a power-user view, full reflow is out of scope.

## Testing

Manual viewport checks at **375 / 768 / 1280px**:
- Rail renders on phone; tooltips appear; every nav item is identifiable.
- Toggle collapses/expands on desktop+tablet and the preference persists across
  navigation.
- No FOUC on load (pre-paint script works).
- Grids reflow 1 → 2 → 3 columns (plugins 2 → 3 → 4) across breakpoints.
- Submit/contribute forms stack to a single column on phones.
- Admin tables scroll horizontally rather than overflowing.

## Out of Scope

- Full reflow / card-ification of admin tables (scroll-wrap only).
- Touch-gesture sidebar swipe.
- Any backend or data changes.
