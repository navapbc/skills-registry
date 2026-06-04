import { SUBMIT_FORM_URL } from './categories.mjs';

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

function avatarHtml(displayName, avatarUrl, size = '5') {
  const initial = (displayName || '?').slice(0, 1).toUpperCase();
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="w-${size} h-${size} rounded-full flex-shrink-0" />`;
  }
  return `<span class="w-${size} h-${size} rounded-full bg-plum-100 text-plum-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">${escapeHtml(initial)}</span>`;
}

// A frontmatter-provided submitter identity (author_name + email, e.g. from the
// Google Form via Zapier) takes precedence over the GitHub committer name/login.
function authorDisplayName(skill) {
  return skill.author_name || skill.committer?.login || skill.committer?.name || skill.author;
}

// The email to attribute a submission to, when the file carries a frontmatter identity.
function submitterEmail(skill) {
  return skill.author && skill.author.includes('@') ? skill.author : null;
}

export function renderSkillCard(skill, showPlugin = true) {
  const committer = skill.committer;
  const displayName = authorDisplayName(skill);
  // Frontmatter identity has no GitHub profile — only link out for committer-sourced attribution.
  const githubUrl = (!skill.author_name && committer?.login) ? `https://github.com/${committer.login}` : null;
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
  const anthropicBadge = skill.source === 'anthropic-builtin'
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 rounded">Anthropic Tool</span>`
    : '';
  const orgWideBadge = skill.source === 'enterprise'
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 rounded">Org-wide</span>`
    : '';
  const tags = skill.tags?.length
    ? `<div class="flex flex-wrap gap-1" data-tags>
      ${skill.tags.slice(0, 3).map(t => `<span class="px-1 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">#${escapeHtml(t)}</span>`).join('')}
    </div>`
    : '';

  const skillData = escapeHtml(JSON.stringify({ slug: skill.slug, name: skill.name, plugin: skill.plugin, type: skill.type, description: skill.description, compatibility: skill.compatibility }));

  const detailHref = skill.type === 'agent' ? `/agents/${escapeHtml(skill.slug)}` : `/skills/${escapeHtml(skill.slug)}`;

  return `<div class="relative h-full">
    <button
      class="fav-btn absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-amber-400 transition-colors rounded"
      data-slug="${escapeHtml(skill.slug)}"
      data-skill="${skillData}"
      aria-label="Add to favorites"
      aria-pressed="false"
      title="Favorite"
    ><span aria-hidden="true" class="fav-star text-base leading-none">☆</span></button>
  <a
    href="${detailHref}"
    class="h-full flex flex-col gap-3 p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-gray-300 transition-all no-underline text-gray-900"
    data-name="${escapeHtml(skill.name)}"
    data-description="${escapeHtml(skill.description)}"
    data-plugin="${escapeHtml(skill.plugin)}"
    data-compatibility="${escapeHtml(skill.compatibility.join(','))}"
    data-sensitive="${skill.sensitive_data}"
    data-type="${escapeHtml(skill.type)}"
    data-updated="${escapeHtml(skill.last_updated || '')}"
  >
    <div class="flex items-start justify-between gap-2 flex-wrap pr-5">
      <span class="font-semibold text-sm text-gray-900">${escapeHtml(skill.name)}</span>
      <div class="flex items-center gap-1 flex-wrap">${pluginBadge}${agentBadge}${sensitiveBadge}${anthropicBadge}${orgWideBadge}</div>
    </div>
    <p class="text-xs text-gray-500 leading-relaxed m-0 flex-1">${escapeHtml(preview)}</p>
    ${tags}
    <div class="flex items-center justify-between mt-auto pt-1">
      <span class="flex items-center gap-1.5 cursor-pointer"
        data-github-url="${escapeHtml(githubUrl || '')}"
        title="${escapeHtml(githubUrl ? '@' + displayName : displayName)}">
        ${avatarHtml(displayName, committer?.avatar_url, '5')}
        <span class="text-xs text-gray-400">${escapeHtml(displayName)}</span>
      </span>
      <span class="text-xs text-gray-400 truncate ml-2">${escapeHtml(compatStr)}</span>
    </div>
  </a></div>`;
}

export function renderSkillGrid(skills, showPlugin = true) {
  if (!skills.length) return '<p class="text-sm text-gray-400 italic">No skills found.</p>';
  return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    ${skills.map(s => `<div class="h-full">${renderSkillCard(s, showPlugin)}</div>`).join('')}
  </div>`;
}

