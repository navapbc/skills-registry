import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { renderIcon, ARCHETYPE_ICON_NAMES } from '../../lib/icons.mjs';
import { apiPost, apiPut } from '../admin/api.mjs';
import { renderListEditor, readListEditor, bindListEditor, compact } from './list-editor.mjs';
import { renderUsageCell, renderOrphanNotice, renderUsageUnavailableNotice } from './usage.mjs';

const ENDPOINT = '/project-reference/archetype';

// Colors are applied as inline styles throughout. Interpolated utility classes
// emit no CSS, so a `bg-${color}` would silently render unstyled.
const swatch = (color) =>
  `<span class="inline-block w-4 h-4 rounded border border-gray-200 align-middle" style="background:${escapeHtml(color)}"></span>`;

/** One table row. Actions are Edit only — no delete endpoint exists. */
export function renderArchetypeRow(a, usage) {
  const inactive = a.status === 'inactive';
  return `
    <tr class="border-b border-gray-100 ${inactive ? 'opacity-60' : ''}" data-id="${escapeHtml(a.id)}">
      <td class="py-2 w-6 text-gray-500">${renderIcon(a.icon, { size: 18 })}</td>
      <td class="py-2 font-medium text-gray-900">${escapeHtml(a.label)}</td>
      <td class="py-2 text-gray-500 font-mono text-xs">${escapeHtml(a.id)}</td>
      <td class="py-2">${swatch(a.color)} <span class="text-xs text-gray-400 font-mono">${escapeHtml(a.color)}</span></td>
      <td class="py-2 text-xs text-gray-500">${(a.characteristics ?? []).length} / ${(a.ai_opportunities ?? []).length}</td>
      <td class="py-2">${renderUsageCell(usage, a.id)}</td>
      <td class="py-2 text-xs">${inactive ? '<span class="text-gray-500">inactive</span>' : '<span class="text-green-700">active</span>'}</td>
      <td class="py-2">
        <button class="edit-archetype-btn text-xs text-plum-600 hover:text-plum-700">Edit</button>
      </td>
    </tr>`;
}

export function renderArchetypeTable(archetypes, usage) {
  if (!archetypes.length) {
    return '<p class="text-sm text-gray-400">No archetypes yet. Add one above.</p>';
  }
  return `
    ${renderUsageUnavailableNotice(usage)}
    <table class="admin-table w-full text-sm border-collapse">
      <thead><tr class="text-left text-xs text-gray-500 border-b border-gray-200">
        <th class="pb-2 font-medium"></th>
        <th class="pb-2 font-medium">Label</th>
        <th class="pb-2 font-medium">Id</th>
        <th class="pb-2 font-medium">Color</th>
        <th class="pb-2 font-medium" title="Characteristics / AI opportunities">Lists</th>
        <th class="pb-2 font-medium" title="Programs referencing this archetype">Programs</th>
        <th class="pb-2 font-medium">Status</th>
        <th class="pb-2 font-medium">Actions</th>
      </tr></thead>
      <tbody>${archetypes.map((a) => renderArchetypeRow(a, usage)).join('')}</tbody>
    </table>
    ${renderOrphanNotice(usage, 'archetype')}`;
}

/**
 * The icon control is a menu of rendered icons, not a text input — which is what
 * makes an off-menu value unreachable from the UI. The API validates it too; this
 * is the affordance, not the boundary.
 */
export function renderIconPicker(selected) {
  const options = ARCHETYPE_ICON_NAMES.map((name) => `
    <label class="cursor-pointer" title="${escapeHtml(name)}">
      <input type="radio" name="arch-icon" value="${escapeHtml(name)}" class="sr-only peer"
        ${name === selected ? 'checked' : ''} />
      <span class="flex items-center justify-center w-9 h-9 rounded border border-gray-200 text-gray-600
        peer-checked:border-plum-500 peer-checked:text-plum-700 peer-checked:bg-plum-50 hover:bg-gray-50">
        ${renderIcon(name, { size: 18 })}
      </span>
    </label>`).join('');

  return `
    <div>
      <label class="text-xs text-gray-600 block mb-1">Icon *</label>
      <div id="arch-icon-picker" class="flex flex-wrap gap-1.5">${options}</div>
    </div>`;
}

