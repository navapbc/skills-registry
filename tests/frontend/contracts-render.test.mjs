import { describe, it, expect } from 'vitest';
import {
  RULINGS,
  rulingOf,
  indexPostures,
  filterContracts,
  portfoliosOf,
  formatCapturedAt,
  renderContractCard,
  renderContractGrid,
  renderContractDetail,
  describePopulationNotice,
} from '../../src/lib/contracts-render.mjs';

const POSTURES = [
  { id: 'allowed', label: 'AI ALLOWED — how to proceed', color: '#e7f1e0', position: 1, steps: ['Step one.', 'Step two.'] },
  { id: 'silent', label: 'AI SILENT — how to proceed', color: '#f3f4f6', position: 3, steps: ['Check the terms.'] },
];
const byId = indexPostures(POSTURES);

const contract = (over = {}) => ({
  contract_id: 'fedciv-sec-enterprise-websites',
  portfolio: 'FEDCIV',
  project: 'SEC ENTERPRISE WEBSITES',
  contract_num: '47QTCA18D008M',
  customer: 'SEC',
  nava_program_mgr: 'Crystal Cody',
  ai_use_terms: 'Conditional, TO Silent, BPA Restricted',
  ai_use_terms_language: 'SEC BPA modification 4 incorporates AI-related clauses.',
  client_policy: 'Yes. SEC requests training features be turned off.',
  ai_used: 'No',
  tools: 'N/A',
  usage: 'Not in use.',
  review_process: 'The CAIO has an AI Use Case Inventory submission form.',
  posture_id: null,
  resolved_project: null,
  ...over,
});

/** The markup of the section carrying `label`, up to its first closing tag. */
const sectionOf = (html, label) =>
  html.match(new RegExp(`<section aria-label="${label}"[\\s\\S]*?</section>`))[0];

