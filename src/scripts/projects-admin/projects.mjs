import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';

// Projects mirrored from the Nava projects sheet. This tab is a window, not an
// editor: the sheet is the only write surface, so nothing here mutates anything
// and no control offers to.
//
// Drift-first. Steady state is zero findings, so the clean state has to read as a
// positive confirmation rather than an absent element — an empty region is
// indistinguishable from a broken tab.

const ENDPOINT = '/projects';

// Matches the API's sync states.
const NEVER_SYNCED = 'never_synced';
const IN_PROGRESS = 'in_progress';

// Columns the sheet declares no group for get this synthetic one from the sync.
const IDENTITY_GROUP = 'IDENTITY';
// Columns absent from the mapping entirely. Deliberately distinct from the
// sheet's own OTHER group, so it reads as a hub-side fallback rather than a
// category the sheet declared.
const UNGROUPED = 'Ungrouped';

const rowId = (code) => `project-row-${code.replace(/[^A-Za-z0-9_-]/g, '-')}`;

function formatWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? escapeHtml(iso) : d.toLocaleString();
}

/**
 * Freshness line. Three states, not two: a run that wrote projects and then died
 * leaves the table mid-flight, and calling that "synced" would vouch for a
 * half-written table.
 */
export function renderFreshness(sync) {
  if (!sync || sync.state === NEVER_SYNCED) {
    return `
      <p class="text-xs text-gray-500 m-0">
        Never synced — no projects have been imported from the sheet yet.
      </p>`;
  }

  if (sync.state === IN_PROGRESS) {
    return `
      <p class="text-xs text-amber-800 m-0">
        A sync started and did not finish, so this table may be partly written.
        Treat what follows as unreliable until the next run completes.
      </p>`;
  }

  const counts = [
    sync.created != null ? `${sync.created} added` : null,
    sync.updated != null ? `${sync.updated} changed` : null,
    sync.deleted != null ? `${sync.deleted} removed` : null,
  ].filter(Boolean).join(', ');

  return `
    <p class="text-xs text-gray-500 m-0">
      Last synced ${escapeHtml(formatWhen(sync.last_run_at))}${
        sync.row_count != null ? ` · ${sync.row_count} rows in the sheet` : ''
      }${counts ? ` · ${escapeHtml(counts)}` : ''}
    </p>`;
}

/**
 * New or renamed columns since the previous run.
 *
 * A rename is indistinguishable from a new column, which is why this surfaces
 * here rather than only in the workflow log: a rename can re-admit a column the
 * sync's exclusion list was dropping, and workflow output is not somewhere anyone
 * looks unprompted.
 */
export function renderNewColumns(sync) {
  const names = sync?.new_columns ?? [];
  if (!names.length) return '';
  return `
    <div class="mt-2 p-3 border border-amber-200 bg-amber-50 rounded">
      <p class="text-xs font-semibold text-amber-900 m-0">
        ${names.length} new column${names.length === 1 ? '' : 's'} in the sheet since the last sync
      </p>
      <ul class="text-xs text-amber-900 mt-1 mb-1 pl-4">
        ${names.map((n) => `<li><code>${escapeHtml(n)}</code></li>`).join('')}
      </ul>
      <p class="text-xs text-amber-900 m-0">
        A renamed column looks the same as a new one here. Check whether any of these is an
        excluded column that came back under a different name.
      </p>
    </div>`;
}

/**
 * The drift summary — the tab's primary surface.
 *
 * Renders from its own data and does not depend on the project table below it.
 */
