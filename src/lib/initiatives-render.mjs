// Rendering for the Initiatives Hub.
//
// Kept out of src/lib/contracts-render.mjs, which is entirely contract markup —
// these share only escapeHtml. A separate module also keeps these functions
// unit-testable without pulling the contracts renderers into every initiatives
// test.

import { escapeHtml } from './render.mjs';

// The sheet's multi-value separator is `;`. Measured: `people` and `links` both
// use it, and no cell uses a comma as a separator. A comma is accepted anyway
// because a hand-edited sheet will eventually contain one, and written as a
// character class so a third separator is a one-line change — the same shape as
// splitArchetypeCell in functions/api/lib/projects.mjs.
const SEPARATOR = /[;,]/;

/**
 * Split a multi-value cell into the individual values it names.
 *
 * Returns strings with surrounding whitespace removed and empties dropped, so
 * `internal; live` yields two values and a cell of only separators yields none.
 */
export function splitList(value) {
  return String(value ?? '')
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const lower = (value) => String(value ?? '').trim().toLowerCase();

/** Does a multi-value cell contain this value? */
const listHas = (cell, wanted) => splitList(cell).some((v) => lower(v) === lower(wanted));

/**
 * Narrow an initiative set.
 *
 * There is deliberately NO hidden-by-default filter here. The Contract Explorer
 * hides unclassified contracts because 82 of its 119 records carry no posture,
 * making the landing view mostly unanswered. Nothing here is comparably empty:
 * every initiative has a title, a use case, an exposure, and a tag. So all 37
 * render by default and there is no unclassified toggle to copy across.
 *
 * All three facets match by CONTAINMENT rather than equality, even though all
 * three are single-valued in the sheet today. If an editor writes `live; proto`
 * into a tags cell, containment starts working; equality would silently drop that
 * row out of every facet including its own.
 */
export function filterInitiatives(initiatives, {
  useCaseLabel = 'all',
  exposure = 'all',
  tag = 'all',
  query = '',
} = {}) {
  const q = lower(query);
  return (initiatives ?? []).filter((i) => {
    if (useCaseLabel !== 'all' && !listHas(i.use_case_label, useCaseLabel)) return false;
    if (exposure !== 'all' && !listHas(i.exposure, exposure)) return false;
    if (tag !== 'all' && !listHas(i.tags, tag)) return false;
    if (q) {
      // `people` is in the haystack because searching for a colleague's name is one
      // of the obvious ways someone arrives here.
      const haystack = [
        i.title, i.desc, i.use_case_label, i.use_case_theme, i.people, i.tags,
        i.project_name, i.resolved_project?.project_name,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Distinct values of a multi-value field, in a stable order, for a filter control. */
function facetOf(initiatives, field) {
  const seen = new Map();
  for (const initiative of initiatives ?? []) {
    for (const value of splitList(initiative?.[field])) {
      // Keyed on the folded form so `Client` and `client` are one option, but the
      // label kept is the first spelling the data used.
      if (!seen.has(lower(value))) seen.set(lower(value), value);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export const useCaseLabelsOf = (initiatives) => facetOf(initiatives, 'use_case_label');
export const exposuresOf = (initiatives) => facetOf(initiatives, 'exposure');
export const tagsOf = (initiatives) => facetOf(initiatives, 'tags');

/**
 * The API path the page should fetch, given the id in the URL (empty for the grid).
 *
 * A function rather than a ternary inlined in the page because the branch is
 * load-bearing and the page has no test seam: `?id=` is what makes the API read the
 * contracts partition, and a regression that appends it unconditionally would make
 * every hub landing view pay for a read it never uses — silently, since the grid
 * renders identically either way.
 */
export function initiativesApiPath(initiativeId) {
  const id = String(initiativeId ?? '').trim();
  return id ? `/initiatives?id=${encodeURIComponent(id)}` : '/initiatives';
}

export function formatCapturedAt(iso) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * A notice about the sync run, shown only when there is something to say.
 *
 * The API reports three states. Rendering only the date would make a half-written
 * table read as a normal capture and a never-populated one read as "Captured
 * unknown" beside an empty grid.
 */
export function describePopulationNotice(population) {
  const state = population?.state;
  if (state === 'never_populated') {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 m-0">
      No initiatives have been synced for this environment yet.
    </p>`;
  }
  if (state === 'in_progress') {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 m-0">
      A sync run did not finish, so this data may be incomplete.
    </p>`;
  }
  return `<p class="text-xs text-gray-400 mt-1 m-0">
    Captured ${escapeHtml(formatCapturedAt(population?.captured_at ?? null))}.
  </p>`;
}

/**
 * Exposure badge classes, as COMPLETE LITERAL strings.
 *
 * Never assembled at runtime from the value. Tailwind generates classes at build
 * time by scanning source text, so a class name built by interpolation emits no
 * CSS and the badge renders blank — the same constraint that governs posture
 * colours on the Contract Explorer and archetype colours on /projects-admin.
 * Writing each class out in full is what makes the build see them.
 *
 * The four keys are the values measured in the sheet. The fallback is not
 * decorative: the sheet can gain a fifth exposure without a deploy, and an
 * unstyled badge is better than an invisible one.
 *
 * Only palettes already in use elsewhere in src/ are used here — plum and gray
 * come from the project theme in src/styles/main.css, and blue, green, and amber
 * from Tailwind's defaults. Note that `navy` is NOT available: main.css defines
 * --navy-900 as a raw variable but never registers it under @theme, so
 * `bg-navy-100` would emit no CSS and render a blank badge.
 */
const EXPOSURE_CLASSES = {
  client: 'bg-plum-100 text-plum-800',
  internal: 'bg-gray-100 text-gray-700',
  infra: 'bg-blue-100 text-blue-800',
  learning: 'bg-green-100 text-green-800',
};
const EXPOSURE_FALLBACK = 'bg-gray-100 text-gray-700';

export function renderExposureBadge(exposure) {
  const value = String(exposure ?? '').trim();
  if (value === '') {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Exposure not recorded
    </span>`;
  }
  const classes = EXPOSURE_CLASSES[lower(value)] ?? EXPOSURE_FALLBACK;
  return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase ${classes}">${escapeHtml(value)}</span>`;
}

const rowShell = (label, body) => `<div class="flex flex-col gap-0.5">
     <dt class="text-xs text-gray-400">${escapeHtml(label)}</dt>
     <dd class="text-sm text-gray-800 m-0 whitespace-pre-line">${body}</dd>
   </div>`;

/** Styled unlike a real value, so an absent answer never reads as one. */
const NONE_LISTED = '<span class="text-gray-400 italic">None listed</span>';

const isBlank = (value) => !value || !String(value).trim();

/**
 * The default renderer for any field: the value as written, or "None listed".
 *
 * Only a genuinely empty cell becomes the placeholder. Whatever the sheet holds is
 * shown as written — including a free-text status like `Fall 2025 – present`,
 * which is never parsed as a date. That is the answer someone typed, and
 * reformatting it would hide what the record actually says.
 */
const plain = (value) => (isBlank(value) ? NONE_LISTED : escapeHtml(value));

/**
 * A row in the two-column details grid.
 *
 * Every field renders, blank or not. Dropping empty rows makes the grid a
 * different shape on every record and leaves a reader unable to tell "the sheet
 * has no answer here" from "this page does not show that field".
 */
const row = (label, value, render = plain) => rowShell(label, render(value));

/**
 * A field that gets the full width of the page rather than a grid cell.
 *
 * The sheet's narrative answers run to sentences and paragraphs. In the two-column
 * grid a long answer wraps to a tall thin column and drags its neighbour's row
 * height with it. These rows are also rule-separated: without a divider,
 * consecutive multiline values run together and the label is the only cue that a
 * new field started.
 */
const stackedRow = (label, value, render = plain) => `<div class="py-3 first:pt-0 last:pb-0">
     <dt class="text-xs text-gray-400">${escapeHtml(label)}</dt>
     <dd class="text-sm text-gray-800 mt-1 m-0 whitespace-pre-line">${render(value)}</dd>
   </div>`;

/** A semicolon-separated cell as a list, so eight names do not read as one string. */
function renderNameList(value) {
  const names = splitList(value);
  if (names.length === 0) return NONE_LISTED;
  return `<ul class="list-none p-0 m-0 space-y-0.5">
    ${names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
  </ul>`;
}

/**
 * Turn one `Label: URL` part into an anchor, or return null if it is not one.
 *
 * The label itself can contain a colon, so the split is on the LAST colon that
 * begins something URL-shaped rather than the first colon in the string.
 */
function parseLinkPart(part) {
  const match = part.match(/^(.*?):\s*((?:https?:\/\/|www\.)\S+)$/i);
  if (match) return { label: match[1].trim(), href: match[2].trim() };
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(part)) return { label: '', href: part };
  return null;
}

/**
 * A sheet-authored URL, linked only when it is one.
 *
 * The value reaches us as free text a human typed into a spreadsheet cell, so:
 *
 * - Only http and https are linked. Interpolating an arbitrary scheme into an href
 *   makes `javascript:` a stored XSS vector, and a sheet any Nava staffer can edit
 *   is not a trusted source. Anything else renders as the plain text it is.
 * - A scheme-less host is linked as https rather than dropped, because a relative
 *   href would resolve against /initiatives/<id> and 404 on our own site.
 *
 * A part that does not parse into label-plus-URL renders as the text it is rather
 * than being dropped: 26 of 37 rows carry links, and losing one silently is worse
 * than showing it unlinked.
 */
function renderOneLink({ label, href }) {
  const raw = href.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return escapeHtml(label ? `${label}: ${raw}` : raw);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return escapeHtml(label ? `${label}: ${raw}` : raw);
  }

  const text = label || raw;
  return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer"
    class="text-plum-700 underline break-words">${escapeHtml(text)}</a>`;
}

export function renderLinks(value) {
  if (isBlank(value)) return NONE_LISTED;

  // Split on semicolons only. A comma appears INSIDE real URLs and inside link
  // labels, so splitting on it here would tear a link in half.
  const parts = String(value).split(';').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return NONE_LISTED;

  return `<ul class="list-none p-0 m-0 space-y-1">
    ${parts.map((part) => {
      const parsed = parseLinkPart(part);
      return `<li>${parsed ? renderOneLink(parsed) : escapeHtml(part)}</li>`;
    }).join('')}
  </ul>`;
}

const CONFLUENCE_SPACES = 'https://navasage.atlassian.net/wiki/spaces/';

/**
 * The project name, linked to its Confluence space when the space key is known.
 *
 * The key is `project_index_code` on the resolved project. Not every project has
 * one, and a link built from a missing key would point at `/wiki/spaces/` — a page
 * that exists and is wrong, which is worse than no link. So the name renders as
 * plain text unless there is a key to link it to.
 */
function renderProjectNameLink(name, spaceKey) {
  if (isBlank(name) || isBlank(spaceKey)) return plain(name);
  const href = CONFLUENCE_SPACES + encodeURIComponent(spaceKey.trim());
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
    class="text-plum-700 underline">${escapeHtml(name)}</a>`;
}

/**
 * One card per initiative.
 *
 * Titles run to 91 characters, so the heading gets its own line clamp rather than
 * assuming two lines will always do.
 */
export function renderInitiativeCard(initiative) {
  const projectName = initiative.resolved_project?.project_name || initiative.project_name || '';
  const subtitle = projectName
    ? `<p class="text-xs text-gray-400 m-0 mt-1">${escapeHtml(projectName)}</p>`
    : '';
  const tags = splitList(initiative.tags);
  const tagBadge = tags.length
    ? `<span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">${escapeHtml(tags[0])}</span>`
    : '';

  return `<a
    href="/initiatives/${encodeURIComponent(initiative.initiative_id)}"
    class="initiative-card flex flex-col h-full bg-white border border-gray-200 rounded-lg p-4 no-underline hover:border-plum-300 transition-colors"
  >
    <div class="flex items-start justify-between gap-2 mb-2">
      ${tagBadge}
      ${renderExposureBadge(initiative.exposure)}
    </div>
    <h3 class="text-sm font-semibold text-gray-900 m-0 leading-snug line-clamp-3">
      ${escapeHtml(initiative.title || initiative.initiative_id)}
    </h3>
    ${subtitle}
    <p class="text-xs text-gray-500 mt-2 mb-0 line-clamp-3 flex-1">
      ${escapeHtml((initiative.desc ?? '').slice(0, 180))}
    </p>
  </a>`;
}

export function renderInitiativeGrid(initiatives) {
  if (!initiatives?.length) {
    return '<p class="text-sm text-gray-400 italic">No initiatives matched.</p>';
  }
  return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    ${initiatives.map((i) => `<div class="h-full">${renderInitiativeCard(i)}</div>`).join('')}
  </div>`;
}

/**
 * The resolved project, when the initiative links to one.
 *
 * Two managers can appear here, so neither is labelled just "Program manager": the
 * project's own (`program_manager`) and the contracts-side one
 * (`nava_contract_pp`, whose sheet header names no role a reader would recognise).
 * They are often different people, and identical labels would read as a
 * contradiction rather than as two facts. Same treatment as the Contract detail
 * page.
 *
 * The unresolved case needs TWO messages, because the causes have different owners
 * and together they are 14 of 37 records:
 *
 *   - No project stated — normal. 14 rows, and plenty of initiatives are genuinely
 *     internal. An amber panel here would cry wolf on 38% of the page.
 *   - A project stated that matches nothing — real drift someone should fix in the
 *     sheet. Zero rows today, and the sync now fails on it, so this should be rare
 *     — but it is reachable between a sheet edit and the next sync, which is
 *     exactly when a reader needs telling.
 */
export function renderProjectSection(initiative) {
  if (!initiative.resolved_project) {
    if (isBlank(initiative.project_name)) {
      return `<section aria-label="Project" class="rounded-lg p-4 border border-gray-200 bg-white">
        <h2 class="text-sm font-semibold text-gray-900 m-0">Not linked to a project</h2>
        <p class="text-xs text-gray-500 mt-1 m-0">
          This initiative names no project. Plenty are internal, so this is not
          necessarily missing information.
        </p>
      </section>`;
    }
    return `<section aria-label="Project" class="rounded-lg p-4 border border-amber-200 bg-amber-50">
      <h2 class="text-sm font-semibold text-amber-900 m-0">No matching project</h2>
      <p class="text-xs text-amber-900 mt-1 m-0">
        This initiative names <code>${escapeHtml(initiative.project_name)}</code>, which matches
        no project on file. Fix the name in the sheet, or check whether the project exists
        under a different one.
      </p>
    </section>`;
  }

  const p = initiative.resolved_project;
  return `<section aria-label="Project" class="rounded-lg p-4 border border-gray-200 bg-white">
    <h2 class="text-sm font-semibold text-gray-900 m-0 mb-3">Project</h2>
    <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">
      ${row('Project', p.project_name, (v) => renderProjectNameLink(v, p.project_index_code))}
      ${row('Portfolio', p.portfolio)}
      ${row('Agency', p.agency)}
      ${row('Project program manager', p.program_manager)}
      ${row('Contracts program manager', p.nava_contract_pp)}
      ${row('Archetype', p.archetype_primary)}
      ${row('Additional archetype', p.archetype_additional)}
    </dl>
  </section>`;
}

/**
 * The secondary line under a contract's name: the facts that tell two contracts on
 * the same project apart.
 *
 * Empty values are dropped rather than rendered as "None listed". This is a link
 * list, not the details grid — the same-shape-every-record argument that makes the
 * grid render its blanks does not apply, and a row of bare separators would be
 * noise between a reader and the link they came for.
 */
function contractMeta(contract) {
  return [contract.contract_num, contract.vehicle, contract.customer]
    .map((v) => String(v ?? '').trim())
    .filter((v) => v !== '')
    .join(' · ');
}

/**
 * One contract as a link to its Contract Explorer page.
 *
 * The display name is `project || contract_id`, the same expression
 * renderContractCard uses, so a contract reads the same way on both pages.
 *
 * No `target="_blank"` here, unlike renderOneLink: these are our own pages, and the
 * external-link treatment exists for sheet-authored URLs we do not control.
 */
function renderRelatedContract(contract) {
  const href = `/contracts/${encodeURIComponent(contract.contract_id)}`;
  const name = contract.project || contract.contract_id;
  const meta = contractMeta(contract);
  return `<li>
    <a href="${escapeHtml(href)}" class="text-plum-700 underline break-words">${escapeHtml(name)}</a>
    ${meta ? `<span class="block text-xs text-gray-500">${escapeHtml(meta)}</span>` : ''}
  </li>`;
}

/**
 * The contracts on this initiative's project, when the API was asked for them.
 *
 * Three states, and the difference between the first two is the whole reason the
 * API distinguishes an absent field from an empty array:
 *
 *   - ABSENT — not asked for. The grid view never requests the join, and neither does
 *     a detail request for an initiative with no resolved project. Renders nothing; a
 *     "no contracts" panel here would answer a question nobody asked and imply the
 *     project has none.
 *   - NULL — asked, and the read failed. Says exactly that. Rendering the empty-state
 *     copy here would report an absence the failed read never established, which is
 *     the same overclaim in a costlier place: during an incident, when someone is
 *     most likely to act on it.
 *   - EMPTY — asked, and no contract on file names this project. Says so, because a
 *     silently missing section is indistinguishable from a page that does not show
 *     contracts at all.
 *   - non-empty — the list.
 *
 * The empty-state wording is deliberate and was measured. Only 43 of 119 contracts
 * carry a project name at all, so "this project has no contracts" would be a false
 * claim on most empty results — the common cause is a survey row that never recorded
 * one, or a name written differently on each side. Both have happened: the Emmy
 * contract read `EMMY (IVaaS)` against a project record spelling it three other ways
 * and resolved to nothing until the sheet was corrected on 2026-08-11. The copy says
 * no contract NAMES the project, which is what the join established.
 */
export function renderRelatedContractsSection(initiative) {
  const contracts = initiative?.related_contracts;
  if (contracts === undefined) return '';

  const note = (text) => `<p class="text-sm text-gray-400 italic mt-1 m-0">${text}</p>`;

  let body;
  if (contracts === null) {
    body = note('Contracts could not be loaded.');
  } else if (!Array.isArray(contracts)) {
    // Defensive: a shape the API does not produce. Treated as "nothing to say"
    // rather than rendered, so a malformed payload cannot assert an absence.
    return '';
  } else if (contracts.length === 0) {
    body = note('No contract on file names this project.');
  } else {
    body = `<ul class="list-none p-0 m-0 space-y-2">
        ${contracts.map(renderRelatedContract).join('')}
      </ul>`;
  }

  return `<section aria-label="Contracts" class="rounded-lg p-4 border border-gray-200 bg-white">
    <h2 class="text-sm font-semibold text-gray-900 m-0 mb-2">Contracts on this project</h2>
    ${body}
  </section>`;
}

/**
 * Fields shown on the detail page, in reading order.
 *
 * An explicit list rather than iterating the record: the sheet gains columns, and a
 * new one should be a deliberate addition to this page rather than appearing
 * unlabelled the moment someone edits the sheet.
 */
const DETAIL_FIELDS = [
  ['Use case', 'use_case_label'],
  ['Exposure', 'exposure'],
  ['Tags', 'tags'],
  ['Status', 'status'],
  ['People', 'people', renderNameList],
];

/**
 * Fields whose values are prose or lists, given a full-width row each.
 *
 * Split from DETAIL_FIELDS because these are answers, not attributes: the sheet
 * records them as free text and several run to multiple sentences.
 */
const NARRATIVE_FIELDS = [
  ['Description', 'desc'],
  ['Use case theme', 'use_case_theme'],
  ['Links', 'links', renderLinks],
];

export function renderInitiativeDetail(initiative, capturedAt) {
  const fields = DETAIL_FIELDS
    .map(([label, key, render]) => row(label, initiative[key], render)).join('');
  const narrative = NARRATIVE_FIELDS
    .map(([label, key, render]) => stackedRow(label, initiative[key], render)).join('');
  const tags = splitList(initiative.tags);

  return `
    <a href="/initiatives" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">&larr; All initiatives</a>

    <div class="mb-5">
      <div class="flex items-center flex-wrap gap-2">
        ${tags.map((t) => `<span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">${escapeHtml(t)}</span>`).join('')}
        ${renderExposureBadge(initiative.exposure)}
      </div>
      <h1 class="text-2xl font-bold text-gray-900 mt-2 mb-1">${escapeHtml(initiative.title || initiative.initiative_id)}</h1>
    </div>

    <div class="space-y-4">
      <!-- Both sections render unconditionally, and every field in them renders
           blank or not, so every record shows the same shape and the same labels. -->
      <section aria-label="Details" class="rounded-lg p-4 border border-gray-200 bg-white">
        <h2 class="text-sm font-semibold text-gray-900 m-0 mb-3">Details</h2>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">${fields}</dl>
      </section>

      <section aria-label="About" class="rounded-lg p-4 border border-gray-200 bg-white">
        <h2 class="text-sm font-semibold text-gray-900 m-0 mb-1">About</h2>
        <dl class="divide-y divide-gray-100 m-0">${narrative}</dl>
      </section>

      ${renderProjectSection(initiative)}

      <!-- Follows the Project section deliberately: it answers the question the
           Project section raises, and it renders nothing at all unless that section
           resolved a project to join on. -->
      ${renderRelatedContractsSection(initiative)}
    </div>

    <p class="text-xs text-gray-400 mt-6 m-0">
      Data captured from the initiatives sheet on ${escapeHtml(formatCapturedAt(capturedAt))}.
      It is not live — re-run the sync workflow to refresh it.
    </p>`;
}