export function renderFavoriteButton(slug, isFav = false) {
  return `<button
    class="favorite-btn inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${isFav ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'}"
    data-slug="${escapeHtml(slug)}"
    aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
    aria-pressed="${isFav}"
  >
    <span aria-hidden="true">${isFav ? '★' : '☆'}</span>
    ${isFav ? 'Favorited' : 'Favorite'}
  </button>`;
}

function renderNavaMetaSection(skill) {
  const hasAny = skill.team || skill.problem || (Array.isArray(skill.impact_type) && skill.impact_type.length > 0)
    || skill.estimated_impact || skill.usage_frequency
    || skill.expected_audience || skill.data_sources;
  if (!hasAny) return '';

  const row = (label, value) => value
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">${label}</dt>
        <dd class="text-xs text-gray-700 m-0">${escapeHtml(value)}</dd>
      </div>`
    : '';

  const impactChips = Array.isArray(skill.impact_type) && skill.impact_type.length
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">Impact type</dt>
        <dd class="flex flex-wrap gap-1 m-0">
          ${skill.impact_type.map(t => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">${escapeHtml(t)}</span>`).join('')}
        </dd>
      </div>`
    : '';

  return `
    <div class="bg-white border border-gray-200 rounded-lg p-4" data-testid="nava-detail-section">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Submission Details</h3>
      <dl class="space-y-2 m-0">
        ${row('Team', skill.team)}
        ${row('Problem solved', skill.problem)}
        ${impactChips}
        ${row('Estimated impact', skill.estimated_impact)}
        ${row('Usage frequency', skill.usage_frequency)}
        ${row('Expected audience', skill.expected_audience)}
        ${row('Data sources', skill.data_sources)}
      </dl>
    </div>`;
}

export function renderSkillDetail(skill) {
  const hasClaudeCode = skill.compatibility.includes('claude-code');
  const hasClaudeChat = skill.compatibility.includes('claude-chat') || skill.compatibility.includes('claude-cowork');
  const claudeCodeCommand = `claude mcp add ${skill.slug} --from-github ${skill.repo}`;
  const committer = skill.committer;
  const authorName = authorDisplayName(skill);
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

  // Frontmatter (form/Zapier) submissions surface the human author + email;
  // GitHub-sourced skills keep the git "Last Committer" provenance.
  const email = submitterEmail(skill);
  const committerName = committer?.name || committer?.login || skill.author;
  const committerUrl = committer?.login ? `https://github.com/${committer.login}` : null;
  const committerCard = skill.author_name
    ? `
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Author</h3>
      <div class="flex items-center gap-3">
        ${avatarHtml(skill.author_name, committer?.avatar_url, '8')}
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 m-0">${escapeHtml(skill.author_name)}</p>
          ${email ? `<a href="mailto:${escapeHtml(email)}" class="text-xs text-plum-600 hover:text-plum-700 no-underline">${escapeHtml(email)}</a>` : ''}
        </div>
      </div>
    </div>`
    : `
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Last Committer</h3>
      <div class="flex items-center gap-3">
        ${avatarHtml(committerName, committer?.avatar_url, '8')}
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 m-0">${escapeHtml(committerName)}</p>
          ${committerUrl ? `<a href="${escapeHtml(committerUrl)}" target="_blank" rel="noopener" class="text-xs text-plum-600 hover:text-plum-700 no-underline">@${escapeHtml(committer.login)}</a>` : ''}
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

  const backHref = skill.type === 'agent'
    ? '/agents'
    : skill.source === 'enterprise' || skill.plugin === 'skills-registry'
      ? '/'
      : `/plugins/${escapeHtml(skill.plugin)}`;
  const backLabel = skill.type === 'agent'
    ? '← All agents'
    : skill.source === 'enterprise' || skill.plugin === 'skills-registry'
      ? '← Back to hub'
      : `← Back to ${escapeHtml(skill.plugin)}`;

  return `
    <a href="${backHref}" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">${backLabel}</a>

    <div class="mb-8">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <h1 class="text-2xl font-bold text-gray-900 m-0">${escapeHtml(skill.name)}</h1>
        <span class="px-2 py-0.5 text-xs font-medium bg-plum-50 text-plum-700 rounded">${escapeHtml(skill.plugin)}</span>
        ${skill.sensitive_data ? '<span class="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded">⚠ sensitive data</span>' : ''}
        ${skill.type === 'agent' ? '<span class="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">agent</span>' : ''}
      </div>
      <div class="flex items-center gap-2 text-sm text-gray-400">
        ${avatarHtml(authorName, committer?.avatar_url, '6')}
        ${addedDate ? `<span class="text-gray-300">·</span><span>Added ${escapeHtml(addedDate)}</span>` : ''}
        <span class="text-gray-300">·</span>
        <a href="https://github.com/${escapeHtml(skill.repo)}/blob/main/${escapeHtml(skill.path)}" target="_blank" rel="noopener" class="text-plum-600 hover:text-plum-700 no-underline">View on GitHub ↗</a>
      </div>
    </div>

    <div hidden data-skill-json="${escapeHtml(JSON.stringify({ slug: skill.slug, name: skill.name, plugin: skill.plugin, description: skill.description, compatibility: skill.compatibility, type: skill.type }))}"></div>

    <div class="flex gap-8 items-start">
      <div class="flex-1 min-w-0 space-y-8">
        <section>
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Description</h2>
          ${skill.compatibility.length ? `<div class="flex items-center gap-2 flex-wrap mb-3"><span class="text-xs text-gray-400">Works with:</span>${compatBadges}</div>` : ''}
          ${skill.source === 'anthropic-builtin'
  ? `<div class="mb-3 p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700">
      <strong>Anthropic Tool</strong> — This skill runs via the Anthropic Messages API code execution container. It is not a SKILL.md workflow.
    </div>`
  : ''}
          ${skill.source === 'enterprise'
  ? `<div class="mb-3 p-3 bg-violet-50 border border-violet-200 rounded-lg flex items-center gap-2">
      <span class="px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 rounded flex-shrink-0">Org-wide</span>
      <span class="text-xs text-violet-700">Available to all Nava staff across Claude Chat and Claude for Work — no installation needed.</span>
    </div>`
  : ''}
          <p class="text-sm text-gray-600 leading-relaxed m-0">${escapeHtml(skill.description)}</p>
          ${skill.tags?.length
  ? `<div class="flex flex-wrap gap-1.5 mt-3">
      ${skill.tags.map(t => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">#${escapeHtml(t)}</span>`).join('')}
    </div>`
  : ''}
        </section>
        ${toolsUsed}
        <section>
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">SKILL.md</h2>
          <pre class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap leading-relaxed m-0"><code>${escapeHtml(skill.content || '')}</code></pre>
        </section>
      </div>
      <aside class="w-64 flex-shrink-0 space-y-4">
        <div>${renderFavoriteButton(skill.slug)}</div>
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
        ${renderNavaMetaSection(skill)}
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

  const agentsPanel = `<div id="tab-agents" class="hidden">
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

