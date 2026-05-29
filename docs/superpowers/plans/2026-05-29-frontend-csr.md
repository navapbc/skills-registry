# Frontend CSR Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all build-time JSON data loading in the Astro frontend with live client-side fetches from `/api/*`, so newly approved skills appear in the browse experience immediately without a CI rebuild.

**Architecture:** Astro pages become static HTML shells with loading spinners. Client-side JavaScript fetches from `/api/skills` and `/api/plugins`, then uses `render.mjs` helper functions to produce the same HTML that Astro components previously generated server-side. The CloudFront edge function's `rewriteUri()` is updated to route all `/skills/*` and `/plugins/*` paths to a single shell page each, enabling any slug — including newly approved ones — to load.

**Tech Stack:** Vanilla JS/ESM, Astro static output, Tailwind CSS (classes used as strings), Vitest, Terraform (CloudFront function update)

---

## File Map

**Create:**
- `src/lib/api.mjs` — `fetchApi(path)` authenticated fetch utility
- `src/lib/render.mjs` — `escapeHtml`, `renderSkillCard`, `renderSkillGrid`, `renderSkillDetail`, `renderPluginDetail`, `renderWhatsNewGroups`
- `src/pages/skills/index.astro` — CSR shell for all skill detail URLs
- `src/pages/plugins/index.astro` — CSR shell for all plugin detail URLs
- `tests/frontend/render.test.mjs` — unit tests for render utilities

**Modify:**
- `src/pages/index.astro` — remove JSON import; add loading shells; fetch + render client-side
- `src/pages/whats-new.astro` — remove JSON import; fetch + render client-side
- `functions/edge/auth-check.js.tpl` — update `rewriteUri()` to route `/skills/*` and `/plugins/*` to shell pages
- `vitest.config.mjs` — add `src/lib/**/*.mjs` to coverage include (already has it; verify)

**Delete:**
- `src/pages/skills/[slug].astro`
- `src/pages/plugins/[slug].astro`

---

## Task 1: API Fetch Utility

**Files:**
- Create: `src/lib/api.mjs`

- [ ] **Step 1: Create `src/lib/api.mjs`**

```js
/**
 * Fetches from the API, forwarding the session cookie automatically
 * (same-origin request — CloudFront routes /api/* to API Gateway).
 *
 * @param {string} path  e.g. '/skills' or '/skills/my-slug'
 * @returns {Promise<any>} parsed JSON
 * @throws {Error} with status code on non-2xx response
 */
export async function fetchApi(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/login?return_to=' + encodeURIComponent(window.location.pathname);
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api.mjs
git commit -m "feat(frontend): add fetchApi utility for authenticated API calls"
```

---

## Task 2: Render Utilities (TDD)

**Files:**
- Create: `src/lib/render.mjs`
- Create: `tests/frontend/render.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend/render.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups } from '../../src/lib/render.mjs';

const baseSkill = {
  slug: 'test-skill',
  name: 'Test Skill',
  description: 'Does something useful',
  plugin: 'my-plugin',
  author: 'author@navapbc.com',
  committer: null,
  type: 'skill',
  sensitive_data: false,
  compatibility: ['claude-code'],
  last_updated: '2026-01-15T00:00:00Z',
  repo: 'navapbc/my-plugin',
  path: 'skills/test-skill/SKILL.md',
  content: '# Test\nThis is the skill content.',
  tools_used: [],
  human_in_loop: null,
};

describe('escapeHtml', () => {
  it('escapes & < > " and single quote', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('returns non-string values as strings', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
});

describe('renderSkillCard', () => {
  it('produces an anchor to the skill detail page', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('href="/skills/test-skill"');
  });

  it('includes the skill name', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('Test Skill');
  });

  it('truncates description to 110 characters', () => {
    const long = { ...baseSkill, description: 'x'.repeat(120) };
    const html = renderSkillCard(long);
    expect(html).toContain('x'.repeat(110) + '...');
  });

  it('shows plugin badge by default', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('my-plugin');
  });

  it('hides plugin badge when showPlugin=false', () => {
    const html = renderSkillCard(baseSkill, false);
    expect(html).not.toContain('bg-plum-50 text-plum-700 rounded');
  });

  it('shows agent badge for agent type', () => {
    const agent = { ...baseSkill, type: 'agent' };
    const html = renderSkillCard(agent);
    expect(html).toContain('agent');
    expect(html).toContain('bg-blue-50');
  });

  it('shows sensitive badge when sensitive_data=true', () => {
    const sensitive = { ...baseSkill, sensitive_data: true };
    const html = renderSkillCard(sensitive);
    expect(html).toContain('⚠');
  });

  it('shows committer avatar when committer has avatar_url', () => {
    const withCommitter = {
      ...baseSkill,
      committer: { login: 'cory', name: 'Cory', avatar_url: 'https://avatars.example.com/cory' },
    };
    const html = renderSkillCard(withCommitter);
    expect(html).toContain('https://avatars.example.com/cory');
    expect(html).toContain('data-github-url="https://github.com/cory"');
  });

  it('escapes XSS in name', () => {
    const xss = { ...baseSkill, name: '<script>alert(1)</script>' };
    const html = renderSkillCard(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSkillDetail', () => {
  it('includes the skill name in an h1', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Test Skill');
  });

  it('includes the skill description', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Does something useful');
  });

  it('includes the SKILL.md content in a pre block', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('This is the skill content.');
    expect(html).toContain('<pre');
  });

  it('shows Install in Claude Code card for claude-code compatible skill', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Install in Claude Code');
    expect(html).toContain(`claude mcp add test-skill --from-github navapbc/my-plugin`);
  });

  it('does not show Claude Code install card when not compatible', () => {
    const noCC = { ...baseSkill, compatibility: ['claude-chat'] };
    const html = renderSkillDetail(noCC);
    expect(html).not.toContain('Install in Claude Code');
  });

  it('includes data-skill-json for localStorage', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('data-skill-json');
    expect(html).toContain('"slug":"test-skill"');
  });

  it('links back to the plugin page', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('href="/plugins/my-plugin"');
  });
});

describe('renderPluginDetail', () => {
  const plugin = {
    slug: 'my-plugin',
    name: 'My Plugin',
    description: 'A plugin for testing',
    repo: 'navapbc/my-plugin',
    author: 'navapbc',
  };
  const skills = [baseSkill];
  const agents = [];

  it('includes the plugin name', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('My Plugin');
  });

  it('includes a skill card for each skill', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('href="/skills/test-skill"');
  });

  it('shows skills count in tab', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('Skills (1)');
  });
});

describe('renderWhatsNewGroups', () => {
  const recentSkill = {
    ...baseSkill,
    slug: 'recent',
    name: 'Recent Skill',
    last_updated: new Date().toISOString(),
  };

  it('renders a skill in the this-week group', () => {
    const html = renderWhatsNewGroups([recentSkill]);
    expect(html).toContain('This week');
    expect(html).toContain('Recent Skill');
  });

  it('renders empty state when no skills', () => {
    const html = renderWhatsNewGroups([]);
    expect(html).toContain('No skills');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test tests/frontend/render.test.mjs
```

