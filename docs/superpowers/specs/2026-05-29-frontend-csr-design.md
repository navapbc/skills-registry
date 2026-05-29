# Frontend CSR Migration Design

**Date:** 2026-05-29  
**Status:** Approved  
**Scope:** Convert the Astro static frontend from build-time JSON rendering to full client-side rendering (CSR) driven by the live `/api/*` endpoints. Newly approved skills appear in the browse experience immediately without requiring a rebuild.

---

## Problem

The frontend currently reads `public/registry/index.json` at Astro build time. All skill and plugin pages are pre-rendered as static HTML. Any skill added to DynamoDB after the last CI build is invisible until the next push to `main`. Skill detail pages (`/skills/[slug]`) only exist for slugs that were present at build time.

---

## Goals

1. The skills list (homepage) always shows the live DynamoDB dataset — no rebuild needed.
2. A newly approved skill's detail page (`/skills/new-slug`) loads immediately without a CI deploy.
3. Plugin detail pages behave the same way.
4. The What's New page reflects current DynamoDB data sorted by `last_updated`.
5. The existing visual design (Tailwind CSS, card layouts) is unchanged.
6. No change to hosting model (S3 + CloudFront static site).

**Out of scope:** Skill submission form, admin approval UI, My Skills localStorage integration with the API.

---

## Architecture

### Pages changed

| Page | Before | After |
|------|--------|-------|
| `src/pages/index.astro` | Imports JSON in frontmatter, server-renders skill cards | Static shell; client script fetches `/api/skills` and `/api/plugins`, renders cards |
| `src/pages/skills/[slug].astro` | `getStaticPaths()` + server-rendered detail | **Deleted** — replaced by `src/pages/skills/index.astro` |
| `src/pages/plugins/[slug].astro` | `getStaticPaths()` + server-rendered detail | **Deleted** — replaced by `src/pages/plugins/index.astro` |
| `src/pages/whats-new.astro` | Imports JSON, sorts server-side | Static shell; client script fetches `/api/skills` sorted by `last_updated` |

### Pages unchanged

- `src/pages/my-skills.astro` — already CSR via localStorage
- `src/pages/contribute.astro` — static, no data
- `src/pages/login.astro` — static
- `src/pages/404.astro` — static

### New files

- `src/lib/api.mjs` — `fetchApi(path)` authenticated fetch utility
- `src/lib/render.mjs` — JavaScript render functions matching existing Astro component HTML

### CloudFront edge function

- `functions/edge/auth-check.js.tpl` — `rewriteUri()` updated to route all `/skills/*` and `/plugins/*` paths to a single shell page

### Terraform

- `terraform apply` required after the edge function change (CloudFront function is a Terraform-managed resource)

---

## API Utility (`src/lib/api.mjs`)

```js
export async function fetchApi(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error ${res.status} for ${path}`);
  return res.json();
}
```

`credentials: 'include'` ensures the `__session` cookie is sent. Since the frontend and API share the same CloudFront domain, the cookie is automatically present — no additional auth setup required. CloudFront routes `/api/*` to API Gateway which validates the JWT in the Lambda.

---

## Render Utility (`src/lib/render.mjs`)

JavaScript functions that produce the same HTML structure as the existing Astro components. They accept the same data shape returned by the API.

```js
function escapeHtml(str) { /* converts &, <, >, ", ' to HTML entities */ }

export function renderSkillCard(skill) { /* mirrors SkillCard.astro HTML */ }
export function renderSkillGrid(skills) { /* wraps cards in the grid container */ }
export function renderSkillDetail(skill) { /* mirrors skills/[slug].astro body */ }
export function renderPluginDetail(plugin, skills, agents) { /* mirrors plugins/[slug].astro body */ }
export function renderWhatsNew(skills) { /* mirrors whats-new.astro grouped list */ }
```

All user-controlled string values are passed through `escapeHtml()` before being placed in HTML.

---

## Page Load Pattern

Every updated page follows the same pattern:

1. **Static shell**: Astro renders the page layout (header, sidebar, nav) with a loading indicator in the content area. No data in the initial HTML.
2. **Client script runs**: Calls `fetchApi()` with the appropriate path.
3. **Render**: Calls the matching `render*()` function and replaces the loading indicator with the result.
4. **Error state**: If the fetch fails (session expired, API error), shows an inline error message with a link to re-login.

---

## Homepage (`src/pages/index.astro`)

**Fetches:** `GET /api/skills` and `GET /api/plugins`

**Shell content:** Page layout + sidebar + search input + `<div id="skills-grid">` with loading spinner.

**Client script:**
1. Fetch skills and plugins in parallel via `Promise.all`
2. Call `renderSkillGrid(skills)` for skills tab, same for agents tab
3. Populate the search index from the fetched data (same structure as current `searchIndex` variable)
4. Attach search/filter event listeners after rendering

The existing search logic (debounced input, filter by plugin/type/compatibility) stays intact — it just operates on the in-memory fetched array rather than DOM attribute scanning.

---

## Skill Detail Shell (`src/pages/skills/index.astro`)

A single static Astro page. No `getStaticPaths()`. Generates one `skills/index.html` file.

**Client script:**
1. Read slug: `const slug = window.location.pathname.split('/skills/')[1]?.replace(/\/$/, '')`
2. Fetch: `fetchApi('/skills/' + slug)`
3. If 404: render "Skill not found" message with a back link
4. Otherwise: call `renderSkillDetail(skill)` and replace the loading indicator

---

## Plugin Detail Shell (`src/pages/plugins/index.astro`)

Same pattern as skill detail.

**Client script:**
1. Read slug from `window.location.pathname`
2. Fetch plugin: `fetchApi('/plugins/' + slug)`
3. Fetch plugin's skills: `fetchApi('/skills?plugin=' + slug)`
4. Call `renderPluginDetail(plugin, skills, agents)`

---

## What's New (`src/pages/whats-new.astro`)

**Fetches:** `GET /api/skills` (all approved)

**Client script:**
1. Fetch all skills
2. Sort by `last_updated` descending
3. Group by recency (last 7 days / this month / older) — same grouping logic as current
4. Render grouped list

---

## CloudFront Edge Function Change

**File:** `functions/edge/auth-check.js.tpl`

**Current `rewriteUri()`:**
```js
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;
  return uri + '/index.html';
}
```

**Updated `rewriteUri()`:**
```js
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;

  // Route all skill/plugin URLs to a single CSR shell
  if (uri.startsWith('/skills')) return '/skills/index.html';
  if (uri.startsWith('/plugins')) return '/plugins/index.html';

  return uri + '/index.html';
}
```

This means any path under `/skills/` — including slugs for skills added after the last build — serves `skills/index.html`. The page script reads the slug from `window.location.pathname` and fetches from the API.

**Terraform apply required** after this change to update the CloudFront function.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No session cookie / expired JWT | API returns 401 → frontend shows "Session expired, please log in" with a link to `/login` |
| Skill slug not found | API returns 404 → detail page shows "Skill not found" with a back link |
| API unreachable | fetch throws → shows "Unable to load, please try again" |
| Empty skills list | Shows empty state matching current design |

---

## What This Phase Does NOT Include

- Skill submission form (non-technical user intake still goes through the existing Google Form)
- Admin approval UI
- My Skills migration from localStorage to API
- MCP server entity
- Search result ranking or full-text search improvements
