import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { relTime, actorName, infoTooltip, userSegments, weeklyCumulative, sparkline } from '../../lib/admin/format.mjs';

// Content-analytics panels (top skills / searches / filters). Pure string builder
// so it can be unit-tested; all user-derived values are HTML-escaped.
export function renderAnalyticsPanels(analytics = {}) {
  const { topSkills = [], topSearches = [], filterUsage = [], window_days = 28 } = analytics;

  const row = (label, count) => `<div class="flex items-center justify-between gap-2 text-xs">
      <span class="text-gray-600 truncate">${escapeHtml(String(label))}</span>
      <span class="text-gray-400 tabular-nums flex-shrink-0">${count}</span>
    </div>`;

  const list = (rows, emptyText) => rows.length
    ? `<div class="space-y-1.5">${rows.join('')}</div>`
    : `<p class="text-xs text-gray-400">${escapeHtml(emptyText)}</p>`;

  const panel = (title, inner) => `<div class="bg-white border border-gray-200 rounded-lg p-4">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">${escapeHtml(title)}</div>
      ${inner}
    </div>`;

  return `<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
    ${panel(`Top Skills (${window_days}d)`, list(topSkills.map(s => row(s.skill_slug, s.count)), 'No skill views yet.'))}
    ${panel(`Top Searches (${window_days}d)`, list(topSearches.map(s => row(s.query, s.count)), 'No searches yet.'))}
    ${panel(`Filter Usage (${window_days}d)`, list(filterUsage.map(f => row(f.filter_value, f.count)), 'No filters used yet.'))}
  </div>`;
}

const ACTIVE_USER_TOOLTIP = 'Active user = ≥1 authenticated activity in the last 28 days. Rolling window (not calendar month).';
const SEGMENT_TOOLTIPS = {
  new: 'First seen in the last 28 days.',
  returning: 'Account older than 28 days and active in the last 28 days.',
  dormant: 'No activity in the last 28 days.',
};

