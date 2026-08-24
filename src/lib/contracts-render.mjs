// Rendering for the Contract Explorer.
//
// Kept out of src/lib/render.mjs, which is entirely skills/plugins markup — these
// share only escapeHtml. A separate module also keeps these functions unit-testable
// without pulling the skills renderers into every contracts test.

import { escapeHtml, truncate } from './render.mjs';

/** Matches the initiative card's blurb budget — the two cards sit in the same grid. */
const BLURB_LIMIT = 180;

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
    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase text-gray-900"
    style="background-color: ${escapeHtml(posture.color)}"
  >${escapeHtml(posture.id)}</span>`;
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
      ${escapeHtml(truncate(contract.client_policy_summary, BLURB_LIMIT))}
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
 * shown as written, including a literal "N/A" — that is the answer someone typed
 * into the survey, and rewriting it would hide what the record actually says.
 *
 * Renderers that build markup take a blank value themselves rather than being
 * skipped, so a field can still show a fixed link beside an absent answer.
 */
const plain = (value) => (isBlank(value) ? NONE_LISTED : escapeHtml(value));

/**
 * A row in the two-column details grid.
 *
 * Every field renders, blank or not. Dropping empty rows made the grid a different
 * shape on every record, and left a reader unable to tell "the survey has no answer
 * here" from "this page does not show that field". An unanswered field is a fact
 * about the survey's coverage — 82 of 119 records are unclassified — so it is said.
 */
const row = (label, value, render = plain) => rowShell(label, render(value));

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

/** Nava's own AI tool use policy — one page, the same for every contract. */
const NAVA_POLICY_URL = `${CONFLUENCE_SPACES}NH/pages/763494410/AI+Tool+Use+Policy`;

/**
 * The survey's answer about a program-specific Nava policy, followed by the policy.
 *
 * The answer is usually a bare "Yes" or "No", which tells a reader a policy exists
 * without telling them where. The link is a fixed destination rather than anything
 * the sheet supplies, so it is appended rather than substituted — the survey's
 * answer is still what the record says, and the link is what to read next.
 *
 * It is appended to an unanswered row too. The policy exists whether or not this
 * survey row mentions it, and a reader who sees only "None listed" would conclude
 * there is nothing to read.
 */
function renderNavaPolicy(value) {
  return `${plain(value)}
    <a href="${NAVA_POLICY_URL}" target="_blank" rel="noopener noreferrer"
      class="block mt-1 text-plum-700 underline">Open policy</a>`;
}

/**
 * A field that gets the full width of the page rather than a grid cell.
 *
 * The survey's narrative answers run to sentences and paragraphs. In the two-column
 * grid a long answer wraps to a tall thin column and drags its neighbour's row
 * height with it, so a one-line value beside a six-line one reads as a layout bug.
 * These rows are also rule-separated: without a divider, consecutive multiline
 * values run together and the label is the only cue that a new field started.
 *
 * Blank values render as "None listed", on the same reasoning as `row`.
 */
const stackedRow = (label, value, render = plain) => `<div class="py-3 first:pt-0 last:pb-0">
     <dt class="text-xs text-gray-400">${escapeHtml(label)}</dt>
     <dd class="text-sm text-gray-800 mt-1 m-0 whitespace-pre-line">${render(value)}</dd>
   </div>`;

/**
 * A survey-sourced URL, linked only when it is one.
 *
 * The value reaches us as free text a human typed into a spreadsheet cell, so it is
 * as often "N/A", "see attached", or a bare `docs.google.com/...` as it is a real
 * URL. Two rules follow:
 *
 * - Only http and https are linked. Interpolating an arbitrary scheme into an href
 *   makes `javascript:` a stored XSS vector, and a sheet any Nava staffer can edit
 *   is not a trusted source. Anything else renders as the plain text it is.
 * - A scheme-less host is linked as https rather than dropped, because relative
 *   hrefs would resolve against /contracts/<id> and 404 on our own site.
 *
 * The link text stays the value the sheet holds, so a reader can see where it goes.
 */
function renderPolicyLink(value) {
  if (isBlank(value)) return NONE_LISTED;
  const raw = String(value).trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return escapeHtml(value);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return escapeHtml(value);
  // A cell holding prose that happens to start with a word and a dot is not a link.
  if (/\s/.test(raw)) return escapeHtml(value);

  return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer"
    class="text-plum-700 underline break-all">${escapeHtml(raw)}</a>`;
}

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
      <h3 class="text-sm font-semibold text-gray-900 m-0">${escapeHtml(posture.label)}</h3>
      ${steps
        // `list-decimal` is required, not decorative: Tailwind's preflight resets
        // ol to list-style:none, so an unclassed <ol> renders the guidance as an
        // unnumbered stack and loses the order the steps are meant to be done in.
        ? `<ol class="list-decimal mt-3 mb-0 pl-5 space-y-1.5 marker:text-gray-500">${steps}</ol>`
        : ''}
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
    <h3 class="text-sm font-semibold text-gray-900 m-0">No AI posture recorded yet</h3>
    <p class="text-xs text-gray-500 mt-1 m-0">
      The AI-use survey has not been completed. What the contract
      itself says is below — treat it as the source, not as guidance.
    </p>
    ${named}
    ${raw}
  </section>`;
}

/**
 * The words to say when a client asks whether Nava uses AI.
 *
 * Authored copy, identical on every contract — nothing here comes from the survey.
 * It reads as a script rather than as guidance because that is the point: someone
 * on a client call needs a sentence they can say, not a policy to interpret.
 *
 * Dark panel and gold accent set it apart from the surveyed fields around it, so
 * a reader can tell at a glance that this is Nava's language and not the contract's.
 * The accents use `nava-gold`, the brand gold registered under @theme in
 * src/styles/main.css. Type is the page's own Inter: the panel already reads as
 * separate on colour and scale alone, and a second typeface made it read as
 * pasted in from another site.
 */
const CLIENT_ASK_SCRIPT = `<section aria-label="If the client asks about AI use"
  class="rounded-lg p-6 bg-gray-900">
  <p class="text-xs font-semibold uppercase tracking-widest text-nava-gold m-0">
    If the client asks about AI use
  </p>
  <h3 class="text-xl font-bold text-white mt-3 mb-4">
    Say this &mdash; word for word if it helps:
  </h3>
  <blockquote class="border-l-2 border-nava-gold pl-4 m-0">
    <p class="text-lg text-white leading-relaxed m-0">
      &ldquo;Yes, Nava uses AI-assisted tools in a controlled manner to support internal
      development and drafting workflows. These tools are not used with agency or
      sensitive data, and all outputs are reviewed and validated by the team prior to
      use.&rdquo;
    </p>
  </blockquote>
