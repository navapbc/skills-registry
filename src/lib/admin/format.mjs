import { escapeHtml } from '../render.mjs';

export const SKILL_CATEGORIES = [
  { id: '', label: '— none —' },
  { id: 'personal-productivity', label: 'Personal Productivity' },
  { id: 'research-and-analyze', label: 'Research & Analyze' },
  { id: 'write-and-review', label: 'Write & Review' },
  { id: 'team-automations', label: 'Team Automations' },
  { id: 'build-and-ship', label: 'Build & Ship' },
];

export const COMPAT_OPTIONS = ['claude-code', 'claude-chat', 'claude-cowork', 'cursor', 'github-copilot'];

export function catLabel(cat) {
  const id = Array.isArray(cat) ? (cat[0] ?? '') : (cat ?? '');
  return (SKILL_CATEGORIES.find(c => c.id === id)?.label ?? id) || '—';
}

export function catSelectOptions(currentCat) {
  const id = Array.isArray(currentCat) ? (currentCat[0] ?? '') : (currentCat ?? '');
  return SKILL_CATEGORIES.map(c => `<option value="${escapeHtml(c.id)}" ${id === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
}

export function tagChips(tags) {
  const arr = tags ?? [];
  const shown = arr.slice(0, 3).map(t => `<span class="text-xs bg-gray-100 text-gray-600 rounded px-1 mr-0.5">#${escapeHtml(t)}</span>`).join('');
  const more = arr.length > 3 ? `<span class="text-xs text-gray-400">+${arr.length - 3}</span>` : '';
  return shown + more || '<span class="text-xs text-gray-300 italic">none</span>';
}

export function compatChips(compat) {
  const arr = compat ?? [];
  if (!arr.length) return '<span class="text-xs text-gray-300 italic">none</span>';
  const shown = arr.slice(0, 2).map(c => `<span class="text-xs bg-gray-100 text-gray-600 rounded px-1 mr-0.5">${escapeHtml(c)}</span>`).join('');
  const more = arr.length > 2 ? `<span class="text-xs text-gray-400">+${arr.length - 2}</span>` : '';
  return shown + more;
}

export function relTime(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function actorName(users, uid) {
  return users.find(u => u.user_id === uid)?.name ?? (uid?.split('@')[0] ?? uid ?? '?');
}

// Rolling 28-day window used for user activity segmentation.
export const ACTIVE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

// Partition users into new / returning / dormant using the rolling window.
// Derived from existing fields only: created_at (first visit) and last_seen_at
// (most recent activity). ISO timestamps compare correctly as strings.
//   new       — first seen within the window
//   returning — account older than the window, active within it
//   dormant   — no activity within the window
// active === new + returning (i.e. any activity within the window).
export function userSegments(users, now = Date.now()) {
  const cutoff = new Date(now - ACTIVE_WINDOW_MS).toISOString();
  const seg = { total: 0, new: 0, returning: 0, dormant: 0, active: 0 };
  for (const u of users ?? []) {
    seg.total++;
    const active = (u.last_seen_at ?? '') >= cutoff;
    if (!active) { seg.dormant++; continue; }
    seg.active++;
    if ((u.created_at ?? '') >= cutoff) seg.new++;
    else seg.returning++;
  }
  return seg;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Cumulative count of `items` at the end of each of the last `weeks` weeks,
// derived from a timestamp field (default `created_at`). The last element equals
// the current total, so a sparkline built from this ends at the card's value.
// Items missing the field are assumed to predate the window (counted in every
// bucket) — this keeps the final point aligned with the displayed count.
// Pure: `now` is injectable for tests. ISO timestamps compare correctly as strings.
export function weeklyCumulative(items, { now = Date.now(), weeks = 4, field = 'created_at' } = {}) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const cutoff = new Date(now - i * WEEK_MS).toISOString();
    let count = 0;
    for (const it of items ?? []) {
      const ts = it?.[field];
      if (!ts || String(ts) <= cutoff) count++;
    }
    out.push(count);
  }
  return out;
}

// Render a minimal inline-SVG sparkline from a numeric series. Uses currentColor
// so the caller controls the stroke via a text-* class. Returns '' for series
// too short to plot. `preserveAspectRatio="none"` lets it stretch to the given
// box; a small vertical pad keeps the 1.5px stroke from clipping at the edges.
export function sparkline(values, { width = 64, height = 16, className = '' } = {}) {
  const vals = (values ?? []).map(v => Number(v) || 0);
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pad = 2;
  const stepX = width / (vals.length - 1);
  const points = vals.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * (height - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="${escapeHtml(className)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" preserveAspectRatio="none" aria-hidden="true"><title>Cumulative trend, last ${vals.length} weeks</title><polyline points="${points}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Small hover/focus info icon with an explanatory tooltip, for annotating metric labels.
export function infoTooltip(text) {
  return `<span class="group relative inline-flex align-middle" tabindex="0" aria-label="${escapeHtml(text)}">
      <svg class="w-3 h-3 text-gray-300 group-hover:text-gray-500 group-focus:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 16v-4M12 8h.01"/></svg>
      <span role="tooltip" class="pointer-events-none absolute left-1/2 bottom-full z-10 mb-1 hidden w-52 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-[11px] font-normal normal-case leading-snug text-white shadow-lg group-hover:block group-focus:block">${escapeHtml(text)}</span>
    </span>`;
}
