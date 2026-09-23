import { describe, it, expect } from 'vitest';
import {
  RULINGS,
  rulingsFromPostures,
  leadingRuling,
  filterContracts,
  portfoliosOf,
  formatCapturedAt,
  renderContractCard,
  renderContractGrid,
  renderContractDetail,
  describePopulationNotice,
} from '../../src/lib/contracts-render.mjs';

// The posture records as staging and prod hold them. No record carries
// `conditional` yet, so that ruling renders uncoloured.
const POSTURES = [
  { id: 'allowed', color: '#e7f1e0', definition: 'This means the contract allows us to use AI.' },
  { id: 'restricted', color: '#fdf3d6' },
  { id: 'silent', color: '#f3f4f6', label: 'AI SILENT — how to proceed', steps: ['Check the terms.', 'Ask your PM.'] },
  { id: 'prohibited', color: '#fcdcd6', definition: 'You cannot use AI on this contract.' },
];
const rulings = rulingsFromPostures(POSTURES);

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

const card = (over) => renderContractCard(contract(over), rulings);

/** The markup of the section carrying `label`, up to its first closing tag. */
const sectionOf = (html, label) =>
  html.match(new RegExp(`<section aria-label="${label}"[\\s\\S]*?</section>`))[0];

describe('RULINGS', () => {
  it('defines the five rulings in the design order', () => {
    expect(RULINGS.map((r) => r.name)).toEqual(['Allowed', 'Restricted', 'Silent', 'Prohibited', 'Conditional']);
  });
});

describe('rulingsFromPostures', () => {
  it('takes each ruling colour from the posture record with the same id', () => {
    const byId = Object.fromEntries(rulings.map((r) => [r.id, r.fill]));
    expect(byId).toMatchObject({
      allowed: '#e7f1e0', restricted: '#fdf3d6', silent: '#f3f4f6', prohibited: '#fcdcd6',
    });
  });

  it('leaves a ruling with no posture record uncoloured', () => {
    expect(rulings.find((r) => r.id === 'conditional').fill).toBeNull();
    expect(rulingsFromPostures(undefined).every((r) => r.fill === null)).toBe(true);
  });

  it('picks up a posture added later, with no code change', () => {
    const later = rulingsFromPostures([...POSTURES, { id: 'conditional', color: '#ece3f5' }]);
    expect(later.find((r) => r.id === 'conditional').fill).toBe('#ece3f5');
  });

  it('keeps the authored order, whatever order the records arrive in', () => {
    expect(rulingsFromPostures([...POSTURES].reverse()).map((r) => r.id)).toEqual(RULINGS.map((r) => r.id));
  });
});

