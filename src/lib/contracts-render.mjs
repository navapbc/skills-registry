// Rendering for the Contract Explorer.
//
// Kept out of src/lib/render.mjs, which is entirely skills/plugins markup — these
// share only escapeHtml. A separate module also keeps these functions unit-testable
// without pulling the skills renderers into every contracts test.
//
// Every survey value renders exactly as the sheet holds it. Nothing here derives a
// ruling or any other text from a cell.

import { escapeHtml, truncate } from './render.mjs';

/** Matches the initiative card's blurb budget — the two cards sit in the same grid. */
const BLURB_LIMIT = 180;

/**
 * The five AI rulings, in the order the rulings list shows them.
 *
 * Authored copy, identical on every contract. The ids match AI_RULINGS in
 * functions/api/lib/contracts.mjs, and a test holds the two lists equal.
 *
 * The fills are Nava brand colours where one exists (`nava-gold` for restricted,
 * `navy-900` for silent) and the design's own values otherwise. They are applied as
 * INLINE STYLES, not interpolated Tailwind classes: those are generated at build
 * time from source text, so a class name assembled at runtime emits no CSS.
 * Contrast of `text` on `fill` is at least 7:1 for every ruling.
 */
export const RULINGS = [
  {
    id: 'allowed',
    name: 'Allowed',
    definition: 'This means the contract allows us to use AI. See below for more information and practical guidance.',
    fill: '#17412d',
    text: '#ffffff',
  },
  {
    id: 'restricted',
    name: 'Restricted',
    definition: 'This means the contract allows us to use AI, but the contract or client has stated restrictions the team must observe.',
    fill: '#f8b712',
    text: '#111827',
  },
  {
    id: 'silent',
    name: 'Silent',
    definition: "This means the contract doesn't give any guidance on how we use AI. See below for how.",
    fill: '#0a0539',
    text: '#ffffff',
  },
  {
    id: 'prohibited',
    name: 'Prohibited',
    definition: 'You cannot use AI on this contract.',
    fill: '#a12a34',
    text: '#ffffff',
  },
  {
    id: 'conditional',
    name: 'Conditional',
    definition: 'This means permission to use AI likely depends on the contract vehicle or clause within the contract, such as the relevant task order.',
    fill: '#80377d',
    text: '#ffffff',
  },
];

const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The ruling a contract's AI use terms (column L) name, or null.
 *
 * Only a cell that is exactly a ruling name ("Allowed") matches. A cell carrying
 * more ("Allowed, disclosure required") matches nothing and renders as the text it
 * is, because reading a ruling out of free text is a guess this page must not make.
 */
export function rulingOf(contract) {
  const value = normalize(contract?.ai_use_terms);
  return RULINGS.find((r) => r.id === value) ?? null;
}

/** A coloured ruling badge carrying `label`, which is the sheet's text where one exists. */
function rulingBadge(ruling, label, size = 'text-xs') {
  return `<span
    class="inline-flex items-center px-2 py-0.5 rounded ${size} font-medium"
    style="background-color: ${ruling.fill}; color: ${ruling.text}"
  >${escapeHtml(label)}</span>`;
}

/** Index postures by id so callers resolve without rescanning the list. */
export function indexPostures(postures) {
  return new Map((postures ?? []).map((p) => [p.id, p]));
}

/**
 * Narrow a contract set by portfolio and free-text search.
 *
 * The search covers the AI use terms, so "allowed" finds every contract whose
 * column L mentions it, not only the few whose cell is the bare ruling name.
 */
