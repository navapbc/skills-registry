import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPost } from './api.mjs';

export async function load(panel) {
  const { skills } = await fetchApi('/admin/queue');
  const badge = document.getElementById('queue-badge');
  if (skills.length > 0) {
    badge.textContent = skills.length;
    badge.classList.remove('hidden');
  }
  if (!skills.length) {
    panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
    return;
  }
  panel.innerHTML = `
    <table class="admin-table w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium">Skill</th>
        <th class="pb-2 font-medium">Author</th>
        <th class="pb-2 font-medium">Plugin</th>
        <th class="pb-2 font-medium">Submitted</th>
        <th class="pb-2 font-medium">Actions</th>
      </tr></thead>
      <tbody>
        ${skills.map(s => `
          <tr class="border-b border-gray-100 hover:bg-gray-50" data-slug="${escapeHtml(s.slug)}">
            <td class="py-3 font-medium text-gray-900"><a href="/skills/${escapeHtml(s.slug)}" class="hover:text-plum-600 no-underline">${escapeHtml(s.name)}</a></td>
            <td class="py-3 text-gray-500">${escapeHtml(s.author ?? s.created_by ?? '')}</td>
            <td class="py-3 text-gray-500">${escapeHtml(s.plugin ?? '')}</td>
            <td class="py-3 text-gray-400">${escapeHtml(s.created_at ? new Date(s.created_at).toLocaleDateString() : '')}</td>
            <td class="py-3 flex gap-2">
              <button class="approve-btn px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition-colors">Approve</button>
              <button class="reject-btn px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">Reject</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  panel.querySelectorAll('.approve-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      try {
        await apiPost(`/skills/${slug}/approve`, {});
        row.remove();
        if (!panel.querySelector('tr[data-slug]')) {
          panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
          document.getElementById('queue-badge').classList.add('hidden');
        }
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });

  panel.querySelectorAll('.reject-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      const reason = prompt('Rejection reason (optional):');
      if (reason === null) return;
      try {
        await apiPost(`/skills/${slug}/reject`, { reason });
        row.remove();
        if (!panel.querySelector('tr[data-slug]')) {
          panel.innerHTML = '<p class="text-sm text-gray-400">No pending submissions.</p>';
          document.getElementById('queue-badge').classList.add('hidden');
        }
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });
}
