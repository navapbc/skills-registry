# Homepage Category Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5-category grid with a submit CTA and "New this week" strip above the existing Skills/Agents/Plugins browse sections on the homepage.

**Architecture:** A new `src/lib/categories.mjs` config file defines the 5 categories and their curated skill slugs — the ops team edits this file to control what appears in each card. Two new render functions (`renderCategoryGrid`, `renderNewThisWeek`) are added to `src/lib/render.mjs` and called from the homepage client script after skills are fetched. No new API calls are needed; the existing `/api/skills` response is reused.

**Tech Stack:** Vanilla JS/ESM, Astro static output, Tailwind CSS (class strings), Vitest

---

## File Map

**Create:**
- `src/lib/categories.mjs` — category definitions (id, label, colors, curatedSlugs) and Google Form URL

**Modify:**
- `src/lib/render.mjs` — add `renderCategoryGrid(categories, allSkills)` and `renderNewThisWeek(allSkills, categories)`
- `src/pages/index.astro` — add two placeholder `<div>` elements (category grid + new-this-week strip), import new functions in client script, call them after skills are fetched
- `tests/frontend/render.test.mjs` — add tests for the two new render functions

---

## Task 1: Category Config

**Files:**
- Create: `src/lib/categories.mjs`

- [ ] **Step 1: Create `src/lib/categories.mjs`**

```js
// Category definitions for the homepage grid.
// Ops team: edit curatedSlugs to control which skills appear in each card.
// Slugs must match exactly what is stored in DynamoDB (check /api/skills for current slugs).
export const CATEGORIES = [
  {
    id: 'writing-comms',
    label: 'Writing & Comms',
    borderColor: '#c4b5fd',
    textColor: '#7c3aed',
    curatedSlugs: ['nava-labs-style'],
  },
  {
    id: 'research-analysis',
    label: 'Research & Analysis',
    borderColor: '#94a3b8',
    textColor: '#475569',
    curatedSlugs: ['diagram', 'index-inputs', 'interface-contracts'],
  },
  {
    id: 'planning',
    label: 'Planning',
    borderColor: '#6ee7b7',
    textColor: '#059669',
    curatedSlugs: ['prioritize-epics', 'review-ruleset'],
  },
  {
    id: 'dev-code',
    label: 'Dev & Code',
    borderColor: '#fcd34d',
    textColor: '#92400e',
    curatedSlugs: ['frontend-design', 'init', 'e2e-test'],
  },
  {
    id: 'ops-automation',
    label: 'Ops & Automation',
    borderColor: '#d1d5db',
    textColor: '#374151',
    curatedSlugs: ['generate-ui', 'flow-screenshots'],
  },
];

export const SUBMIT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/categories.mjs
git commit -m "feat(homepage): add category config for curated skill grid"
```

---

## Task 2: Render Functions (TDD)

**Files:**
- Modify: `tests/frontend/render.test.mjs`
- Modify: `src/lib/render.mjs`

- [ ] **Step 1: Add failing tests to `tests/frontend/render.test.mjs`**

Append after the existing `renderWhatsNewGroups` describe block:

```js
import { CATEGORIES } from '../../src/lib/categories.mjs';

const catSkills = [
  {
    slug: 'nava-labs-style', name: 'Nava Labs Style', description: 'Writing style guide',
    plugin: 'labs-tir-prototyping', author: 'navapbc', committer: null, type: 'skill',
    sensitive_data: false, compatibility: ['claude-code'],
    last_updated: new Date().toISOString(), // today — counts as "new"
    repo: 'navapbc/labs-tir-prototyping', path: 'skills/nava-labs-style/SKILL.md', content: '',
  },
  {
    slug: 'diagram', name: 'Diagram', description: 'Draw diagrams',
    plugin: 'digital-service-orchestra', author: 'navapbc', committer: null, type: 'skill',
    sensitive_data: false, compatibility: ['claude-code'],
    last_updated: '2025-01-01T00:00:00Z', // old — not "new"
    repo: 'navapbc/digital-service-orchestra', path: 'SKILL.md', content: '',
  },
];

describe('renderCategoryGrid', () => {
  it('renders a card for each category', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Writing &amp; Comms');
    expect(html).toContain('Research &amp; Analysis');
    expect(html).toContain('Planning');
    expect(html).toContain('Dev &amp; Code');
    expect(html).toContain('Ops &amp; Automation');
  });

  it('shows curated skill names in the correct card', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Nava Labs Style');
    expect(html).toContain('Diagram');
  });

  it('shows "new" badge on skills updated within the last 7 days', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    // nava-labs-style has today's date — expect a "new" badge
    const writingSection = html.split('Research &amp;')[0];
    expect(writingSection).toContain('new');
  });

  it('does not show "new" badge on old skills', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    const researchSection = html.split('Research &amp; Analysis')[1]?.split('Planning')[0] || '';
    expect(researchSection).not.toContain('>new<');
  });

  it('renders the submit CTA cell', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Submit a skill');
    expect(html).toContain('docs.google.com');
  });

  it('skips curated slugs that are not in allSkills without erroring', () => {
    const html = renderCategoryGrid(CATEGORIES, []); // no skills loaded yet
    expect(html).toContain('Writing &amp; Comms');
    expect(html).not.toContain('undefined');
  });
});

describe('renderNewThisWeek', () => {
  it('returns empty string when no skills are new', () => {
    const old = [{ ...catSkills[1] }]; // only the old skill
    expect(renderNewThisWeek(old, CATEGORIES)).toBe('');
  });

  it('renders new skills with name and category link', () => {
    const html = renderNewThisWeek(catSkills, CATEGORIES);
    expect(html).toContain('Nava Labs Style');
    expect(html).toContain('/skills/nava-labs-style');
    expect(html).toContain("What's new");
  });

  it('caps output at 3 skills', () => {
    const manyNew = Array.from({ length: 10 }, (_, i) => ({
      ...catSkills[0],
      slug: `skill-${i}`,
      name: `Skill ${i}`,
    }));
    const html = renderNewThisWeek(manyNew, CATEGORIES);
    // Count occurrences of /skills/ links
    const linkCount = (html.match(/href="\/skills\//g) || []).length;
    expect(linkCount).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test tests/frontend/render.test.mjs
```