Expected: FAIL — `Cannot find module '../../src/lib/render.mjs'`

- [ ] **Step 3: Create `src/lib/render.mjs`**

```js
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function avatarHtml(committer, author, size = '5') {
  const displayName = committer?.login || committer?.name || author;
  const avatarUrl = committer?.avatar_url || null;
  const initial = (displayName || '?').slice(0, 1).toUpperCase();
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="w-${size} h-${size} rounded-full flex-shrink-0" />`;
  }
  return `<span class="w-${size} h-${size} rounded-full bg-plum-100 text-plum-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">${escapeHtml(initial)}</span>`;
}

export function renderSkillCard(skill, showPlugin = true) {
  const committer = skill.committer;
  const displayName = committer?.login || committer?.name || skill.author;
  const githubUrl = committer?.login ? `https://github.com/${committer.login}` : null;
  const preview = skill.description.length > 110
    ? skill.description.slice(0, 110) + '...'
    : skill.description;
  const compatStr = skill.compatibility.slice(0, 2).join(', ') +
    (skill.compatibility.length > 2 ? ` +${skill.compatibility.length - 2}` : '');

  const pluginBadge = showPlugin
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-plum-50 text-plum-700 rounded">${escapeHtml(skill.plugin)}</span>`
    : '';
  const agentBadge = skill.type === 'agent'
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">agent</span>`
    : '';
  const sensitiveBadge = skill.sensitive_data
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded" title="Contains sensitive data">⚠</span>`
    : '';

  return `<a
    href="/skills/${escapeHtml(skill.slug)}"
    class="flex flex-col gap-3 p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-gray-300 transition-all no-underline text-gray-900"
    data-name="${escapeHtml(skill.name)}"
    data-description="${escapeHtml(skill.description)}"
    data-plugin="${escapeHtml(skill.plugin)}"
    data-compatibility="${escapeHtml(skill.compatibility.join(','))}"
    data-sensitive="${skill.sensitive_data}"
    data-type="${escapeHtml(skill.type)}"
    data-updated="${escapeHtml(skill.last_updated || '')}"
  >
    <div class="flex items-start justify-between gap-2 flex-wrap">
      <span class="font-semibold text-sm text-gray-900">${escapeHtml(skill.name)}</span>
      <div class="flex items-center gap-1 flex-wrap">${pluginBadge}${agentBadge}${sensitiveBadge}</div>
    </div>
    <p class="text-xs text-gray-500 leading-relaxed m-0 flex-1">${escapeHtml(preview)}</p>
    <div class="flex items-center justify-between mt-auto pt-1">
      <span class="flex items-center gap-1.5 cursor-pointer"
        data-github-url="${escapeHtml(githubUrl || '')}"
        title="${escapeHtml(githubUrl ? '@' + displayName : displayName)}">
        ${avatarHtml(committer, skill.author, '5')}
        <span class="text-xs text-gray-400">${escapeHtml(displayName)}</span>
      </span>
      <span class="text-xs text-gray-400 truncate ml-2">${escapeHtml(compatStr)}</span>
    </div>
  </a>`;
}

