// Rendering for the Contract Explorer.
//
// Kept out of src/lib/render.mjs, which is entirely skills/plugins markup — these
// share only escapeHtml. A separate module also keeps these functions unit-testable
// without pulling the skills renderers into every contracts test.

import { escapeHtml } from './render.mjs';

/** A record here is one survey row: an engagement under a contract, not a contract. */
// export const UNIT_LABEL = 'Engagement';

/**
 * Posture colours come from the posture records and are applied as INLINE STYLES.
 *
 * Never as interpolated Tailwind classes: those are generated at build time from
 * source text, so a class name assembled at runtime emits no CSS and the badge
 * renders blank. The same constraint governs archetype colours on /projects-admin.
 */
export function renderPostureBadge(posture) {
  if (!posture) {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Posture not recorded
    </span>`;
  }
  return `<span
    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-gray-900"
    style="background-color: ${escapeHtml(posture.color)}"
  >${escapeHtml(posture.label)}</span>`;
}

/** Index postures by id so callers resolve without rescanning the list. */
export function indexPostures(postures) {
  return new Map((postures ?? []).map((p) => [p.id, p]));
}

export const hasPosture = (contract) => Boolean(contract?.posture_id);

/**
 * Narrow a contract set.
 *
 * `includeUnclassified` defaults to false, matching the grid's default view: 82 of
 * 119 contracts carry no posture, so showing everything makes the landing view
 * mostly unanswered. The count of what this hides is surfaced next to the control —
 * hiding without saying so is how someone concludes their contract is not covered.
 */
export function filterContracts(contracts, {
  posture = 'all',
  portfolio = 'all',
  query = '',
  includeUnclassified = false,
} = {}) {
  const q = query.trim().toLowerCase();
  return (contracts ?? []).filter((c) => {
    if (!includeUnclassified && !hasPosture(c)) return false;
    if (posture !== 'all' && c.posture_id !== posture) return false;
    if (portfolio !== 'all' && c.portfolio !== portfolio) return false;
    if (q) {
      const haystack = [c.project, c.portfolio, c.contract_num, c.project_name, c.customer]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * How many contracts the default view is hiding.
 *
 * The posture filter is deliberately NOT applied. Selecting a posture excludes
 * every unclassified contract by definition, so counting under it always yields
 * zero — which would tell a user "nothing is hidden" at the exact moment 82
 * contracts are. The count answers "how many would appear if you cleared the
 * unclassified filter", which is what the control offers to do.
 */
export function countHiddenUnclassified(contracts, { portfolio = 'all', query = '' } = {}) {
  return filterContracts(contracts, { portfolio, query, includeUnclassified: true })
    .filter((c) => !hasPosture(c)).length;
}

/**
 * A notice about the population run, shown only when there is something to say.
 *
 * The API reports three states and the page previously rendered only the date, so
 * a half-written table read as a normal capture and a never-populated one read as
 * "Captured unknown" beside an empty grid.
 */
export function describePopulationNotice(population) {
  const state = population?.state;
  if (state === 'never_populated') {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 m-0">
      No contracts have been populated for this environment yet.
    </p>`;
  }
  if (state === 'in_progress') {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 m-0">
      A population run did not finish, so this data may be incomplete.
    </p>`;
  }
  return `<p class="text-xs text-gray-400 mt-1 m-0">
    Captured ${escapeHtml(formatCapturedAt(population?.captured_at ?? null))}.
  </p>`;
}

/** Distinct portfolios, in a stable order, for the filter control. */
export function portfoliosOf(contracts) {
  return [...new Set((contracts ?? []).map((c) => c.portfolio).filter(Boolean))].sort();
}

export function formatCapturedAt(iso) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * One card per survey row.
 *
 * The card names the record an engagement rather than a contract, and shows its
 * contract number as a parent where one exists. One contract number spans 17 rows
 * in the current data — without the number visible, those read as 17 duplicates.
 */
export function renderContractCard(contract, postureById) {
  const posture = postureById?.get(contract.posture_id) ?? null;
  const parent = contract.contract_num
    ? `<p class="text-xs text-gray-400 m-0 mt-1">
         Contract <code class="text-xs">${escapeHtml(contract.contract_num)}</code>
       </p>`
    : '';

  return `<a
    href="/contracts/${encodeURIComponent(contract.contract_id)}"
    class="contract-card flex flex-col h-full bg-white border border-gray-200 rounded-lg p-4 no-underline hover:border-plum-300 transition-colors"
  >
    <div class="flex items-start justify-between gap-2 mb-2">
      <span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
        ${escapeHtml(contract.portfolio ?? '')}
      </span>
      ${renderPostureBadge(posture)}
    </div>
    <h3 class="text-sm font-semibold text-gray-900 m-0 leading-snug">
      ${escapeHtml(contract.project || contract.contract_id)}
    </h3>
    ${parent}
    <p class="text-xs text-gray-500 mt-2 mb-0 line-clamp-3 flex-1">
      ${escapeHtml((contract.client_policy_summary ?? '').slice(0, 180))}
    </p>
  </a>`;
}

export function renderContractGrid(contracts, postureById) {
  if (!contracts?.length) {
    return '<p class="text-sm text-gray-400 italic">No contracts matched.</p>';
  }
  return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    ${contracts.map((c) => `<div class="h-full">${renderContractCard(c, postureById)}</div>`).join('')}
  </div>`;
}

/**
 * The control that states what the default view is hiding.
 *
 * Rendered even at zero, so "nothing hidden" is distinguishable from "the filter is
 * gone". A user whose contract is unclassified has to be able to find it.
 */
export function renderUnclassifiedToggle(hiddenCount, includeUnclassified, postureFiltered = false) {
  if (hiddenCount === 0 && !includeUnclassified) {
    // Only claim this when nothing else is narrowing the set. Saying "every
    // contract has a posture recorded" while a posture filter is active is a flat
    // falsehood for 82 of 119 records.
    return postureFiltered
      ? ''
      : `<p class="text-xs text-gray-400 m-0">Every contract has a posture recorded.</p>`;
  }
  return `<button
    id="contracts-unclassified-toggle"
    type="button"
    aria-pressed="${includeUnclassified}"
    class="text-xs px-3 py-1.5 rounded-lg border transition-colors ${
      includeUnclassified
        ? 'border-plum-600 bg-plum-600 text-white'
        : 'border-gray-200 text-gray-600 hover:border-plum-300'
    }"
  >${
    includeUnclassified
      ? 'Hide contracts with no posture'
      : `Show ${hiddenCount} contract${hiddenCount === 1 ? '' : 's'} with no posture recorded`
  }</button>`;
}

const row = (label, value) => (value
  ? `<div class="flex flex-col gap-0.5">
       <dt class="text-xs text-gray-400">${escapeHtml(label)}</dt>
       <dd class="text-sm text-gray-800 m-0 whitespace-pre-line">${escapeHtml(value)}</dd>
     </div>`
  : '');

/**
 * The posture region: the answer the page exists to give.
 *
 * Rendered first and never buried. When no posture is recorded this says so plainly
 * and falls back to the survey's own free-text terms, which are populated on every
 * record — so this region is never empty.
 */
function renderPostureSection(contract, posture) {
  if (posture) {
    const steps = (posture.steps ?? [])
      .map((s) => `<li class="text-sm text-gray-800">${escapeHtml(s)}</li>`).join('');
    return `<section aria-label="AI posture" class="rounded-lg p-4 border border-gray-200"
      style="background-color: ${escapeHtml(posture.color)}">
      <h2 class="text-sm font-semibold text-gray-900 m-0">${escapeHtml(posture.label)}</h2>
      ${steps ? `<ol class="mt-3 mb-0 pl-5 space-y-1.5">${steps}</ol>` : ''}
    </section>`;
  }

  const raw = contract.ai_use_terms
    ? `<p class="text-sm text-gray-800 mt-2 mb-0 whitespace-pre-line">${escapeHtml(contract.ai_use_terms)}</p>`
    : '';
  const named = contract.ai_posture
    ? `<p class="text-xs text-red-900 mt-2 m-0">
         The survey records <code>${escapeHtml(contract.ai_posture)}</code>, which matches no posture on file, so no guidance can be shown.
       </p>`
    : '';

  return `<section aria-label="AI posture" class="rounded-lg p-4 border border-gray-200 bg-gray-50">
    <h2 class="text-sm font-semibold text-gray-900 m-0">No AI posture recorded yet</h2>
    <p class="text-xs text-gray-500 mt-1 m-0">
      The AI-use survey has not been completed. What the contract
      itself says is below — treat it as the source, not as guidance.
    </p>
    ${named}
    ${raw}
  </section>`;
}

/**
 * The resolved project, when the engagement links to one.
 *
 * Three managers can appear across this page, so none of them is labelled just
 * "Program manager": the project's own (`program_manager`), the contracts-side one
 * (`nava_contract_pp`, whose sheet header names no role a reader would recognise),
 * and the survey's `nava_program_mgr` in the engagement details below. They are
 * often different people, and identical labels would read as a contradiction
 * rather than as three facts.
 */
function renderProjectSection(contract) {
  if (!contract.resolved_project) {
    return `<section aria-label="Project" class="rounded-lg p-4 border border-amber-200 bg-amber-50">
      <h2 class="text-sm font-semibold text-amber-900 m-0">No matching project</h2>
      <p class="text-xs text-amber-900 mt-1 m-0">
        ${contract.project_name
          ? `This record names <code>${escapeHtml(contract.project_name)}</code>, which matches no project on file.`
          : 'This record has not been matched to a project.'}
        The posture above does not depend on the link.
      </p>
    </section>`;
  }

  const p = contract.resolved_project;
  return `<section aria-label="Project" class="rounded-lg p-4 border border-gray-200 bg-white">
    <h2 class="text-sm font-semibold text-gray-900 m-0 mb-3">Project</h2>
    <dl class="grid grid-cols-2 gap-3 m-0">
      ${row('Project', p.project_name)}
      ${row('Code', p.project_code)}
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
 * Fields shown on the detail page, in reading order.
 *
 * An explicit list rather than iterating the record: the survey gains columns, and
 * a new one should be a deliberate addition to this page rather than appearing
 * unlabelled the moment someone edits the sheet.
 */
const DETAIL_FIELDS = [
  ['Agreement type', 'agreement_type'],
  ['Contract number', 'contract_num'],
  ['Task order', 'task_order'],
  ['Vehicle', 'vehicle'],
  ['Vehicle (full name)', 'vehicle_fullname'],
  ['Customer', 'customer'],
  ['Subcontractors', 'subcontractors'],
  ['Nava project manager', 'nava_project_mgr'],
  ['Nava program manager', 'nava_program_mgr'],
  ['AI used in performance', 'ai_used'],
  ['AI tools used', 'tools'],
  ['How AI is used', 'usage'],
  ['Agency review process', 'review_process'],
  ['Client AI policy', 'client_policy'],
  ['Client AI policy (summary)', 'client_policy_summary'],
  ['Client AI policy link', 'client_policy_link'],
  ['Nava program AI policy', 'nava_policy'],
  ['Notes', 'notes'],
];

export function renderContractDetail(contract, postureById, capturedAt) {
  const posture = postureById?.get(contract.posture_id) ?? null;
  const fields = DETAIL_FIELDS.map(([label, key]) => row(label, contract[key])).join('');

  // The clause text runs to multiple paragraphs. Behind a disclosure so it cannot
  // push the posture answer off-screen, but present and expandable.
  const clause = contract.ai_use_terms_language
    ? `<details class="rounded-lg border border-gray-200 bg-white p-4">
        <summary class="text-sm font-semibold text-gray-900 cursor-pointer">
          Contract AI-use clause language
        </summary>
        <p class="text-sm text-gray-700 mt-3 mb-0 whitespace-pre-line">${escapeHtml(contract.ai_use_terms_language)}</p>
      </details>`
    : '';

  const termsDetail = contract.terms_detail
    ? `<section aria-label="Terms" class="rounded-lg p-4 border border-gray-200 bg-white">
        <h2 class="text-sm font-semibold text-gray-900 m-0 mb-2">Terms</h2>
        <p class="text-sm text-gray-700 m-0 whitespace-pre-line">${escapeHtml(contract.terms_detail)}</p>
      </section>`
    : '';

  return `
    <a href="/contracts" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">&larr; All contracts</a>

    <div class="mb-5">
      <span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
        ${escapeHtml(contract.portfolio ?? '')}
      </span>
      <h1 class="text-2xl font-bold text-gray-900 mt-2 mb-1">${escapeHtml(contract.project || contract.contract_id)}</h1>
      ${contract.contract_num
        ? `<p class="text-sm text-gray-500 m-0">
             Under contract <code class="text-xs">${escapeHtml(contract.contract_num)}</code>
           </p>`
        : ''}
    </div>

    <div class="space-y-4">
      ${fields
        ? `<section aria-label="Details" class="rounded-lg p-4 border border-gray-200 bg-white">
             <h2 class="text-sm font-semibold text-gray-900 m-0 mb-3">Details</h2>
             <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">${fields}</dl>
           </section>`
        : ''}
      ${renderPostureSection(contract, posture)}
      ${termsDetail}
      ${renderProjectSection(contract)}
      ${clause}
    </div>

    <p class="text-xs text-gray-400 mt-6 m-0">
      Data captured from the AI-use survey on ${escapeHtml(formatCapturedAt(capturedAt))}.
      It is not live — re-run the population script to refresh it.
    </p>`;
}
