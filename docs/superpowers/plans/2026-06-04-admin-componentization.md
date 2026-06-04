# Admin Page Componentization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 1011-line `src/pages/admin/index.astro` into focused, single-responsibility modules and Astro components with identical runtime behavior, adding unit tests for the parts that become pure functions.

**Architecture:** Pure logic (formatters, validation-results renderer) moves to `src/lib/admin/` (vitest-covered). DOM/tab code moves to a new `src/scripts/admin/` (one module per tab, each exporting `load(panel, ctx)`, plus a `controller.mjs` owning `currentTab`/`activateTab`/`reloadTab` and an `index.mjs` entry). The static shell becomes `AdminDashboard.astro` + `AdminTabs.astro`. The page shrinks to a thin shell that calls `initAdmin()`.

**Tech Stack:** Astro 6, Vite-bundled ESM `<script>` modules, Tailwind v4, Vitest, `pnpm`.

**Testing note:** This project has no DOM/component test harness; vitest covers `.mjs` logic only. So DOM modules are verified with `node --check` (syntax) during extraction and a full `pnpm run build` + manual click-through at the end. The two pure modules get real unit tests (TDD). This is why DOM modules live in `src/scripts/admin/` (outside the `src/lib/**` coverage glob) — putting them under `src/lib/` would drag untested files into the 80/80/70 coverage thresholds and fail `test:coverage`.

**Critical invariant:** behavior is identical. Same endpoints, payloads, DOM ids/classes, tab order, role gating. Do not "improve" behavior in this refactor.

**Reference:** Throughout, "current file" means the pre-refactor `src/pages/admin/index.astro` (captured in git history once Task 15 rewrites it). Read the relevant line range before moving it.

---

### Task 1: Pure formatters module (`format.mjs`)

**Files:**
- Create: `src/lib/admin/format.mjs`
- Test: `tests/frontend/admin-format.test.mjs`

- [ ] **Step 1: Confirm the `escapeHtml` dependency exists**

Run: `grep -n "export function escapeHtml\|export const escapeHtml" src/lib/render.mjs`
Expected: one match (the function this module imports).

- [ ] **Step 2: Write the failing test**

Create `tests/frontend/admin-format.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  SKILL_CATEGORIES, COMPAT_OPTIONS,
  catLabel, catSelectOptions, tagChips, compatChips, relTime, actorName,
} from '../../src/lib/admin/format.mjs';

describe('catLabel', () => {
  it('maps a known id to its label', () => {
    expect(catLabel('dev-code')).toBe('Dev & Code');
  });
  it('accepts an array and uses the first element', () => {
    expect(catLabel(['planning'])).toBe('Planning');
  });
  it('falls back to the raw id when unknown, and em-dash when empty', () => {
    expect(catLabel('mystery')).toBe('mystery');
    expect(catLabel('')).toBe('—');
    expect(catLabel(null)).toBe('—');
  });
});

describe('catSelectOptions', () => {
  it('marks the current category selected', () => {
    const html = catSelectOptions('planning');
    expect(html).toContain('<option value="planning" selected>Planning</option>');
    expect(html).toContain('<option value="dev-code" >Dev & Code</option>');
  });
  it('renders one option per category', () => {
    expect(catSelectOptions('').match(/<option/g).length).toBe(SKILL_CATEGORIES.length);
  });
});

describe('tagChips', () => {
  it('shows up to 3 chips', () => {
    const html = tagChips(['a', 'b', 'c']);
    expect(html.match(/<span/g).length).toBe(3);
    expect(html).toContain('#a');
  });
  it('adds a +N overflow indicator beyond 3', () => {
    expect(tagChips(['a', 'b', 'c', 'd', 'e'])).toContain('+2');
  });
  it('shows an italic none for empty/missing', () => {
    expect(tagChips([])).toContain('none');
    expect(tagChips(undefined)).toContain('none');
  });
});

describe('compatChips', () => {
  it('shows up to 2 chips then +N', () => {
    const html = compatChips(['claude-code', 'cursor', 'github-copilot']);
    expect(html).toContain('claude-code');
    expect(html).toContain('+1');
  });
  it('shows none for empty', () => {
    expect(compatChips([])).toContain('none');
  });
  it('exposes the canonical compat options', () => {
    expect(COMPAT_OPTIONS).toContain('claude-code');
  });
});

describe('relTime', () => {
  it('returns empty string for falsy input', () => {
    expect(relTime('')).toBe('');
    expect(relTime(null)).toBe('');
  });
  it('formats minutes, hours, and days', () => {
    const iso = (ms) => new Date(Date.now() - ms).toISOString();
    expect(relTime(iso(5 * 60000))).toBe('5m');
    expect(relTime(iso(90 * 60000))).toBe('1h');
    expect(relTime(iso(50 * 60 * 60000))).toBe('2d');
  });
});

describe('actorName', () => {
  const users = [{ user_id: 'u1', name: 'Ada Lovelace' }];
  it('returns the matching user name', () => {
    expect(actorName(users, 'u1')).toBe('Ada Lovelace');
  });
  it('falls back to the local-part of an email-like id', () => {
    expect(actorName(users, 'bob@nava.com')).toBe('bob');
  });
  it('returns ? for missing id', () => {
    expect(actorName(users, undefined)).toBe('?');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/frontend/admin-format.test.mjs`
