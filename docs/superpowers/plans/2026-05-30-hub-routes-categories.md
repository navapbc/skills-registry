# Hub Routes & Category Expansion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the hub with full category assignments for all skills, featured enterprise skill slots, new `/skills`, `/agents`, and `/category/[slug]` routes, and a homepage preview mode that links to those routes.

**Architecture:** `categories.mjs` is updated with `slugs` (all 54 categorized skills) and `featuredSlugs` (empty now, populated when enterprise skills are synced). `skills/index.astro` becomes dual-mode (no slug → full list, slug present → detail). Two new CSR shell pages are added: `agents/index.astro` and `category/index.astro`. The CloudFront edge function gains routing rules for `/agents/*` and `/category/*`, requiring a `terraform apply`. The homepage "View all" expand buttons become `<a>` links to the new routes.

**Tech Stack:** Vanilla JS/ESM, Astro static output, Tailwind CSS, Vitest, Terraform

---

## File Map

**Modify:**
- `src/lib/categories.mjs` — rename `curatedSlugs` → `slugs`, add `featuredSlugs: []`, populate full 54-skill taxonomy
- `src/lib/render.mjs` — update `renderCategoryGrid` (slugs, featured section, View All link), add `renderCategoryDetail(category, skills)`
- `tests/frontend/render.test.mjs` — update field names, add category detail tests
- `src/pages/skills/index.astro` — dual-mode: no slug → full skills list; slug → detail
- `src/pages/index.astro` — "View all" buttons → `<a>` links to `/skills` and `/agents`
- `functions/edge/auth-check.js.tpl` — add `/agents/*` and `/category/*` routing rules

**Create:**
- `src/pages/agents/index.astro` — dual-mode: no slug → agent list; slug → agent detail
- `src/pages/category/index.astro` — category detail: reads slug, shows all skills in category

---

## Task 1: Update categories.mjs

**Files:**
- Modify: `src/lib/categories.mjs`

- [ ] **Step 1: Replace `src/lib/categories.mjs` entirely**

```js
// Category definitions for the homepage grid and category detail pages.
// slugs: all skills assigned to this category (shown in grid + category page)
// featuredSlugs: enterprise-managed skills shown with "Featured" label at top
//   (leave empty until Anthropic API enterprise skill sync is built)
// Ops team: edit slugs/featuredSlugs to curate the hub's categories.
export const CATEGORIES = [
  {
    id: 'writing-comms',
    label: 'Writing & Comms',
    borderColor: '#c4b5fd',
    textColor: '#7c3aed',
    featuredSlugs: [],
    slugs: [
      'nava-labs-style',
      'ux-writing',
      'update-docs',
      'caseworker-communication',
    ],
  },
  {
    id: 'research-analysis',
    label: 'Research & Analysis',
    borderColor: '#94a3b8',
    textColor: '#475569',
    featuredSlugs: [],
    slugs: [
      'diagram',
      'analyze-codebase',
      'design-review',
      'index-inputs',
      'review-stats',
      'dso-test-quality-report',
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    borderColor: '#6ee7b7',
    textColor: '#059669',
    featuredSlugs: [],
    slugs: [
      'brainstorm',
      'implementation-plan',
      'prioritize-epics',
      'preplanning',
      'roadmap',
      'interface-contracts',
      'sprint',
      'plan-review',
      'oscillation-check',
      'audit-plans',
      'open-items',
    ],
  },
  {
    id: 'dev-code',
    label: 'Dev & Code',
    borderColor: '#fcd34d',
    textColor: '#92400e',
    featuredSlugs: [],
    slugs: [
      'fix-bug',
      'debug-everything',
      'playwright-debug',
      'e2e-test',
      'test',
      'typecheck',
      'lint',
      'build',
      'review',
      'resolve-conflicts',
      'respond-to-pr-comments',
      'pre-push-check',
      'verification-before-completion',
      'validate-work',
      'frontend-design',
      'tweakcn-design',
      'color-and-contrast',
      'responsive-design',
      'spatial-design',
      'typography',
      'interaction-design',
      'motion-design',
      'skill-refactor',
    ],
  },
  {
    id: 'ops-automation',
    label: 'Ops & Automation',
    borderColor: '#d1d5db',
    textColor: '#374151',
    featuredSlugs: [],
    slugs: [
      'retro',
      'tickets-health',
      'generate-ui',
      'flow-screenshots',
      'create-bug',
      'agent-browser',
      'retro-finalize',
      'add-learning',
      'end-session',
      'session-start',
    ],
  },
];

export const SUBMIT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/categories.mjs
git commit -m "feat(hub): expand category taxonomy — 54 skills across 5 categories, add featuredSlugs"
```

