import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPost, apiPut, apiDelete } from './api.mjs';

export async function load(panel, ctx) {
  const { skills } = await fetchApi('/admin/enterprise-skills');
  const builtins = skills.filter(s => s.source === 'anthropic-builtin');
  const org = skills.filter(s => s.source === 'anthropic-enterprise' || s.source === 'enterprise');

  panel.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">Anthropic Built-ins</h2>
        <span class="text-xs text-gray-400">Synced weekly — read only</span>
      </div>
      <table class="admin-table w-full text-sm border-collapse">
        <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
          <th class="pb-2 font-medium">Skill</th><th class="pb-2 font-medium">Version</th><th class="pb-2 font-medium">Last synced</th>
        </tr></thead>
        <tbody>
          ${builtins.length ? builtins.map(s => `
            <tr class="border-b border-gray-100">
              <td class="py-2 font-medium text-gray-800">${escapeHtml(s.name)}</td>
              <td class="py-2 text-gray-500">${escapeHtml(s.version ?? '')}</td>
              <td class="py-2 text-gray-400">${escapeHtml(s.last_updated ? new Date(s.last_updated).toLocaleDateString() : '')}</td>
            </tr>`).join('') : '<tr><td colspan="3" class="py-3 text-gray-400 text-xs">No built-ins synced yet. Run the sync script.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-gray-700 m-0">Org Skills</h2>
        <button id="add-enterprise-btn" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">+ Add Skill</button>
      </div>
      <div id="org-skills-list">
        ${org.length ? `<table class="admin-table w-full text-sm border-collapse">
          <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
            <th class="pb-2 font-medium">Name</th><th class="pb-2 font-medium">Slug</th><th class="pb-2 font-medium">Tags</th><th class="pb-2 font-medium">Visibility</th><th class="pb-2 font-medium">Actions</th>
          </tr></thead>
          <tbody>
            ${org.map(s => {
              const visClass = s.visibility === 'hidden' ? 'bg-gray-100 text-gray-500 border border-gray-200'
                : s.visibility === 'private' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-green-50 text-green-700 border border-green-200';
              return `
              <tr class="border-b border-gray-100" data-slug="${escapeHtml(s.slug)}" data-skill="${escapeHtml(JSON.stringify({ name: s.name, description: s.description, tags: s.tags ?? [], docs_url: s.docs_url ?? '', visibility: s.visibility ?? 'public' }))}">
                <td class="py-2 font-medium text-gray-900">${escapeHtml(s.name)}</td>
                <td class="py-2 text-gray-500 font-mono text-xs">${escapeHtml(s.slug)}</td>
                <td class="py-2 text-gray-500">${(s.tags ?? []).map(t => `<span class="text-xs bg-gray-100 rounded px-1">#${escapeHtml(t)}</span>`).join(' ')}</td>
                <td class="py-2"><span class="text-xs px-1.5 py-0.5 rounded ${visClass}">${escapeHtml(s.visibility ?? 'public')}</span></td>
                <td class="py-2 flex gap-2">
                  <button class="edit-enterprise-btn text-xs text-plum-600 hover:text-plum-700">Edit</button>
                  ${ctx.role === 'admin' ? `<button class="delete-enterprise-btn text-xs text-red-500 hover:text-red-700">Delete</button>` : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>` : '<p class="text-sm text-gray-400">No org skills yet. Add one above.</p>'}
      </div>
    </div>

    <div id="enterprise-form" class="hidden mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <h3 class="text-sm font-semibold text-gray-700 mb-3" id="enterprise-form-title">Add Org Skill</h3>
      <input type="hidden" id="enterprise-edit-slug" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-600 block mb-1">Name *</label>
          <input id="ent-name" type="text" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
        <div>
          <label class="text-xs text-gray-600 block mb-1">Slug *</label>
          <input id="ent-slug" type="text" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-plum-300" />
        </div>
      </div>
      <div class="mb-3">
        <label class="text-xs text-gray-600 block mb-1">Description *</label>
        <textarea id="ent-desc" rows="2" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300 resize-none"></textarea>
      </div>
      <div class="mb-3">
        <label class="text-xs text-gray-600 block mb-1">Tags (comma-separated)</label>
        <input id="ent-tags" type="text" placeholder="productivity, briefing" class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
      <div class="mb-3">
        <label class="text-xs text-gray-600 block mb-1">Visibility</label>
        <select id="ent-visibility" class="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-plum-300">
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      <div class="flex gap-2">
        <button id="enterprise-form-save" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
        <button id="enterprise-form-cancel" class="px-3 py-1.5 text-xs bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors">Cancel</button>
      </div>
      <p id="enterprise-form-error" class="text-xs text-red-500 mt-2 hidden"></p>
    </div>
  `;

  const form = panel.querySelector('#enterprise-form');
  const editSlugInput = panel.querySelector('#enterprise-edit-slug');

  panel.querySelector('#add-enterprise-btn').addEventListener('click', () => {
    editSlugInput.value = '';
    panel.querySelector('#enterprise-form-title').textContent = 'Add Org Skill';
    panel.querySelector('#ent-name').value = '';
    panel.querySelector('#ent-slug').value = '';
    panel.querySelector('#ent-slug').disabled = false;
    panel.querySelector('#ent-desc').value = '';
    panel.querySelector('#ent-tags').value = '';
    panel.querySelector('#ent-visibility').value = 'public';
    form.classList.remove('hidden');
  });

  panel.querySelector('#enterprise-form-cancel').addEventListener('click', () => form.classList.add('hidden'));

  panel.querySelector('#ent-name').addEventListener('input', e => {
    if (!editSlugInput.value) {
      panel.querySelector('#ent-slug').value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  });

  panel.querySelector('#enterprise-form-save').addEventListener('click', async () => {
    const errEl = panel.querySelector('#enterprise-form-error');
    errEl.classList.add('hidden');
    const editSlug = editSlugInput.value;
    const payload = {
      name: panel.querySelector('#ent-name').value.trim(),
      slug: panel.querySelector('#ent-slug').value.trim(),
      description: panel.querySelector('#ent-desc').value.trim(),
      tags: panel.querySelector('#ent-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      visibility: panel.querySelector('#ent-visibility').value,
    };
    try {
      if (editSlug) {
        await apiPut(`/admin/enterprise-skills/${encodeURIComponent(editSlug)}`, payload);
      } else {
        await apiPost('/admin/enterprise-skills', payload);
      }
      form.classList.add('hidden');
      ctx.reloadTab('enterprise');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  panel.querySelectorAll('.edit-enterprise-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    const skillData = JSON.parse(row.dataset.skill);
    btn.addEventListener('click', () => {
      editSlugInput.value = slug;
      panel.querySelector('#enterprise-form-title').textContent = 'Edit Org Skill';
      panel.querySelector('#ent-name').value = skillData.name ?? '';
      panel.querySelector('#ent-slug').value = slug;
      panel.querySelector('#ent-slug').disabled = true;
      panel.querySelector('#ent-desc').value = skillData.description ?? '';
      panel.querySelector('#ent-tags').value = (skillData.tags ?? []).join(', ');
      panel.querySelector('#ent-visibility').value = skillData.visibility ?? 'public';
      form.classList.remove('hidden');
    });
  });

  panel.querySelectorAll('.delete-enterprise-btn').forEach(btn => {
    const row = btn.closest('tr');
    const slug = row.dataset.slug;
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return;
      try {
        await apiDelete(`/admin/enterprise-skills/${encodeURIComponent(slug)}`);
        row.remove();
      } catch (e) { alert(`Error: ${e.message}`); }
    });
  });
}