Expected: FAIL — cannot resolve `../../src/lib/admin/format.mjs`.

- [ ] **Step 4: Create the module**

Create `src/lib/admin/format.mjs`:

```js
import { escapeHtml } from '../render.mjs';

export const SKILL_CATEGORIES = [
  { id: '', label: '— none —' },
  { id: 'writing-comms', label: 'Writing & Comms' },
  { id: 'research-analysis', label: 'Research & Analysis' },
  { id: 'planning', label: 'Planning' },
  { id: 'dev-code', label: 'Dev & Code' },
  { id: 'ops-automation', label: 'Ops & Automation' },
];

export const COMPAT_OPTIONS = ['claude-code', 'claude-chat', 'claude-cowork', 'cursor', 'github-copilot'];

export function catLabel(cat) {
  const id = Array.isArray(cat) ? (cat[0] ?? '') : (cat ?? '');
  return (SKILL_CATEGORIES.find(c => c.id === id)?.label ?? id) || '—';
}

export function catSelectOptions(currentCat) {
  const id = Array.isArray(currentCat) ? (currentCat[0] ?? '') : (currentCat ?? '');
  return SKILL_CATEGORIES.map(c => `<option value="${escapeHtml(c.id)}" ${id === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
}

export function tagChips(tags) {
  const arr = tags ?? [];
  const shown = arr.slice(0, 3).map(t => `<span class="text-xs bg-gray-100 text-gray-600 rounded px-1 mr-0.5">#${escapeHtml(t)}</span>`).join('');
  const more = arr.length > 3 ? `<span class="text-xs text-gray-400">+${arr.length - 3}</span>` : '';
  return shown + more || '<span class="text-xs text-gray-300 italic">none</span>';
}

export function compatChips(compat) {
  const arr = compat ?? [];
  if (!arr.length) return '<span class="text-xs text-gray-300 italic">none</span>';
  const shown = arr.slice(0, 2).map(c => `<span class="text-xs bg-gray-100 text-gray-600 rounded px-1 mr-0.5">${escapeHtml(c)}</span>`).join('');
  const more = arr.length > 2 ? `<span class="text-xs text-gray-400">+${arr.length - 2}</span>` : '';
  return shown + more;
}