---

## Task 2: Update render.mjs + tests

**Files:**
- Modify: `src/lib/render.mjs`
- Modify: `tests/frontend/render.test.mjs`

- [ ] **Step 1: Update `renderCategoryGrid` in `src/lib/render.mjs`**

Find and replace the entire `renderCategoryGrid` function (from `export function renderCategoryGrid` to its closing `}`). Replace with:

```js
export function renderCategoryGrid(categories, allSkills) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const bySlug = new Map(allSkills.map(s => [s.slug, s]));

  function isNew(skill) {
    return !!skill.last_updated && new Date(skill.last_updated).getTime() >= sevenDaysAgo;
  }

  const categoryCards = categories.map(cat => {
    const featured = (cat.featuredSlugs || []).map(slug => bySlug.get(slug)).filter(Boolean);
    const all = (cat.slugs || []).map(slug => bySlug.get(slug)).filter(Boolean);
    const preview = all.slice(0, 3);
    const total = all.length;

    const featuredRows = featured.map(skill => `
      <div class="flex items-center justify-between py-1 border-b border-gray-50">
        <span class="text-xs text-gray-700">${escapeHtml(skill.name)}</span>
        <span class="text-xs font-medium text-plum-600">Featured</span>
      </div>`).join('');

    const previewRows = preview.map(skill => `
      <div class="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
        <span class="text-xs text-gray-700">${escapeHtml(skill.name)}</span>
        ${isNew(skill) ? `<span class="px-1.5 py-0.5 text-xs font-semibold rounded" style="background:#f5f3ff;color:${escapeHtml(cat.textColor)}">new</span>` : ''}
      </div>`).join('');

    const rows = (featuredRows + previewRows) ||
      '<div class="text-xs text-gray-400 py-1 italic">No skills yet</div>';

    const viewAll = total > 0
      ? `<a href="/category/${escapeHtml(cat.id)}" class="text-xs no-underline font-medium hover:underline" style="color:${escapeHtml(cat.textColor)}">View all (${total}) &rarr;</a>`
      : '';

    return `
      <div class="bg-white border border-gray-200 rounded-lg p-4" style="border-top:3px solid ${escapeHtml(cat.borderColor)}">
        <div class="text-xs font-bold uppercase tracking-wider mb-3" style="color:${escapeHtml(cat.textColor)}">${escapeHtml(cat.label)}</div>
        <div class="mb-3">${rows}</div>
        ${viewAll}
      </div>`;
  }).join('');

  const submitCell = `
    <div class="border border-dashed border-plum-200 bg-plum-50 rounded-lg p-4 flex flex-col items-center justify-center text-center gap-2">
      <div class="text-xs font-semibold text-plum-700">Have a skill to share?</div>
      <div class="text-xs text-gray-500 leading-relaxed">Submit via Google Form. The ops team reviews submissions weekly.</div>
      <a href="${escapeHtml(SUBMIT_FORM_URL)}" target="_blank" rel="noopener"
         class="px-3 py-1.5 text-xs font-medium bg-plum-600 text-white rounded hover:bg-plum-700 no-underline transition-colors">
        Submit a skill
      </a>
    </div>`;

  return `
    <section class="mb-6">
      <div class="grid grid-cols-3 gap-4">
        ${categoryCards}
        ${submitCell}
      </div>
    </section>`;
}
```

