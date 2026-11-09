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
 * The ids match AI_RULINGS in functions/api/lib/contracts.mjs, and a test holds
 * the two lists equal. Colours, definitions, and guidance are not authored here:
 * rulingsFromPostures takes them from the posture records.
 */
export const RULINGS = [
  { id: 'allowed', name: 'Allowed' },
  { id: 'restricted', name: 'Restricted' },
  { id: 'silent', name: 'Silent' },
];

// The badge text colour the Policy Guidance tab previews every posture colour
// against (BADGE_FOREGROUND in src/scripts/projects-admin/postures.mjs). The tab
// tells editors to pick a light colour for that reason.
const BADGE_FOREGROUND = '#1b1b1b';

/**
 * RULINGS, each carrying the posture record with the same id and that record's
 * colour as `fill`.
 *
 * The posture records are edited on the Policy Guidance tab of /projects-admin, so
 * a change there reaches this page with no deploy. A ruling with no posture record
 * gets `posture: null` and `fill: null`: its badge renders outlined and its
 * guidance panel is left out.
 */
export function rulingsFromPostures(postures) {
  const byId = new Map((postures ?? []).map((p) => [p.id, p]));
  return RULINGS.map((r) => {
    const posture = byId.get(r.id) ?? null;
    return { ...r, posture, fill: posture?.color ?? null, textColor: posture?.text_color ?? null };
  });
}

const NO_POSTURES = rulingsFromPostures([]);

/** The ruling named by the first word of `text`, or null. The whole word must match. */
export function leadingRuling(text, rulings = NO_POSTURES) {
  const word = String(text ?? '').trim().match(/^[a-z]+/i)?.[0] ?? '';
  return rulings.find((r) => r.id === word.toLowerCase()) ?? null;
}

/**
 * A ruling badge carrying `label`, which is the sheet's text where one exists.
 *
 * The fill is applied as an INLINE STYLE, not an interpolated Tailwind class: those
 * are generated at build time from source text, so a class name assembled at
 * runtime emits no CSS.
 */
function rulingBadge(ruling, label) {
  const base = 'inline-flex items-center align-middle gap-2 rounded-lg p-2 font-sans text-contract-copy font-normal leading-none tracking-normal';
  if (!ruling.fill) {
    return `<span class="${base} border border-gray-300 bg-white text-gray-900">${escapeHtml(label)}</span>`;
  }
  return `<span class="${base}"
    style="background-color: ${escapeHtml(ruling.fill)}; color: ${escapeHtml(ruling.textColor ?? BADGE_FOREGROUND)}"
  >${escapeHtml(label)}</span>`;
}

/**
 * The AI use terms (column L) as written, with a leading ruling word highlighted.
 *
 * When the first word is a ruling name ("Conditional, TO Silent, …"), that word
 * renders in the ruling's colour and the rest follows as plain text. The highlight
 * marks a word the contracts team wrote; it does not replace or summarise the cell.
 * The word keeps the sheet's own spelling and case.
 */