export function relTime(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function actorName(users, uid) {
  return users.find(u => u.user_id === uid)?.name ?? (uid?.split('@')[0] ?? uid ?? '?');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/frontend/admin-format.test.mjs`
Expected: PASS — all groups green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/format.mjs tests/frontend/admin-format.test.mjs
git commit -m "refactor(admin): extract pure formatters into lib/admin/format with tests"
```

---

### Task 2: Validation-results renderer (`validation-view.mjs`)

**Files:**
- Create: `src/lib/admin/validation-view.mjs`
- Test: `tests/frontend/admin-validation-view.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/frontend/admin-validation-view.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderValidationResults } from '../../src/lib/admin/validation-view.mjs';

const base = {
  fields: [
    { key: 'name', value: 'my-skill', source: 'frontmatter' },
    { key: 'slug', value: 'my-skill', source: 'pipeline' },
  ],
  ignored: [],
  validation: { valid: true, errors: [] },
  warnings: [],
  record: { name: 'my-skill' },
};

describe('renderValidationResults', () => {
  it('shows the valid banner when schema passes', () => {
    const html = renderValidationResults(base);
    expect(html).toContain('Valid skill file');
    expect(html).toContain('Copy as JSON');
  });

  it('shows errors when invalid', () => {
    const html = renderValidationResults({
      ...base,
      validation: { valid: false, errors: [{ path: 'name', message: 'Required' }] },
    });
    expect(html).toContain('Invalid');
    expect(html).toContain('1 issue(s)');
    expect(html).toContain('Required');
  });

  it('renders the warnings block when warnings exist', () => {
    const html = renderValidationResults({
      ...base,
      warnings: [{ field: 'description', message: 'too short' }],
    });
    expect(html).toContain('Form conformance');
    expect(html).toContain('too short');
  });

  it('renders the ignored-keys block when ignored keys exist', () => {
    const html = renderValidationResults({
      ...base,
      ignored: [{ key: 'foo', suggestion: 'name' }],
    });
    expect(html).toContain('Ignored / unrecognized keys');
    expect(html).toContain('did you mean');
  });

  it('splits authored vs pipeline fields into two tables', () => {
    const html = renderValidationResults(base);
    expect(html).toContain('Extracted fields');
    expect(html).toContain('Set by the pipeline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/frontend/admin-validation-view.test.mjs`
Expected: FAIL — cannot resolve `../../src/lib/admin/validation-view.mjs`.

- [ ] **Step 3: Create the module**

Create `src/lib/admin/validation-view.mjs`. Copy the body of `renderValidationResults` **verbatim** from the current file (lines 513–581), then: (a) add the import line at the very top, and (b) add `export ` before `function`:

```js
import { escapeHtml } from '../render.mjs';

export function renderValidationResults(analysis) {
  // ... exact body from current src/pages/admin/index.astro lines 514–580 ...
}
```

The body (lines 514–580) is unchanged: `sourceLabel`, `fmtValue`, `authored`/`pipeline` split, `banner`, `warningsBlock`, `fieldRows`, `ignoredBlock`, and the final returned template string ending with the `copy-record-btn` / `copy-status` markup. Do not alter any markup.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/frontend/admin-validation-view.test.mjs`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/validation-view.mjs tests/frontend/admin-validation-view.test.mjs
git commit -m "refactor(admin): extract renderValidationResults into lib/admin/validation-view with tests"
```

---

### Task 3: API helpers and tab controller

**Files:**
- Create: `src/scripts/admin/api.mjs`
- Create: `src/scripts/admin/controller.mjs`

- [ ] **Step 1: Create the API helper**

Create `src/scripts/admin/api.mjs` (DRYs the three near-identical wrappers from the current file lines 51–75; POST/PUT send a JSON body, DELETE sends none — identical behavior):

```js
async function request(method, path, body) {
  const opts = { method, credentials: 'include' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const apiPost = (path, body) => request('POST', path, body);
export const apiPut = (path, body) => request('PUT', path, body);
export const apiDelete = (path) => request('DELETE', path);
```

- [ ] **Step 2: Create the controller**

Create `src/scripts/admin/controller.mjs`. This owns `currentTab` and merges the current file's `activateTab` (lines 91–105) and `loadTab` (223–238) logic. The `ctx` it builds is passed to every loader; `reloadTab` replaces the `currentTab = null; loadTab(...)` idiom:

```js
import { escapeHtml } from '../../lib/render.mjs';

// Creates the tab controller. `loaders` maps tabId -> async load(panel, ctx).
// Returns { activateTab, reloadTab } for the entry script to wire up.
export function createTabController({ loaders, role }) {
  let currentTab = null;

  async function loadTab(tabId) {
    const panel = document.getElementById(`tab-${tabId}`);
    if (!panel) return;
    panel.innerHTML = '<p class="text-sm text-gray-400">Loading...</p>';
    try {
      const load = loaders[tabId];
      if (load) await load(panel, ctx);
    } catch (err) {
      panel.innerHTML = `<p class="text-sm text-red-500">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  function activateTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('border-plum-600', isActive);
      btn.classList.toggle('text-plum-700', isActive);
      btn.classList.toggle('text-gray-600', !isActive);
      btn.classList.toggle('border-transparent', !isActive);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    if (currentTab !== tabId) {
      currentTab = tabId;
      loadTab(tabId);
    }
  }

  function reloadTab(tabId) {
    currentTab = null;
    loadTab(tabId);
  }

  const ctx = { role, activateTab, reloadTab };
  return { activateTab, reloadTab };
}
```

- [ ] **Step 3: Syntax-check both modules**

Run: `node --check src/scripts/admin/api.mjs && node --check src/scripts/admin/controller.mjs`
Expected: no output (exit 0) — both parse cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/admin/api.mjs src/scripts/admin/controller.mjs
git commit -m "refactor(admin): add api helpers and tab controller modules"
```

