import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPut } from './api.mjs';

export async function load(panel, ctx) {
  const { users } = await fetchApi('/admin/users');
  panel.innerHTML = `
    <table class="admin-table w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Name</th>
        <th class="pb-2 font-medium">Email</th>
        <th class="pb-2 font-medium">Role</th>
        <th class="pb-2 font-medium">Last seen</th>
      </tr></thead>
      <tbody>
        ${users.map(u => `
          <tr class="border-b border-gray-100" data-uid="${escapeHtml(u.user_id)}">
            <td class="py-2 text-gray-900">${escapeHtml(u.name ?? '')}</td>
            <td class="py-2 text-gray-500">${escapeHtml(u.email ?? '')}</td>
            <td class="py-2">
              <select class="role-select text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-plum-300">
                <option value="user"     ${u.role === 'user'     ? 'selected' : ''}>user</option>
                <option value="maintain" ${u.role === 'maintain' ? 'selected' : ''}>maintain</option>
                <option value="admin"    ${u.role === 'admin'    ? 'selected' : ''}>admin</option>
              </select>
            </td>
            <td class="py-2 text-gray-400 text-xs">${escapeHtml(u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  panel.querySelectorAll('.role-select').forEach(sel => {
    const row = sel.closest('tr');
    const uid = row.dataset.uid;
    sel.addEventListener('change', async () => {
      try {
        await apiPut(`/admin/users/${encodeURIComponent(uid)}/role`, { role: sel.value });
      } catch (e) {
        alert(`Error: ${e.message}`);
        ctx.reloadTab('users');
      }
    });
  });
}