export function renderCategoryGrid(categories, allSkills) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const bySlug = new Map(allSkills.map(s => [s.slug, s]));

  function isNew(skill) {
    return !!skill.last_updated && new Date(skill.last_updated).getTime() >= sevenDaysAgo;
  }

  const categoryCards = categories.map(cat => {
    const adminFeatured = (cat.featuredSlugs || []).map(slug => bySlug.get(slug)).filter(Boolean);
    const enterpriseFeatured = allSkills.filter(s => s.source === 'enterprise' && s.category === cat.id);
    // Merge, deduplicating by slug (admin-featured take precedence, then enterprise)
    const featuredSlugsSet = new Set(adminFeatured.map(s => s.slug));
    const featured = [
      ...adminFeatured,
      ...enterpriseFeatured.filter(s => !featuredSlugsSet.has(s.slug)),
    ];
    const catSlugs = (cat.slugs || []).map(slug => bySlug.get(slug)).filter(Boolean);
    const enterpriseSlugsSet = new Set(enterpriseFeatured.map(s => s.slug));
    const catSlugsFiltered = catSlugs.filter(s => !enterpriseSlugsSet.has(s.slug));
    const all = [...enterpriseFeatured, ...catSlugsFiltered];
    const preview = all.filter(s => !featuredSlugsSet.has(s.slug) && s.source !== 'enterprise').slice(0, 3);

    const skillUrl = (skill) => `/${skill.type === 'agent' ? 'agents' : 'skills'}/${escapeHtml(skill.slug)}`;

    const featuredRows = featured.map(skill => `
      <div class="flex items-center justify-between py-1 border-b border-gray-50">
        <a href="${skillUrl(skill)}" class="text-xs text-gray-700 no-underline hover:text-plum-600">${escapeHtml(skill.name)}</a>
        ${skill.source === 'enterprise'
      ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 rounded">Org-wide</span>`
      : `<span class="text-xs font-medium text-plum-600">Featured</span>`}
      </div>`).join('');

    const previewRows = preview.map(skill => `
      <div class="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
        <a href="${skillUrl(skill)}" class="text-xs text-gray-700 no-underline hover:text-plum-600">${escapeHtml(skill.name)}</a>
        ${isNew(skill) ? `<span class="px-1.5 py-0.5 text-xs font-semibold rounded" style="background:#f5f3ff;color:${escapeHtml(cat.textColor)}">new</span>` : ''}
      </div>`).join('');

    const rows = (featuredRows + previewRows) ||
      '<div class="text-xs text-gray-400 py-1 italic">No skills yet</div>';

    const viewAll = all.length > 0
      ? `<a href="/category/${escapeHtml(cat.id)}" class="text-xs no-underline font-medium hover:underline" style="color:${escapeHtml(cat.textColor)}">View all (${all.length}) &rarr;</a>`
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
      <div class="text-xs text-gray-500 leading-relaxed">Submit via Google Form. The ops team reviews within 1 business day.</div>
      <a href="${escapeHtml(SUBMIT_FORM_URL)}" target="_blank" rel="noopener"
         class="px-3 py-1.5 text-xs font-medium bg-plum-600 text-white rounded hover:bg-plum-700 no-underline transition-colors">
        Submit a skill
      </a>
    </div>`;

  return `
    <section class="mb-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    const cat = categories.find(c => c.slugs.includes(slug));
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
        <a href="/whats-new" class="text-xs text-plum-600 hover:text-plum-700 no-underline font-medium">What's new &rarr;</a>
      </div>
      <div class="flex gap-3">${cards}</div>
    </div>`;
}

export function renderCategoryDetail(category, allSkills) {
  const bySlug = new Map(allSkills.map(s => [s.slug, s]));

  const featured = (category.featuredSlugs || []).map(s => bySlug.get(s)).filter(Boolean);
  const skills = (category.slugs || []).map(s => bySlug.get(s)).filter(Boolean);

  const featuredSection = featured.length ? `
    <section class="mb-8">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-xs font-semibold text-plum-600 uppercase tracking-wider">Featured</span>
        <div class="flex-1 border-t border-gray-200"></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${featured.map(skill => `
          <div style="border-top:2px solid ${escapeHtml(category.borderColor)}">${renderSkillCard(skill)}</div>
        `).join('')}
      </div>
    </section>` : '';

  const allSection = skills.length ? `
    <section>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