- [ ] **Step 2: Add `renderCategoryDetail` at the end of `src/lib/render.mjs`**

Append after the `renderNewThisWeek` function:

```js
export function renderCategoryDetail(category, allSkills) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const bySlug = new Map(allSkills.map(s => [s.slug, s]));

  function isNew(skill) {
    return !!skill.last_updated && new Date(skill.last_updated).getTime() >= sevenDaysAgo;
  }

  const featured = (category.featuredSlugs || []).map(s => bySlug.get(s)).filter(Boolean);
  const skills = (category.slugs || []).map(s => bySlug.get(s)).filter(Boolean);

  const featuredSection = featured.length ? `
    <section class="mb-8">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-xs font-semibold text-plum-600 uppercase tracking-wider">Featured</span>
        <div class="flex-1 border-t border-gray-200"></div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        ${featured.map(skill => `
          <div style="border-top:2px solid ${escapeHtml(category.borderColor)}">${renderSkillCard(skill)}</div>
        `).join('')}
      </div>
    </section>` : '';

  const allSection = skills.length ? `
    <section>
      <div class="grid grid-cols-3 gap-3">
        ${skills.map(skill => renderSkillCard(skill)).join('')}
      </div>
    </section>` : '<p class="text-sm text-gray-400 italic">No skills in this category yet.</p>';

  return `
    <a href="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-6 transition-colors">
      &larr; Back to hub
    </a>
    <div class="mb-8" style="border-left:4px solid ${escapeHtml(category.borderColor)};padding-left:12px">
      <h1 class="text-2xl font-bold text-gray-900 m-0">${escapeHtml(category.label)}</h1>
      <p class="text-sm text-gray-500 mt-1 m-0">${skills.length} skill${skills.length !== 1 ? 's' : ''}</p>
    </div>
    ${featuredSection}
    ${allSection}`;
}
```

- [ ] **Step 3: Update tests in `tests/frontend/render.test.mjs`**

Find the `catSkills` fixture and the two describe blocks for `renderCategoryGrid` and `renderNewThisWeek`. The test currently uses `CATEGORIES` from categories.mjs — since categories.mjs still exports `CATEGORIES`, the import line is unchanged. However, the field name changed from `curatedSlugs` to `slugs`. Update the `renderCategoryGrid` tests to also import `renderCategoryDetail` and add a test for it.

Update the import line:
```js
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups, renderCategoryGrid, renderNewThisWeek, renderCategoryDetail } from '../../src/lib/render.mjs';
```

Add after the `renderNewThisWeek` describe block:

```js
describe('renderCategoryDetail', () => {
  const cat = CATEGORIES[0]; // writing-comms

  it('renders the category label', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain('Writing &amp; Comms');
  });

  it('renders a skill card for each skill in the category', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain('href="/skills/nava-labs-style"');
  });

  it('renders empty state when no skills match', () => {
    const html = renderCategoryDetail(cat, []);
    expect(html).toContain('No skills in this category yet');
  });

  it('renders featured section when featuredSlugs has entries', () => {
    const catWithFeatured = { ...cat, featuredSlugs: ['nava-labs-style'], slugs: ['nava-labs-style'] };
    const html = renderCategoryDetail(catWithFeatured, catSkills);
    expect(html).toContain('Featured');
  });

  it('does not render featured section when featuredSlugs is empty', () => {
    const catNoFeatured = { ...cat, featuredSlugs: [] };
    const html = renderCategoryDetail(catNoFeatured, catSkills);
    expect(html).not.toContain('Featured');
  });
});
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test
```