Expected: FAIL — `renderCategoryGrid is not a function` and `renderNewThisWeek is not a function`

- [ ] **Step 3: Add the two functions to `src/lib/render.mjs`**

First, add the import to the TOP of `src/lib/render.mjs` (after the existing first line `export function escapeHtml...` — actually insert it as line 1, before everything else):

```js
import { SUBMIT_FORM_URL } from './categories.mjs';
```

Then append the two functions at the very end of `src/lib/render.mjs`:

```js

export function renderCategoryGrid(categories, allSkills) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const bySlug = new Map(allSkills.map(s => [s.slug, s]));

  function isNew(skill) {
    return !!skill.last_updated && new Date(skill.last_updated).getTime() >= sevenDaysAgo;
  }

  const categoryCards = categories.map(cat => {
    const skills = cat.curatedSlugs.map(slug => bySlug.get(slug)).filter(Boolean);

    const rows = skills.length
      ? skills.map(skill => `
          <div class="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
            <span class="text-xs text-gray-700">${escapeHtml(skill.name)}</span>
            ${isNew(skill) ? `<span class="px-1.5 py-0.5 text-xs font-semibold rounded" style="background:#f5f3ff;color:${escapeHtml(cat.textColor)}">new</span>` : ''}
          </div>`).join('')
      : '<div class="text-xs text-gray-400 py-1 italic">No skills yet</div>';

    return `
      <div class="bg-white border border-gray-200 rounded-lg p-4" style="border-top:3px solid ${escapeHtml(cat.borderColor)}">
        <div class="text-xs font-bold uppercase tracking-wider mb-3" style="color:${escapeHtml(cat.textColor)}">${escapeHtml(cat.label)}</div>
        <div class="mb-3">${rows}</div>
        ${skills.length ? `<div class="text-xs text-gray-400">${skills.length} curated</div>` : ''}
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