export function renderSkillGrid(skills, showPlugin = true) {
  if (!skills.length) return '<p class="text-sm text-gray-400 italic">No skills found.</p>';
  return `<div class="grid grid-cols-3 gap-3">
    ${skills.map(s => `<div>${renderSkillCard(s, showPlugin)}</div>`).join('')}
  </div>`;
}

export function renderSkillDetail(skill) {
  const hasClaudeCode = skill.compatibility.includes('claude-code');
  const hasClaudeChat = skill.compatibility.includes('claude-chat') || skill.compatibility.includes('claude-cowork');
  const claudeCodeCommand = `claude mcp add ${skill.slug} --from-github ${skill.repo}`;
  const committer = skill.committer;
  const displayName = committer?.login || committer?.name || skill.author;
  const githubUrl = committer?.login ? `https://github.com/${committer.login}` : null;
  const initial = (displayName || '?').slice(0, 1).toUpperCase();
  const addedDate = formatDate(skill.last_updated);

  const compatBadges = skill.compatibility.map(c =>
    `<span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">${escapeHtml(c)}</span>`
  ).join('');

  const claudeCodeCard = hasClaudeCode ? `
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-1">Install in Claude Code</h3>
      <p class="text-xs text-gray-500 mb-3 m-0">Run this command in your terminal</p>
      <div class="bg-gray-50 border border-gray-200 rounded p-2 flex items-start justify-between gap-2">
        <code class="text-xs text-gray-700 break-all leading-relaxed">${escapeHtml(claudeCodeCommand)}</code>
        <button
          class="flex-shrink-0 px-2 py-1 text-xs font-medium bg-white border border-gray-200 rounded hover:bg-gray-50 cursor-pointer transition-colors"
          data-copy="${escapeHtml(claudeCodeCommand)}"
          aria-label="Copy install command">Copy</button>
      </div>
    </div>` : '';

  const claudeChatCard = hasClaudeChat ? `
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-1">Install in Claude Chat / Cowork</h3>
      <p class="text-xs text-gray-500 mb-0 m-0">Open Claude, then go to <strong class="text-gray-700">Customize → Skills</strong> in the sidebar and add this skill from there.</p>
    </div>` : '';

  const committerCard = `
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Last Committer</h3>
      <div class="flex items-center gap-3">
        ${avatarHtml(committer, skill.author, '8')}
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 m-0">${escapeHtml(committer?.name || displayName)}</p>
          ${githubUrl ? `<a href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener" class="text-xs text-plum-600 hover:text-plum-700 no-underline">@${escapeHtml(committer.login)}</a>` : ''}
        </div>
      </div>
    </div>`;

  const toolsUsed = skill.tools_used?.length ? `
    <section>
      <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Composed Skills</h2>
      <ul class="list-none p-0 m-0 space-y-1">
        ${skill.tools_used.map(slug => `<li class="text-sm"><a href="/skills/${escapeHtml(slug)}" class="text-plum-600 hover:text-plum-700 no-underline">${escapeHtml(slug)}</a></li>`).join('')}
      </ul>
      ${skill.human_in_loop ? `<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800"><strong>Human in the loop:</strong> ${escapeHtml(skill.human_in_loop)}</div>` : ''}
    </section>` : '';

  return `
    <a href="/plugins/${escapeHtml(skill.plugin)}" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">← Back to ${escapeHtml(skill.plugin)}</a>

    <div class="mb-8">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <h1 class="text-2xl font-bold text-gray-900 m-0">${escapeHtml(skill.name)}</h1>
        <span class="px-2 py-0.5 text-xs font-medium bg-plum-50 text-plum-700 rounded">${escapeHtml(skill.plugin)}</span>
        ${skill.sensitive_data ? '<span class="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded">⚠ sensitive data</span>' : ''}
        ${skill.type === 'agent' ? '<span class="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">agent</span>' : ''}
      </div>
      <div class="flex items-center gap-2 text-sm text-gray-400">
        ${avatarHtml(committer, skill.author, '6')}
        ${addedDate ? `<span class="text-gray-300">·</span><span>Added ${escapeHtml(addedDate)}</span>` : ''}
        <span class="text-gray-300">·</span>
        <a href="https://github.com/${escapeHtml(skill.repo)}/blob/main/${escapeHtml(skill.path)}" target="_blank" rel="noopener" class="text-plum-600 hover:text-plum-700 no-underline">View on GitHub ↗</a>
      </div>
    </div>

    <div hidden data-skill-json='${JSON.stringify({ slug: skill.slug, name: skill.name, plugin: skill.plugin, description: skill.description, compatibility: skill.compatibility, type: skill.type })}'></div>

    <div class="flex gap-8 items-start">
      <div class="flex-1 min-w-0 space-y-8">
        <section>
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Description</h2>
          <p class="text-sm text-gray-600 leading-relaxed m-0">${escapeHtml(skill.description)}</p>
          ${skill.compatibility.length ? `<div class="flex items-center gap-2 flex-wrap mt-3"><span class="text-xs text-gray-400">Works with:</span>${compatBadges}</div>` : ''}
        </section>
        ${toolsUsed}
        <section>
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">SKILL.md</h2>
          <pre class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap leading-relaxed m-0"><code>${escapeHtml(skill.content || '')}</code></pre>
        </section>
      </div>
      <aside class="w-64 flex-shrink-0 space-y-4">
        ${claudeCodeCard}
        ${claudeChatCard}
        ${committerCard}
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-gray-900 mb-3">Details</h3>
          <dl class="space-y-2 m-0">
            ${addedDate ? `<div class="flex justify-between gap-2"><dt class="text-xs text-gray-400">Added</dt><dd class="text-xs text-gray-700 m-0">${escapeHtml(addedDate)}</dd></div>` : ''}
            <div class="flex justify-between gap-2">
              <dt class="text-xs text-gray-400">Repo</dt>
              <dd class="text-xs m-0"><a href="https://github.com/${escapeHtml(skill.repo)}" target="_blank" rel="noopener" class="text-plum-600 hover:text-plum-700 no-underline truncate block max-w-32" title="${escapeHtml(skill.repo)}">${escapeHtml(skill.repo)}</a></dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>`;
}

export function renderPluginDetail(plugin, skills, agents) {
  const initial = (plugin.author || '?').slice(0, 1).toUpperCase();

  const skillsTab = skills.length
    ? renderSkillGrid(skills, false)
    : '<p class="text-sm text-gray-400 italic">No skills in this plugin.</p>';

  const agentsTab = agents.length
    ? renderSkillGrid(agents, false)
    : '<p class="text-sm text-gray-400 italic">No agents in this plugin.</p>';

  const agentsTabBtn = agents.length
    ? `<button class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent -mb-px bg-transparent cursor-pointer hover:text-gray-700" data-tab="agents">Agents (${agents.length})</button>`
    : '';

  const agentsPanel = `<div id="tab-agents" class="${agents.length ? 'hidden' : 'hidden'}">
    <p class="text-sm text-gray-500 mb-4">Agents (${agents.length})</p>
    ${agentsTab}
  </div>`;

  return `
    <a href="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">← Back to Marketplace</a>

    <div class="flex items-start justify-between gap-4 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold text-gray-900 m-0">${escapeHtml(plugin.name)}</h1>
        ${plugin.description ? `<p class="text-sm text-gray-500 mt-1 m-0">${escapeHtml(plugin.description)}</p>` : ''}
        <a href="https://github.com/${escapeHtml(plugin.repo)}" target="_blank" rel="noopener" class="inline-block mt-1 text-xs text-plum-600 hover:text-plum-700 no-underline">/${escapeHtml(plugin.name)} ↗</a>
      </div>
      <span class="w-9 h-9 rounded-full bg-plum-100 text-plum-700 text-sm font-semibold flex items-center justify-center flex-shrink-0" aria-label="${escapeHtml(plugin.author)}">${escapeHtml(initial)}</span>
    </div>

    <div class="flex items-center gap-0 border-b border-gray-200 mb-6">
      <button class="px-4 py-2 text-sm font-medium text-plum-700 border-b-2 border-plum-600 -mb-px bg-transparent cursor-pointer" data-tab="skills">Skills (${skills.length})</button>
      ${agentsTabBtn}
      <button class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent -mb-px bg-transparent cursor-pointer hover:text-gray-700" data-tab="history">History</button>
    </div>

    <div id="tab-skills">
      <p class="text-sm text-gray-500 mb-4">Skills (${skills.length})</p>
      ${skillsTab}
    </div>
    ${agentsPanel}
    <div id="tab-history" class="hidden">
      <p class="text-sm text-gray-400 italic">Skill history will appear here once the registry tracks version changes.</p>
    </div>`;
}

