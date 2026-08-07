// Inline SVG markup for the Tabler icons used by category tiles and headers.
// Kept as a small hand-maintained map (not a dependency) so the SSR string
// render layer can embed icons directly with no build/bundle step.
//
// Icons are the Tabler outline set (MIT, v3.46.0). Stroke uses `currentColor`, so
// the caller controls color via a text-color class or inline style.
//
// The map has two consumers: category tiles (CATEGORIES.icon) and the archetype
// icon picker on /projects-admin (ARCHETYPE_ICON_NAMES below). Extend it when
// either needs a name it does not already contain — that is a deliberate code
// change, since `renderIcon` returns '' for an unknown name and a stored icon
// pointing at a missing entry would silently render nothing.

// Inner <path> markup per icon name (viewBox 0 0 24 24).
const ICON_PATHS = {
  'file-text':
    '<path d="M14 3v4a1 1 0 0 0 1 1h4" />' +
    '<path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />' +
    '<path d="M9 9l1 0" /><path d="M9 13l6 0" /><path d="M9 17l6 0" />',
  search:
    '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />' +
    '<path d="M21 21l-6 -6" />',
  'calendar-check':
    '<path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4" />' +
    '<path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" />' +
    '<path d="M15 19l2 2l4 -4" />',
  code:
    '<path d="M7 8l-4 4l4 4" /><path d="M17 8l4 4l-4 4" /><path d="M14 4l-4 16" />',
  repeat:
    '<path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />' +
    '<path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />',

  // ── Archetype icons ──────────────────────────────────────────────────────
  users:
    '<path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />' +
    '<path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />' +
    '<path d="M16 3.13a4 4 0 0 1 0 7.75" />' +
    '<path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />',
  server:
    '<path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2" />' +
    '<path d="M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2" />' +
    '<path d="M7 8l0 .01" /><path d="M7 16l0 .01" />',
  database:
    '<path d="M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" />' +
    '<path d="M4 6v6a8 3 0 0 0 16 0v-6" />' +
    '<path d="M4 12v6a8 3 0 0 0 16 0v-6" />',
  settings:
    '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" />' +
    '<path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />',
  bulb:
    '<path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" />' +
    '<path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" />' +
    '<path d="M9.7 17l4.6 0" />',
  building:
    '<path d="M3 21l18 0" />' +
    '<path d="M9 8l1 0" /><path d="M9 12l1 0" /><path d="M9 16l1 0" />' +
    '<path d="M14 8l1 0" /><path d="M14 12l1 0" /><path d="M14 16l1 0" />' +
    '<path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />',
  'shield-check':
    '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" />' +
    '<path d="M15 19l2 2l4 -4" />',
  'chart-bar':
    '<path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6" />' +
    '<path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10" />' +
    '<path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14" />' +
    '<path d="M4 20h14" />',
  world:
    '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />' +
    '<path d="M3.6 9h16.8" /><path d="M3.6 15h16.8" />' +
    '<path d="M11.5 3a17 17 0 0 0 0 18" />' +
    '<path d="M12.5 3a17 17 0 0 1 0 18" />',
  briefcase:
    '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9" />' +
    '<path d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" />' +
    '<path d="M12 12l0 .01" />' +
    '<path d="M3 13a20 20 0 0 0 18 0" />',
  rocket:
    '<path d="M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3" />' +
    '<path d="M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3" />' +
    '<path d="M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
  puzzle:
    '<path d="M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1" />',
};

// The closed menu offered by the archetype icon picker on /projects-admin.
// Every name here must resolve to markup in ICON_PATHS above; the parity test in
// tests/project-icons-parity.test.mjs enforces that, and also enforces that this
// list matches its mirror in functions/api/lib/project-reference.mjs. The mirror
// exists because the API Lambda zip is built from functions/api/ alone and cannot
// import this module at runtime — the same constraint categories already solved.
export const ARCHETYPE_ICON_NAMES = [
  'users',
  'server',
  'database',
  'settings',
  'bulb',
  'building',
  'shield-check',
  'chart-bar',
  'world',
  'briefcase',
  'rocket',
  'puzzle',
];

// Render an inline SVG for `name`. Returns '' for an unknown name (never throws).
// opts.size sets width/height (px); opts.className adds classes to the <svg>.
export function renderIcon(name, { size = 24, className = '' } = {}) {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}><path stroke="none" d="M0 0h24v24H0z" fill="none" />${paths}</svg>`;
}
