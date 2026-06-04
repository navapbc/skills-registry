import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPut } from './api.mjs';
import { tagChips } from '../../lib/admin/format.mjs';

export async function load(panel) {
  const { plugins } = await fetchApi('/plugins');
  let searchQuery = '';

  function getFiltered() {
    if (!searchQuery) return plugins;
    const q = searchQuery.toLowerCase();
    return plugins.filter(p => p.name?.toLowerCase().includes(q) || p.slug?.toLowerCase().includes(q) || (p.author ?? '').toLowerCase().includes(q));
  }

  function renderRows(list) {
    if (!list.length) return '<tr><td colspan="4" class="py-6 text-center text-sm text-gray-400">No results.</td></tr>';
    return list.map(p => {
      const tagsVal = (p.tags ?? []).join(', ');
      return `
        <tr class="border-b border-gray-100 hover:bg-gray-50/50">
          <td class="py-2 pr-2 font-medium text-gray-900">${escapeHtml(p.name)}<div class="text-xs text-gray-400 font-mono font-normal">${escapeHtml(p.slug)}</div></td>
          <td class="py-2 pr-2 text-xs text-gray-500">${escapeHtml(p.author ?? '')}</td>
          <td class="py-2 pr-2">${tagChips(p.tags)}</td>
          <td class="py-2 whitespace-nowrap"><button class="edit-plugin-btn text-xs text-plum-600 hover:text-plum-800 px-2 py-1 border border-plum-200 rounded hover:bg-plum-50 transition-colors">Edit</button></td>
        </tr>
        <tr class="edit-plugin-row hidden bg-violet-50/50 border-b border-gray-100">
          <td colspan="4" class="py-3 px-2">
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex-1 min-w-56">
                <label class="text-xs text-gray-600 block mb-1">Tags <span class="text-gray-400">(comma-separated)</span></label>
                <input type="text" class="plugin-tags-input w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-plum-300" value="${escapeHtml(tagsVal)}" placeholder="mcp, productivity, dev" data-slug="${escapeHtml(p.slug)}" />
              </div>
              <div class="flex gap-2 items-center">
                <button class="save-plugin-btn px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
                <button class="cancel-plugin-btn px-3 py-1.5 text-xs bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors">Cancel</button>
                <span class="plugin-save-status text-xs hidden"></span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  panel.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <input type="text" id="plugins-search" placeholder="Search plugins…" class="flex-1 max-w-sm text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      <span class="text-xs text-gray-400"><span id="plugins-count">${plugins.length}</span> plugins</span>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
          <th class="pb-2 font-medium pr-2">Plugin</th>
          <th class="pb-2 font-medium pr-2">Author</th>
          <th class="pb-2 font-medium pr-2">Tags</th>
          <th class="pb-2"></th>
        </tr></thead>
        <tbody id="plugins-tbody">${renderRows(getFiltered())}</tbody>
      </table>
    </div>
  `;

  function wireRows() {
    panel.querySelectorAll('.edit-plugin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dataRow = btn.closest('tr');
        const editRow = dataRow.nextElementSibling;
        const isOpen = !editRow.classList.contains('hidden');
        panel.querySelectorAll('.edit-plugin-row').forEach(r => r.classList.add('hidden'));
        if (!isOpen) editRow.classList.remove('hidden');
      });
    });

    panel.querySelectorAll('.cancel-plugin-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.edit-plugin-row').classList.add('hidden'));
    });

    panel.querySelectorAll('.save-plugin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const editRow = btn.closest('.edit-plugin-row');
        const dataRow = editRow.previousElementSibling;
        const slug = editRow.querySelector('.plugin-tags-input').dataset.slug;
        const tags = editRow.querySelector('.plugin-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);
        const statusEl = editRow.querySelector('.plugin-save-status');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await apiPut(`/plugins/${encodeURIComponent(slug)}`, { tags });
          const cells = dataRow.querySelectorAll('td');
          cells[2].innerHTML = tagChips(tags);
          statusEl.textContent = 'Saved ✓';
          statusEl.className = 'plugin-save-status text-xs text-green-600';
          statusEl.classList.remove('hidden');
          setTimeout(() => { editRow.classList.add('hidden'); statusEl.classList.add('hidden'); }, 1500);
        } catch (e) {
          statusEl.textContent = `Error: ${e.message}`;
          statusEl.className = 'plugin-save-status text-xs text-red-500';
          statusEl.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      });
    });
  }
  wireRows();

  panel.querySelector('#plugins-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    const filtered = getFiltered();
    panel.querySelector('#plugins-count').textContent = filtered.length;
    panel.querySelector('#plugins-tbody').innerHTML = renderRows(filtered);
    wireRows();
  });
}
