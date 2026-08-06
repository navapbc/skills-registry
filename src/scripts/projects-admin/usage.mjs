import { escapeHtml } from '../../lib/render.mjs';

// Program-reference counts, shared by both tabs.
//
// The distinction that matters: "no programs reference this" and "we don't know
// how many programs reference this" must not look the same. A zero would read as
// safe to deactivate for a record that may have many references, so the unknown
// case renders as an em-dash with an explanation rather than a number.

export const UNAVAILABLE_LABEL = 'Not yet available';

/** One table cell's worth of reference count. */
export function renderUsageCell(usage, id) {
  if (!usage?.available) {
    return `<span class="text-xs text-gray-400" title="${escapeHtml(
      usage?.reason ?? UNAVAILABLE_LABEL
    )}">—</span>`;
  }
  const count = usage.counts?.[id] ?? 0;
  const cls = count === 0 ? 'text-gray-400' : 'text-gray-700';
  return `<span class="text-xs ${cls}">${count}</span>`;
}

/**
 * The inverse direction: values the upstream sheet emits that match no record
 * here. This is the one a naive implementation forgets, and it is how drift
 * between the sheet and this table becomes visible instead of silent.
 */
export function renderOrphanNotice(usage, entityLabel) {
  if (!usage?.available || !usage.orphans?.length) return '';
  const rows = usage.orphans
    .map(
      (o) =>
        `<li><code class="text-xs">${escapeHtml(o.value)}</code> — ${o.count} program${
          o.count === 1 ? '' : 's'
        }</li>`
    )
    .join('');
  return `
    <div class="mt-3 p-3 border border-amber-200 bg-amber-50 rounded">
      <p class="text-xs font-semibold text-amber-900 m-0">
        Program data references ${entityLabel} values that do not exist here
      </p>
      <ul class="text-xs text-amber-900 mt-1 mb-0 pl-4">${rows}</ul>
    </div>`;
}

/** Banner explaining why counts are blank, shown once per tab. */
export function renderUsageUnavailableNotice(usage) {
  if (usage?.available) return '';
  return `<p class="text-xs text-gray-500 mb-3">${escapeHtml(
    usage?.reason ?? UNAVAILABLE_LABEL
  )} Reference counts show — until it is.</p>`;
}