describe('RULINGS', () => {
  it('defines the five rulings in the design order', () => {
    expect(RULINGS.map((r) => r.name)).toEqual(['Allowed', 'Restricted', 'Silent', 'Prohibited', 'Conditional']);
  });

  it('gives every ruling a definition and a six-digit fill and text colour', () => {
    for (const r of RULINGS) {
      expect(r.definition.length).toBeGreaterThan(0);
      expect(r.fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('rulingOf', () => {
  it('matches a cell that is exactly a ruling name, whatever its case', () => {
    expect(rulingOf(contract({ ai_use_terms: 'Allowed' })).id).toBe('allowed');
    expect(rulingOf(contract({ ai_use_terms: '  silent ' })).id).toBe('silent');
  });

  it('matches nothing when the cell carries more than a ruling name', () => {
    expect(rulingOf(contract({ ai_use_terms: 'Allowed, disclosure required' }))).toBeNull();
    expect(rulingOf(contract({ ai_use_terms: 'no language regarding AI' }))).toBeNull();
    expect(rulingOf(contract({ ai_use_terms: '' }))).toBeNull();
  });
});

describe('filterContracts', () => {
  const set = [
    contract({ contract_id: 'a', portfolio: 'FEDCIV', ai_use_terms: 'Allowed, GSA restriction' }),
    contract({ contract_id: 'b', portfolio: 'STATES', project: 'MD FAMLI', ai_use_terms: 'Silent' }),
  ];

  it('shows every contract by default', () => {
    expect(filterContracts(set).map((c) => c.contract_id)).toEqual(['a', 'b']);
  });

  it('narrows by portfolio', () => {
    expect(filterContracts(set, { portfolio: 'STATES' }).map((c) => c.contract_id)).toEqual(['b']);
  });

  it('searches the AI use terms as written', () => {
    expect(filterContracts(set, { query: 'allowed' }).map((c) => c.contract_id)).toEqual(['a']);
  });

  it('searches the project name, case-insensitively', () => {
    expect(filterContracts(set, { query: 'famli' }).map((c) => c.contract_id)).toEqual(['b']);
  });
});

describe('portfoliosOf', () => {
  it('returns distinct portfolios in a stable order', () => {
    expect(portfoliosOf([
      contract({ portfolio: 'STATES' }), contract({ portfolio: 'FEDCIV' }), contract({ portfolio: 'STATES' }),
    ])).toEqual(['FEDCIV', 'STATES']);
  });
});

describe('formatCapturedAt', () => {
  it('formats an ISO timestamp readably', () => {
    expect(formatCapturedAt('2026-08-07T18:53:15.161Z')).toMatch(/2026/);
  });
  it('says unknown for a missing or unparseable value', () => {
    expect(formatCapturedAt(null)).toBe('unknown');
    expect(formatCapturedAt('not-a-date')).toBe('unknown');
  });
});

describe('renderContractCard', () => {
  it('links to the detail page by contract id', () => {
    expect(renderContractCard(contract())).toContain('href="/contracts/fedciv-sec-enterprise-websites"');
  });

  it('shows the AI use terms as written when they are not a ruling name', () => {
    const html = renderContractCard(contract());
    expect(html).toContain('Conditional, TO Silent, BPA Restricted');
    expect(html).not.toContain('background-color');
  });

  it('badges a bare ruling name in its colour, carrying the sheet text', () => {
    const html = renderContractCard(contract({ ai_use_terms: 'Allowed' }));
    expect(html).toContain('background-color: #17412d');
    expect(html).toContain('>Allowed</span>');
  });

  it('shows the contract number as the parent', () => {
    expect(renderContractCard(contract())).toContain('47QTCA18D008M');
  });

  it('escapes sheet values', () => {
    const html = renderContractCard(contract({ project: '<script>x</script>' }));
    expect(html).not.toContain('<script>x');
  });
});

describe('renderContractGrid', () => {
  it('says so when nothing matched', () => {
    expect(renderContractGrid([])).toMatch(/no contracts matched/i);
  });

  it('renders one card per contract', () => {
    const html = renderContractGrid([contract({ contract_id: 'a' }), contract({ contract_id: 'b' })]);
    expect(html.match(/contract-card/g)).toHaveLength(2);
  });
});

describe('renderContractDetail', () => {
  describe('the header', () => {
    it('names the portfolio, the contract, the agency, and the program manager', () => {
      const html = renderContractDetail(contract(), byId, null);
      expect(html).toMatch(/contract details/i);
      expect(html).toContain('FEDCIV');
      expect(html).toContain('<h1');
      expect(html).toContain('SEC ENTERPRISE WEBSITES');
      expect(html).toContain('Agency: SEC');
      expect(html).toContain('Crystal Cody');
    });

    it('links the project index on Sage when the project has a space key', () => {
      const html = renderContractDetail(
        contract({ resolved_project: { project_index_code: 'SECWEB' } }), byId, null,
      );
      expect(html).toContain('href="https://navasage.atlassian.net/wiki/spaces/SECWEB"');
      expect(html).toContain('check out the project index on Sage');
    });

    it('leaves the Sage link out rather than pointing it at no space', () => {
      const unresolved = renderContractDetail(contract(), byId, null);
      const keyless = renderContractDetail(contract({ resolved_project: { project_index_code: '' } }), byId, null);
      expect(unresolved).not.toContain('wiki/spaces/');
      expect(keyless).not.toContain('wiki/spaces/');
    });

    it('marks a blank agency or program manager as unlisted', () => {
      const html = renderContractDetail(contract({ customer: '', nava_program_mgr: '' }), byId, null);
      expect(html.match(/None listed/g).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('what the contract says about AI', () => {
    it('renders free-text AI use terms exactly as written, unbadged', () => {
      const html = sectionOf(renderContractDetail(contract(), byId, null), 'What the contract says about AI');
      expect(html).toContain('AI use on this contract is:');
      expect(html).toContain('Conditional, TO Silent, BPA Restricted');
      expect(html).not.toContain('background-color');
    });

    it('badges AI use terms that are exactly a ruling name', () => {
      const html = sectionOf(
        renderContractDetail(contract({ ai_use_terms: 'Prohibited' }), byId, null),
        'What the contract says about AI',
      );
      expect(html).toContain('background-color: #a12a34');
      expect(html).toContain('>Prohibited</span>');
    });

    it('links to the rulings list at the bottom of the page', () => {
      const html = renderContractDetail(contract(), byId, null);
      expect(html).toContain('href="#ai-rulings"');
      expect(html).toContain('See all 5 potential AI rulings and their definitions.');
      expect(html).toContain('id="ai-rulings"');
    });

    it('shows the contract language as written', () => {
      const html = renderContractDetail(contract(), byId, null);
      expect(html).toContain('Contract language');
      expect(html).toContain('SEC BPA modification 4 incorporates AI-related clauses.');
    });

    it('escapes the contract language, which is free text', () => {
      const html = renderContractDetail(contract({ ai_use_terms_language: '<img src=x onerror=1>' }), byId, null);
      expect(html).not.toContain('<img src=x');
    });
  });

  describe('practical guidance', () => {
    it('asks each survey question with its answer as written', () => {
      const html = sectionOf(renderContractDetail(contract(), byId, null), 'Practical guidance and more information');
      expect(html).toContain('Does this client have an AI policy');
      expect(html).toContain('Yes. SEC requests training features be turned off.');
      expect(html).toContain('Is AI in use on this contract?');
      expect(html).toContain('What AI tools are in use?');
      expect(html).toContain('N/A');
      expect(html).toContain('How are people on this program using AI?');
      expect(html).toContain('Does the client have a process to review or approve AI use or AI tools?');
      expect(html).toContain('The CAIO has an AI Use Case Inventory submission form.');
    });

    it('keeps every question when the survey answered none of them', () => {
      const html = renderContractDetail(
        contract({ client_policy: '', ai_used: '', tools: '', usage: '', review_process: '' }), byId, null,
      );
      const section = sectionOf(html, 'Practical guidance and more information');
      expect(section.match(/None listed/g)).toHaveLength(5);
    });
  });

  describe('the pre-use checklist', () => {
    it('lists the posture guidance when the contract resolves to a posture', () => {
      const html = sectionOf(
        renderContractDetail(contract({ ai_use_terms: 'Allowed', posture_id: 'allowed' }), byId, null),
        'Pre-use checklist',
      );
      expect(html).toContain('AI ALLOWED — how to proceed');
      expect(html).toContain('Step one.');
      expect(html).toContain('Step two.');
    });

    it('lists the authored checklist when no posture resolves', () => {
      const html = sectionOf(renderContractDetail(contract(), byId, null), 'Pre-use checklist');
      expect(html).toContain('Always confirm that AI use is allowed on your project.');
      expect(html).toContain('No client or sensitive data');
    });

    it('escapes posture steps, which are stored records', () => {
      const postures = indexPostures([{ id: 'silent', label: 'S', steps: ['<b>bold</b>'] }]);
      const html = renderContractDetail(contract({ posture_id: 'silent' }), postures, null);
      expect(html).not.toContain('<b>bold</b>');
    });
  });

  describe('the client-facing script', () => {
    it('gives the reader words to say, directly after the pre-use checklist', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
      expect(html).toContain('If the client asks about AI use');
      expect(html).toContain('all outputs are reviewed and validated by the team');
      expect(html.indexOf('aria-label="Pre-use checklist"'))
        .toBeLessThan(html.indexOf('If the client asks about AI use'));
    });

    // Authored copy, not a surveyed field: it must not vary by record or vanish on
    // a contract with no posture.
    it('says the same thing on every record, with a posture or not', () => {
      const withPosture = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
      const without = renderContractDetail(contract(), byId, null);
      expect(without).toContain('Nava uses AI-assisted tools in a controlled manner');
      expect(withPosture).toContain('Nava uses AI-assisted tools in a controlled manner');
    });

    it('reads as an informational alert', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
      expect(html).toContain('bg-info-bg');
      expect(html).toContain('text-info-text');
      expect(html).toContain('border-info');
    });

    // Colour reinforces the classification; the words carry it.
    it('names the alert type in words, not only in colour', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
      expect(html).toContain('aria-label="If the client asks about AI use"');
      expect(html).toMatch(/<div class="w-1[^"]*"\s+aria-hidden="true"><\/div>/);
    });
  });

  describe('the rulings list', () => {
    it('comes last, after the resources', () => {
      const html = renderContractDetail(contract(), byId, null);
      expect(html.indexOf('If the client asks about AI use')).toBeLessThan(html.indexOf('id="ai-rulings"'));
    });

    it('lists every ruling with its colour and definition', () => {
      const html = renderContractDetail(contract(), byId, null);
      const list = html.slice(html.indexOf('id="ai-rulings"'));
      expect(list).toContain('5 AI Rulings and Definitions');
      for (const r of RULINGS) {
        expect(list).toContain(`background-color: ${r.fill}`);
        expect(list).toContain(`>${r.name}</span>`);
      }
      expect(list).toContain('You cannot use AI on this contract.');
      expect(list).toContain('such as the relevant task order.');
    });
  });

  it('orders the sections as the design does', () => {
    const html = renderContractDetail(contract(), byId, null);
    const order = [
      'What the Contract says about AI',
      'Practical guidance and more information',
      'Resources',
      'Pre-use checklist',
      'If the client asks about AI use',
      'AI Rulings and Definitions',
    ].map((text) => html.indexOf(text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('describePopulationNotice', () => {
  it('warns when a run did not finish', () => {
    const html = describePopulationNotice({ state: 'in_progress', captured_at: null });
    expect(html).toMatch(/did not finish|incomplete/i);
  });

  it('says so when nothing has been populated', () => {
    expect(describePopulationNotice({ state: 'never_populated' })).toMatch(/no contracts have been populated/i);
  });

  it('shows the capture date for a completed run', () => {
    const html = describePopulationNotice({ state: 'complete', captured_at: '2026-08-07T18:53:15.161Z' });
    expect(html).toMatch(/captured/i);
    expect(html).toMatch(/2026/);
  });
});

describe('empty-string project fallback', () => {
  // The population writes '' rather than undefined, so `??` never fell back and
  // the card title, detail heading, and document title rendered blank.
  it('falls back to the id when the project cell is blank on a card', () => {
    const html = renderContractCard(contract({ project: '', contract_id: 'labs-blank' }));
    expect(html).toContain('labs-blank');
  });

  it('falls back to the id on the detail heading', () => {
    const html = renderContractDetail(contract({ project: '', contract_id: 'labs-blank' }), byId, null);
    expect(html).toContain('labs-blank');
  });
});