export function filterContracts(contracts, { portfolio = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return (contracts ?? []).filter((c) => {
    if (portfolio !== 'all' && c.portfolio !== portfolio) return false;
    if (q) {
      const haystack = [c.project, c.portfolio, c.contract_num, c.customer, c.ai_use_terms]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
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
  return `<p class="text-xs text-gray-600 mt-1 m-0">
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
 * The card shows its contract number as a parent where one exists. One contract
 * number spans many rows in the current data — without the number visible, those
 * read as duplicates. The blurb is the AI use terms as written, so the card states
 * what the contract says about AI even when the cell is not a bare ruling name.
 */
export function renderContractCard(contract) {
  const ruling = rulingOf(contract);
  const parent = contract.contract_num
    ? `<p class="text-xs text-gray-600 m-0 mt-1">
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
      ${ruling ? rulingBadge(ruling, contract.ai_use_terms.trim()) : ''}
    </div>
    <h3 class="text-sm font-semibold text-gray-900 m-0 leading-snug">
      ${escapeHtml(contract.project || contract.contract_id)}
    </h3>
    ${parent}
    <p class="text-xs text-gray-600 mt-2 mb-0 line-clamp-3 flex-1">
      ${ruling ? '' : escapeHtml(truncate(contract.ai_use_terms, BLURB_LIMIT))}
    </p>
  </a>`;
}

export function renderContractGrid(contracts) {
  if (!contracts?.length) {
    return '<p class="text-sm text-gray-600 italic">No contracts matched.</p>';
  }
  return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    ${contracts.map((c) => `<div class="h-full">${renderContractCard(c)}</div>`).join('')}
  </div>`;
}

/** Styled unlike a real value, so an absent answer never reads as one. */
const NONE_LISTED = '<span class="text-gray-600 italic">None listed</span>';

const isBlank = (value) => !value || !String(value).trim();

/**
 * A survey value as written, or "None listed".
 *
 * Only a genuinely empty cell becomes the placeholder. Whatever the sheet holds is
 * shown as written, including a literal "N/A" — that is the answer someone typed
 * into the survey, and rewriting it would hide what the record actually says.
 */
const plain = (value) => (isBlank(value) ? NONE_LISTED : escapeHtml(String(value).trim()));

const CONFLUENCE_SPACES = 'https://navasage.atlassian.net/wiki/spaces/';

/**
 * The link to the project's index on Sage, or '' when the space key is unknown.
 *
 * The key is `project_index_code` on the resolved project. Not every contract
 * resolves to a project and not every project has a key, and a link built from a
 * missing key would point at `/wiki/spaces/` — a page that exists and is wrong,
 * which is worse than no link.
 */
function renderSageLink(project) {
  const key = project?.project_index_code;
  if (isBlank(key)) return '';
  const href = CONFLUENCE_SPACES + encodeURIComponent(key.trim());
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
    class="block mt-2 text-xs font-semibold text-plum-700 underline">For full program details, check out the project index on Sage.</a>`;
}

/**
 * What the contract says about AI use, from column L.
 *
 * A cell that is exactly a ruling name renders as that ruling's badge. Any other
 * cell renders as its text, unstyled by any ruling, so a reader is never shown a
 * colour the contracts team did not record.
 */
function renderAiUseTerms(contract) {
  const ruling = rulingOf(contract);
  if (ruling) return rulingBadge(ruling, contract.ai_use_terms.trim(), 'text-sm');
  return `<p class="text-sm text-gray-900 m-0 whitespace-pre-line">${plain(contract.ai_use_terms)}</p>`;
}

/**
 * The survey's answers, one card each, in the design's order.
 *
 * The questions are the page's wording for each column rather than the sheet's
 * headers, which are instructions to the person filling the survey in.
 */
const GUIDANCE_QUESTIONS = [
  ["Does this client have an AI policy that isn't necessarily referenced in the program's contract with Nava?", 'client_policy'],
  ['Is AI in use on this contract?', 'ai_used'],
  ['What AI tools are in use?', 'tools'],
  ['How are people on this program using AI?', 'usage'],
  ['Does the client have a process to review or approve AI use or AI tools?', 'review_process'],
];

const questionCard = (question, value) => `<div class="rounded-lg border border-gray-200 bg-white p-5">
    <h3 class="text-sm font-semibold text-gray-900 m-0">${escapeHtml(question)}</h3>
    <p class="text-sm text-gray-800 mt-2 mb-0 whitespace-pre-line">${plain(value)}</p>
  </div>`;

/**
 * The words to say when a client asks whether Nava uses AI.
 *
 * Authored copy, identical on every contract — nothing here comes from the survey.
 * It reads as a script rather than as guidance because that is the point: someone
 * on a client call needs a sentence they can say, not a policy to interpret.
 *
 * Styled as an INFORMATIONAL alert, following the structure USWDS and the CMS
 * Design System use: a solid left bar, a pale fill, and a short uppercase label
 * naming the alert type in words. Info rather than warning because this content
 * is reassurance to relay, not a risk to weigh — the yellow warning treatment is
 * reserved for the posture panel, which is the part of this page that can tell a
 * reader to stop.
 *
 * This replaced a solid gray-900 panel. The dark fill separated the block from the
 * surveyed fields around it, which is worth keeping, so the separation now comes
 * from the tinted fill and the bar instead — same job, at the weight the rest of
 * the page is built at. The label is what actually classifies the block; colour
 * only reinforces it, which is why the bar is allowed to sit below 3:1 (see the
 * --info trio in src/styles/main.css).
 */
const CLIENT_ASK_SCRIPT = `<section aria-label="If the client asks about AI use"
  class="rounded-lg p-6 bg-info-bg flex gap-4">
  <div class="w-1 rounded shrink-0 bg-info" aria-hidden="true"></div>
  <div class="flex-1 min-w-0">
    <p class="text-xs font-semibold uppercase tracking-widest text-info-text m-0">
      If the client asks about AI use
    </p>
    <h3 class="text-xl font-bold text-gray-900 mt-3 mb-4">
      Say this &mdash; word for word if it helps:
    </h3>
    <blockquote class="border-l-2 border-info pl-4 m-0">
      <p class="text-lg text-gray-900 leading-relaxed m-0">
        &ldquo;Yes, Nava uses AI-assisted tools in a controlled manner to support internal
        development and drafting workflows. These tools are not used with agency or
        sensitive data, and all outputs are reviewed and validated by the team prior to
        use.&rdquo;
      </p>
    </blockquote>
  </div>
</section>`;

/**
 * What to confirm before opening an AI tool on this contract.
 *
 * The steps are the guidance of the posture the contract resolves to, which
 * happens only when column L is exactly a posture id. Every other contract gets
 * the authored checklist below, identical on every record.
 *
 * Rendered as a plain list rather than checkboxes. Real checkboxes would invite a
 * reader to tick them, and nothing here persists — a checklist that forgets what you
 * confirmed is worse than one that never claimed to remember.
 */
const PRE_USE_CHECKLIST_ITEMS = [
  'Always confirm that AI use is allowed on your project. Every item below assumes it is.',
  'No client or sensitive data (PII, PHI, FTI, or regulated data) is included in my prompt.',
  'The tool I&rsquo;m using is approved or not restricted by the contract or client policy.',
  'My output will be reviewed and validated by a human before use in a deliverable.',
  'I can clearly explain my AI use if asked by the client or a colleague.',
  'I am not skipping any disclosure requirement that applies to this contract.',
  'If this contract has a formal approval process, I have followed it (or will before '
    + 'expanding use).',
];

function renderPreUseChecklist(posture) {
  const heading = posture ? escapeHtml(posture.label) : 'Pre-use checklist';
  // Posture steps come from stored records, so they are escaped. The authored
  // items above carry HTML entities, so they are not.
  const items = posture
    ? (posture.steps ?? []).map(escapeHtml)
    : PRE_USE_CHECKLIST_ITEMS;

  return `<section aria-label="Pre-use checklist" class="rounded-lg border border-gray-200 bg-white p-5">
    <h3 class="text-sm font-semibold text-gray-900 m-0">Pre-use checklist</h3>
    <p class="text-sm text-gray-800 mt-3 mb-0">
      Before using AI on this contract, review this checklist to ensure you&rsquo;re
      following the right steps and meeting any applicable requirements.
    </p>
    <div class="flex gap-4 mt-5">
      <div class="w-1 rounded shrink-0 bg-info-bg" aria-hidden="true"></div>
      <div class="flex-1 min-w-0">
        <h4 class="text-lg font-semibold text-gray-900 m-0">${heading}</h4>
        <ul class="list-disc mt-2 mb-0 pl-5 space-y-1.5 marker:text-gray-500">
          ${items.map((item) => `<li class="text-sm text-gray-800">${item}</li>`).join('')}
        </ul>
      </div>
    </div>
  </section>`;
}

/** Every ruling with its definition — the target of the "See all" link. */
function renderRulingsList() {
  const rows = RULINGS.map((r) => `<div class="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <dt class="shrink-0 sm:w-28">${rulingBadge(r, r.name, 'text-sm')}</dt>
      <dd class="text-sm text-gray-800 m-0">${escapeHtml(r.definition)}</dd>
    </div>`).join('');
  return `<section id="ai-rulings" aria-labelledby="ai-rulings-heading" class="scroll-mt-6">
    <h2 id="ai-rulings-heading" class="text-base font-semibold text-gray-900 m-0">
      ${RULINGS.length} AI Rulings and Definitions
    </h2>
    <dl class="mt-3 mb-0 rounded-lg border border-gray-200 bg-white p-5 space-y-4">${rows}</dl>
  </section>`;
}

const sectionHeading = (text) => `<h2 class="text-2xl font-bold text-gray-900 m-0">${escapeHtml(text)}</h2>`;

export function renderContractDetail(contract, postureById, capturedAt) {
  const posture = postureById?.get(contract.posture_id) ?? null;

  return `
    <a href="/contracts" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline mb-5 transition-colors">&larr; All contracts</a>

    <header class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-10">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-600 m-0">Contract details</p>
        <span class="inline-block mt-2 px-2 py-0.5 text-sm rounded bg-gray-600 text-white">${escapeHtml(contract.portfolio ?? '')}</span>
        <h1 class="text-xl font-bold text-gray-900 mt-3 mb-0">${escapeHtml(contract.project || contract.contract_id)}</h1>
      </div>
      <div class="text-sm sm:text-right">
        <p class="text-gray-900 m-0">Agency: ${plain(contract.customer)}</p>
        <p class="text-gray-600 mt-1 mb-0">Program manager: <strong class="text-gray-900">${plain(contract.nava_program_mgr)}</strong></p>
        ${renderSageLink(contract.resolved_project)}
      </div>
    </header>

    <div class="space-y-12">
      <section aria-label="What the contract says about AI">
        ${sectionHeading('What the Contract says about AI')}
        <h3 class="text-base font-semibold text-gray-900 mt-6 mb-3">AI use on this contract is:</h3>
        <div>${renderAiUseTerms(contract)}</div>
        <p class="mt-4 mb-0">
          <a href="#ai-rulings" class="text-sm text-plum-700 underline">
            See all ${RULINGS.length} potential AI rulings and their definitions.
          </a>
        </p>

        <h3 class="text-base font-semibold text-gray-900 mt-8 mb-2">Contract language</h3>
        <p class="text-sm text-gray-600 m-0">
          Read the most up-to-date contract language. Nava&rsquo;s contract teams are working
          with program managers on a &ldquo;path to yes&rdquo; for all Nava programs so that all
          delivery teams can use AI when appropriate or necessary.
        </p>
        <div class="mt-4 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 whitespace-pre-line">${plain(contract.ai_use_terms_language)}</div>
        <p class="text-sm font-semibold text-gray-600 mt-6 mb-0">
          Regardless of a contract&rsquo;s AI ruling, keep reading to understand any nuance
          that may apply to this program when it comes to using AI.
        </p>
      </section>

      <section aria-label="Practical guidance and more information">
        ${sectionHeading('Practical guidance and more information')}
        <p class="text-sm text-gray-600 mt-4 mb-0">
          This section provides background and context on AI use and expectations for this
          program or contract. The information below comes from an AI-use survey we asked
          Program Managers to complete to help delivery teams understand a given client&rsquo;s
          AI posture and confidently explore AI capabilities when possible.
        </p>
        <div class="space-y-3 mt-5">
          ${GUIDANCE_QUESTIONS.map(([question, key]) => questionCard(question, contract[key])).join('')}
        </div>
      </section>

      <section aria-label="Resources">
        ${sectionHeading('Resources')}
        <div class="space-y-4 mt-5">
          ${renderPreUseChecklist(posture)}
          ${CLIENT_ASK_SCRIPT}
        </div>
      </section>

      ${renderRulingsList()}
    </div>

    <p class="text-xs text-gray-600 mt-10 m-0">
      Data captured from the AI-use survey on ${escapeHtml(formatCapturedAt(capturedAt))}.
      It is not live — re-run the population script to refresh it.
    </p>`;
}
