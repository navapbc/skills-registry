// The archetype badge, shared by the Initiatives detail page and the Archetypes
// tab of /projects-admin. One renderer means the tab previews exactly the badge a
// reader sees.

import { escapeHtml } from './render.mjs';
import { renderIcon } from './icons.mjs';

/**
 * One archetype as a badge: its icon and label, in the archetype's color.
 *
 * The color is edited on the Archetypes tab of /projects-admin and arrives as a
 * six-digit hex, so it is applied as an INLINE STYLE. An interpolated Tailwind
 * class would emit no CSS.
 *
 * The text stays gray-900 and the color goes on the border, the icon, and a 10%
 * tint behind the text (the `1a` alpha suffix). The seeded colors are saturated,
 * and orange `#F37100` or teal `#08A588` as text on white measures under the
 * 4.5:1 WCAG AA minimum. A 10% tint of any hex stays pale enough for gray-900 text.
 *
 * The markup holds no newlines because the Initiatives details grid's `<dd>` sets
 * `whitespace-pre-line`, which would turn each newline into a line break.
 */
export function renderArchetypeBadge(archetype) {
  const color = escapeHtml(archetype.color);
  return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium text-gray-900" style="background-color: ${color}1a; border-color: ${color}"><span class="inline-flex" style="color: ${color}">${renderIcon(archetype.icon, { size: 14 })}</span>${escapeHtml(archetype.label)}</span>`;
}
