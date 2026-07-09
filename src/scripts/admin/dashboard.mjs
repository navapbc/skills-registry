import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { relTime, actorName, infoTooltip } from '../../lib/admin/format.mjs';

const ACTIVE_USER_TOOLTIP = 'Active user = ≥1 authenticated activity in the last 28 days. Rolling window (not calendar month).';

export async function load(panel, ctx) {
  const dash = panel;
  if (!dash) return;

  const [skillsRes, pluginsRes, queueRes, usersRes, auditRes] = await Promise.all([
    fetchApi('/skills').catch(() => ({})),
    fetchApi('/plugins').catch(() => ({})),
    fetchApi('/admin/queue').catch(() => ({})),
    ctx.role === 'admin' ? fetchApi('/admin/users').catch(() => ({})) : Promise.resolve({}),
    ctx.role === 'admin' ? fetchApi('/admin/audit?limit=6').catch(() => ({})) : Promise.resolve({}),
  ]);

  const allItems = (skillsRes.skills ?? []).filter(s => s.source !== 'category-config');
  const skillCount = allItems.filter(s => s.type !== 'agent').length;
  const agentCount = allItems.filter(s => s.type === 'agent').length;
  const pluginCount = (pluginsRes.plugins ?? []).length;
  const pendingCount = (queueRes.skills ?? []).length;

  // Update queue tab badge from dashboard data
  const badge = document.getElementById('queue-badge');
  if (badge && pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.classList.remove('hidden');
  }

  const users = usersRes.users ?? [];
  const events = auditRes.events ?? [];
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const activeCount = users.filter(u => (u.last_seen_at ?? '') >= cutoff).length;

  function statCard(value, label, highlight = false, tabTarget = null) {
    const cardCls = highlight && value > 0
      ? 'bg-amber-50 border-amber-200 cursor-pointer hover:shadow-sm transition-shadow'
      : 'bg-white border-gray-200';
    const valCls = highlight && value > 0 ? 'text-amber-700' : 'text-gray-900';
    const attrs = tabTarget ? `data-tab-target="${escapeHtml(tabTarget)}"` : '';
    return `<div class="${cardCls} border rounded-lg p-4" ${attrs}>
      <div class="text-2xl font-bold ${valCls}">${value}</div>
      <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(label)}</div>
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
            <div class="text-xs text-gray-400 flex items-center gap-1">active this month ${infoTooltip(ACTIVE_USER_TOOLTIP)}</div>
          </div>
        </div>
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

  dash.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      ${statCard(skillCount, 'Skills')}
      ${statCard(agentCount, 'Agents')}
      ${statCard(pluginCount, 'Plugins')}
      ${statCard(pendingCount, 'Pending Review', true, 'queue')}
    </div>
    ${adminSection}
  `;

  dash.querySelectorAll('[data-tab-target]').forEach(card => {
    card.addEventListener('click', () => ctx.activateTab(card.dataset.tabTarget));
  });
}
