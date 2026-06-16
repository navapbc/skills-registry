import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPut } from './api.mjs';
import { catLabel, catSelectOptions, tagChips, compatChips, COMPAT_OPTIONS } from '../../lib/admin/format.mjs';

export async function load(panel) {
  const { skills } = await fetchApi('/admin/skills');
  const items = skills;

  let filterType = 'all';
  let searchQuery = '';

  function getFiltered() {
    return items.filter(s => {
      if (filterType !== 'all' && s.type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.name?.toLowerCase().includes(q) || s.slug?.toLowerCase().includes(q) || (s.author ?? '').toLowerCase().includes(q);
      }
      return true;
    });
  }

  const VISIBILITY_BADGE = {
    public:  'bg-green-50 text-green-700 border border-green-200',
    private: 'bg-amber-50 text-amber-700 border border-amber-200',
    hidden:  'bg-gray-100 text-gray-500 border border-gray-200',
  };

  function visibilityBadge(v) {
    const val = v || 'public';
    const cls = VISIBILITY_BADGE[val] || VISIBILITY_BADGE.public;
    return `<span class="text-xs px-1.5 py-0.5 rounded ${cls}">${escapeHtml(val)}</span>`;
  }

  function renderRows(list) {
    if (!list.length) return '<tr><td colspan="7" class="py-6 text-center text-sm text-gray-400">No results.</td></tr>';
    return list.map(s => {
      const tagsVal = (s.tags ?? []).join(', ');
      const currentCompat = s.compatibility ?? [];
      const typeBadge = s.type === 'agent'
        ? '<span class="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">agent</span>'
        : '<span class="text-xs px-1.5 py-0.5 rounded bg-plum-100 text-plum-700">skill</span>';
      return `
        <tr class="border-b border-gray-100 hover:bg-gray-50/50">
          <td class="py-2 pr-2 font-medium text-gray-900">${escapeHtml(s.name)}<div class="text-xs text-gray-400 font-mono font-normal">${escapeHtml(s.slug)}</div></td>
          <td class="py-2 pr-2 whitespace-nowrap">${typeBadge}</td>
          <td class="py-2 pr-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(catLabel(s.category))}</td>
          <td class="py-2 pr-2">${tagChips(s.tags)}</td>
          <td class="py-2 pr-2 visibility-display whitespace-nowrap">${visibilityBadge(s.visibility)}</td>
          <td class="py-2 pr-2 compat-display">${compatChips(s.compatibility)}</td>
          <td class="py-2 whitespace-nowrap"><button class="edit-content-btn text-xs text-plum-600 hover:text-plum-800 px-2 py-1 border border-plum-200 rounded hover:bg-plum-50 transition-colors">Edit</button></td>
        </tr>
        <tr class="edit-content-row hidden bg-violet-50/50 border-b border-gray-100">
          <td colspan="7" class="py-3 px-2">
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="text-xs text-gray-600 block mb-1">Category</label>
                <select class="content-cat-select text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-plum-300">
                  ${catSelectOptions(s.category)}
                </select>
              </div>
              <div class="flex-1 min-w-56">
                <label class="text-xs text-gray-600 block mb-1">Tags <span class="text-gray-400">(comma-separated)</span></label>
                <input type="text" class="content-tags-input w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-plum-300" value="${escapeHtml(tagsVal)}" placeholder="productivity, writing, research" data-slug="${escapeHtml(s.slug)}" />
              </div>
              <div>
                <label class="text-xs text-gray-600 block mb-1">Visibility</label>
                <select class="content-visibility-select text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-plum-300">
                  <option value="public"  ${(s.visibility ?? 'public') === 'public'  ? 'selected' : ''}>Public</option>
                  <option value="private" ${s.visibility === 'private' ? 'selected' : ''}>Private</option>
                  <option value="hidden"  ${s.visibility === 'hidden'  ? 'selected' : ''}>Hidden</option>
                </select>
              </div>
              <div>
                <label class="text-xs text-gray-600 block mb-1">Compatibility</label>
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  ${COMPAT_OPTIONS.map(opt => `
                    <label class="flex items-center gap-1 text-xs text-gray-700 cursor-pointer select-none">
                      <input type="checkbox" class="content-compat-cb" value="${escapeHtml(opt)}" ${currentCompat.includes(opt) ? 'checked' : ''} />
                      ${escapeHtml(opt)}
                    </label>`).join('')}
                </div>
              </div>
              <div class="flex gap-2 items-center">
                <button class="save-content-btn px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
                <button class="cancel-content-btn px-3 py-1.5 text-xs bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors">Cancel</button>
                <span class="content-save-status text-xs hidden"></span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function updateCount(list) {
    panel.querySelector('#content-count').textContent = `${list.length} of ${items.length}`;
  }

  panel.innerHTML = `
    <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 leading-relaxed">
      <strong>Sync note:</strong> Category and compatibility on GitHub-sourced skills are overwritten by the next sync whenever the SKILL.md changes in the source repo. To make these changes permanent, update the frontmatter in the SKILL.md directly. <strong>Tags are safe</strong> — they are never touched by sync.
    </div>
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input type="text" id="content-search" placeholder="Search by name, slug, or author…" class="flex-1 min-w-48 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      <div class="flex gap-1">
        <button data-filter="all"   class="content-filter active text-xs px-3 py-1.5 rounded border border-plum-600 bg-plum-600 text-white">All</button>
        <button data-filter="skill" class="content-filter text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:border-plum-300 transition-colors">Skills</button>
        <button data-filter="agent" class="content-filter text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:border-plum-300 transition-colors">Agents</button>
      </div>
      <span class="text-xs text-gray-400"><span id="content-count">${items.length} of ${items.length}</span> items</span>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
          <th class="pb-2 font-medium pr-2">Name</th>
          <th class="pb-2 font-medium pr-2">Type</th>
          <th class="pb-2 font-medium pr-2">Category</th>
          <th class="pb-2 font-medium pr-2">Tags</th>
          <th class="pb-2 font-medium pr-2">Visibility</th>
          <th class="pb-2 font-medium pr-2">Compatibility</th>
          <th class="pb-2"></th>
        </tr></thead>
        <tbody id="content-tbody">${renderRows(getFiltered())}</tbody>
      </table>
    </div>
  `;

  function wireRows() {
    panel.querySelectorAll('.edit-content-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dataRow = btn.closest('tr');
        const editRow = dataRow.nextElementSibling;
        const isOpen = !editRow.classList.contains('hidden');
        panel.querySelectorAll('.edit-content-row').forEach(r => r.classList.add('hidden'));
        if (!isOpen) editRow.classList.remove('hidden');
      });
    });

    panel.querySelectorAll('.cancel-content-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.edit-content-row').classList.add('hidden'));
    });

    panel.querySelectorAll('.save-content-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const editRow = btn.closest('.edit-content-row');
        const dataRow = editRow.previousElementSibling;
        const slug = editRow.querySelector('.content-tags-input').dataset.slug;
        const category = editRow.querySelector('.content-cat-select').value;
        const tags = editRow.querySelector('.content-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);
        const visibility = editRow.querySelector('.content-visibility-select').value;
        const compatibility = [...editRow.querySelectorAll('.content-compat-cb:checked')].map(cb => cb.value);
        const statusEl = editRow.querySelector('.content-save-status');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await apiPut(`/skills/${encodeURIComponent(slug)}`, { category, tags, visibility, compatibility });
          // Refresh display cells in data row
          const cells = dataRow.querySelectorAll('td');
          cells[2].textContent = catLabel(category);
          cells[3].innerHTML = tagChips(tags);
          cells[4].innerHTML = visibilityBadge(visibility);
          cells[5].innerHTML = compatChips(compatibility);
          statusEl.textContent = 'Saved ✓';
          statusEl.className = 'content-save-status text-xs text-green-600';
          statusEl.classList.remove('hidden');
          setTimeout(() => { editRow.classList.add('hidden'); statusEl.classList.add('hidden'); }, 1500);
        } catch (e) {
          statusEl.textContent = `Error: ${e.message}`;
          statusEl.className = 'content-save-status text-xs text-red-500';
          statusEl.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      });
    });
  }
  wireRows();

  function rerender() {
    const filtered = getFiltered();
    updateCount(filtered);
    panel.querySelector('#content-tbody').innerHTML = renderRows(filtered);
    wireRows();
  }

  panel.querySelector('#content-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    rerender();
  });

  panel.querySelectorAll('.content-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      filterType = btn.dataset.filter;
      panel.querySelectorAll('.content-filter').forEach(b => {
        const active = b === btn;
        b.className = `content-filter text-xs px-3 py-1.5 rounded border transition-colors ${active ? 'border-plum-600 bg-plum-600 text-white' : 'border-gray-200 text-gray-600 hover:border-plum-300'}`;
      });
      rerender();
    });
  });
}