Expected: all tests pass. If `renderCategoryGrid` tests fail because of the `curatedSlugs` → `slugs` rename, the CATEGORIES import already uses `slugs` (from the updated categories.mjs in Task 1), so they should pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render.mjs tests/frontend/render.test.mjs
git commit -m "feat(hub): update renderCategoryGrid (slugs, featured, view-all), add renderCategoryDetail"
```

---

## Task 3: Skills page dual-mode (list + detail)

**Files:**
- Modify: `src/pages/skills/index.astro`

- [ ] **Step 1: Replace the `<script>` block in `src/pages/skills/index.astro`**

Read the file first. Then replace the entire `<script>` section with:

```astro
<script>
import { fetchApi } from '../../lib/api.mjs';
import { renderSkillDetail, renderSkillGrid, escapeHtml } from '../../lib/render.mjs';

const STORAGE_KEY = 'nava_installed_skills';
const container = document.getElementById('skill-content');

const slug = window.location.pathname.replace(/^\/skills\/?/, '').replace(/\/$/, '');

if (!slug) {
  // List mode — show all skills
  document.title = 'Skills · Skills Hub';
  container.innerHTML = `
    <div class="mb-8">
      <a href="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">&larr; Back to hub</a>
      <h1 class="text-2xl font-bold text-gray-900 m-0">All Skills</h1>
      <p class="text-sm text-gray-500 mt-1 m-0">Loading...</p>
    </div>
    <div id="skills-list-grid"><span class="text-xs text-gray-400">Loading...</span></div>`;

  fetchApi('/skills?type=skill')
    .then(({ skills }) => {
      document.querySelector('#skill-content h1 + p').textContent = `${skills.length} skills`;
      document.getElementById('skills-list-grid').innerHTML = renderSkillGrid(skills);
      initGithubLinks();
    })
    .catch(err => {
      if (!err.message.startsWith('Unauthorized')) {
        document.getElementById('skills-list-grid').innerHTML =
          '<p class="text-sm text-red-500">Failed to load skills. Please try again.</p>';
      }
    });
} else {
  // Detail mode — show one skill
  fetchApi('/skills/' + slug)
    .then(skill => {
      container.innerHTML = renderSkillDetail(skill);
      document.title = skill.name + ' · Skills Hub';
      initCopyButtons(skill);
      initGithubLinks();
    })
    .catch(err => {
      if (err.message.startsWith('API 404')) {
        container.innerHTML = '<p class="text-sm text-gray-500">Skill not found. <a href="/" class="text-plum-600 hover:text-plum-700">Back to hub</a></p>';
      } else if (!err.message.startsWith('Unauthorized')) {
        container.innerHTML = '<p class="text-sm text-red-500">Failed to load skill. Please try again.</p>';
      }
    });
}

function initCopyButtons(skill) {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy || '';
      navigator.clipboard.writeText(text).then(() => {
        saveToMySkills(skill, text);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });
  });
}

function saveToMySkills(skill, cmd) {
  try {
    const installed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!installed.find(s => s.slug === skill.slug)) {
      installed.unshift({ slug: skill.slug, name: skill.name, plugin: skill.plugin, description: skill.description, compatibility: skill.compatibility, type: skill.type, installedAt: Date.now(), installCommand: cmd });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(installed));
    }
  } catch {}
}

