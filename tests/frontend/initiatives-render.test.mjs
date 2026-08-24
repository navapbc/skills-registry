import { describe, it, expect } from 'vitest';
import {
  splitList,
  filterInitiatives,
  useCasesOf,
  exposuresOf,
  tagsOf,
  formatCapturedAt,
  initiativesApiPath,
  describePopulationNotice,
  renderExposureBadge,
  renderLinks,
  renderInitiativeCard,
  renderInitiativeGrid,
  renderProjectSection,
  renderRelatedContractsSection,
  renderInitiativeDetail,
} from '../../src/lib/initiatives-render.mjs';

const PROJECT = {
  project_code: 'LB001',
  project_index_code: 'UFAI',
  project_name: 'User-Facing AI',
  portfolio: 'LABS',
  agency: 'Nava Labs',
  program_manager: 'Nancy Nussear',
  nava_contract_pp: 'Priya Contracts',
  archetype_primary: 'Product Team',
  archetype_additional: '',
};

const initiative = (over = {}) => ({
  initiative_id: 'init-2',
  title: 'Benefits navigator prototype',
  summary: 'Prototype for a multi-benefit navigator.',
  description: 'Exploring a navigator for multiple benefit types.',
  practice: '',
  exposure: 'Client',
  contacts: 'Ada Lovelace; Grace Hopper',
  link: 'Demo: https://example.gov/demo',
  submitted_by: 'Ada Lovelace',
  timestamp: 'Jun 25, 2026, 7:00:00 PM',
  use_case: 'AI-powered benefits assistant',
  ai_governance: '',
  tags: 'internal',
  status: 'Apr 7–14, 2026',
  project: 'User-Facing AI',
  resolved_project: PROJECT,
  ...over,
});