export function renderDriftSummary(drift, sync) {
  const unresolved = drift?.unresolved ?? [];
  const missing = drift?.missing ?? [];
  const noArchetypes = (drift?.archetype_count ?? 0) === 0;

  const seedNotice = noArchetypes
    ? `<p class="text-xs text-amber-900 m-0 mt-2">
         No archetype records exist yet, so every value below is unresolved for that reason
         alone. Seed the archetypes before reading anything into these findings.
       </p>`
    : '';

  const findings = unresolved.length
    ? `
      <p class="text-sm font-semibold text-red-900 m-0">
        ${unresolved.length} archetype value${unresolved.length === 1 ? '' : 's'} in the sheet
        match${unresolved.length === 1 ? 'es' : ''} no archetype record
      </p>
      <p class="text-xs text-red-900 mt-1 mb-2">
        Fix these in the sheet, or add the missing archetype on the Archetypes tab.
      </p>
      <ul class="text-xs text-red-900 m-0 pl-4 space-y-1">
        ${unresolved.map((u) => `
          <li>
            <a href="#${rowId(u.project_code)}" class="drift-jump underline" data-code="${escapeHtml(u.project_code)}">
              <code>${escapeHtml(u.project_code)}</code> ${escapeHtml(u.project_name ?? '')}
            </a>
            — ${escapeHtml(u.column)} reads
            <code class="bg-white px-1 rounded">${escapeHtml(u.raw_value)}</code>
          </li>`).join('')}
      </ul>`
    : `
      <p class="text-sm font-semibold text-green-900 m-0">
        Every archetype value in the sheet matches an archetype record
      </p>`;

  const wrapper = unresolved.length
    ? 'border-red-200 bg-red-50'
    : 'border-green-200 bg-green-50';

  // Missing is not a failure: a project whose archetype has not been assigned yet
  // is normal in-progress state, and rendering it like a typo would make the
  // common case look broken. Same split the sync uses to decide fail vs warn.
  const missingBlock = missing.length
    ? `
      <div class="mt-3 p-3 border border-gray-200 bg-gray-50 rounded">
        <p class="text-xs font-semibold text-gray-700 m-0">
          ${missing.length} project${missing.length === 1 ? '' : 's'} with no archetype assigned yet
        </p>
        <p class="text-xs text-gray-500 mt-1 mb-1">Not an error — nothing has been typed wrong.</p>
        <ul class="text-xs text-gray-600 m-0 pl-4">
          ${missing.map((m) => `
            <li>
              <a href="#${rowId(m.project_code)}" class="drift-jump underline" data-code="${escapeHtml(m.project_code)}">
                <code>${escapeHtml(m.project_code)}</code> ${escapeHtml(m.project_name ?? '')}
              </a>
            </li>`).join('')}
        </ul>
      </div>`
    : '';

  return `
    <section aria-label="Archetype drift" class="p-4 border rounded ${wrapper}">
      ${findings}
      ${seedNotice}
      <div class="mt-2">${renderFreshness(sync)}</div>
      ${renderNewColumns(sync)}
    </section>
    ${missingBlock}`;
}

/**
 * Findings about the populated contracts, rendered beside the archetype summary.
 *
 * Three states the reader must be able to tell apart, which is why a zero count
 * is not enough on its own:
 *
 *   - not checked   — the contracts table is absent or unreadable
 *   - not populated — the table is there and empty, so nothing has been run yet
 *   - checked       — real findings, including "none", which is good news
 *
 * The missing-posture finding shows a count and no list. 82 of 119 contracts
 * carry no posture today; listing them would bury the unresolved names, which
 * are the entries someone can actually act on.
 */