export function renderWhatsNewGroups(skills) {
  if (!skills.length) {
    return `<div class="flex flex-col items-center justify-center py-20 text-center">
      <span class="text-3xl text-plum-300 mb-4">★</span>
      <p class="font-semibold text-gray-800 m-0">No skills in the registry yet</p>
      <p class="text-sm text-gray-500 mt-2 m-0">Check back soon.</p>
    </div>`;
  }

  const sorted = [...skills].sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));
  const now = new Date();
  const oneWeekAgo = new Date(now); oneWeekAgo.setDate(now.getDate() - 7);
  const oneMonthAgo = new Date(now); oneMonthAgo.setDate(now.getDate() - 30);

  const thisWeek = sorted.filter(s => new Date(s.last_updated) >= oneWeekAgo);
  const thisMonth = sorted.filter(s => { const d = new Date(s.last_updated); return d < oneWeekAgo && d >= oneMonthAgo; });
  const earlier = sorted.filter(s => new Date(s.last_updated) < oneMonthAgo);

  function skillRow(skill) {
    const initial = (skill.author || '?').slice(0, 1).toUpperCase();
    const typeLabel = skill.type === 'agent'
      ? '<span class="px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">agent</span>'
      : '<span class="px-1.5 py-0.5 text-xs font-medium bg-plum-50 text-plum-700 rounded">skill</span>';
    const sensitiveLabel = skill.sensitive_data
      ? '<span class="px-1.5 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded">⚠ sensitive</span>'
      : '';
    return `<a href="/skills/${escapeHtml(skill.slug)}" class="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:shadow-sm hover:border-gray-300 transition-all no-underline">
      <span class="w-8 h-8 rounded-full bg-plum-100 text-plum-700 text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">${escapeHtml(initial)}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          <span class="font-semibold text-sm text-gray-900">${escapeHtml(skill.name)}</span>
          ${typeLabel}${sensitiveLabel}
        </div>
        <p class="text-xs text-gray-500 m-0 leading-relaxed">${escapeHtml(skill.description)}</p>
        <p class="text-xs text-gray-400 mt-1.5 m-0">${escapeHtml(skill.plugin)} · Added ${escapeHtml(formatDateShort(skill.last_updated))}</p>
      </div>
    </a>`;
  }

  function group(label, items) {
    if (!items.length) return '';
    return `<section class="mb-8">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">${escapeHtml(label)}</span>
        <div class="flex-1 border-t border-gray-200"></div>
      </div>
      <div class="space-y-2">${items.map(skillRow).join('')}</div>
    </section>`;
  }

  return group('This week', thisWeek) + group('This month', thisMonth) + group('Earlier', earlier);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test tests/frontend/render.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render.mjs tests/frontend/render.test.mjs