describe('splitList', () => {
  it('splits on semicolons, the separator the sheet actually uses', () => {
    expect(splitList('internal; live')).toEqual(['internal', 'live']);
  });

  it('also accepts commas, for a hand-edited sheet', () => {
    expect(splitList('a,b')).toEqual(['a', 'b']);
  });

  it('drops empties and trims', () => {
    expect(splitList('a; ;b')).toEqual(['a', 'b']);
    expect(splitList(';')).toEqual([]);
    expect(splitList('')).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('filterInitiatives', () => {
  const set = [
    initiative({ initiative_id: 'a', exposure: 'Client', tags: 'proto', use_case: 'Delivery prototyping' }),
    initiative({ initiative_id: 'b', exposure: 'Internal', tags: 'live', use_case: 'Knowledge management' }),
    initiative({ initiative_id: 'c', exposure: 'Client', tags: 'live; proto', use_case: 'Delivery prototyping' }),
  ];
  const ids = (result) => result.map((i) => i.initiative_id);

  it('returns everything with no facets and no query', () => {
    expect(filterInitiatives(set)).toHaveLength(3);
    expect(filterInitiatives(set, {})).toHaveLength(3);
  });

  it('filters by useCase', () => {
    expect(ids(filterInitiatives(set, { useCase: 'Delivery prototyping' }))).toEqual(['a', 'c']);
  });

  it('filters by exposure', () => {
    expect(ids(filterInitiatives(set, { exposure: 'Internal' }))).toEqual(['b']);
  });

  it('filters by tag through CONTAINMENT, not equality', () => {
    // Initiative c has `live; proto`. An equality implementation drops it from both
    // the `live` and the `proto` facet, which is the bug this pins.
    expect(ids(filterInitiatives(set, { tag: 'proto' }))).toEqual(['a', 'c']);
    expect(ids(filterInitiatives(set, { tag: 'live' }))).toEqual(['b', 'c']);
  });

  it('composes facets as AND, not OR', () => {
    expect(ids(filterInitiatives(set, { exposure: 'Client', tag: 'live' }))).toEqual(['c']);
    expect(filterInitiatives(set, { exposure: 'Internal', tag: 'proto' })).toHaveLength(0);
  });

  it('composes three facets with a query', () => {
    const result = filterInitiatives(set, {
      exposure: 'Client', tag: 'proto', useCase: 'Delivery prototyping', query: 'navigator',
    });
    expect(ids(result)).toEqual(['a', 'c']);
  });

  it('matches a query case-insensitively and ignores surrounding whitespace', () => {
    expect(filterInitiatives(set, { query: '  NAVIGATOR ' })).toHaveLength(3);
  });

  it('matches a query against contacts, so searching a colleague works', () => {
    const result = filterInitiatives(
      [initiative({ initiative_id: 'x', contacts: 'Katherine Johnson' })],
      { query: 'katherine' },
    );
    expect(result).toHaveLength(1);
  });

  it('matches a query against summary and description alike', () => {
    // Complementary, not duplicated: all 46 rows carry a summary and 37 a
    // description, so searching only one silently misses part of the set.
    const set = [
      initiative({ initiative_id: 'summary-only', summary: 'Voice AI triage', description: '' }),
      initiative({ initiative_id: 'desc-only', summary: '', description: 'Voice AI triage' }),
    ];
    expect(filterInitiatives(set, { query: 'voice ai' })).toHaveLength(2);
  });

  it('keeps a row with no use case or exposure out of those facets but in the unfiltered set', () => {
    // The shape of 9 of the 46 real rows.
    const sparse = [initiative({ initiative_id: 'sparse', use_case: '', exposure: '' })];
    expect(filterInitiatives(sparse)).toHaveLength(1);
    expect(filterInitiatives(sparse, { useCase: 'Delivery prototyping' })).toHaveLength(0);
    expect(filterInitiatives(sparse, { exposure: 'Client' })).toHaveLength(0);
  });

  it('matches a query against the resolved project name', () => {
    expect(filterInitiatives(set, { query: 'user-facing' })).toHaveLength(3);
  });

  it('excludes an initiative with no tags from a specific tag filter but not from all', () => {
    const set2 = [initiative({ initiative_id: 'z', tags: '' })];
    expect(filterInitiatives(set2, { tag: 'live' })).toHaveLength(0);
    expect(filterInitiatives(set2, { tag: 'all' })).toHaveLength(1);
  });

  it('returns an empty array for a nullish set rather than throwing', () => {
    expect(filterInitiatives(undefined)).toEqual([]);
    expect(filterInitiatives(null, { tag: 'live' })).toEqual([]);
  });
});

describe('facet extractors', () => {
  const set = [
    initiative({ exposure: 'Client', tags: 'proto', use_case: 'Delivery prototyping' }),
    initiative({ exposure: 'internal', tags: 'live; proto', use_case: 'Knowledge management' }),
    initiative({ exposure: 'client', tags: '', use_case: 'Delivery prototyping' }),
  ];

  it('de-duplicates, drops empties, and sorts stably', () => {
    expect(tagsOf(set)).toEqual(['live', 'proto']);
    // Title case, because that is what v2 supplies and the facet keeps the first
    // spelling it sees rather than normalizing one.
    expect(exposuresOf(set)).toEqual(['Client', 'internal']);
    expect(useCasesOf(set)).toEqual(['Delivery prototyping', 'Knowledge management']);
  });

  it('treats differently-cased spellings as one option, keeping the first seen', () => {
    const mixed = [initiative({ tags: 'Live' }), initiative({ tags: 'live' })];
    expect(tagsOf(mixed)).toEqual(['Live']);
  });

  it('returns the four real exposure values in the sheet\'s own spellings', () => {
    const all = ['Client', 'Internal', 'Infrastructure', 'Learning']
      .map((e) => initiative({ exposure: e }));
    expect(exposuresOf(all)).toEqual(['Client', 'Infrastructure', 'Internal', 'Learning']);
  });

  it('returns an empty list for a nullish set', () => {
    expect(tagsOf(undefined)).toEqual([]);
  });
});

describe('renderExposureBadge', () => {
  it('renders each known exposure with complete literal classes', () => {
    // Never interpolated from the value: Tailwind generates classes by scanning
    // source text at build time, so a runtime-assembled name emits no CSS and the
    // badge renders blank.
    for (const [value, expected] of [
      ['Client', 'bg-plum-100'],
      ['Internal', 'bg-gray-100'],
      ['Infrastructure', 'bg-blue-100'],
      ['Learning', 'bg-green-100'],
    ]) {
      const html = renderExposureBadge(value);
      expect(html).toContain(expected);
      expect(html).toContain(value);
    }
  });

  it('renders capitalized words, neither uppercased nor lowercased', () => {
    // The badge used to carry Tailwind's `uppercase`, which rendered
    // INFRASTRUCTURE. Casing comes from the sheet and is shown as written.
    const html = renderExposureBadge('Infrastructure');
    expect(html).toContain('>Infrastructure<');
    expect(html).not.toContain('uppercase');
    expect(html).not.toContain('>INFRASTRUCTURE<');
    expect(html).not.toContain('>infrastructure<');
  });

  it('colours `Infrastructure` and the older `infra` alike, rather than falling back', () => {
    // v1 said `infra`, v2 says `Infrastructure`. A gray badge for either would read
    // as a bug rather than as information.
    expect(renderExposureBadge('Infrastructure')).toContain('bg-blue-100');
    expect(renderExposureBadge('infra')).toContain('bg-blue-100');
  });

  it('folds case for the colour lookup while leaving the label alone', () => {
    const html = renderExposureBadge('cLiEnT');
    expect(html).toContain('bg-plum-100');
    expect(html).toContain('>cLiEnT<');
  });

  it('renders an unrecognised fifth value through the fallback, not as a blank badge', () => {
    const html = renderExposureBadge('partner');
    expect(html).toContain('partner');
    expect(html).toContain('bg-gray-100');
  });

  it('says so when exposure is not recorded', () => {
    expect(renderExposureBadge('')).toContain('Exposure not recorded');
    expect(renderExposureBadge(undefined)).toContain('Exposure not recorded');
  });

  it('never emits a class attribute containing an unresolved template value', () => {
    expect(renderExposureBadge('Client')).not.toMatch(/class="[^"]*\$\{/);
  });
});

describe('renderLinks', () => {
  it('renders both links from a real two-link cell', () => {
    const cell = 'April 2026 Demo: https://example.gov/demo; '
      + 'Product requirements MURAL: https://app.mural.co/t/nava/m/nava/123/abc';
    const html = renderLinks(cell);
    expect(html).toContain('href="https://example.gov/demo"');
    expect(html).toContain('April 2026 Demo');
    expect(html).toContain('href="https://app.mural.co/t/nava/m/nava/123/abc"');
    expect(html).toContain('Product requirements MURAL');
  });

  it('splits on semicolons only, so a comma inside a URL does not tear it', () => {
    const html = renderLinks('Doc: https://example.gov/a?ids=1,2,3');
    expect(html).toContain('href="https://example.gov/a?ids=1,2,3"');
  });

  it('links a bare unlabelled URL', () => {
    expect(renderLinks('https://example.gov/x')).toContain('href="https://example.gov/x"');
  });

  it('links a scheme-less host as https, never as a relative href', () => {
    // A relative href would resolve against /initiatives/<id> and 404 on our own site.
    const html = renderLinks('Notes: www.example.gov/x');
    expect(html).toContain('href="https://www.example.gov/x"');
  });

  it('keeps a label containing a colon intact', () => {
    const html = renderLinks('Q1 2026: retro notes: https://example.gov/r');
    expect(html).toContain('href="https://example.gov/r"');
    expect(html).toContain('Q1 2026: retro notes');
  });

  it('renders an unparseable part as text rather than dropping it', () => {
    // 26 of 37 rows carry links; losing one silently is worse than showing it plain.
    const html = renderLinks('see attached; Demo: https://example.gov/demo');
    expect(html).toContain('see attached');
    expect(html).toContain('href="https://example.gov/demo"');
  });

  it('renders the placeholder for a blank cell', () => {
    expect(renderLinks('')).toContain('None listed');
    expect(renderLinks(undefined)).toContain('None listed');
    expect(renderLinks(';;')).toContain('None listed');
  });

  it('refuses to link a javascript: URL', () => {
    // The sheet is editable by any staffer, so it is not a trusted source.
    const html = renderLinks('Click: javascript:alert(1)');
    expect(html).not.toContain('<a');
    expect(html).toContain('javascript:alert(1)');
  });

  it('refuses to link a data: URL', () => {
    const html = renderLinks('data:text/html,<script>alert(1)</script>');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<script>');
  });
});

describe('renderInitiativeCard', () => {
  it('links to the encoded detail route', () => {
    const html = renderInitiativeCard(initiative());
    expect(html).toContain('href="/initiatives/init-2"');
  });

  it('percent-encodes an id containing a space or a slash', () => {
    const html = renderInitiativeCard(initiative({ initiative_id: 'a b/c' }));
    expect(html).toContain('href="/initiatives/a%20b%2Fc"');
  });

  it('shows the full title, clamped rather than truncated', () => {
    const title = 'MD PBIF’s HR1 SNAP document upload and verification MVP & AI-assisted verification';
    const html = renderInitiativeCard(initiative({ title }));
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('AI-assisted verification');
  });

  it('subtitles with the resolved project name, falling back to the raw one', () => {
    expect(renderInitiativeCard(initiative())).toContain('User-Facing AI');
    const unresolved = initiative({ resolved_project: null, project: 'MD ADEPT WO4' });
    expect(renderInitiativeCard(unresolved)).toContain('MD ADEPT WO4');
  });

  it('omits the subtitle entirely when no project is named', () => {
    const html = renderInitiativeCard(initiative({ resolved_project: null, project: '' }));
    expect(html).not.toContain('mt-1">');
  });

  it('marks an over-long blurb as elided rather than stopping mid-word', () => {
    const summary = 'word '.repeat(60);
    const html = renderInitiativeCard(initiative({ summary }));
    expect(html).toContain('word...');
  });

  it('leaves a blurb that fits without a trailing ellipsis', () => {
    const html = renderInitiativeCard(initiative({ summary: 'Short enough.' }));
    expect(html).toContain('Short enough.');
    expect(html).not.toContain('Short enough....');
  });

  it('escapes a title containing markup', () => {
    const html = renderInitiativeCard(initiative({ title: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderInitiativeGrid', () => {
  it('renders one card per initiative', () => {
    const html = renderInitiativeGrid([initiative({ initiative_id: 'a' }), initiative({ initiative_id: 'b' })]);
    expect(html.match(/initiative-card/g)).toHaveLength(2);
  });

  it('says nothing matched rather than rendering empty markup', () => {
    expect(renderInitiativeGrid([])).toContain('No initiatives matched.');
    expect(renderInitiativeGrid(undefined)).toContain('No initiatives matched.');
  });
});

describe('renderProjectSection', () => {
  it('renders every projected field label for a resolved project', () => {
    const html = renderProjectSection(initiative());
    for (const label of [
      'Project', 'Portfolio', 'Agency', 'Project program manager',
      'Contracts program manager', 'Archetype', 'Additional archetype',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('labels the two managers differently, since they are different people', () => {
    const html = renderProjectSection(initiative());
    expect(html).toContain('Project program manager');
    expect(html).toContain('Contracts program manager');
    expect(html).toContain('Nancy Nussear');
    expect(html).toContain('Priya Contracts');
  });

  it('links the project name to its Confluence space', () => {
    const html = renderProjectSection(initiative());
    expect(html).toContain('href="https://navasage.atlassian.net/wiki/spaces/UFAI"');
  });

  it('renders the project name as plain text when the space key is blank', () => {
    // A link built from a missing key points at /wiki/spaces/ — a page that exists
    // and is wrong, which is worse than no link.
    const html = renderProjectSection(initiative({
      resolved_project: { ...PROJECT, project_index_code: '' },
    }));
    expect(html).not.toContain('/wiki/spaces/');
    expect(html).toContain('User-Facing AI');
  });

  it('renders a blank field as the placeholder rather than dropping the row', () => {
    const html = renderProjectSection(initiative({
      resolved_project: { ...PROJECT, agency: '' },
    }));
    expect(html).toContain('Agency');
    expect(html).toContain('None listed');
  });

  it('renders a neutral note when no project is stated, not an alarm', () => {
    // 23 of 46 rows state none, and plenty are genuinely internal. An amber panel
    // here would cry wolf on half the page.
    const html = renderProjectSection(initiative({ resolved_project: null, project: '' }));
    expect(html).toContain('Not linked to a project');
    expect(html).not.toContain('amber');
  });

  it('names an unresolved project as the sheet spells it, with the unregistered suffix', () => {
    // The sync only warns on this, so the page is where the finding reaches someone
    // who can fix it. The name is shown, not replaced by an error.
    const html = renderProjectSection(initiative({
      resolved_project: null, project: 'MD ADEPT WO4',
    }));
    expect(html).toContain('amber');
    expect(html).toContain('MD ADEPT WO4');
    expect(html).toContain('(Could not find registered project name)');
  });

  it('does not suffix a project that resolves', () => {
    const html = renderProjectSection(initiative());
    expect(html).not.toContain('(Could not find registered project name)');
  });

  it('does not suffix an initiative that states no project at all', () => {
    // Stating none is not the same as naming one that does not exist, and the
    // suffix would turn a normal record into a finding.
    const html = renderProjectSection(initiative({ resolved_project: null, project: '' }));
    expect(html).not.toContain('(Could not find registered project name)');
  });

  it('escapes an unresolved project name containing markup', () => {
    const html = renderProjectSection(initiative({
      resolved_project: null, project: '<img src=x onerror=alert(1)>',
    }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('initiativesApiPath', () => {
  it('asks for no join on the grid view', () => {
    // R6: the grid must never make the API read the contracts partition.
    expect(initiativesApiPath('')).toBe('/initiatives');
    expect(initiativesApiPath(null)).toBe('/initiatives');
    expect(initiativesApiPath(undefined)).toBe('/initiatives');
    expect(initiativesApiPath('   ')).toBe('/initiatives');
  });

  it('asks for the join on a detail view', () => {
    expect(initiativesApiPath('init-2'))
      .toBe('/initiatives?id=init-2');
  });

  it('encodes an id carrying characters that would otherwise alter the query', () => {
    expect(initiativesApiPath('a&b=c')).toBe('/initiatives?id=a%26b%3Dc');
    expect(initiativesApiPath('a#b')).toBe('/initiatives?id=a%23b');
    expect(initiativesApiPath('a b')).toBe('/initiatives?id=a%20b');
  });

  it('never produces a path fetchApi would double-prefix', () => {
    expect(initiativesApiPath('x').startsWith('/api')).toBe(false);
  });
});

describe('renderRelatedContractsSection', () => {
  const contract = (over = {}) => ({
    contract_id: 'user-facing-ai',
    project: 'User-Facing AI',
    contract_num: '47QRAA21D0064',
    vehicle: 'GSA MAS',
    customer: 'Nava Labs',
    agreement_type: 'Task order',
    ...over,
  });

  it('links each contract to its detail page', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract(), contract({ contract_id: 'md-pbif', project: 'MD PBIF' })],
    }));

    expect(html).toContain('href="/contracts/user-facing-ai"');
    expect(html).toContain('href="/contracts/md-pbif"');
    expect(html).toContain('>User-Facing AI<');
    expect(html).toContain('>MD PBIF<');
  });

  it('falls back to the contract id when the survey named no project', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ project: '' })],
    }));
    expect(html).toContain('>user-facing-ai<');
  });

  it('renders nothing when the field is absent', () => {
    // The grid view and the no-project detail view both land here. A "no contracts"
    // panel would answer a question that was never asked.
    expect(renderRelatedContractsSection(initiative())).toBe('');
    expect(renderRelatedContractsSection(initiative({ related_contracts: undefined }))).toBe('');
  });

  it('reports what the join established, not an absence it cannot see', () => {
    // Only 43 of 119 contracts carry a project name, so "this project has no
    // contracts" would be false on most empty results. The copy claims only that no
    // contract NAMES the project.
    const html = renderRelatedContractsSection(initiative({ related_contracts: [] }));
    expect(html).toContain('aria-label="Contracts"');
    expect(html).toContain('No contract on file names this project.');
    expect(html).not.toMatch(/no contracts (associated|on file for)/i);
  });

  it('says the read failed rather than claiming there are none', () => {
    // null is the failure state. Rendering the empty-state copy here would assert an
    // absence the failed read never established — during an incident, when someone is
    // most likely to act on it.
    const html = renderRelatedContractsSection(initiative({ related_contracts: null }));
    expect(html).toContain('aria-label="Contracts"');
    expect(html).toContain('Contracts could not be loaded.');
    expect(html).not.toContain('No contract on file names');
  });

  it('distinguishes all four states from one another', () => {
    const of = (v) => renderRelatedContractsSection(
      v === 'absent' ? initiative() : initiative({ related_contracts: v }),
    );
    const absent = of('absent');
    const failed = of(null);
    const none = of([]);
    const listed = of([contract()]);

    expect(absent).toBe('');
    expect(new Set([failed, none, listed]).size).toBe(3);
  });

  it('percent-encodes an id carrying a space or a slash', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ contract_id: 'md adept/wo-04' })],
    }));
    expect(html).toContain('href="/contracts/md%20adept%2Fwo-04"');
  });

  it('renders the name alone when every secondary field is empty', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ contract_num: '', vehicle: '', customer: '' })],
    }));
    expect(html).toContain('>User-Facing AI<');
    expect(html).not.toContain('·');
  });

  it('drops only the empty secondary fields, leaving no stray separators', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ vehicle: '' })],
    }));
    expect(html).toContain('47QRAA21D0064 · Nava Labs');
  });

  it('escapes markup in a contract name and in its secondary line', () => {
    // Asserts the escaped entity is PRESENT, not merely that the raw tag is absent —
    // a half-escaping bug passes the negative assertion alone.
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ project: '<script>a</script>', vehicle: '<img src=x>' })],
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('escapes a contract id carrying a quote so it cannot break out of the href', () => {
    const html = renderRelatedContractsSection(initiative({
      related_contracts: [contract({ contract_id: 'a"onmouseover="alert(1)' })],
    }));
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain('href="/contracts/a%22onmouseover%3D%22alert(1)"');
  });
});

