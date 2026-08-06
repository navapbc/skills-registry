import { escapeHtml } from '../../lib/render.mjs';

// An ordered-list editor shared by the archetypes tab (characteristics, AI
// opportunities) and the policy guidance tab (posture steps).
//
// Reordering is a first-class action here, not an afterthought: on the policy
// tab the order of guidance steps is what a team follows in sequence. It is also
// keyboard-operable by construction — explicit move controls, no drag required —
// because drag-only reordering would put list order out of reach for keyboard
// and screen-reader users.
//
// The list operations below are pure so they can be tested without a DOM; the
// render and bind helpers are the thin layer over them.

/** Returns a new list with the item at `index` moved one place earlier. */
export function moveUp(items, index) {
  if (index <= 0 || index >= items.length) return items.slice();
  const next = items.slice();
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

/** Returns a new list with the item at `index` moved one place later. */
export function moveDown(items, index) {
  if (index < 0 || index >= items.length - 1) return items.slice();
  const next = items.slice();
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

/** Returns a new list without the item at `index`. */
export function removeAt(items, index) {
  if (index < 0 || index >= items.length) return items.slice();
  return items.filter((_, i) => i !== index);
}

/** Returns a new list with `value` appended. */
export function append(items, value = '') {
  return [...items, value];
}

/**
 * Drops blank entries and trims the rest.
 *
 * The API rejects an empty entry outright — a blank guidance step would render as
 * a blank instruction — so an untouched "add" row must not be submitted as one.
 */
export function compact(items) {
  return items.map((v) => v.trim()).filter((v) => v !== '');
}

/**
 * Renders the editor markup for one list.
 *
 * `name` namespaces the data attributes so two editors can coexist in one form.
 */
export function renderListEditor(name, items, { label, placeholder = '' } = {}) {
  const rows = items
    .map((value, i) => {
      const first = i === 0;
      const last = i === items.length - 1;
      return `
      <li class="flex items-start gap-1" data-le-row="${i}">
        <span class="text-xs text-gray-400 w-5 pt-2 text-right select-none">${i + 1}</span>
        <input
          type="text"
          data-le-input="${i}"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          class="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-plum-300"
        />
        <button type="button" data-le-up="${i}" ${first ? 'disabled' : ''}
          aria-label="Move ${escapeHtml(label ?? name)} item ${i + 1} up"
          class="px-1.5 py-1 text-xs text-gray-500 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">↑</button>
        <button type="button" data-le-down="${i}" ${last ? 'disabled' : ''}
          aria-label="Move ${escapeHtml(label ?? name)} item ${i + 1} down"
          class="px-1.5 py-1 text-xs text-gray-500 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">↓</button>
        <button type="button" data-le-remove="${i}"
          aria-label="Remove ${escapeHtml(label ?? name)} item ${i + 1}"
          class="px-1.5 py-1 text-xs text-red-500 rounded hover:bg-red-50">✕</button>
      </li>`;
    })
    .join('');

  return `
    <div data-le-root="${escapeHtml(name)}">
      ${label ? `<label class="text-xs text-gray-600 block mb-1">${escapeHtml(label)}</label>` : ''}
      <ul class="flex flex-col gap-1 list-none p-0 m-0">${rows}</ul>
      <button type="button" data-le-add
        class="mt-1 px-2 py-1 text-xs text-plum-700 rounded hover:bg-plum-50">+ add</button>
    </div>`;
}

/** Reads the current values out of a rendered editor, in display order. */
export function readListEditor(root) {
  return [...root.querySelectorAll('[data-le-input]')].map((el) => el.value);
}

/**
 * Wires the editor's controls. `getItems`/`setItems` own the state so the caller
 * can keep several editors in one form object.
 */
export function bindListEditor(root, { getItems, setItems, rerender }) {
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-le-up], [data-le-down], [data-le-remove], [data-le-add]');
    if (!target) return;
    event.preventDefault();

    // Read the inputs before mutating so in-progress typing is not lost.
    const current = readListEditor(root);

    if (target.hasAttribute('data-le-add')) return void rerender(setItems(append(current)));
    const up = target.getAttribute('data-le-up');
    if (up !== null) return void rerender(setItems(moveUp(current, Number(up))));
    const down = target.getAttribute('data-le-down');
    if (down !== null) return void rerender(setItems(moveDown(current, Number(down))));
    const remove = target.getAttribute('data-le-remove');
    if (remove !== null) return void rerender(setItems(removeAt(current, Number(remove))));
  });

  return () => getItems();
}
