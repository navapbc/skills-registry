// Inline SVG markup for the Tabler icons used by category tiles and headers.
// Kept as a small hand-maintained map (not a dependency) so the SSR string
// render layer can embed icons directly with no build/bundle step.
//
// Icons are the Tabler outline set (MIT). Stroke uses `currentColor`, so the
// caller controls color via a text-color class or inline style. Only the names
// referenced by CATEGORIES.icon are included; extend this map when adding a new
// category icon.

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
};

// Render an inline SVG for `name`. Returns '' for an unknown name (never throws).
// opts.size sets width/height (px); opts.className adds classes to the <svg>.
export function renderIcon(name, { size = 24, className = '' } = {}) {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}><path stroke="none" d="M0 0h24v24H0z" fill="none" />${paths}</svg>`;
}