describe('leadingRuling', () => {
  it('names the ruling the first word spells, whatever its case', () => {
    expect(leadingRuling('Allowed').id).toBe('allowed');
    expect(leadingRuling('  silent on use terms').id).toBe('silent');
    expect(leadingRuling('Conditional, TO Silent').id).toBe('conditional');
  });

  it('names nothing when the first word is not a ruling name', () => {
    expect(leadingRuling('no language regarding AI')).toBeNull();
    expect(leadingRuling('GSA restriction')).toBeNull();
    expect(leadingRuling('Silently accepted')).toBeNull();
    expect(leadingRuling('')).toBeNull();
    expect(leadingRuling(undefined)).toBeNull();
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
    expect(card()).toContain('href="/contracts/fedciv-sec-enterprise-websites"');
  });

  it('shows the AI use terms as written when they do not start with a ruling name', () => {
    const html = card({ ai_use_terms: 'GSA restriction, TO Silent' });
    expect(html).toContain('GSA restriction, TO Silent');
    expect(html).not.toContain('background-color');
  });

  it('highlights a leading ruling word the same way the detail page does', () => {
    const html = card({ ai_use_terms: 'Prohibited, no exceptions' });
    expect(html).toContain('background-color: #fcdcd6; color: #1b1b1b');
    expect(html).toContain('>Prohibited</span>, no exceptions');
  });

  it('highlights a cell that is exactly a ruling name, once', () => {
    const html = card({ ai_use_terms: 'Allowed' });
    expect(html).toContain('background-color: #e7f1e0');
    expect(html.match(/>Allowed<\/span>/g)).toHaveLength(1);
  });

  it('shortens long terms after the highlighted word', () => {
    const html = card({ ai_use_terms: `Silent ${'x '.repeat(200)}` });
    expect(html).toContain('>Silent</span>');
    expect(html).toContain('...');
  });

  it('leaves the blurb empty when the terms are blank', () => {
    const html = card({ ai_use_terms: '' });
    expect(html).not.toContain('None listed');
    expect(html).not.toContain('background-color');
  });

  it('shows the contract number as the parent', () => {
    expect(card()).toContain('47QTCA18D008M');
  });

  it('escapes sheet values', () => {
    const html = card({ project: '<script>x</script>' });
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
      const html = renderContractDetail(contract(), rulings);
      expect(html).toMatch(/contract details/i);
      expect(html).toContain('FEDCIV');
      expect(html).toContain('<h1');
      expect(html).toContain('SEC ENTERPRISE WEBSITES');
      expect(html).toContain('Agency: <strong class="text-gray-900">SEC</strong>');
      expect(html).toContain('Crystal Cody');
    });

    it('links the project index on Sage when the project has a space key', () => {
      const html = renderContractDetail(
        contract({ resolved_project: { project_index_code: 'SECWEB' } }), rulings);
      expect(html).toContain('href="https://navasage.atlassian.net/wiki/spaces/SECWEB"');
      expect(html).toContain('check out the project index on Sage');
    });

    it('leaves the Sage link out rather than pointing it at no space', () => {
      const unresolved = renderContractDetail(contract(), rulings);
      const keyless = renderContractDetail(contract({ resolved_project: { project_index_code: '' } }), rulings);
      expect(unresolved).not.toContain('wiki/spaces/');
      expect(keyless).not.toContain('wiki/spaces/');
    });

    it('marks a blank agency or program manager as unlisted', () => {
      const html = renderContractDetail(contract({ customer: '', nava_program_mgr: '' }), rulings);
      expect(html.match(/None listed/g).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('what the contract says about AI', () => {
    const termsOf = (terms) => sectionOf(
      renderContractDetail(contract({ ai_use_terms: terms }), rulings),
      'What the contract says about AI',
    );

    it('highlights a leading ruling name and keeps the rest as written', () => {
      const html = termsOf('Restricted, learning/development restrictions');
      expect(html).toContain('AI use on this contract is:');
      expect(html).toContain('background-color: #fdf3d6');
      expect(html).toContain('>Restricted</span>, learning/development restrictions');
    });

    it('outlines a leading ruling that has no posture record yet', () => {
      const html = termsOf('Conditional, TO Silent, BPA Restricted');
      expect(html).not.toContain('background-color');
      expect(html).toContain('border border-gray-300 bg-white text-gray-900">Conditional</span>, TO Silent');
    });

    it('highlights the word as the sheet spells it, whatever its case', () => {
      const html = termsOf('silent on use terms');
      expect(html).toContain('background-color: #f3f4f6');
      expect(html).toContain('>silent</span> on use terms');
    });

    it('highlights a cell that is exactly a ruling name', () => {
      const html = termsOf('Prohibited');
      expect(html).toContain('background-color: #fcdcd6');
      expect(html).toContain('>Prohibited</span>');
    });

    it('highlights nothing when the first word is not a ruling name', () => {
      const html = termsOf('GSA restriction, TO Silent');
      expect(html).toContain('GSA restriction, TO Silent');
      expect(html).not.toContain('background-color');
    });

    it('highlights nothing when a ruling name only starts the first word', () => {
      // "Silently" is not "Silent": the whole first word must match.
      expect(termsOf('Silently accepted')).not.toContain('background-color');
    });

    it('escapes the text after the highlighted word', () => {
      expect(termsOf('Allowed <img src=x onerror=1>')).not.toContain('<img src=x');
    });

    it('marks blank terms as unlisted', () => {
      expect(termsOf('')).toContain('None listed');
    });

    it('links to the rulings list at the bottom of the page', () => {
      const html = renderContractDetail(contract(), rulings);
      expect(html).toContain('href="#ai-rulings"');
      expect(html).toContain('See all 5 potential AI rulings and their definitions.');
      expect(html).toContain('id="ai-rulings"');
    });

    it('shows the contract language as written', () => {
      const html = renderContractDetail(contract(), rulings);
      expect(html).toContain('Contract language');
      expect(html).toContain('SEC BPA modification 4 incorporates AI-related clauses.');
    });

    it('escapes the contract language, which is free text', () => {
      const html = renderContractDetail(contract({ ai_use_terms_language: '<img src=x onerror=1>' }), rulings);
      expect(html).not.toContain('<img src=x');
    });
  });

  describe('practical guidance', () => {
    it('asks each survey question with its answer as written', () => {
      const html = sectionOf(renderContractDetail(contract(), rulings), 'Practical guidance and more information');
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
        contract({ client_policy: '', ai_used: '', tools: '', usage: '', review_process: '' }), rulings);
      const section = sectionOf(html, 'Practical guidance and more information');
      expect(section.match(/None listed/g)).toHaveLength(5);
    });
  });

  describe('the pre-use checklist', () => {
    const ITEMS = [
      "Check whether a client AI policy exists for this contract (see 'client policy' field). If yes, you must follow it in addition to Nava's playbook.",
      'All AI outputs must be reviewed, validated, and owned by a team member before inclusion in any deliverable.',
      'If you want to expand AI use or introduce a new tool, check with your Program Manager first. Some clients (MN, MA, AK) have formal approval processes that must be followed.',
      'If asked by the client whether you use AI: do not assume silence means you can answer without flagging it internally first. Ask your Program Manager how to respond.',
    ];
    const itemsOf = (html) => [...sectionOf(html, 'Pre-use checklist').matchAll(/<li[^>]*>([^<]*)<\/li>/g)]
      .map((m) => m[1]);

    it('lists exactly the four authored items, in order', () => {
      expect(itemsOf(renderContractDetail(contract(), rulings))).toEqual(ITEMS);
    });

    it('lists the same items whatever posture the contract resolves to', () => {
      const html = renderContractDetail(contract({ ai_use_terms: 'Allowed', posture_id: 'allowed' }), rulings);
      expect(itemsOf(html)).toEqual(ITEMS);
    });
  });

  describe('the client-facing script', () => {
    it('introduces the talking points under their heading', () => {
      const html = sectionOf(renderContractDetail(contract(), rulings), 'Scripted responses to client questions about AI');
      expect(html).toContain('<h3');
      expect(html).toContain('If a client asks about Nava&rsquo;s AI use, use these pre-approved talking points');
      expect(html).not.toContain('If the client asks about AI use');
      expect(html).not.toContain('word for word');
    });

    it('gives the reader words to say, directly after the pre-use checklist', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), rulings);
      expect(html).toContain('Scripted responses to client questions about AI');
      expect(html).toContain('all outputs are reviewed and validated by the team');
      expect(html.indexOf('aria-label="Pre-use checklist"'))
        .toBeLessThan(html.indexOf('Scripted responses to client questions about AI'));
    });

    // Authored copy, not a surveyed field: it must not vary by record or vanish on
    // a contract with no posture.
    it('says the same thing on every record, with a posture or not', () => {
      const withPosture = renderContractDetail(contract({ posture_id: 'allowed' }), rulings);
      const without = renderContractDetail(contract(), rulings);
      expect(without).toContain('Nava uses AI-assisted tools in a controlled manner');
      expect(withPosture).toContain('Nava uses AI-assisted tools in a controlled manner');
    });

    it('reads as an informational alert', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), rulings);
      expect(html).toContain('bg-info-bg');
      expect(html).toContain('border-info');
    });

    // Colour reinforces the classification; the words carry it.
    it('names the alert type in words, not only in colour', () => {
      const html = renderContractDetail(contract({ posture_id: 'allowed' }), rulings);
      expect(html).toContain('aria-label="Scripted responses to client questions about AI"');
      expect(html).toMatch(/<div class="w-1[^"]*"\s+aria-hidden="true"><\/div>/);
    });
  });

  describe('the posture guidance', () => {
    const guidanceOf = (terms, list = rulings) =>
      renderContractDetail(contract({ ai_use_terms: terms }), list).match(
        /<section aria-label="AI posture guidance"[\s\S]*?<\/section>/,
      )?.[0] ?? null;

    it('shows the posture named by the first word of the AI use terms', () => {
      const html = guidanceOf('Silent on use terms, no explicit AI terms');
      expect(html).toContain('AI SILENT — how to proceed');
      expect(html).toContain('background-color: #f3f4f6');
    });

    it('numbers the steps in their stored order', () => {
      const html = guidanceOf('silent');
      expect(html).toContain('list-decimal');
      expect(html.indexOf('Check the terms.')).toBeLessThan(html.indexOf('Ask your PM.'));
    });

    it('is left out when the first word names no ruling', () => {
      expect(guidanceOf('no language regarding AI')).toBeNull();
    });

    it('is left out when the ruling has no posture record yet', () => {
      expect(guidanceOf('Conditional, TO Silent')).toBeNull();
    });

    it('sits directly before the rulings list', () => {
      const html = renderContractDetail(contract({ ai_use_terms: 'Silent' }), rulings);
      const at = html.indexOf('aria-label="AI posture guidance"');
      expect(html.indexOf('Scripted responses to client questions about AI')).toBeLessThan(at);
      expect(at).toBeLessThan(html.indexOf('id="ai-rulings"'));
    });

    it('escapes the posture label and steps, which are stored records', () => {
      const list = rulingsFromPostures([{ id: 'silent', color: '#f3f4f6', label: '<b>L</b>', steps: ['<i>s</i>'] }]);
      const html = guidanceOf('Silent', list);
      expect(html).not.toContain('<b>L</b>');
      expect(html).not.toContain('<i>s</i>');
    });
  });

  describe('the rulings list', () => {
    it('comes last, after the resources', () => {
      const html = renderContractDetail(contract(), rulings);
      expect(html.indexOf('Scripted responses to client questions about AI')).toBeLessThan(html.indexOf('id="ai-rulings"'));
    });

    it('lists every ruling with its colour and definition', () => {
      const html = renderContractDetail(contract(), rulings);
      const list = html.slice(html.indexOf('id="ai-rulings"'));
      expect(list).toContain('5 AI Rulings and Definitions');
      for (const r of rulings) {
        if (r.fill) expect(list).toContain(`background-color: ${r.fill}`);
        expect(list).toContain(`>${r.name}</span>`);
      }
      expect(list).toContain('border border-gray-300 bg-white text-gray-900">Conditional</span>');
      expect(list).toContain('You cannot use AI on this contract.');
      expect(list).toContain('This means the contract allows us to use AI.');
    });

    it('takes each definition from its posture record, and says when there is none', () => {
      const html = renderContractDetail(contract(), rulings);
      const list = html.slice(html.indexOf('id="ai-rulings"'));
      const rowOf = (name) => list.slice(list.indexOf(`>${name}</span>`)).split('</div>')[0];
      expect(rowOf('Prohibited')).toContain('You cannot use AI on this contract.');
      // A record with no definition, and a ruling with no record at all.
      expect(rowOf('Restricted')).toContain('None listed');
      expect(rowOf('Conditional')).toContain('None listed');
    });

    it('escapes a definition, which an admin typed', () => {
      const list = rulingsFromPostures([{ id: 'allowed', color: '#e7f1e0', definition: '<img src=x>' }]);
      expect(renderContractDetail(contract(), list)).not.toContain('<img src=x>');
    });
  });

  it('orders the sections as the design does', () => {
    const html = renderContractDetail(contract(), rulings);
    const order = [
      'What the Contract says about AI',
      'Practical guidance and more information',
      'Resources',
      'Pre-use checklist',
      'Scripted responses to client questions about AI',
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
    const html = card({ project: '', contract_id: 'labs-blank' });
    expect(html).toContain('labs-blank');
  });

  it('falls back to the id on the detail heading', () => {
    const html = renderContractDetail(contract({ project: '', contract_id: 'labs-blank' }), rulings);
    expect(html).toContain('labs-blank');
  });
});