git commit -m "feat(frontend): add render utilities for CSR card and detail views"
```

---

## Task 3: Skill Detail Shell

**Files:**
- Delete: `src/pages/skills/[slug].astro`
- Create: `src/pages/skills/index.astro`

- [ ] **Step 1: Delete the old static page**

```bash
rm "/Users/cory/Documents/GitHub/skills-registry/src/pages/skills/[slug].astro"
```

- [ ] **Step 2: Create `src/pages/skills/index.astro`**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Skill">
  <div id="skill-content">
    <div class="flex items-center justify-center py-20">
      <span class="text-sm text-gray-400">Loading skill...</span>
    </div>
  </div>
</Base>

<script>
import { fetchApi } from '../../lib/api.mjs';
import { renderSkillDetail } from '../../lib/render.mjs';

const STORAGE_KEY = 'nava_installed_skills';
const container = document.getElementById('skill-content');

// Extract slug from /skills/<slug>
const slug = window.location.pathname.replace(/^\/skills\//, '').replace(/\/$/, '');

if (!slug) {
  container.innerHTML = '<p class="text-sm text-gray-400">No skill specified.</p>';
} else {
  fetchApi('/skills/' + slug)
    .then(skill => {
      container.innerHTML = renderSkillDetail(skill);
      document.title = skill.name + ' · Skills Hub';
      initCopyButtons(skill);
      initGithubLinks();
    })
    .catch(err => {
      if (err.message.startsWith('API 404')) {
        container.innerHTML = '<p class="text-sm text-gray-500">Skill not found. <a href="/" class="text-plum-600 hover:text-plum-700">Back to marketplace</a></p>';
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

- [ ] **Step 3: Verify the build still works**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -20
```

Expected: build succeeds. `dist/skills/index.html` exists. No `dist/skills/nava-labs-style/` directories (old static pages are gone).

```bash
ls dist/skills/
```

Expected: `index.html` only (no subdirectories).

- [ ] **Step 4: Commit**

```bash
git rm "src/pages/skills/[slug].astro"
git add src/pages/skills/index.astro
git commit -m "feat(frontend): replace static skill detail pages with CSR shell"
```

---

## Task 4: Plugin Detail Shell

**Files:**
- Delete: `src/pages/plugins/[slug].astro`
- Create: `src/pages/plugins/index.astro`

- [ ] **Step 1: Delete the old static page**

```bash
rm "/Users/cory/Documents/GitHub/skills-registry/src/pages/plugins/[slug].astro"
```

- [ ] **Step 2: Create `src/pages/plugins/index.astro`**

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Plugin">
  <div id="plugin-content">
    <div class="flex items-center justify-center py-20">
      <span class="text-sm text-gray-400">Loading plugin...</span>
    </div>
  </div>
</Base>

<script>
import { fetchApi } from '../../lib/api.mjs';
import { renderPluginDetail } from '../../lib/render.mjs';