function highlightTerms(text, rulings) {
  const value = String(text ?? '').trim();
  const ruling = leadingRuling(value, rulings);
  if (!ruling) return escapeHtml(value);
  const word = value.slice(0, ruling.id.length);
  return `${rulingBadge(ruling, word)}${escapeHtml(value.slice(word.length))}`;
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

/** 
 * Distinct portfolios, in a stable order, for the filter control. 
 * Account for recent portfolio sort cases that require exceptions.   
*/
export function portfoliosOf(contracts) {
  // Define your array of pinned exceptions
  const SORT_EXCEPTIONS = ['BEAM'];
  
  // Get the unique, clean list of portfolios
  const uniquePortfolios = [...new Set((contracts ?? []).map((c) => c.portfolio).filter(Boolean))];
  
  // Separate standard items from exceptions
  const standard = uniquePortfolios.filter(p => !SORT_EXCEPTIONS.includes(p));
  const pinnedToBack = uniquePortfolios.filter(p => SORT_EXCEPTIONS.includes(p));
  
  // Sort only the standard items alphabetically
  standard.sort((a, b) => a.localeCompare(b));
  
  // Merge them back together
  return [...standard, ...pinnedToBack];
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
 * read as duplicates. The blurb is the AI use terms, highlighted the same way as on
 * the detail page, so the card and the page never disagree about the ruling.
 */
export function renderContractCard(contract, rulings = NO_POSTURES) {
  const parent = contract.contract_num
    ? `<p class="text-xs text-gray-600 m-0 mt-1">
         Contract <code class="text-xs">${escapeHtml(contract.contract_num)}</code>
       </p>`
    : '';

  return `<a
    href="/contracts/${encodeURIComponent(contract.contract_id)}"
    class="contract-card flex flex-col h-full bg-white border border-gray-200 rounded-lg p-4 no-underline hover:border-plum-300 transition-colors"
  >
    <div class="mb-2">
      <span class="px-1.5 py-0.5 text-xs font-medium bg-portfolio-badge text-white rounded">
        ${escapeHtml(contract.portfolio ?? '')}
      </span>
    </div>
    <h3 class="text-sm font-semibold text-gray-900 m-0 leading-snug">
      ${escapeHtml(contract.project || contract.contract_id)}
    </h3>
    ${parent}
    <p class="text-xs text-gray-600 mt-2 mb-0 line-clamp-3 flex-1">
      ${highlightTerms(truncate(String(contract.ai_use_terms ?? '').trim(), BLURB_LIMIT), rulings)}
    </p>
  </a>`;
}

export function renderContractGrid(contracts, rulings = NO_POSTURES) {
  if (!contracts?.length) {
    return '<p class="text-sm text-gray-600 italic">No contracts matched.</p>';
  }
  return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    ${contracts.map((c) => `<div class="h-full">${renderContractCard(c, rulings)}</div>`).join('')}
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
const FEEDBACK_FORM = 'https://forms.gle/dmmSLFzEyzQjPdxj6';

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

/** What the contract says about AI use, from column L, or "None listed" when blank. */
function renderAiUseTerms(contract, rulings) {
  const body = isBlank(contract?.ai_use_terms)
    ? NONE_LISTED
    : highlightTerms(contract.ai_use_terms, rulings);
  return `<span class="inline-block text-sm text-gray-900 m-0 whitespace-pre-line">${body}</span>`;
}

/**
 * The survey's answers, one card each, in the design's order.
 *
 * The questions are the page's wording for each column rather than the sheet's
 * headers, which are instructions to the person filling the survey in.
 */
const GUIDANCE_QUESTIONS = [
  ["Does this client have an AI policy that isn't necessarily referenced in the program's contract with Nava?", 'client_policy'],
  ['Is AI being used to meet formal program goals or deliverables as stated in the contract?', 'ai_used'],
  ['What tools are in use to complete work on this contract?', 'tools'],
  ['How are people on this program using AI now?', 'usage'],
  ['Does the client have a process to review or approve AI use or AI tools?', 'review_process'],
];

const questionCard = (question, value, showPolicySummary = false) => `<div class="rounded-border-card">
    <h3 class="font-sans text-base font-bold leading-normal tracking-normal text-gray-900 m-0">${escapeHtml(question)}</h3>
  ${showPolicySummary ? '<p class="font-sans text-sm font-semibold leading-normal tracking-policy-summary uppercase text-gray-500 mt-2 mb-1">SUMMARY</p>' : ''}
  <p class="font-sans text-contract-copy text-gray-800 ${showPolicySummary ? 'mt-0' : 'mt-2'} mb-0 whitespace-pre-line">${plain(value)}</p>
  ${showPolicySummary ? '<span class="inline-block font-sans text-sm font-semibold leading-normal tracking-normal text-policy-link underline decoration-solid mt-2">Link to policy information</span>' : ''}
  </div>`;

/** Authored client-facing copy, independent of the survey response. */
const CLIENT_ASK_SCRIPT = `<section aria-label="Scripted responses to client questions about AI"
  class="rounded-lg border border-gray-200 bg-white px-6 py-3 flex gap-4">
  <div class="flex-1 min-w-0">
    <h3 class="font-sans text-base font-bold leading-normal tracking-normal text-gray-900 m-0">
      Scripted responses to client questions about AI
    </h3>
    <p class="font-sans text-contract-copy text-gray-800 mt-2 mb-2">
      If a client asks about Nava&rsquo;s AI use, use these pre-approved talking points to
      respond confidently and consistently.
    </p>
    <blockquote class="pl-4 m-0">
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
 * Authored copy, identical on every record, like CLIENT_ASK_SCRIPT.
 *
 * Rendered as a plain list rather than checkboxes. Real checkboxes would invite a
 * reader to tick them, and nothing here persists — a checklist that forgets what you
 * confirmed is worse than one that never claimed to remember.
 */
const PRE_USE_CHECKLIST_ITEMS = [
  'Never input PII, PHI, client datasets, production data, or any agency-sensitive '
    + 'information into AI tools.',
  "Check whether a client AI policy exists for this contract (see 'client policy' field). "
    + "If yes, you must follow it in addition to Nava's playbook.",
  'All AI outputs must be reviewed, validated, and owned by a team member before inclusion '
    + 'in any deliverable.',
  'If you want to expand AI use or introduce a new tool, check with your Program Manager '
    + 'first. Some clients (MN, MA, AK) have formal approval processes that must be followed.',
  'If asked by the client whether you use AI: do not assume silence means you can answer '
    + 'without flagging it internally first. Ask your Program Manager how to respond.',
];

const PRE_USE_CHECKLIST = `<section aria-label="Pre-use checklist" class="rounded-lg border border-gray-200 bg-white p-5">
  <h3 class="font-sans text-base font-bold leading-normal tracking-normal text-gray-900 m-0">Pre-use checklist</h3>
  <p class="font-sans text-contract-copy text-gray-800 mt-3 mb-0">
    Before using AI on this contract, review this checklist to ensure you&rsquo;re
    following the right steps and meeting any applicable requirements.
  </p>
  <div class="flex gap-4 mt-5">
    <div class="flex-1 min-w-0">
      <h4 class="font-sans text-contract-copy text-gray-900 m-0">Checklist:</h4>
      <ol class="list-decimal mt-2 mb-0 pl-5 space-y-1.5 marker:text-gray-500">
        ${PRE_USE_CHECKLIST_ITEMS.map((item) => `<li class="font-sans text-contract-copy text-gray-800">${item}</li>`).join('')}
      </ol>
    </div>
  </div>
</section>`;

/**
 * The guidance of the posture named by the first word of the AI use terms.
 *
 * The heading and the numbered steps come from the posture record, and the panel
 * takes the record's colour. The steps are ordered, so `list-decimal` is required:
 * Tailwind's preflight resets `ol` to list-style none. Returns '' when the first
 * word names no ruling or the ruling has no posture record, because there is no
 * guidance to show.
 */
function renderPostureGuidance(contract, rulings) {
  const posture = leadingRuling(contract?.ai_use_terms, rulings)?.posture;
  if (!posture) return '';
  const textColor = posture.text_color ?? BADGE_FOREGROUND;
  const steps = (posture.steps ?? [])
    .map((step) => `<li class="text-sm">${escapeHtml(step)}</li>`).join('');
  return `<section aria-label="AI posture guidance" class="rounded-lg p-4 border border-gray-200"
    style="background-color: ${escapeHtml(posture.color)}; color: ${escapeHtml(textColor)}">
    <h3 class="text-sm font-normal m-0">${escapeHtml(posture.label)}</h3>
    ${steps ? `<ol class="list-decimal mt-3 mb-0 pl-5 space-y-1.5">${steps}</ol>` : ''}
  </section>`;
}

/**
 * Every ruling with its definition — the target of the "See all" link.
 *
 * The definition comes from the posture record, edited on the Policy Guidance tab.
 * A ruling with no record, or a record with no definition, shows "None listed".
 */
function renderRulingsList(rulings) {
  const rows = rulings.map((r, index) => `<div class="ruling-definition-row flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 -mx-5 px-5 ${index > 0 ? 'border-t border-gray-200' : ''}">
      <dt class="shrink-0 sm:w-28">${rulingBadge(r, r.name)}</dt>
      <dd class="font-sans text-contract-copy text-gray-800 m-0">${plain(r.posture?.definition)}</dd>
    </div>`).join('');
  return `<section id="ai-rulings" aria-labelledby="ai-rulings-heading" class="scroll-mt-6">
    <div class="pl-6">
      <h2 id="ai-rulings-heading" class="text-base font-semibold text-gray-900 m-0">
        ${rulings.length} AI Rulings and Definitions
      </h2>
      <dl class="rulings-list mt-3 mb-0 rounded-lg border border-gray-200 bg-white">${rows}</dl>
    </div>
  </section>`;
}

const sectionHeading = (text) => `<h2 class="font-sans text-section-heading text-gray-900 m-0">${escapeHtml(text)}</h2>`;

export function renderContractDetail(contract, rulings = NO_POSTURES, capturedAt = null) {
  return `
    <div class="contract-detail-content">
    <a href="/contracts" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 no-underline transition-colors">&larr; All contracts</a>

    <header class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <p class="font-sans text-sm font-semibold leading-[21px] tracking-[0.28px] uppercase text-gray-600 m-0">Contract Details</p>
        <p class="text-gray-600 mt-1 mb-0"><span class="inline-block px-2 py-0.5 text-sm rounded bg-portfolio-badge text-white">${escapeHtml(contract.portfolio ?? '')}</span></p>
        <h1 class="font-sans text-2xl font-extrabold leading-[50px] tracking-normal text-gray-900 mt-3 mb-0">${escapeHtml(contract.project || contract.contract_id)}</h1>
      </div>
      <div class="text-sm sm:text-right">
        <p class="text-gray-900 m-0">Agency: <strong class="text-gray-900">${plain(contract.customer)}</strong></p>
        <p class="text-gray-600 mt-1 mb-0">Program manager: <strong class="text-gray-900">${plain(contract.nava_program_mgr)}</strong></p>
        <p class="text-gray-600 mt-1 mb-0">Contract manager: <strong class="text-gray-900">${plain(contract.nava_project_mgr)}</strong></p>
        ${renderSageLink(contract.resolved_project)}
      </div>
    </header>
  
    <div class="space-y-12">
      <section aria-label="What's in the contract?">
        ${sectionHeading('What the Contract says about AI')}
        <h3 class="font-sans text-xl font-bold leading-normal tracking-normal text-gray-900 mt-6 mb-4">AI use on this contract is</h3>
        ${renderAiUseTerms(contract, rulings)}
        <p class="mt-4 mb-0">
          <a href="#ai-rulings" class="font-sans text-contract-copy text-contract-link underline decoration-solid">
            See all ${rulings.length} potential AI rulings and their definitions.
          </a>
        </p>
        <h3 class="font-sans text-xl font-bold leading-normal tracking-normal text-gray-900 mt-6 mb-3">Contract language</h3>
        <p class="font-sans text-contract-copy text-gray-600 m-0">
          Read the most up-to-contract language. Nava's contract teams are working with program managers on a "path to yes" for all Nava programs so that all delivery teams to can use AI when appropriate or necessary.
        </p>
        <p class="font-sans text-contract-copy text-gray-600 m-0 mt-4">
          Program managers or a program’s contract manager are always available to answer questions about expectations for AI use. 
        </p>
        <div class="rounded-border-card rounded-border-card--narrow mt-4 font-sans text-contract-copy text-gray-800 whitespace-pre-line">${plain(contract.ai_use_terms_language)}</div>
        <p class="font-sans text-contract-copy-bold text-gray-500 mt-6 mb-0">
          Regardless of a contract&rsquo;s AI ruling, keep reading to understand any nuance
          that may apply to this program when it comes to using AI.
        </p>
      </section>

      <section aria-label="Practical guidance and more information">
        ${sectionHeading('Practical guidance and more information')}
        <p class="font-sans text-contract-copy leading-6 tracking-normal text-gray-600 mt-4 mb-0">
          This section provides background and context on AI use and expectations for this program or contract. 
          The information below comes from an AI-use survey we asked Program Managers to complete to help delivery teams understand a given client's AI posture and confidently explore AI capabilities when possible.
        </p>
        <div class="space-y-3 mt-5">
          ${GUIDANCE_QUESTIONS.map(([question, key]) => questionCard(question, contract[key], key === 'client_policy')).join('')}
        </div>
      </section>

      <section aria-label="Resources">
        ${sectionHeading('Resources')}
        <div class="space-y-4 mt-5">
          ${PRE_USE_CHECKLIST}
          ${CLIENT_ASK_SCRIPT}
        </div>
      </section>

      ${renderRulingsList(rulings)}
    </div>

    <a href="${FEEDBACK_FORM}" target="_blank" rel="noopener noreferrer"
      class="block font-sans text-contract-copy text-contract-link underline decoration-solid">Submit feedback to help us improve.</a>
    </div>`;
}