</section>`;

/**
 * What to confirm before opening an AI tool on this contract.
 *
 * Authored copy, identical on every record, like CLIENT_ASK_SCRIPT.
 *
 * The first line is the load-bearing one: every item below it is conditional on AI
 * being allowed at all, and a reader who skips straight to the list could work
 * through six satisfied checks on a contract that permits none of it.
 *
 * Rendered as a plain list rather than checkboxes. Real checkboxes would invite a
 * reader to tick them, and nothing here persists — a checklist that forgets what you
 * confirmed is worse than one that never claimed to remember.
 */
const PRE_USE_CHECKLIST_ITEMS = [
  'No client or sensitive data (PII, PHI, FTI, or regulated data) is included in my prompt.',
  'The tool I&rsquo;m using is approved or not restricted by the contract or client policy.',
  'My output will be reviewed and validated by a human before use in a deliverable.',
  'I can clearly explain my AI use if asked by the client or a colleague.',
  'I am not skipping any disclosure requirement that applies to this contract.',
  'If this contract has a formal approval process, I have followed it (or will before '
    + 'expanding use).',
];

const PRE_USE_CHECKLIST = `<section aria-label="Pre-use checklist"
  class="rounded-lg p-4 border border-gray-200 bg-white">
  <h3 class="text-sm font-semibold text-gray-900 m-0">Pre-use checklist</h3>
  <p class="text-sm text-gray-700 mt-2 mb-0">
    Always confirm that AI use is allowed on your project. If AI is allowed, you also
    need to confirm the following items before opening or using an AI tool.
  </p>
  <ul class="list-disc mt-3 mb-0 pl-5 space-y-1.5 marker:text-gray-400">
    ${PRE_USE_CHECKLIST_ITEMS.map((item) => `<li class="text-sm text-gray-800">${item}</li>`).join('')}
  </ul>
</section>`;

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
    return `<section aria-label="Project overview" class="rounded-lg p-4 border border-amber-200 bg-amber-50">
      <h3 class="text-sm font-semibold text-amber-900 m-0">No matching project</h3>
      <p class="text-xs text-amber-900 mt-1 m-0">
        ${contract.project_name
          ? `This record names <code>${escapeHtml(contract.project_name)}</code>, which matches no project on file.`
          : 'This record has not been matched to a project.'}
        The posture does not depend on the link.
      </p>
    </section>`;
  }

  const p = contract.resolved_project;
  return `<section aria-label="Project overview" class="rounded-lg p-4 border border-gray-200 bg-white">
    <h3 class="text-sm font-semibold text-gray-900 m-0 mb-3">Project overview</h3>
    <dl class="grid grid-cols-2 gap-3 m-0">
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
  ['Vehicle', 'vehicle_fullname'],
  ['Customer', 'customer'],
  ['Subcontractors', 'subcontractors'],
  ['Nava project manager', 'nava_project_mgr'],
  ['Nava program manager', 'nava_program_mgr'],
  ['AI tools used', 'tools'],
];