const container = document.getElementById('plugin-content');
const slug = window.location.pathname.replace(/^\/plugins\//, '').replace(/\/$/, '');

if (!slug) {
  container.innerHTML = '<p class="text-sm text-gray-400">No plugin specified.</p>';
} else {
  Promise.all([
    fetchApi('/plugins/' + slug),
    fetchApi('/skills?plugin=' + slug),
  ])
    .then(([plugin, { skills }]) => {
      const skillItems = skills.filter(s => s.type === 'skill');
      const agentItems = skills.filter(s => s.type === 'agent');
      container.innerHTML = renderPluginDetail(plugin, skillItems, agentItems);
      document.title = plugin.name + ' · Skills Hub';
      initTabs();
      initGithubLinks();
    })
    .catch(err => {
      if (err.message.startsWith('API 404')) {
        container.innerHTML = '<p class="text-sm text-gray-500">Plugin not found. <a href="/" class="text-plum-600 hover:text-plum-700">Back to marketplace</a></p>';
      } else if (!err.message.startsWith('Unauthorized')) {
        container.innerHTML = '<p class="text-sm text-red-500">Failed to load plugin. Please try again.</p>';
      }
    });
}

function initTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  const activeClass = ['text-plum-700', 'border-plum-600'];
  const inactiveClass = ['text-gray-500', 'border-transparent'];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => { t.classList.remove(...activeClass); t.classList.add(...inactiveClass); });
      tab.classList.add(...activeClass);
      tab.classList.remove(...inactiveClass);
      ['skills', 'agents', 'history'].forEach(name => {
        const panel = document.getElementById('tab-' + name);
        if (panel) panel.classList.toggle('hidden', name !== target);
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

- [ ] **Step 3: Verify build**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -20
```

Expected: build succeeds. `dist/plugins/index.html` exists with no subdirectories.

```bash
ls dist/plugins/
```

Expected: `index.html` only.

- [ ] **Step 4: Commit**

```bash
git rm "src/pages/plugins/[slug].astro"
git add src/pages/plugins/index.astro
git commit -m "feat(frontend): replace static plugin detail pages with CSR shell"
```

---

## Task 5: Homepage CSR

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace `src/pages/index.astro`** with the full CSR version

Read the current file first to confirm the structure, then write:

```astro
---
import Base from '../layouts/Base.astro';
import Tooltip from '../components/Tooltip.astro';
---

<Base title="Skills Marketplace">

  <!-- Search hero -->
  <div class="mb-10">
    <div class="flex items-start justify-between mb-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 m-0">Skills Marketplace</h1>
        <p class="text-sm text-gray-500 mt-1 m-0">Browse, install, and share reusable AI skills across Nava</p>
      </div>
      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview"
        target="_blank"
        rel="noopener"
        class="flex-shrink-0 px-3 py-1.5 text-sm font-medium bg-plum-600 text-white rounded hover:bg-plum-700 no-underline transition-colors"
      >
        + Submit Skill
      </a>
    </div>
    <div class="relative">
      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
      <input
        type="search"
        id="global-search"
        placeholder="Search skills, agents, and plugins..."
        autocomplete="off"
        class="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-plum-300 focus:border-plum-400 placeholder:text-gray-400"
      />
    </div>
  </div>

  <!-- Browse view -->
  <div id="browse-view">

    <!-- Plugins -->
    <section class="mb-10">
      <div class="flex items-center gap-1.5 mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">Plugins</h2>
        <span class="text-xs text-gray-400" id="plugins-count"></span>
        <Tooltip text="A Plugin is a GitHub repo that contains Skills and Agents — the organizational unit, like a package." />
      </div>
      <div class="flex flex-wrap gap-2" id="plugins-list">
        <span class="text-xs text-gray-400">Loading...</span>
      </div>
    </section>

    <!-- Skills -->
    <section class="mb-10">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5">
          <h2 class="text-base font-semibold text-gray-700 m-0">Skills</h2>
          <span class="text-xs text-gray-400" id="skills-count"></span>
          <Tooltip text='A Skill is a reusable prompt workflow (SKILL.md) that guides an AI through a specific task.' width="w-64" />
        </div>
        <button id="skills-expand" class="text-xs text-plum-600 hover:text-plum-700 cursor-pointer bg-transparent border-none hidden">
          View all →
        </button>
      </div>
      <div id="skills-grid">
        <span class="text-xs text-gray-400">Loading...</span>
      </div>
    </section>

    <!-- Agents -->
    <section class="mb-10" id="agents-section" style="display:none">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5">
          <h2 class="text-base font-semibold text-gray-700 m-0">Agents</h2>
          <span class="text-xs text-gray-400" id="agents-count"></span>
          <Tooltip text="An Agent is a project-level AI config file that sets baseline behavior across a whole project." width="w-64" />
        </div>
        <button id="agents-expand" class="text-xs text-plum-600 hover:text-plum-700 cursor-pointer bg-transparent border-none hidden">
          View all →
        </button>
      </div>
      <div id="agents-grid"></div>
    </section>

    <!-- MCP Servers placeholder -->
    <section class="mb-10">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">MCP Servers</h2>
        <span class="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-600 rounded-full border border-amber-200">Coming soon</span>
        <Tooltip text="Model Context Protocol servers expose tools, resources, and prompts to AI assistants. Registry support for MCP servers is coming soon." width="w-64" />
      </div>
      <div class="p-6 bg-white border border-gray-200 border-dashed rounded-lg text-center">
        <p class="text-sm text-gray-400 m-0">MCP server discovery will appear here once registry support is added.</p>
        <a href="/contribute" class="inline-block mt-3 text-xs text-plum-600 hover:text-plum-700 no-underline">Learn how to contribute →</a>
      </div>
    </section>

  </div>

  <!-- Search results -->
  <div id="search-results" class="hidden">
    <p class="text-xs text-gray-400 mb-4" id="search-summary"></p>
    <div id="results-list" class="space-y-1"></div>
    <p class="text-sm text-gray-400 italic hidden" id="no-results">No results found.</p>
  </div>

</Base>

<script>
import { fetchApi } from '../lib/api.mjs';
import { renderSkillCard, escapeHtml } from '../lib/render.mjs';

const PREVIEW_COUNT = 6;

const globalSearch = document.getElementById('global-search');
const browseView = document.getElementById('browse-view');
const searchResults = document.getElementById('search-results');
const resultsList = document.getElementById('results-list');
const searchSummary = document.getElementById('search-summary');
const noResults = document.getElementById('no-results');

const TYPE_STYLES = {
  plugin: 'bg-plum-50 text-plum-700',
  skill:  'bg-gray-100 text-gray-600',
  agent:  'bg-blue-50 text-blue-700',
};

let searchIndex = [];

// Load data
Promise.all([
  fetchApi('/skills'),
  fetchApi('/plugins'),
]).then(([{ skills }, { plugins }]) => {
  const allSkills = skills.filter(s => s.type === 'skill');
  const allAgents = skills.filter(s => s.type === 'agent');

  // Plugins
  document.getElementById('plugins-count').textContent = `(${plugins.length})`;
  document.getElementById('plugins-list').innerHTML = plugins.map(p => {
    const total = (p.skills_count || 0);
    return `<a href="/plugins/${escapeHtml(p.slug)}" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-plum-300 hover:shadow-sm no-underline transition-all group">
      <span class="text-sm font-medium text-gray-800 group-hover:text-plum-700 transition-colors">${escapeHtml(p.name)}</span>
      <span class="text-xs text-gray-400 whitespace-nowrap">${total} ${total === 1 ? 'skill' : 'skills'}</span>
    </a>`;
  }).join('');

  // Skills grid
  document.getElementById('skills-count').textContent = `(${allSkills.length})`;
  renderGrid('skills-grid', 'skills-expand', allSkills, '[data-skill-item]');

  // Agents grid
  if (allAgents.length) {
    document.getElementById('agents-section').style.display = '';
    document.getElementById('agents-count').textContent = `(${allAgents.length})`;
    renderGrid('agents-grid', 'agents-expand', allAgents, '[data-agent-item]');
  }

  // Build search index
  searchIndex = [
    ...plugins.map(p => ({
      type: 'plugin',
      name: p.name,
      description: p.description || '',
      url: `/plugins/${p.slug}`,
      meta: `${p.skills_count || 0} skills`,
      keywords: '',
    })),
    ...allSkills.map(s => ({
      type: 'skill',
      name: s.name,
      description: s.description || '',
      url: `/skills/${s.slug}`,
      meta: s.plugin,
      keywords: [s.plugin, ...(s.compatibility || [])].join(' '),
    })),
    ...allAgents.map(s => ({
      type: 'agent',
      name: s.name,
      description: s.description || '',
      url: `/skills/${s.slug}`,
      meta: s.plugin,
      keywords: [s.plugin, ...(s.compatibility || [])].join(' '),
    })),
  ];

  initGithubLinks();
}).catch(err => {
  if (!err.message.startsWith('Unauthorized')) {
    document.getElementById('skills-grid').innerHTML = '<p class="text-sm text-red-500">Failed to load skills. Please try again.</p>';
  }
});

function renderGrid(gridId, expandBtnId, items, itemAttr) {
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

function initGithubLinks() {
  document.querySelectorAll('[data-github-url]').forEach(el => {
    el.addEventListener('click', e => {
      const url = el.dataset.githubUrl;
      if (url) { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); }
    });
  });
}

// Search
function renderResults(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    browseView.classList.remove('hidden');
    searchResults.classList.add('hidden');
    return;
  }
  browseView.classList.add('hidden');
  searchResults.classList.remove('hidden');

  const matches = searchIndex.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.meta.toLowerCase().includes(q) ||
    item.keywords.toLowerCase().includes(q)
  );

  searchSummary.textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''} for "${query}"`;
  noResults.classList.toggle('hidden', matches.length > 0);

  resultsList.innerHTML = matches.map(item => `
    <a href="${escapeHtml(item.url)}" class="flex items-start gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg hover:border-plum-300 hover:shadow-sm no-underline transition-all group">
      <span class="mt-0.5 px-1.5 py-0.5 text-xs font-medium rounded flex-shrink-0 ${TYPE_STYLES[item.type] || 'bg-gray-100 text-gray-600'}">${escapeHtml(item.type)}</span>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-900 m-0 group-hover:text-plum-700 transition-colors">${escapeHtml(item.name)}</p>
        ${item.description ? `<p class="text-xs text-gray-500 m-0 mt-0.5 truncate">${escapeHtml(item.description)}</p>` : ''}
      </div>
      <span class="ml-auto text-xs text-gray-400 flex-shrink-0 mt-0.5">${escapeHtml(item.meta)}</span>
    </a>
  `).join('');
}

globalSearch?.addEventListener('input', e => renderResults(e.target.value));
</script>
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(frontend): convert homepage to CSR — fetch skills/plugins from API"
```