export async function load(panel, ctx) {
  const dash = panel;
  if (!dash) return;

  const [skillsRes, pluginsRes, queueRes, usersRes, auditRes, analyticsRes] = await Promise.all([
    fetchApi('/skills').catch(() => ({})),
    fetchApi('/plugins').catch(() => ({})),
    fetchApi('/admin/queue').catch(() => ({})),
    ctx.role === 'admin' ? fetchApi('/admin/users').catch(() => ({})) : Promise.resolve({}),
    ctx.role === 'admin' ? fetchApi('/admin/audit?limit=6').catch(() => ({})) : Promise.resolve({}),
    ctx.role === 'admin' ? fetchApi('/admin/analytics').catch(() => ({})) : Promise.resolve({}),
  ]);

  const allItems = (skillsRes.skills ?? []).filter(s => s.source !== 'category-config');
  const skillItems = allItems.filter(s => s.type !== 'agent');
  const agentItems = allItems.filter(s => s.type === 'agent');
  const plugins = pluginsRes.plugins ?? [];
  const skillCount = skillItems.length;
  const agentCount = agentItems.length;
  const pluginCount = plugins.length;
  const pendingCount = (queueRes.skills ?? []).length;

  // 4-week cumulative-growth sparkline, computed from each item's created_at.
  const spark = (items) => sparkline(weeklyCumulative(items), { className: 'text-gray-400' });

  // Update queue tab badge from dashboard data
  const badge = document.getElementById('queue-badge');
  if (badge && pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.classList.remove('hidden');
  }

  const users = usersRes.users ?? [];
  const events = auditRes.events ?? [];
  const analytics = analyticsRes ?? {};
  const seg = userSegments(users);
  const activeCount = seg.active;

  function statCard(value, label, highlight = false, tabTarget = null, sparkHtml = '') {
    const cardCls = highlight && value > 0
      ? 'bg-amber-50 border-amber-200 cursor-pointer hover:shadow-sm transition-shadow'
      : 'bg-white border-gray-200';
    const valCls = highlight && value > 0 ? 'text-amber-700' : 'text-gray-900';
    const attrs = tabTarget ? `data-tab-target="${escapeHtml(tabTarget)}"` : '';
    return `<div class="${cardCls} border rounded-lg p-4" ${attrs}>
      <div class="text-2xl font-bold ${valCls}">${value}</div>
      <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(label)}</div>
      ${sparkHtml ? `<div class="mt-2">${sparkHtml}</div>` : ''}
    </div>`;
  }

  const ACTION_STYLE = {
    approved:      'bg-green-50 text-green-700',
    rejected:      'bg-red-50 text-red-700',
    created:       'bg-blue-50 text-blue-700',
    deleted:       'bg-red-50 text-red-700',
    updated:       'bg-gray-100 text-gray-600',
    'role-changed':'bg-violet-50 text-violet-700',
  };

  const adminSection = ctx.role === 'admin' ? `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
      <div class="bg-white border border-gray-200 rounded-lg p-4">
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Users</div>
        <div class="flex items-end gap-4">
          <div>
            <div class="text-2xl font-bold text-gray-900">${users.length}</div>
            <div class="text-xs text-gray-400">total</div>
          </div>
          <div class="mb-px">
            <div class="text-xl font-bold text-green-600">${activeCount}</div>
            <div class="text-xs text-gray-400 flex items-center gap-1">active (28d) ${infoTooltip(ACTIVE_USER_TOOLTIP)}</div>
          </div>
        </div>
        <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
          <div>
            <div class="text-sm font-semibold text-gray-900">${seg.new}</div>
            <div class="text-[11px] text-gray-400 flex items-center justify-center gap-1">new ${infoTooltip(SEGMENT_TOOLTIPS.new)}</div>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-900">${seg.returning}</div>
            <div class="text-[11px] text-gray-400 flex items-center justify-center gap-1">returning ${infoTooltip(SEGMENT_TOOLTIPS.returning)}</div>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-900">${seg.dormant}</div>
            <div class="text-[11px] text-gray-400 flex items-center justify-center gap-1">dormant ${infoTooltip(SEGMENT_TOOLTIPS.dormant)}</div>
          </div>
        </div>
        <div class="mt-3 text-gray-400">${sparkline(weeklyCumulative(users), { width: 240, className: 'text-gray-400 w-full' })}</div>
      </div>
      <div class="md:col-span-2 bg-white border border-gray-200 rounded-lg p-4">
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Activity</div>
        ${events.length ? `<div class="space-y-2">
          ${events.map(e => `
            <div class="flex items-center gap-2 text-xs min-w-0">
              <span class="text-gray-400 w-8 flex-shrink-0 tabular-nums">${relTime(e.timestamp)}</span>
              <span class="text-gray-600 truncate w-28 flex-shrink-0">${escapeHtml(actorName(users, e.user_id))}</span>
              <span class="px-1.5 py-0.5 rounded flex-shrink-0 ${ACTION_STYLE[e.action] ?? 'bg-gray-100 text-gray-600'}">${escapeHtml(e.action ?? '')}</span>
              <span class="text-gray-400 truncate">${escapeHtml(e.resource_type ?? '')} / ${escapeHtml(e.resource_id ?? '')}</span>
            </div>`).join('')}
        </div>` : '<p class="text-xs text-gray-400">No activity yet.</p>'}
      </div>
    </div>
  ` : '';

  const analyticsSection = ctx.role === 'admin' ? renderAnalyticsPanels(analytics) : '';

  dash.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      ${statCard(skillCount, 'Skills', false, null, spark(skillItems))}
      ${statCard(agentCount, 'Agents', false, null, spark(agentItems))}
      ${statCard(pluginCount, 'Plugins', false, null, spark(plugins))}
      ${statCard(pendingCount, 'Pending Review', true, 'queue')}
    </div>
    ${adminSection}
    ${analyticsSection}
  `;

  dash.querySelectorAll('[data-tab-target]').forEach(card => {
    card.addEventListener('click', () => ctx.activateTab(card.dataset.tabTarget));
  });
}