describe('renderInitiativeDetail', () => {
  it('renders every field label even when every value is blank', () => {
    // The same-shape-every-record assertion: a reader must be able to tell "the
    // sheet has no answer" from "this page does not show that field".
    const blank = {
      initiative_id: 'x', title: 'X', summary: '', description: '', practice: '',
      exposure: '', contacts: '', submitted_by: '', timestamp: '', use_case: '',
      ai_governance: '', tags: '', status: '', link: '', project: '',
      resolved_project: null,
    };
    const html = renderInitiativeDetail(blank, null);
    for (const label of [
      'Use case', 'Exposure', 'Practice', 'Tags', 'Status', 'Contacts',
      'AI governance', 'Submitted by', 'Submitted',
      'Summary', 'Description', 'Links',
    ]) {
      expect(html).toContain(label);
    }
    expect(html.match(/None listed/g).length).toBeGreaterThanOrEqual(11);
  });

  it('renders contacts as a list, not one run-together string', () => {
    const html = renderInitiativeDetail(initiative({ contacts: 'Ada Lovelace; Grace Hopper' }), null);
    expect(html).toContain('<li>Ada Lovelace</li>');
    expect(html).toContain('<li>Grace Hopper</li>');
  });

  it('renders a free-text status exactly as written, never parsed as a date', () => {
    const html = renderInitiativeDetail(initiative({ status: 'Fall 2025 – present' }), null);
    expect(html).toContain('Fall 2025 – present');
  });

  it('includes the Project section', () => {
    expect(renderInitiativeDetail(initiative(), null)).toContain('aria-label="Project"');
  });

  it('places the Contracts section after the Project section', () => {
    const html = renderInitiativeDetail(initiative({
      related_contracts: [{ contract_id: 'user-facing-ai', project: 'User-Facing AI' }],
    }), null);

    expect(html.indexOf('aria-label="Contracts"'))
      .toBeGreaterThan(html.indexOf('aria-label="Project"'));
  });

  it('emits no Contracts section when the join was not requested', () => {
    expect(renderInitiativeDetail(initiative(), null)).not.toContain('aria-label="Contracts"');
  });

  it('links back to the grid', () => {
    expect(renderInitiativeDetail(initiative(), null)).toContain('href="/initiatives"');
  });

  it('states the capture date and that the data is not live', () => {
    const html = renderInitiativeDetail(initiative(), '2026-08-10T12:00:00.000Z');
    expect(html).toContain('August 10, 2026');
    expect(html).toContain('not live');
  });

  it('escapes markup in every rendered field', () => {
    const html = renderInitiativeDetail(initiative({
      title: '<script>a</script>', desc: '<script>b</script>', status: '<script>c</script>',
    }), null);
    expect(html).not.toContain('<script>');
  });
});

describe('formatCapturedAt', () => {
  it('formats an ISO date', () => {
    expect(formatCapturedAt('2026-08-10T12:00:00.000Z')).toBe('August 10, 2026');
  });

  it('returns unknown for null and for an unparseable string', () => {
    expect(formatCapturedAt(null)).toBe('unknown');
    expect(formatCapturedAt('not a date')).toBe('unknown');
  });
});

describe('describePopulationNotice', () => {
  it('distinguishes all three states', () => {
    expect(describePopulationNotice({ state: 'never_populated' }))
      .toContain('No initiatives have been synced');
    expect(describePopulationNotice({ state: 'in_progress' }))
      .toContain('did not finish');
    expect(describePopulationNotice({ state: 'complete', captured_at: '2026-08-10T12:00:00.000Z' }))
      .toContain('August 10, 2026');
  });

  it('says captured unknown rather than throwing on absent metadata', () => {
    expect(describePopulationNotice(undefined)).toContain('unknown');
  });
});
