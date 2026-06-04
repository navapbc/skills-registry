import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';

export async function load(panel) {
  const { events } = await fetchApi('/admin/audit?limit=100');
  if (!events.length) {
    panel.innerHTML = '<p class="text-sm text-gray-400">No audit events yet.</p>';
    return;
  }
  panel.innerHTML = `
    <table class="w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Time</th>
        <th class="pb-2 font-medium">Actor</th>
        <th class="pb-2 font-medium">Action</th>
        <th class="pb-2 font-medium">Entity</th>
      </tr></thead>
      <tbody>
        ${events.map(e => `
          <tr class="border-b border-gray-100">
            <td class="py-2 text-gray-400 text-xs whitespace-nowrap">${escapeHtml(e.timestamp ? new Date(e.timestamp).toLocaleString() : '')}</td>
            <td class="py-2 text-gray-600">${escapeHtml(e.user_id ?? '')}</td>
            <td class="py-2"><span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">${escapeHtml(e.action ?? '')}</span></td>
            <td class="py-2 text-gray-500 font-mono text-xs">${escapeHtml(e.resource_type ?? '')} / ${escapeHtml(e.resource_id ?? '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}
