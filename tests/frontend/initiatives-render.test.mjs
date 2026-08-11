import { describe, it, expect } from 'vitest';
import {
  splitList,
  filterInitiatives,
  useCaseLabelsOf,
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
  initiative_id: 'benefits-navigator-prototype',
  title: 'Benefits navigator prototype',
  desc: 'Exploring a navigator for multiple benefit types.',
  use_case_label: 'AI-powered benefits assistant',
  use_case_theme: 'AI-powered assistant that makes benefits easier to access',
  exposure: 'client',
  people: 'Ada Lovelace; Grace Hopper',
  status: 'Apr 7–14, 2026',
  tags: 'internal',
  links: 'Demo: https://example.gov/demo',
  project_name: 'User-Facing AI',
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
    initiative({ initiative_id: 'a', exposure: 'client', tags: 'proto', use_case_label: 'Delivery prototyping' }),
    initiative({ initiative_id: 'b', exposure: 'internal', tags: 'live', use_case_label: 'Knowledge management' }),
    initiative({ initiative_id: 'c', exposure: 'client', tags: 'live; proto', use_case_label: 'Delivery prototyping' }),
  ];
  const ids = (result) => result.map((i) => i.initiative_id);

  it('returns everything with no facets and no query', () => {
    expect(filterInitiatives(set)).toHaveLength(3);
    expect(filterInitiatives(set, {})).toHaveLength(3);
  });

  it('filters by useCaseLabel', () => {
    expect(ids(filterInitiatives(set, { useCaseLabel: 'Delivery prototyping' }))).toEqual(['a', 'c']);
  });

  it('filters by exposure', () => {
    expect(ids(filterInitiatives(set, { exposure: 'internal' }))).toEqual(['b']);
  });

  it('filters by tag through CONTAINMENT, not equality', () => {
    // Initiative c has `live; proto`. An equality implementation drops it from both
    // the `live` and the `proto` facet, which is the bug this pins.
    expect(ids(filterInitiatives(set, { tag: 'proto' }))).toEqual(['a', 'c']);
    expect(ids(filterInitiatives(set, { tag: 'live' }))).toEqual(['b', 'c']);
  });

  it('composes facets as AND, not OR', () => {
    expect(ids(filterInitiatives(set, { exposure: 'client', tag: 'live' }))).toEqual(['c']);
    expect(filterInitiatives(set, { exposure: 'internal', tag: 'proto' })).toHaveLength(0);
  });

  it('composes three facets with a query', () => {
    const result = filterInitiatives(set, {
      exposure: 'client', tag: 'proto', useCaseLabel: 'Delivery prototyping', query: 'navigator',
    });
    expect(ids(result)).toEqual(['a', 'c']);
  });

  it('matches a query case-insensitively and ignores surrounding whitespace', () => {
    expect(filterInitiatives(set, { query: '  NAVIGATOR ' })).toHaveLength(3);
  });

  it('matches a query against people, so searching a colleague works', () => {
    const result = filterInitiatives(
      [initiative({ initiative_id: 'x', people: 'Katherine Johnson' })],
      { query: 'katherine' },
    );
    expect(result).toHaveLength(1);
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
    initiative({ exposure: 'client', tags: 'proto', use_case_label: 'Delivery prototyping' }),
    initiative({ exposure: 'internal', tags: 'live; proto', use_case_label: 'Knowledge management' }),
    initiative({ exposure: 'client', tags: '', use_case_label: 'Delivery prototyping' }),
  ];

  it('de-duplicates, drops empties, and sorts stably', () => {
    expect(tagsOf(set)).toEqual(['live', 'proto']);
    expect(exposuresOf(set)).toEqual(['client', 'internal']);
    expect(useCaseLabelsOf(set)).toEqual(['Delivery prototyping', 'Knowledge management']);
  });

  it('treats differently-cased spellings as one option, keeping the first seen', () => {
    const mixed = [initiative({ tags: 'Live' }), initiative({ tags: 'live' })];
    expect(tagsOf(mixed)).toEqual(['Live']);
  });

  it('returns the four real exposure values from real spellings', () => {
    const all = ['client', 'internal', 'infra', 'learning'].map((e) => initiative({ exposure: e }));
    expect(exposuresOf(all)).toEqual(['client', 'infra', 'internal', 'learning']);
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
      ['client', 'bg-plum-100'],
      ['internal', 'bg-gray-100'],
      ['infra', 'bg-blue-100'],
      ['learning', 'bg-green-100'],
    ]) {
      const html = renderExposureBadge(value);
      expect(html).toContain(expected);
      expect(html).toContain(value);
    }
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
    expect(renderExposureBadge('client')).not.toMatch(/class="[^"]*\$\{/);
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
    expect(html).toContain('href="/initiatives/benefits-navigator-prototype"');
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
    const unresolved = initiative({ resolved_project: null, project_name: 'MD ADEPT WO4' });
    expect(renderInitiativeCard(unresolved)).toContain('MD ADEPT WO4');
  });

  it('omits the subtitle entirely when no project is named', () => {
    const html = renderInitiativeCard(initiative({ resolved_project: null, project_name: '' }));
    expect(html).not.toContain('mt-1">');
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
    // 14 of 37 rows state none, and plenty are genuinely internal. An amber panel
    // here would cry wolf on 38% of the page.
    const html = renderProjectSection(initiative({ resolved_project: null, project_name: '' }));
    expect(html).toContain('Not linked to a project');
    expect(html).not.toContain('amber');
  });

  it('renders an amber note naming the raw value when a stated project resolves to nothing', () => {
    const html = renderProjectSection(initiative({
      resolved_project: null, project_name: 'MD ADEPT WO4',
    }));
    expect(html).toContain('amber');
    expect(html).toContain('No matching project');
    expect(html).toContain('MD ADEPT WO4');
  });

  it('escapes an unresolved project name containing markup', () => {
    const html = renderProjectSection(initiative({
      resolved_project: null, project_name: '<img src=x onerror=alert(1)>',
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
    expect(initiativesApiPath('benefits-navigator-prototype'))
      .toBe('/initiatives?id=benefits-navigator-prototype');
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
    // contracts" would be false on most empty results. The copy must stay hedged.
    const html = renderRelatedContractsSection(initiative({ related_contracts: [] }));
    expect(html).toContain('aria-label="Contracts"');
    expect(html).toContain('No contract on file names this project');
    expect(html).toMatch(/record no project name/);
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
      initiative_id: 'x', title: 'X', desc: '', use_case_label: '', use_case_theme: '',
      exposure: '', people: '', status: '', tags: '', links: '', project_name: '',
      resolved_project: null,
    };
    const html = renderInitiativeDetail(blank, null);
    for (const label of [
      'Use case', 'Exposure', 'Tags', 'Status', 'People',
      'Description', 'Use case theme', 'Links',
    ]) {
      expect(html).toContain(label);
    }
    expect(html.match(/None listed/g).length).toBeGreaterThanOrEqual(7);
  });

  it('renders people as a list, not one run-together string', () => {
    const html = renderInitiativeDetail(initiative({ people: 'Ada Lovelace; Grace Hopper' }), null);
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