---

## Task 6: What's New CSR

**Files:**
- Modify: `src/pages/whats-new.astro`

- [ ] **Step 1: Replace `src/pages/whats-new.astro`**

```astro
---
import Base from '../layouts/Base.astro';
---

<Base title="What's New">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-gray-900 m-0">What's New</h1>
    <p class="text-sm text-gray-500 mt-1 m-0">Recently added and updated skills</p>
  </div>

  <div id="whats-new-content">
    <div class="flex items-center justify-center py-20">
      <span class="text-sm text-gray-400">Loading...</span>
    </div>
  </div>
</Base>

<script>
import { fetchApi } from '../lib/api.mjs';
import { renderWhatsNewGroups } from '../lib/render.mjs';

const container = document.getElementById('whats-new-content');

fetchApi('/skills')
  .then(({ skills }) => {
    container.innerHTML = renderWhatsNewGroups(skills);
  })
  .catch(err => {
    if (!err.message.startsWith('Unauthorized')) {
      container.innerHTML = '<p class="text-sm text-red-500">Failed to load. Please try again.</p>';
    }
  });
</script>
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test
```

Expected: all tests PASS (including the new render tests).

- [ ] **Step 3: Commit**

```bash
git add src/pages/whats-new.astro
git commit -m "feat(frontend): convert What's New to CSR"
```