export function renderContractDrift(contractDrift) {
  const drift = contractDrift ?? {};
  if (!drift.available) {
    return `
      <section aria-label="Contract drift" class="mt-3 p-3 border border-gray-200 bg-gray-50 rounded">
        <p class="text-xs font-semibold text-gray-700 m-0">Contracts not checked</p>
        <p class="text-xs text-gray-500 mt-1 m-0">
          The contracts table could not be read. This is expected before the first
          <code>terraform apply</code> for this environment — it is not a finding about the data.
        </p>
      </section>`;
  }

  const count = drift.contract_count ?? 0;
  if (count === 0) {
    return `
      <section aria-label="Contract drift" class="mt-3 p-3 border border-gray-200 bg-gray-50 rounded">
        <p class="text-xs font-semibold text-gray-700 m-0">No contracts populated yet</p>
        <p class="text-xs text-gray-500 mt-1 m-0">
          Run <code>scripts/sync-contracts.mjs</code> to populate this environment.
        </p>
      </section>`;
  }

  const unresolvedProjects = drift.unresolved_projects ?? [];
  const unresolvedPostures = drift.unresolved_postures ?? [];
  const missingPosture = drift.missing_posture ?? [];

  const entry = (u, detail) => `
    <li>
      <code>${escapeHtml(u.portfolio ?? '')}</code> ${escapeHtml(u.project ?? '')}
      — ${detail}
    </li>`;

  const projectBlock = unresolvedProjects.length
    ? `
      <p class="text-sm font-semibold text-red-900 m-0">
        ${unresolvedProjects.length} contract${unresolvedProjects.length === 1 ? '' : 's'}
        name${unresolvedProjects.length === 1 ? 's' : ''} a project that does not exist
      </p>
      <p class="text-xs text-red-900 mt-1 mb-2">
        Fix the name in the survey, or wait for the project to appear in the projects sheet.
        The contract still shows its posture — only the project link is missing.
      </p>
      <ul class="text-xs text-red-900 m-0 pl-4 space-y-1">
        ${unresolvedProjects.map((u) => entry(u,
          `project name reads <code class="bg-white px-1 rounded">${escapeHtml(u.raw_value)}</code>`)).join('')}
      </ul>`
    : `
      <p class="text-sm font-semibold text-green-900 m-0">
        Every contract that names a project matches one
      </p>`;

  // An unknown posture is worse than a missing one: it renders no guidance at all
  // on a page whose whole purpose is to deliver that guidance.
  const postureBlock = unresolvedPostures.length
    ? `
      <div class="mt-3 pt-3 border-t border-red-200">
        <p class="text-sm font-semibold text-red-900 m-0">
          ${unresolvedPostures.length} contract${unresolvedPostures.length === 1 ? '' : 's'}
          name${unresolvedPostures.length === 1 ? 's' : ''} a posture that does not exist
        </p>
        <p class="text-xs text-red-900 mt-1 mb-2">
          These render no guidance. Fix the value in the survey, or add the posture on the
          Policy Guidance tab.
        </p>
        <ul class="text-xs text-red-900 m-0 pl-4 space-y-1">
          ${unresolvedPostures.map((u) => entry(u,
            `posture reads <code class="bg-white px-1 rounded">${escapeHtml(u.raw_value)}</code>`)).join('')}
        </ul>
      </div>`
    : '';

  const wrapper = unresolvedProjects.length || unresolvedPostures.length
    ? 'border-red-200 bg-red-50'
    : 'border-green-200 bg-green-50';

  // Not an error: the survey is still being filled in, and rendering an
  // incomplete survey like a defect would make the common case look broken.
  const missingBlock = missingPosture.length
    ? `
      <div class="mt-3 p-3 border border-gray-200 bg-gray-50 rounded">
        <p class="text-xs font-semibold text-gray-700 m-0">
          ${missingPosture.length} of ${count} contracts have no posture recorded yet
        </p>
        <p class="text-xs text-gray-500 mt-1 m-0">
          Not an error — the survey has not been completed for these. They are hidden by
          default on the Contract Explorer.
        </p>
      </div>`
    : '';

  return `
    <section aria-label="Contract drift" class="mt-3 p-4 border rounded ${wrapper}">
      ${projectBlock}
      ${postureBlock}
      <p class="text-xs text-gray-500 mt-2 m-0">${count} contract${count === 1 ? '' : 's'} checked</p>
    </section>
    ${missingBlock}`;
}

/** Marker for a value that resolves to no record. Text, not colour alone. */
function unresolvedBadge() {
  return `<span class="ml-1 px-1 rounded bg-red-100 text-red-900 text-[10px] font-semibold uppercase tracking-wide">unresolved</span>`;
}

/**
 * Group the stored columns for display, using the mapping the sync captured from
 * the sheet. Identity columns lead; the sheet's own order is preserved after that.
 */
export function groupColumns(slugs, columnGroups) {
  const order = [];
  const byGroup = new Map();

  for (const slug of slugs) {
    const group = columnGroups?.[slug] ?? UNGROUPED;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group).push(slug);
  }

  // IDENTITY first, Ungrouped last, the sheet's order for everything between.
  order.sort((a, b) => {
    const rank = (g) => (g === IDENTITY_GROUP ? -1 : g === UNGROUPED ? 1 : 0);
    return rank(a) - rank(b) || order.indexOf(a) - order.indexOf(b);
  });

  return order.map((group) => ({ group, slugs: byGroup.get(group) }));
}

/**
 * One project, as a summary line with its full field set behind a disclosure.
 *
 * 34 columns cannot be scanned side by side, so the detail is disclosed per row.
 * The control is a real button with aria-expanded rather than a div or a hover
 * reveal — order and detail here are load-bearing, and a mouse-only affordance
 * would put them out of reach entirely.
 */