function initGithubLinks() {
  document.querySelectorAll('[data-github-url]').forEach(el => {
    el.addEventListener('click', e => {
      const url = el.dataset.githubUrl;
      if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); }
    });
  });
}
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/skills/index.astro
git commit -m "feat(hub): skills page dual-mode — /skills shows full list, /skills/:slug shows detail"
```

---

## Task 4: Agents page

**Files:**
- Create: `src/pages/agents/index.astro`

- [ ] **Step 1: Create `src/pages/agents/index.astro`**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Agent">
  <div id="agent-content">
    <div class="flex items-center justify-center py-20">
      <span class="text-sm text-gray-400">Loading...</span>
    </div>
  </div>
</Base>

<script>
import { fetchApi } from '../../lib/api.mjs';
import { renderSkillDetail, renderSkillGrid } from '../../lib/render.mjs';

const STORAGE_KEY = 'nava_installed_skills';
const container = document.getElementById('agent-content');

const slug = window.location.pathname.replace(/^\/agents\/?/, '').replace(/\/$/, '');

if (!slug) {
  // List mode — show all agents
  document.title = 'Agents · Skills Hub';
  container.innerHTML = `
    <div class="mb-8">
      <a href="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">&larr; Back to hub</a>
      <h1 class="text-2xl font-bold text-gray-900 m-0">All Agents</h1>
      <p class="text-sm text-gray-500 mt-1 m-0">Loading...</p>
    </div>
    <div id="agents-list-grid"><span class="text-xs text-gray-400">Loading...</span></div>`;

  fetchApi('/skills?type=agent')
    .then(({ skills }) => {
      document.querySelector('#agent-content h1 + p').textContent = `${skills.length} agents`;
      document.getElementById('agents-list-grid').innerHTML = renderSkillGrid(skills);
      initGithubLinks();
    })
    .catch(err => {
      if (!err.message.startsWith('Unauthorized')) {
        document.getElementById('agents-list-grid').innerHTML =
          '<p class="text-sm text-red-500">Failed to load agents. Please try again.</p>';
      }
    });
} else {
  // Detail mode — reuse skill detail render (agents have the same schema)
  fetchApi('/skills/' + slug)
    .then(skill => {
      container.innerHTML = renderSkillDetail(skill);
      document.title = skill.name + ' · Skills Hub';
      initCopyButtons(skill);
      initGithubLinks();
    })
    .catch(err => {
      if (err.message.startsWith('API 404')) {
        container.innerHTML = '<p class="text-sm text-gray-500">Agent not found. <a href="/" class="text-plum-600 hover:text-plum-700">Back to hub</a></p>';
      } else if (!err.message.startsWith('Unauthorized')) {
        container.innerHTML = '<p class="text-sm text-red-500">Failed to load agent. Please try again.</p>';
      }
    });
}

function initCopyButtons(skill) {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy || '';
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });
  });
}

function initGithubLinks() {
  document.querySelectorAll('[data-github-url]').forEach(el => {
    el.addEventListener('click', e => {
      const url = el.dataset.githubUrl;
      if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); }
    });
  });
}
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -10
```

Expected: build succeeds. `dist/agents/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add src/pages/agents/index.astro
git commit -m "feat(hub): add /agents route — list all agents or show agent detail"
```

---

## Task 5: Category detail page

**Files:**
- Create: `src/pages/category/index.astro`

- [ ] **Step 1: Create `src/pages/category/index.astro`**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Category">
  <div id="category-content">
    <div class="flex items-center justify-center py-20">
      <span class="text-sm text-gray-400">Loading...</span>
    </div>
  </div>
</Base>

<script>
import { fetchApi } from '../../lib/api.mjs';
import { renderCategoryDetail } from '../../lib/render.mjs';
import { CATEGORIES } from '../../lib/categories.mjs';

const container = document.getElementById('category-content');
const catSlug = window.location.pathname.replace(/^\/category\/?/, '').replace(/\/$/, '');

const category = CATEGORIES.find(c => c.id === catSlug);

if (!category) {
  container.innerHTML = '<p class="text-sm text-gray-500">Category not found. <a href="/" class="text-plum-600 hover:text-plum-700">Back to hub</a></p>';
} else {
  document.title = category.label + ' · Skills Hub';

  fetchApi('/skills')
    .then(({ skills }) => {
      container.innerHTML = renderCategoryDetail(category, skills);
      initGithubLinks();
    })
    .catch(err => {
      if (!err.message.startsWith('Unauthorized')) {
        container.innerHTML = '<p class="text-sm text-red-500">Failed to load. Please try again.</p>';
      }
    });
}