export function renderArchetypeForm(a = {}) {
  return `
    <h3 class="text-sm font-semibold text-gray-700 mb-3" id="arch-form-title">
      ${a.id ? 'Edit Archetype' : 'Add Archetype'}
    </h3>
    <input type="hidden" id="arch-edit-id" value="${escapeHtml(a.id ?? '')}" />
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs text-gray-600 block mb-1">Label *</label>
        <input id="arch-label" type="text" value="${escapeHtml(a.label ?? '')}"
          class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
      <div>
        <label class="text-xs text-gray-600 block mb-1">Id *</label>
        <input id="arch-id" type="text" value="${escapeHtml(a.id ?? '')}" ${a.id ? 'disabled' : ''}
          placeholder="product-team"
          class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
    </div>
    <div class="mb-3">
      <label class="text-xs text-gray-600 block mb-1">Description</label>
      <textarea id="arch-description" rows="2"
        class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300">${escapeHtml(a.description ?? '')}</textarea>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs text-gray-600 block mb-1">Color *</label>
        <div class="flex items-center gap-2">
          <input id="arch-color" type="color" value="${escapeHtml(a.color ?? '#651A94')}"
            class="h-8 w-12 border border-gray-200 rounded p-0.5" />
          <span id="arch-color-preview" class="text-xs font-mono text-gray-500">${escapeHtml(a.color ?? '#651A94')}</span>
        </div>
      </div>
      ${renderIconPicker(a.icon)}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      ${renderListEditor('characteristics', a.characteristics ?? [], { label: 'Characteristics', placeholder: 'Cross-functional…' })}
      ${renderListEditor('ai_opportunities', a.ai_opportunities ?? [], { label: 'AI opportunities', placeholder: 'Rapid prototyping…' })}
    </div>
    <div class="flex items-center gap-2">
      <button id="arch-save" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700">Save</button>
      <button id="arch-cancel" class="px-3 py-1.5 text-xs text-gray-600 rounded hover:bg-gray-100">Cancel</button>
      ${a.id ? `<button id="arch-status" class="ml-auto px-3 py-1.5 text-xs text-gray-600 rounded hover:bg-gray-100">
        ${a.status === 'inactive' ? 'Reactivate' : 'Deactivate'}</button>` : ''}
      <span id="arch-error" class="text-xs text-red-600"></span>
    </div>`;
}

export async function load(panel, ctx) {
  const { records } = await fetchApi(ENDPOINT);
  const archetypes = [...records].sort((a, b) => a.label.localeCompare(b.label));
  // A usage failure must not take the whole tab down — the counts are advisory,
  // the records are the point.
  const usage = await fetchApi('/project-reference-usage/archetype').catch(() => ({
    available: false,
    reason: 'Reference counts could not be loaded.',
  }));

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-gray-700 m-0">Delivery Archetypes</h2>
      <button id="add-archetype-btn" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700">+ Add Archetype</button>
    </div>
    <div id="archetype-list">${renderArchetypeTable(archetypes, usage)}</div>
    <div id="archetype-form" class="hidden mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg"></div>`;

  const formEl = panel.querySelector('#archetype-form');
  // Held outside the DOM so reordering a list does not lose in-progress typing.
  let draft = {};

  function openForm(record = {}) {
    draft = {
      ...record,
      characteristics: record.characteristics ?? [],
      ai_opportunities: record.ai_opportunities ?? [],
    };
    formEl.innerHTML = renderArchetypeForm(draft);
    formEl.classList.remove('hidden');
    wireForm();
  }

  function closeForm() {
    formEl.classList.add('hidden');
    formEl.innerHTML = '';
  }

  function wireForm() {
    for (const field of ['characteristics', 'ai_opportunities']) {
      const root = formEl.querySelector(`[data-le-root="${field}"]`);
      bindListEditor(root, {
        getItems: () => draft[field],
        setItems: (next) => (draft[field] = next),
        rerender: () => {
          // Re-render only this editor, preserving the rest of the form's state.
          const label = field === 'characteristics' ? 'Characteristics' : 'AI opportunities';
          root.outerHTML = renderListEditor(field, draft[field], { label });
          wireForm();
        },
      });
    }

    const color = formEl.querySelector('#arch-color');
    color?.addEventListener('input', () => {
      formEl.querySelector('#arch-color-preview').textContent = color.value;
    });

    formEl.querySelector('#arch-cancel')?.addEventListener('click', closeForm);
    formEl.querySelector('#arch-save')?.addEventListener('click', save);
    formEl.querySelector('#arch-status')?.addEventListener('click', toggleStatus);
  }

  function readForm() {
    const read = (sel) => formEl.querySelector(sel)?.value ?? '';
    return {
      id: read('#arch-edit-id') || read('#arch-id'),
      label: read('#arch-label'),
      description: read('#arch-description'),
      color: read('#arch-color'),
      icon: formEl.querySelector('input[name="arch-icon"]:checked')?.value ?? '',
      characteristics: compact(readListEditor(formEl.querySelector('[data-le-root="characteristics"]'))),
      ai_opportunities: compact(readListEditor(formEl.querySelector('[data-le-root="ai_opportunities"]'))),
    };
  }

  async function save() {
    const errorEl = formEl.querySelector('#arch-error');
    errorEl.textContent = '';
    const body = readForm();
    const editing = Boolean(formEl.querySelector('#arch-edit-id').value);
    try {
      if (editing) await apiPut(`${ENDPOINT}/${encodeURIComponent(body.id)}`, body);
      else await apiPost(ENDPOINT, body);
      ctx.reloadTab('archetypes');
    } catch (err) {
      // Leave the form populated — a rejected save must not cost the input.
      errorEl.textContent = err.message;
    }
  }

  async function toggleStatus() {
    const id = formEl.querySelector('#arch-edit-id').value;
    const next = draft.status === 'inactive' ? 'active' : 'inactive';
    const errorEl = formEl.querySelector('#arch-error');
    try {
      await apiPut(`${ENDPOINT}/${encodeURIComponent(id)}/status`, { status: next });
      ctx.reloadTab('archetypes');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  panel.querySelector('#add-archetype-btn').addEventListener('click', () => openForm());
  panel.querySelectorAll('.edit-archetype-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openForm(archetypes.find((a) => a.id === id));
    });
  });
}