export function renderProjectRow(p, { columnGroups, columnHeaders, unresolvedByProject }) {
  const code = String(p.project_code ?? '');
  const bad = unresolvedByProject.get(code) ?? new Set();

  const slugs = Object.keys(p)
    .filter((k) => k !== 'record_type' && k !== 'project_code')
    .sort((a, b) => a.localeCompare(b));

  const groups = groupColumns(slugs, columnGroups);
  const detailId = `${rowId(code)}-detail`;

  const fields = groups.map(({ group, slugs: groupSlugs }) => `
    <div class="mt-3 first:mt-0">
      <h4 class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 m-0">${escapeHtml(group)}</h4>
      <dl class="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-3 gap-y-1 mt-1 mb-0 text-xs">
        ${groupSlugs.map((slug) => {
          const header = columnHeaders?.[slug] ?? slug;
          const value = String(p[slug] ?? '');
          const isBad = bad.has(slug);
          return `
            <dt class="text-gray-500 truncate">${escapeHtml(header)}</dt>
            <dd class="text-gray-800 m-0 ${isBad ? 'text-red-900' : ''}">
              ${value === '' ? '<span class="text-gray-300">—</span>' : escapeHtml(value)}
              ${isBad ? unresolvedBadge() : ''}
            </dd>`;
        }).join('')}
      </dl>
    </div>`).join('');

  return `
    <li id="${rowId(code)}" class="border-b border-gray-100 py-2" tabindex="-1">
      <div class="flex items-center gap-2">
        <button
          class="project-disclosure text-xs text-plum-600 hover:text-plum-700 w-5 text-left"
          aria-expanded="false"
          aria-controls="${detailId}"
        >+</button>
        <code class="text-xs text-gray-500">${escapeHtml(code)}</code>
        <span class="text-sm font-medium text-gray-900">${escapeHtml(p.project_name ?? '')}</span>
        ${p.portfolio ? `<span class="text-xs text-gray-400">${escapeHtml(p.portfolio)}</span>` : ''}
        ${bad.size ? unresolvedBadge() : ''}
      </div>
      <div id="${detailId}" class="hidden pl-7 pt-2">${fields}</div>
    </li>`;
}

export function renderProjectList(projects, meta) {
  if (!projects.length) {
    return '<p class="text-sm text-gray-400">No projects yet. Run the projects sync.</p>';
  }
  return `
    <ul class="list-none p-0 m-0">
      ${projects.map((p) => renderProjectRow(p, meta)).join('')}
    </ul>`;
}

/** Which columns of which projects hold an unresolved value. */
export function indexUnresolved(unresolved, columnHeaders) {
  const headerToSlug = new Map(
    Object.entries(columnHeaders ?? {}).map(([slug, header]) => [header, slug]),
  );
  const byProject = new Map();
  for (const u of unresolved ?? []) {
    const slug = headerToSlug.get(u.column) ?? u.column;
    if (!byProject.has(u.project_code)) byProject.set(u.project_code, new Set());
    byProject.get(u.project_code).add(slug);
  }
  return byProject;
}

export async function load(panel) {
  let data;
  try {
    data = await fetchApi(ENDPOINT);
  } catch (err) {
    // An error in the panel, never an empty table — an empty table would read as
    // "no projects", which is a different and much more alarming fact.
    panel.innerHTML = `
      <p class="text-sm text-red-600">
        Projects could not be loaded. ${escapeHtml(err?.message ?? 'Unknown error.')}
      </p>`;
    return;
  }

  const projects = data.projects ?? [];
  const meta = {
    columnGroups: data.column_groups ?? {},
    columnHeaders: data.column_headers ?? {},
    unresolvedByProject: indexUnresolved(data.drift?.unresolved, data.column_headers),
  };

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-gray-700 m-0">Projects</h2>
      <span class="text-xs text-gray-400">${projects.length} project${projects.length === 1 ? '' : 's'}</span>
    </div>
    <div id="projects-drift" class="mb-4">
      ${renderDriftSummary(data.drift, data.sync)}
      ${renderContractDrift(data.contract_drift)}
    </div>
    <div id="projects-list">${renderProjectList(projects, meta)}</div>`;

  // Disclosure: toggles on activation, which covers click and keyboard equally
  // because it is a real button.
  panel.querySelectorAll('.project-disclosure').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      btn.textContent = expanded ? '+' : '−';
      panel.querySelector(`#${btn.getAttribute('aria-controls')}`)?.classList.toggle('hidden', expanded);
    });
  });

  // A finding names a project; with 53 rows and no search, it also has to be able
  // to reach it. Focus moves so the jump works without a pointer.
  panel.querySelectorAll('.drift-jump').forEach((link) => {
    link.addEventListener('click', (event) => {
      const row = panel.querySelector(`#${rowId(link.dataset.code)}`);
      if (!row) return;
      event.preventDefault();
      row.focus();
      row.scrollIntoView({ block: 'center' });
    });
  });
}