export function renderNewThisWeek(allSkills, categories) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newSkills = allSkills
    .filter(s => s.last_updated && new Date(s.last_updated).getTime() >= sevenDaysAgo)
    .slice(0, 3);

  if (!newSkills.length) return '';

  function getCategoryLabel(slug) {
    const cat = categories.find(c => c.curatedSlugs.includes(slug));
    return cat ? cat.label : '';
  }

  const cards = newSkills.map(skill => {
    const catLabel = getCategoryLabel(skill.slug);
    return `
      <a href="/skills/${escapeHtml(skill.slug)}"
         class="bg-gray-50 border border-gray-200 rounded-lg p-3 flex-1 no-underline hover:border-gray-300 transition-colors">
        <div class="text-xs font-semibold text-gray-900 mb-1">${escapeHtml(skill.name)}</div>
        ${catLabel ? `<div class="text-xs text-gray-400">${escapeHtml(catLabel)}</div>` : ''}
      </a>`;
  }).join('');

  return `
    <div class="bg-white border border-gray-200 rounded-lg p-4 mb-10">
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs font-bold uppercase tracking-wider text-gray-700">New this week</div>
        <a href="/whats-new" class="text-xs text-plum-600 hover:text-plum-700 no-underline font-medium">What's new &rarr;</a>
      </div>
      <div class="flex gap-3">${cards}</div>
    </div>`;
}
```

- [ ] **Step 4: Update the imports in `tests/frontend/render.test.mjs`**

The test file currently imports from `render.mjs` — add the two new functions to the import line at the top of the file:

```js
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups, renderCategoryGrid, renderNewThisWeek } from '../../src/lib/render.mjs';
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test tests/frontend/render.test.mjs
```

Expected: all tests PASS (existing 23 + new 9 = 32 total).

- [ ] **Step 6: Commit**

```bash
git add src/lib/render.mjs tests/frontend/render.test.mjs
git commit -m "feat(homepage): add renderCategoryGrid and renderNewThisWeek"
```

---

## Task 3: Homepage Integration

**Files:**
- Modify: `src/pages/index.astro`

The homepage currently has this structure in its template:
1. Search hero (`<div class="mb-10">`)
2. Browse view (`<div id="browse-view">`) containing Plugins, Skills, Agents, MCP sections

We need to add two new `<div>` placeholders between the search hero and the browse view, then populate them from the client script.

- [ ] **Step 1: Add placeholder divs to `src/pages/index.astro` template**

Find the line `<!-- Browse view -->` in the template section. Insert the two new divs immediately BEFORE `<div id="browse-view">`:

```astro
  <!-- Category grid — populated by client script after skills are fetched -->
  <div id="category-grid"></div>

  <!-- New this week strip — populated by client script after skills are fetched -->
  <div id="new-this-week"></div>

  <!-- Browse view -->
  <div id="browse-view">
```

- [ ] **Step 2: Update the import line at the top of the `<script>` tag**

Find the existing import line in the `<script>` block:

```js
import { renderSkillCard, escapeHtml } from '../lib/render.mjs';
```

Replace it with:

```js
import { renderSkillCard, escapeHtml, renderCategoryGrid, renderNewThisWeek } from '../lib/render.mjs';
import { CATEGORIES } from '../lib/categories.mjs';
```

- [ ] **Step 3: Call the new render functions in the `Promise.all` `.then()` block**

Find the beginning of the `.then(([{ skills }, { plugins }]) => {` block. After the opening line (before the Plugins section), add:

```js
  // Category grid and new-this-week strip
  document.getElementById('category-grid').innerHTML = renderCategoryGrid(CATEGORIES, skills);
  const newThisWeek = renderNewThisWeek(skills, CATEGORIES);
  document.getElementById('new-this-week').innerHTML = newThisWeek;
```

Note: pass the full `skills` array (not filtered by type) so both skills and agents can appear in the curated lists.

- [ ] **Step 4: Remove the "+ Submit Skill" button from the page header**

The submit CTA is now in the category grid's 6th cell. Find and remove this block from the search hero:

```astro
      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview"
        target="_blank"
        rel="noopener"
        class="flex-shrink-0 px-3 py-1.5 text-sm font-medium bg-plum-600 text-white rounded hover:bg-plum-700 no-underline transition-colors"
      >
        + Submit Skill
      </a>
```

Also change the header flex container from `justify-between` to just `mb-4` since there's no longer a button on the right:

Replace:
```astro
    <div class="flex items-start justify-between mb-4">
```
With:
```astro
    <div class="mb-4">
```

- [ ] **Step 5: Verify the build**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -10
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Run the full test suite**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(homepage): add category grid and new-this-week strip above browse sections"
```

---

## Task 4: Deploy

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: After CI goes green, verify on staging**

Visit `https://d2x86ifnw0tzpg.cloudfront.net` and confirm:
1. The 5 category cards appear above the Plugins section
2. The submit CTA cell is visible in the 6th grid cell
3. "New this week" strip appears if there are any skills updated in the last 7 days
4. Clicking a skill name in a category card navigates to the skill detail page
5. The "+ Submit Skill" button is no longer in the page header
6. The existing Skills / Agents / Plugins sections still render below

- [ ] **Step 3: Update curated slugs if needed**

After verifying on staging, check the actual slugs in DynamoDB and update `src/lib/categories.mjs` to surface the right skills. The initial slugs in the config are best guesses — some may have been renamed by the dedup script (e.g. `generate-ui` may now be `benefits-delivery-system-generate-ui`).

```bash
curl -s "https://d2x86ifnw0tzpg.cloudfront.net/api/skills?type=skill" \
  -H "Cookie: __session=<your-session-token>" | python3 -m json.tool | grep '"slug"' | sort
```

Update `src/lib/categories.mjs` with correct slugs, then:

```bash
git add src/lib/categories.mjs
git commit -m "fix(homepage): update curated skill slugs to match DynamoDB"
git push origin main
```
