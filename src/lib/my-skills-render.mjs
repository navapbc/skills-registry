import { escapeHtml } from './render.mjs';

/**
 * The two card renderers for /my-skills.
 *
 * Extracted from the page's client script so they can be tested. Both build
 * markup that goes straight into `innerHTML`, and the values they interpolate —
 * a skill's name, plugin and description — reach the browser from the registry,
 * which accepts open submissions. Nothing on the write path enforces their
 * shape: `checkFormConstraints` in form-constraints.mjs only warns, and only in
 * the submit form's own preview. So escaping here is the control, not a second
 * layer over one.
 *
 * A favourite or installed entry is also persisted to localStorage, so an
 * unescaped value would re-execute on every later visit rather than once.
 */

const BLURB_LIMIT = 100;

/**
 * Cut a description to the card's blurb length.
 *
 * Truncation happens BEFORE escaping, deliberately. Escaping first would let the
 * cut land inside an entity and emit `&am`, which renders as literal text and
 * loses the character it stood for.
 */
const blurb = (description) => {
  const text = String(description ?? '');
  return text.length > BLURB_LIMIT ? text.slice(0, BLURB_LIMIT) + '...' : text;
};

/**
 * The badge naming an entry's plugin, or marking it as an agent.
 *
 * An agent's badge is a fixed string and carries no interpolation.
 */
const typeTag = (entry) =>
  entry?.type === 'agent'
    ? '<span class="px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">agent</span>'
    : `<span class="px-1.5 py-0.5 text-xs font-medium bg-plum-50 text-plum-700 rounded">${escapeHtml(entry?.plugin ?? '')}</span>`;

/**
 * The path to an entry's detail page.
 *
 * The slug is percent-encoded rather than HTML-escaped: it is a URL segment, and
 * a slug holding `#` or `?` would otherwise truncate the path or turn the rest of
 * it into a fragment. That is a live routing bug on any such slug, separate from
 * injection. Encoding also forecloses a `javascript:` scheme, which escaping
 * alone would not — the fixed prefix already does, but not durably if the prefix
 * ever becomes dynamic. Matches renderContractCard in contracts-render.mjs.
 */
const detailHref = (entry) =>
  `/${entry?.type === 'agent' ? 'agents' : 'skills'}/${encodeURIComponent(entry?.slug ?? '')}`;

/** One card on the Favourites tab. */
export function renderFavoriteCard(fav) {
  return `
        <div class="flex flex-col gap-3 p-4 bg-white border border-amber-200 rounded-lg">
          <div class="flex items-start justify-between gap-2">
            <a href="${escapeHtml(detailHref(fav))}" class="font-semibold text-sm text-gray-900 no-underline hover:text-plum-700">${escapeHtml(fav?.name ?? '')}</a>
            <div class="flex items-center gap-1">${typeTag(fav)}</div>
          </div>
          <p class="text-xs text-gray-500 leading-relaxed m-0 flex-1">${escapeHtml(blurb(fav?.description))}</p>
          <div class="flex items-center justify-between mt-auto pt-1 gap-2">
            <span class="text-xs text-gray-600">${escapeHtml(fav?.plugin ?? '')}</span>
            <button
              class="unfav-btn px-2 py-1 text-xs text-amber-600 border border-amber-200 rounded hover:border-amber-300 hover:text-amber-700 cursor-pointer transition-colors bg-white"
              data-slug="${escapeHtml(fav?.slug ?? '')}"
              aria-label="Remove ${escapeHtml(fav?.name ?? '')} from favorites"
            >★ Remove</button>
          </div>
        </div>
      `;
}

/**
 * One card on the Installed tab.
 *
 * `installedLabel` is passed in rather than computed: the relative time it holds
 * comes from the page's own `timeAgo`, and threading a clock through here would
 * make every test of this function depend on the current date.
 */
export function renderInstalledCard(skill, installedLabel) {
  const cmd = skill?.installCommand || '';
  return `
        <div class="flex flex-col gap-3 p-4 bg-white border border-gray-200 rounded-lg">
          <div class="flex items-start justify-between gap-2">
            <a href="/skills/${encodeURIComponent(skill?.slug ?? '')}" class="font-semibold text-sm text-gray-900 no-underline hover:text-plum-700">${escapeHtml(skill?.name ?? '')}</a>
            ${typeTag(skill)}
          </div>
          <p class="text-xs text-gray-500 leading-relaxed m-0 flex-1">${escapeHtml(blurb(skill?.description))}</p>
          <div class="flex items-center justify-between mt-auto pt-1 gap-2">
            <span class="text-xs text-gray-600">Installed ${escapeHtml(installedLabel ?? '')}</span>
            <div class="flex items-center gap-1.5">
              ${cmd ? `<button
                class="copy-btn px-2 py-1 text-xs font-medium text-plum-600 border border-plum-200 rounded hover:bg-plum-50 cursor-pointer transition-colors bg-white"
                data-copy="${escapeHtml(cmd)}"
              >Copy</button>` : ''}
              <!-- The skill name is in the label, not just "Remove": every card
                   carries one of these buttons, and a screen reader reading the
                   list back needs to know which skill each one removes. The glyph
                   is hidden so the label is the whole accessible name. -->
              <button
                class="remove-btn px-2 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:border-gray-300 hover:text-gray-800 cursor-pointer transition-colors bg-white"
                data-slug="${escapeHtml(skill?.slug ?? '')}"
                aria-label="Remove ${escapeHtml(skill?.name ?? '')} from installed skills"
              ><span aria-hidden="true">✕</span></button>
            </div>
          </div>
        </div>
      `;
}