function initGithubLinks() {
  document.querySelectorAll('[data-github-url]').forEach(el => {
    el.addEventListener('click', e => {
      const url = el.dataset.githubUrl;
      if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); }
    });
  });
}
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -10
```

Expected: build succeeds. `dist/category/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add src/pages/category/index.astro
git commit -m "feat(hub): add /category/[slug] route — category detail with featured skills"
```

---

## Task 6: CloudFront routing + terraform apply

**Files:**
- Modify: `functions/edge/auth-check.js.tpl`

- [ ] **Step 1: Update `rewriteUri` in `functions/edge/auth-check.js.tpl`**

Find the existing `rewriteUri` function and add two new routing rules for `/agents` and `/category`:

```js
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;

  // Route all /skills/*, /plugins/*, /agents/*, /category/* to their CSR shells
  if (uri.indexOf('/skills') === 0) return '/skills/index.html';
  if (uri.indexOf('/plugins') === 0) return '/plugins/index.html';
  if (uri.indexOf('/agents') === 0) return '/agents/index.html';
  if (uri.indexOf('/category') === 0) return '/category/index.html';

  return uri + '/index.html';
}
```

- [ ] **Step 2: Commit the edge function change**

```bash
git add functions/edge/auth-check.js.tpl
git commit -m "feat(infra): add /agents/* and /category/* CloudFront routing rules"
```

- [ ] **Step 3: Terraform apply for staging**

```bash
cd /Users/cory/Documents/GitHub/skills-registry/terraform
terraform apply -var-file=terraform.staging.tfvars
```

Expected: `1 change` — only `aws_cloudfront_function.auth_check` updates.

---

## Task 7: Homepage preview mode + View All links

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Update the skills expand button to a link**

Find the skills-expand button in the template:
```astro
        <button id="skills-expand" class="text-xs text-plum-600 hover:text-plum-700 cursor-pointer bg-transparent border-none hidden">
          View all →
        </button>
```

Replace with an anchor:
```astro
        <a id="skills-expand" href="/skills" class="text-xs text-plum-600 hover:text-plum-700 no-underline hidden">
          View all →
        </a>
```

- [ ] **Step 2: Update the agents expand button to a link**

Find the agents-expand button:
```astro
        <button id="agents-expand" class="text-xs text-plum-600 hover:text-plum-700 cursor-pointer bg-transparent border-none hidden">
          View all →
        </button>
```

Replace with:
```astro
        <a id="agents-expand" href="/agents" class="text-xs text-plum-600 hover:text-plum-700 no-underline hidden">
          View all →
        </a>
```

- [ ] **Step 3: Update `renderGrid` in the client script to no longer expand on click**

Find the `renderGrid` function in the `<script>` block:

```js
function renderGrid(gridId, expandBtnId, items) {
  const grid = document.getElementById(gridId);
  const expandBtn = document.getElementById(expandBtnId);

  grid.innerHTML = `<div class="grid grid-cols-3 gap-3">
    ${items.map((skill, i) => `<div ${i >= PREVIEW_COUNT ? 'class="hidden"' : ''} data-item>${renderSkillCard(skill)}</div>`).join('')}
  </div>`;

  if (items.length > PREVIEW_COUNT) {
    expandBtn.classList.remove('hidden');
    expandBtn.textContent = `View all (${items.length}) →`;
    expandBtn.addEventListener('click', function() {
      grid.querySelectorAll('[data-item]').forEach(el => el.classList.remove('hidden'));
      this.classList.add('hidden');
    });
  }
}
```

Replace with (link version — no click handler needed):

```js
function renderGrid(gridId, expandBtnId, items) {
  const grid = document.getElementById(gridId);
  const expandLink = document.getElementById(expandBtnId);

  grid.innerHTML = `<div class="grid grid-cols-3 gap-3">
    ${items.slice(0, PREVIEW_COUNT).map(skill => `<div>${renderSkillCard(skill)}</div>`).join('')}
  </div>`;

  if (items.length > PREVIEW_COUNT) {
    expandLink.classList.remove('hidden');
    expandLink.textContent = `View all (${items.length}) →`;
  }
}
```

- [ ] **Step 4: Build and test**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -10 && pnpm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/pages/index.astro
git commit -m "feat(hub): homepage View All links go to /skills and /agents routes"
git push origin main
```
