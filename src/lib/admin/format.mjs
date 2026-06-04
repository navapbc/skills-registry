import { escapeHtml } from '../render.mjs';

export const SKILL_CATEGORIES = [
  { id: '', label: '— none —' },
  { id: 'writing-comms', label: 'Writing & Comms' },
  { id: 'research-analysis', label: 'Research & Analysis' },
  { id: 'planning', label: 'Planning' },
  { id: 'dev-code', label: 'Dev & Code' },
  { id: 'ops-automation', label: 'Ops & Automation' },
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