---

## Task 7: CloudFront Edge Function Update

**Files:**
- Modify: `functions/edge/auth-check.js.tpl`

- [ ] **Step 1: Update `rewriteUri` in `functions/edge/auth-check.js.tpl`**

Find the existing `rewriteUri` function (lines 21-26) and replace it:

```js
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;

  // Route all /skills/* and /plugins/* to their CSR shells
  if (uri.indexOf('/skills') === 0) return '/skills/index.html';
  if (uri.indexOf('/plugins') === 0) return '/plugins/index.html';

  return uri + '/index.html';
}
```

- [ ] **Step 2: Commit the edge function change**

```bash
git add functions/edge/auth-check.js.tpl
git commit -m "feat(infra): update CloudFront rewriteUri to route skill/plugin paths to CSR shells"
```

- [ ] **Step 3: Run terraform apply for staging**

```bash
cd /Users/cory/Documents/GitHub/skills-registry/terraform
terraform apply -var-file=terraform.staging.tfvars
```

Expected: `aws_cloudfront_function.auth_check` will update in-place. All other resources unchanged (`0 to add, 1 to change, 0 to destroy`).

- [ ] **Step 4: Run terraform apply for prod (after staging is verified)**

```bash
terraform apply -var-file=terraform.prod.tfvars
```

---

## Task 8: Build Verification + Deploy

- [ ] **Step 1: Final build check**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm build
```

Expected: successful build. Check the dist structure:

```bash
ls dist/skills/    # should contain index.html only
ls dist/plugins/   # should contain index.html only
ls dist/           # should contain index.html, whats-new/, my-skills/, etc.
```

- [ ] **Step 2: Push to main**

```bash
git push origin main
```

Watch GitHub Actions — the deploy job should complete with:
- Static site synced to S3
- API Lambda deployed
- CloudFront invalidated

- [ ] **Step 3: Smoke test the live site**

After CI is green, verify in a browser logged into staging:

1. **Homepage** loads skill cards from the API (not empty)
2. **A skill detail page** (e.g. `https://d2x86ifnw0tzpg.cloudfront.net/skills/nava-labs-style`) loads the skill data
3. **A plugin detail page** loads and shows skills
4. **What's New** shows grouped skills
5. **Search** finds skills by name

- [ ] **Step 4: Test the "new skill" scenario**

Pick any skill slug that was NOT in the registry before (or use a fake one). Visit:
```
https://d2x86ifnw0tzpg.cloudfront.net/skills/a-brand-new-slug
```

Expected: page loads the shell, then shows "Skill not found" message (not a CloudFront 404 error page). This confirms the CloudFront routing change is working — the shell page loaded even for an unknown slug.

- [ ] **Step 5: Final test run**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test
```

Expected: all tests PASS.
