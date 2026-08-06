import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPost, apiPut } from '../admin/api.mjs';
import {
  renderListEditor,
  readListEditor,
  bindListEditor,
  compact,
  moveUp,
  moveDown,
} from './list-editor.mjs';
import { renderUsageCell, renderOrphanNotice, renderUsageUnavailableNotice } from './usage.mjs';

const ENDPOINT = '/project-reference/posture';

// A posture's color is its badge *background*, not a hue to blend. The seeded
// values are pale (#fff8e1 and friends), so the archetype treatment — which
// alpha-blends a saturated color over white — would produce a near-white badge
// with unreadable text. Pair the stored background with a fixed dark foreground.
export const BADGE_FOREGROUND = '#1b1b1b';

/**
 * Display order. Ties break on id so the list never reshuffles between renders —
 * two postures sharing a position is possible after a seed against an edited
 * source file, and a nondeterministic order would look like a bug.
 */
export function sortPostures(postures) {
  return [...postures].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Renumbers positions to 1..n from the list's current order and returns only the
 * records whose position actually changed, so a reorder writes the minimum.
 */
export function repositioned(postures) {
  return postures
    .map((p, i) => ({ ...p, position: i + 1 }))
    .filter((p, i) => p.position !== postures[i].position);
}

export function renderPostureBadge(posture) {
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded"
    style="background:${escapeHtml(posture.color)};color:${BADGE_FOREGROUND}">${escapeHtml(posture.label)}</span>`;
}

export function renderPostureRow(posture, index, total, usage) {
  const steps = posture.steps ?? [];
  const inactive = posture.status === 'inactive';
  return `
    <li class="border border-gray-200 rounded mb-2 ${inactive ? 'opacity-60' : ''}" data-id="${escapeHtml(posture.id)}">
      <div class="flex items-center gap-2 px-3 py-2">
        <div class="flex flex-col">
          <button type="button" data-posture-up="${index}" ${index === 0 ? 'disabled' : ''}
            aria-label="Move ${escapeHtml(posture.label)} earlier"
            class="px-1 text-xs text-gray-500 rounded hover:bg-gray-100 disabled:opacity-30">↑</button>
          <button type="button" data-posture-down="${index}" ${index === total - 1 ? 'disabled' : ''}
            aria-label="Move ${escapeHtml(posture.label)} later"
            class="px-1 text-xs text-gray-500 rounded hover:bg-gray-100 disabled:opacity-30">↓</button>
        </div>
        ${renderPostureBadge(posture)}
        <span class="text-xs text-gray-400 font-mono">${escapeHtml(posture.id)}</span>
        <span class="text-xs text-gray-500">${steps.length} step${steps.length === 1 ? '' : 's'}</span>
        <span class="text-xs text-gray-400">·</span>
        <span title="Programs with this posture">${renderUsageCell(usage, posture.id)}</span>
        ${inactive ? '<span class="text-xs text-gray-500">inactive</span>' : ''}
        <button class="edit-posture-btn ml-auto text-xs text-plum-600 hover:text-plum-700">Edit</button>
      </div>
      <ol class="text-sm text-gray-700 px-3 pb-3 pl-10 m-0">
        ${steps.map((s) => `<li class="py-0.5">${escapeHtml(s)}</li>`).join('')
          || '<li class="py-0.5 text-gray-400 list-none">No steps yet.</li>'}
      </ol>
    </li>`;
}

export function renderPostureList(postures, usage) {
  if (!postures.length) {
    return '<p class="text-sm text-gray-400">No postures yet. Add one above.</p>';
  }
  const ordered = sortPostures(postures);
  return `
    ${renderUsageUnavailableNotice(usage)}
    <ul class="list-none p-0 m-0">${ordered
      .map((p, i) => renderPostureRow(p, i, ordered.length, usage))
      .join('')}</ul>
    ${renderOrphanNotice(usage, 'posture')}`;
}

export function renderPostureForm(p = {}) {
  const color = p.color ?? '#e0f5f0';
  return `
    <h3 class="text-sm font-semibold text-gray-700 mb-3">${p.id ? 'Edit Posture' : 'Add Posture'}</h3>
    <input type="hidden" id="posture-edit-id" value="${escapeHtml(p.id ?? '')}" />
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs text-gray-600 block mb-1">Label *</label>
        <input id="posture-label" type="text" value="${escapeHtml(p.label ?? '')}"
          placeholder="AI ALLOWED — how to proceed"
          class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
      <div>
        <label class="text-xs text-gray-600 block mb-1">Id *</label>
        <input id="posture-id" type="text" value="${escapeHtml(p.id ?? '')}" ${p.id ? 'disabled' : ''}
          placeholder="conditional"
          class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-plum-300" />
      </div>
    </div>
    <div class="mb-3">
      <label class="text-xs text-gray-600 block mb-1">Badge color *</label>
      <div class="flex items-center gap-3">
        <input id="posture-color" type="color" value="${escapeHtml(color)}"
          class="h-8 w-12 border border-gray-200 rounded p-0.5" />
        <span class="text-xs font-mono text-gray-500" id="posture-color-value">${escapeHtml(color)}</span>
        <span class="text-xs text-gray-400">Preview:</span>
        <span id="posture-badge-preview">${renderPostureBadge({ ...p, color, label: p.label || 'Posture label' })}</span>
      </div>
      <p class="text-xs text-gray-400 mt-1">
        This is the badge background. Text is always dark, so pick a light color.
      </p>
    </div>
    <div class="mb-3">
      ${renderListEditor('steps', p.steps ?? [], {
        label: 'Guidance steps — order is what a team follows',
        placeholder: 'Never input PII, PHI, or client data…',
      })}
    </div>
    <div class="flex items-center gap-2">
      <button id="posture-save" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700">Save</button>
      <button id="posture-cancel" class="px-3 py-1.5 text-xs text-gray-600 rounded hover:bg-gray-100">Cancel</button>
      ${p.id ? `<button id="posture-status" class="ml-auto px-3 py-1.5 text-xs text-gray-600 rounded hover:bg-gray-100">
        ${p.status === 'inactive' ? 'Reactivate' : 'Deactivate'}</button>` : ''}
      <span id="posture-error" class="text-xs text-red-600"></span>
    </div>`;
}

export async function load(panel, ctx) {
  const { records } = await fetchApi(ENDPOINT);
  let postures = sortPostures(records);
  // Advisory — a failure here must not take the tab down.
  const usage = await fetchApi('/project-reference-usage/posture').catch(() => ({
    available: false,
    reason: 'Reference counts could not be loaded.',
  }));

  function paint() {
    panel.querySelector('#posture-list').innerHTML = renderPostureList(postures, usage);
    wireList();
  }

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-gray-700 m-0">AI Posture Guidance</h2>
      <button id="add-posture-btn" class="px-3 py-1.5 text-xs bg-plum-600 text-white rounded hover:bg-plum-700">+ Add Posture</button>
    </div>
    <p class="text-xs text-gray-500 mb-3">
      Order is display order only — it carries no severity meaning. Reorder with the arrows.
    </p>
    <div id="posture-list">${renderPostureList(postures, usage)}</div>
    <div id="posture-form" class="hidden mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg"></div>`;

  const formEl = panel.querySelector('#posture-form');
  let draft = {};

  // Position is never typed. Moving a row renumbers the affected records and
  // writes only those, so a raw integer is not part of the form's surface.
  async function reorder(next) {
    postures = next;
    paint();
    try {
      for (const record of repositioned(next)) {
        await apiPut(`${ENDPOINT}/${encodeURIComponent(record.id)}`, record);
      }
      ctx.reloadTab('postures');
    } catch (err) {
      panel.querySelector('#posture-list').insertAdjacentHTML(
        'beforebegin',
        `<p class="text-xs text-red-600">Could not save the new order: ${escapeHtml(err.message)}</p>`
      );
    }
  }

  function wireList() {
    panel.querySelectorAll('[data-posture-up]').forEach((btn) => {
      btn.addEventListener('click', () => reorder(moveUp(postures, Number(btn.dataset.postureUp))));
    });
    panel.querySelectorAll('[data-posture-down]').forEach((btn) => {
      btn.addEventListener('click', () => reorder(moveDown(postures, Number(btn.dataset.postureDown))));
    });
    panel.querySelectorAll('.edit-posture-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('li').dataset.id;
        openForm(postures.find((p) => p.id === id));
      });
    });
  }

  function openForm(record = {}) {
    draft = { ...record, steps: record.steps ?? [] };
    formEl.innerHTML = renderPostureForm(draft);
    formEl.classList.remove('hidden');
    wireForm();
  }

  function closeForm() {
    formEl.classList.add('hidden');
    formEl.innerHTML = '';
  }

  function wireForm() {
    const root = formEl.querySelector('[data-le-root="steps"]');
    bindListEditor(root, {
      getItems: () => draft.steps,
      setItems: (next) => (draft.steps = next),
      rerender: () => {
        root.outerHTML = renderListEditor('steps', draft.steps, {
          label: 'Guidance steps — order is what a team follows',
          placeholder: 'Never input PII, PHI, or client data…',
        });
        wireForm();
      },
    });

    const color = formEl.querySelector('#posture-color');
    color?.addEventListener('input', () => {
      formEl.querySelector('#posture-color-value').textContent = color.value;
      formEl.querySelector('#posture-badge-preview').innerHTML = renderPostureBadge({
        color: color.value,
        label: formEl.querySelector('#posture-label').value || 'Posture label',
      });
    });

    formEl.querySelector('#posture-cancel')?.addEventListener('click', closeForm);
    formEl.querySelector('#posture-save')?.addEventListener('click', save);
    formEl.querySelector('#posture-status')?.addEventListener('click', toggleStatus);
  }

  async function save() {
    const errorEl = formEl.querySelector('#posture-error');
    errorEl.textContent = '';
    const editing = Boolean(formEl.querySelector('#posture-edit-id').value);
    const id = formEl.querySelector('#posture-edit-id').value || formEl.querySelector('#posture-id').value;
    const body = {
      id,
      label: formEl.querySelector('#posture-label').value,
      color: formEl.querySelector('#posture-color').value,
      steps: compact(readListEditor(formEl.querySelector('[data-le-root="steps"]'))),
      // A new posture goes last; existing records keep the position they have.
      position: draft.position ?? postures.length + 1,
    };
    try {
      if (editing) await apiPut(`${ENDPOINT}/${encodeURIComponent(id)}`, body);
      else await apiPost(ENDPOINT, body);
      ctx.reloadTab('postures');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  async function toggleStatus() {
    const id = formEl.querySelector('#posture-edit-id').value;
    const next = draft.status === 'inactive' ? 'active' : 'inactive';
    try {
      await apiPut(`${ENDPOINT}/${encodeURIComponent(id)}/status`, { status: next });
      ctx.reloadTab('postures');
    } catch (err) {
      formEl.querySelector('#posture-error').textContent = err.message;
    }
  }

  panel.querySelector('#add-posture-btn').addEventListener('click', () => openForm());
  wireList();
}