---

### Task 4: Dashboard module

**Files:**
- Create: `src/scripts/admin/dashboard.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/dashboard.mjs` by moving the body of `loadDashboard` (current file lines 114–221) with these exact transforms:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { relTime, actorName } from '../../lib/admin/format.mjs';
   ```
2. Signature: `async function loadDashboard() {` → `export async function load(panel, ctx) {`.
3. Replace the first two body lines `const dash = document.getElementById('admin-dashboard'); if (!dash) return;` with: `const dash = panel; if (!dash) return;`.
4. **Delete** the local `relTime` definition (lines 156–163) and the local `actorName` definition (lines 165–167) — they are imported now.
5. Update the `actorName` call (line 199) from `actorName(e.user_id)` to `actorName(users, e.user_id)`.
6. Replace the `role` reads (lines 122, 123, and 178) with `ctx.role`.
7. Replace the `activateTab` reference (line 219) with `ctx.activateTab`.
8. Keep `statCard`, `ACTION_STYLE`, the `Promise.all` fetches, the `queue-badge` update, and all markup exactly as-is.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/dashboard.mjs`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/dashboard.mjs
git commit -m "refactor(admin): extract dashboard into its own module"
```

---

### Task 5: Queue tab module

**Files:**
- Create: `src/scripts/admin/queue.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/queue.mjs` by moving `loadQueue` (current file lines 240–308) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPost } from './api.mjs';
   ```
2. Signature: `async function loadQueue(panel) {` → `export async function load(panel) {`.
3. Everything else verbatim (it uses `fetchApi`, `apiPost`, `escapeHtml`, and `document.getElementById('queue-badge')`).

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/queue.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/queue.mjs
git commit -m "refactor(admin): extract queue tab into its own module"
```

---

### Task 6: Enterprise tab module

**Files:**
- Create: `src/scripts/admin/enterprise.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/enterprise.mjs` by moving `loadEnterprise` (current file lines 310–465) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPost, apiPut, apiDelete } from './api.mjs';
   ```
2. Signature: `async function loadEnterprise(panel) {` → `export async function load(panel, ctx) {`.
3. Replace the `role` read (line 354, in the delete-button ternary) with `ctx.role`.
4. Replace `currentTab = null; loadTab('enterprise');` (lines 430–431) with `ctx.reloadTab('enterprise');`.
5. Everything else verbatim (form wiring, edit/delete handlers).

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/enterprise.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/enterprise.mjs
git commit -m "refactor(admin): extract enterprise tab into its own module"
```

---

### Task 7: Categories tab module

**Files:**
- Create: `src/scripts/admin/categories.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/categories.mjs` by moving `loadCategories` (current file lines 467–511) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPut } from './api.mjs';
   ```
2. Signature: `async function loadCategories(panel) {` → `export async function load(panel) {`.
3. Everything else verbatim.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/categories.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/categories.mjs
git commit -m "refactor(admin): extract categories tab into its own module"
```

---

### Task 8: Validate tab module

**Files:**
- Create: `src/scripts/admin/validate.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/validate.mjs` by moving `loadValidate` (current file lines 583–615) with:

1. Top imports:
   ```js
   import { escapeHtml } from '../../lib/render.mjs';
   import { analyzeSkillFile } from '../../lib/parse-skill.mjs';
   import { renderValidationResults } from '../../lib/admin/validation-view.mjs';
   ```
2. Signature: `async function loadValidate(panel) {` → `export async function load(panel) {`.
3. Everything else verbatim (it already calls `analyzeSkillFile`, `renderValidationResults`, `escapeHtml`). Note `renderValidationResults` now comes from the import, not a local function.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/validate.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/validate.mjs
git commit -m "refactor(admin): extract validate tab into its own module"
```

---

### Task 9: Users tab module

**Files:**
- Create: `src/scripts/admin/users.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/users.mjs` by moving `loadUsers` (current file lines 617–659) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPut } from './api.mjs';
   ```
2. Signature: `async function loadUsers(panel) {` → `export async function load(panel, ctx) {`.
3. Replace `currentTab = null; loadTab('users');` (lines 654–655) with `ctx.reloadTab('users');`.
4. Everything else verbatim.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/users.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/users.mjs
git commit -m "refactor(admin): extract users tab into its own module"
```

---

### Task 10: Skills & Agents (all-content) tab module

**Files:**
- Create: `src/scripts/admin/all-content.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/all-content.mjs` by moving `loadAllContent` (current file lines 687–871) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPut } from './api.mjs';
   import { catLabel, catSelectOptions, tagChips, compatChips, COMPAT_OPTIONS } from '../../lib/admin/format.mjs';
   ```
2. Signature: `async function loadAllContent(panel) {` → `export async function load(panel) {`.
3. **Delete** the local `const COMPAT_OPTIONS = [...]` (line 705) and the local `function compatChips(compat) {...}` (lines 707–713) — both are imported now.
4. Everything else verbatim: `getFiltered`, `renderRows`, `updateCount`, `wireRows`, `rerender`, the search input and `.content-filter` handlers, and the sync-note markup. The functions `catLabel`, `catSelectOptions`, `tagChips`, `compatChips` are now resolved from the import.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/all-content.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/all-content.mjs
git commit -m "refactor(admin): extract skills & agents tab into its own module"
```

---

### Task 11: Plugins tab module

**Files:**
- Create: `src/scripts/admin/plugins.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/plugins.mjs` by moving `loadPlugins` (current file lines 873–983) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   import { apiPut } from './api.mjs';
   import { tagChips } from '../../lib/admin/format.mjs';
   ```
2. Signature: `async function loadPlugins(panel) {` → `export async function load(panel) {`.
3. Everything else verbatim (`getFiltered`, `renderRows`, `wireRows`, search handler). `tagChips` is resolved from the import.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/plugins.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/plugins.mjs
git commit -m "refactor(admin): extract plugins tab into its own module"
```

---

### Task 12: Audit tab module

**Files:**
- Create: `src/scripts/admin/audit.mjs`

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/audit.mjs` by moving `loadAudit` (current file lines 985–1010) with:

1. Top imports:
   ```js
   import { fetchApi } from '../../lib/api.mjs';
   import { escapeHtml } from '../../lib/render.mjs';
   ```
2. Signature: `async function loadAudit(panel) {` → `export async function load(panel) {`.
3. Everything else verbatim.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/audit.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/audit.mjs
git commit -m "refactor(admin): extract audit tab into its own module"
```

---

### Task 13: Entry module (`index.mjs`)

**Files:**
- Create: `src/scripts/admin/index.mjs`

This merges the current file's top-level bootstrap (lines 77–112): role fetch + redirect, revealing `.admin-only`, wiring `.tab-btn` clicks, loading the dashboard, and activating the queue tab.

- [ ] **Step 1: Create the module**

Create `src/scripts/admin/index.mjs`:

```js
import { fetchApi } from '../../lib/api.mjs';
import { createTabController } from './controller.mjs';
import { load as loadDashboard } from './dashboard.mjs';
import { load as loadQueue } from './queue.mjs';
import { load as loadAllContent } from './all-content.mjs';
import { load as loadPlugins } from './plugins.mjs';
import { load as loadEnterprise } from './enterprise.mjs';
import { load as loadCategories } from './categories.mjs';
import { load as loadValidate } from './validate.mjs';
import { load as loadUsers } from './users.mjs';
import { load as loadAudit } from './audit.mjs';

export async function initAdmin() {
  // The __user cookie only has name/email/picture, not role — fetch it.
  const me = await fetchApi('/users/me').catch(() => null);
  if (!me || me.role === 'user') {
    window.location.href = '/';
    return;
  }
  const role = me.role;

  if (role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  const loaders = {
    queue: loadQueue,
    'all-content': loadAllContent,
    plugins: loadPlugins,
    enterprise: loadEnterprise,
    categories: loadCategories,
    validate: loadValidate,
    users: loadUsers,
    audit: loadAudit,
  };

  const { activateTab } = createTabController({ loaders, role });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  const dashPanel = document.getElementById('admin-dashboard');
  await loadDashboard(dashPanel, { role, activateTab });

  activateTab('queue');
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/scripts/admin/index.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/admin/index.mjs
git commit -m "refactor(admin): add entry module wiring controller and tab loaders"
```

---

### Task 14: Static shell components

**Files:**
- Create: `src/components/admin/AdminDashboard.astro`
- Create: `src/components/admin/AdminTabs.astro`

- [ ] **Step 1: Create `AdminDashboard.astro`**

Move the current file's dashboard skeleton (lines 11–19) verbatim:

```astro
---
---
<div id="admin-dashboard" class="mb-6">
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
    <div class="bg-white border border-gray-200 rounded-lg p-4"><div class="h-8 bg-gray-200 rounded w-12 mb-1"></div><div class="h-3 bg-gray-100 rounded w-16"></div></div>
    <div class="bg-white border border-gray-200 rounded-lg p-4"><div class="h-8 bg-gray-200 rounded w-12 mb-1"></div><div class="h-3 bg-gray-100 rounded w-16"></div></div>
    <div class="bg-white border border-gray-200 rounded-lg p-4"><div class="h-8 bg-gray-200 rounded w-12 mb-1"></div><div class="h-3 bg-gray-100 rounded w-16"></div></div>
    <div class="bg-white border border-gray-200 rounded-lg p-4"><div class="h-8 bg-gray-200 rounded w-12 mb-1"></div><div class="h-3 bg-gray-100 rounded w-16"></div></div>
  </div>
</div>
```

- [ ] **Step 2: Create `AdminTabs.astro`**

This renders the nav and the empty panels from one `tabs` array, preserving every id and class from the current file (lines 21–43):

```astro
---
const tabs = [
  { id: 'queue',       label: 'Queue', badgeId: 'queue-badge' },
  { id: 'all-content', label: 'Skills & Agents' },
  { id: 'plugins',     label: 'Plugins' },
  { id: 'enterprise',  label: 'Enterprise Skills' },
  { id: 'categories',  label: 'Categories' },
  { id: 'validate',    label: 'Validate' },
  { id: 'users',       label: 'Users', adminOnly: true },
  { id: 'audit',       label: 'Audit Log', adminOnly: true },
];
---
<!-- Tab nav -->
<div class="border-b border-gray-200 mb-6">
  <nav class="flex gap-1 -mb-px">
    {tabs.map((t) => (
      <button
        data-tab={t.id}
        class={`tab-btn ${t.adminOnly ? 'admin-only hidden ' : ''}px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors`}
      >
        {t.label}
        {t.badgeId && <span id={t.badgeId} class="ml-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full hidden"></span>}
      </button>
    ))}
  </nav>
</div>

<!-- Tab panels -->
{tabs.map((t) => (
  <div id={`tab-${t.id}`} class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
))}
```

- [ ] **Step 3: Verify the build compiles the new components**

Run: `pnpm run build`
Expected: build succeeds (the components are not yet imported, but must parse).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminDashboard.astro src/components/admin/AdminTabs.astro
git commit -m "refactor(admin): extract dashboard and tabs into Astro components"
```

---

### Task 15: Rewrite the page and verify end-to-end

**Files:**
- Modify: `src/pages/admin/index.astro` (replace entire file)

- [ ] **Step 1: Replace the page with the thin shell**

Replace the **entire** contents of `src/pages/admin/index.astro` with:

```astro
---
import Base from '../../layouts/Base.astro';
import AdminDashboard from '../../components/admin/AdminDashboard.astro';
import AdminTabs from '../../components/admin/AdminTabs.astro';
---
<Base title="Admin" description="Admin panel for managing skills, users, and categories in the Nava Skills Registry.">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-gray-900 m-0">Admin Panel</h1>
    <p class="text-sm text-gray-500 mt-1 m-0">Content curation and site management</p>
  </div>

  <AdminDashboard />
  <AdminTabs />
</Base>

<script>
  import { initAdmin } from '../../scripts/admin/index.mjs';
  initAdmin();
</script>
```

- [ ] **Step 2: Confirm the old inline logic is fully gone**

Run: `grep -n "loadDashboard\|loadQueue\|function activateTab\|apiPost" src/pages/admin/index.astro`
Expected: **no output** (all logic now lives in modules).

- [ ] **Step 3: Run the full automated suite**

Run: `pnpm run test && pnpm run check && pnpm run build`
Expected: all unit tests pass (including the two new admin test files), `astro check` is clean, and the build succeeds. If the build reports an unresolved import, fix the offending module's import path (modules in `src/scripts/admin/` reach `src/lib/` via `../../lib/` and siblings via `./`).

- [ ] **Step 4: Manual click-through (dev server)**

Run: `pnpm run dev`, open the printed URL, sign in as an admin, and verify each tab behaves exactly as before:

- [ ] Dashboard stat cards render; clicking the "Pending Review" card switches to the Queue tab; the queue badge shows the pending count; admin "Users / Recent Activity" section appears.
- [ ] **Queue:** pending list renders; Approve and Reject (with prompt) remove the row and clear the badge when empty.
- [ ] **Skills & Agents:** search + type filters work; inline Edit row opens, saves category/tags/compatibility, and updates the display cells.
- [ ] **Plugins:** search works; inline Edit saves tags.
- [ ] **Enterprise Skills:** built-ins read-only table renders; Add/Edit/Delete org skill works and the list refreshes (via `reloadTab`).
- [ ] **Categories:** editing featured slugs and Save shows the saved status.
- [ ] **Validate:** pasting a SKILL.md shows results (debounced), and "Copy as JSON" works.
- [ ] **Users** (admin only): role dropdown change persists; tab is hidden for non-admins.
- [ ] **Audit Log** (admin only): events table renders; hidden for non-admins.
- [ ] Non-privileged users are redirected to `/`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "refactor(admin): slim page to thin shell using extracted components and modules"
```

---

## Done

Complete when: both new unit test files pass, `pnpm run test` / `check` / `build`
are all green, the manual click-through in Task 15 confirms every tab is
behavior-identical, and `src/pages/admin/index.astro` is the ~16-line shell.

## Follow-on

After this lands, the responsive plan
(`2026-06-04-responsive-mobile-styles.md`) runs next. Its admin-table changes
(Task 7 there) now apply to the per-tab modules: add the `admin-table` class to
the `<table ...>` opening tags inside `queue.mjs`, `enterprise.mjs`, `users.mjs`,
`audit.mjs`, `all-content.mjs`, and `plugins.mjs`, and the `validation-view.mjs`
tables, rather than to one monolithic file.