/**
 * Fields whose values are prose, given a section and a full-width row each.
 *
 * Split from DETAIL_FIELDS because these are answers, not attributes: the survey
 * records them as free text and several routinely run to multiple paragraphs. The
 * short attributes above stay in the two-column grid, where a scanning reader can
 * take in eight of them at once.
 *
 * The optional third element renders the value; it defaults to escaped plain text.
 */
const NARRATIVE_FIELDS = [
  ['Client AI policy (summary)', 'client_policy_summary'],
  ['Client AI policy', 'client_policy'],
  ['Client AI policy link', 'client_policy_link', renderPolicyLink],
  ['Nava program AI policy', 'nava_policy', renderNavaPolicy],
  ['AI used in performance', 'ai_used'],
  ['How AI is used', 'usage'],
  ['Agency review process', 'review_process'],
  ['Notes', 'notes'],
];

/**
 * A titled band of related sections.
 *
 * The page carries 7 sections, and read as one flat stack a reader could not tell
 * which of them answer "what am I allowed to do" from which merely describe the
 * contract. The group heading is the only cue, so it is a real `h2` with the
 * sections' own headings demoted to `h3` beneath it: a screen-reader user
 * navigating by heading gets the same 3 groups a sighted reader sees.
 *
 * Blank members are dropped rather than rendered empty, since `clause` and the
 * posture fallback both render to '' on some records.
 */
function group(title, sections) {
  const body = sections.filter((s) => s && s.trim()).join('');
  if (!body) return '';
  return `<section aria-label="${escapeHtml(title)}">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500 m-0 mb-2 px-1">${escapeHtml(title)}</h2>
    <div class="space-y-4">${body}</div>
  </section>`;
}

export function renderContractDetail(contract, postureById, capturedAt) {
  const posture = postureById?.get(contract.posture_id) ?? null;
  const fields = DETAIL_FIELDS
    .map(([label, key, render]) => row(label, contract[key], render)).join('');
  const narrative = NARRATIVE_FIELDS
    .map(([label, key, render]) => stackedRow(label, contract[key], render)).join('');

  // The clause text runs to multiple paragraphs. Open by default because the exact
  // contract language is the thing readers come here for, and a collapsed
  // disclosure hides it behind a click. Still a <details> so it can be collapsed
  // when it crowds out the guidance group below it.
  const clause = contract.ai_use_terms_language
    ? `<details open class="rounded-lg border border-gray-200 bg-white p-4">
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
      <div class="flex items-center flex-wrap gap-2">
        <span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
          ${escapeHtml(contract.portfolio ?? '')}
        </span>
        ${renderPostureBadge(posture)}
      </div>
      <h1 class="text-2xl font-bold text-gray-900 mt-2 mb-1">${escapeHtml(contract.project || contract.contract_id)}</h1>
      ${contract.contract_num
        ? `<p class="text-sm text-gray-500 m-0">
             Under contract <code class="text-xs">${escapeHtml(contract.contract_num)}</code>
           </p>`
        : ''}
      ${termsDetail}
    </div>

    <!-- Groups in the order a reader needs them: what the contract permits, then
         what to do about it, then who and what the contract covers. The project and
         contract attributes come last because a reader who opened this page already
         knows which contract they are on. -->
    <div class="space-y-6">
      ${group('AI policy', [
        // Both sections render unconditionally: every field in them now renders, so
        // every record shows the same shape and the same set of labels.
        `<section aria-label="Policy and AI use" class="rounded-lg p-4 border border-gray-200 bg-white">
          <h3 class="text-sm font-semibold text-gray-900 m-0 mb-1">Policy and AI use</h3>
          <dl class="divide-y divide-gray-100 m-0">${narrative}</dl>
        </section>`,
        clause,
      ])}

      ${group('Guidance for team members', [
        renderPostureSection(contract, posture),
        PRE_USE_CHECKLIST,
        CLIENT_ASK_SCRIPT,
      ])}

      ${group('Project information', [
        renderProjectSection(contract),
        `<section aria-label="Contract details" class="rounded-lg p-4 border border-gray-200 bg-white">
          <h3 class="text-sm font-semibold text-gray-900 m-0 mb-3">Contract details</h3>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">${fields}</dl>
        </section>`,
      ])}
    </div>

    <p class="text-xs text-gray-400 mt-6 m-0">
      Data captured from the AI-use survey on ${escapeHtml(formatCapturedAt(capturedAt))}.
      It is not live — re-run the population script to refresh it.
    </p>`;
}
