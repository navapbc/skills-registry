import { describe, it, expect } from 'vitest';
import {
  renderPostureBadge,
  indexPostures,
  hasPosture,
  filterContracts,
  portfoliosOf,
  formatCapturedAt,
  renderContractCard,
  renderContractGrid,
  renderUnclassifiedToggle,
  renderContractDetail,
  countHiddenUnclassified,
  describePopulationNotice,
} from '../../src/lib/contracts-render.mjs';

const POSTURES = [
  { id: 'allowed', label: 'AI ALLOWED — how to proceed', color: '#e0f5f0', position: 1, steps: ['Step one.', 'Step two.'] },
  { id: 'silent', label: 'AI SILENT — how to proceed', color: '#faf0f7', position: 3, steps: ['Check the terms.'] },
];
const byId = indexPostures(POSTURES);

const contract = (over = {}) => ({
  contract_id: 'fedciv-sec-enterprise-websites',
  portfolio: 'FEDCIV',
  project: 'SEC ENTERPRISE WEBSITES',
  project_name: 'SEC Enterprise Websites',
  contract_num: '47QTCA18D008M',
  ai_posture: 'silent',
  posture_id: 'silent',
  ai_use_terms: 'TO Silent, BPA Restricted.',
  project: 'SEC ENTERPRISE WEBSITES',
  ...over,
});

describe('renderPostureBadge', () => {
  it('applies the posture colour as an inline style', () => {
    // An interpolated Tailwind class emits no CSS and the badge renders blank.
    const html = renderPostureBadge(POSTURES[0]);
    expect(html).toContain('style="background-color: #e0f5f0"');
    expect(html).not.toMatch(/bg-\[?#/);
  });

  it('renders a neutral badge when there is no posture', () => {
    expect(renderPostureBadge(null)).toMatch(/not recorded/i);
  });

  it('escapes a label from the records', () => {
    const html = renderPostureBadge({ id: 'x', label: '<script>x</script>', color: '#ffffff' });
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('filterContracts', () => {
  const set = [
    contract({ contract_id: 'a', posture_id: 'silent', portfolio: 'FEDCIV' }),
    contract({ contract_id: 'b', posture_id: 'allowed', portfolio: 'STATES' }),
    contract({ contract_id: 'c', posture_id: null, ai_posture: '', portfolio: 'BEAM', project: 'Riverside' }),
  ];

  it('hides contracts with no posture by default', () => {
    expect(filterContracts(set).map((c) => c.contract_id)).toEqual(['a', 'b']);
  });

  it('includes them when asked', () => {
    expect(filterContracts(set, { includeUnclassified: true })).toHaveLength(3);
  });

  it('narrows by posture', () => {
    expect(filterContracts(set, { posture: 'allowed' }).map((c) => c.contract_id)).toEqual(['b']);
  });

  it('narrows by portfolio', () => {
    expect(filterContracts(set, { portfolio: 'FEDCIV' }).map((c) => c.contract_id)).toEqual(['a']);
  });

  it('composes filters as an intersection', () => {
    expect(filterContracts(set, { posture: 'silent', portfolio: 'STATES' })).toHaveLength(0);
  });

  it('keeps the unclassified filter applied when another filter changes', () => {
    // Clearing one control must not silently clear the other.
    expect(filterContracts(set, { portfolio: 'BEAM' })).toHaveLength(0);
    expect(filterContracts(set, { portfolio: 'BEAM', includeUnclassified: true })).toHaveLength(1);
  });

  it('searches project, portfolio, and contract number', () => {
    expect(filterContracts(set, { query: 'sec enterprise' })).toHaveLength(2);
    expect(filterContracts(set, { query: '47QTCA' })).toHaveLength(2);
    expect(filterContracts(set, { query: 'riverside', includeUnclassified: true })).toHaveLength(1);
  });

  it('returns nothing for an empty input rather than throwing', () => {
    expect(filterContracts(undefined)).toEqual([]);
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
  it('shows the contract number as a parent when one exists', () => {
    expect(renderContractCard(contract(), byId)).toContain('47QTCA18D008M');
  });

  it('omits the parent line when no contract number exists', () => {
    const html = renderContractCard(contract({ contract_num: '' }), byId);
    expect(html).not.toContain('Contract <code');
  });

  it('lets records sharing a contract number read as related, not duplicated', () => {
    // 17 rows share one number in the real data.
    const a = renderContractCard(contract({ contract_id: 'a', project: 'SEC WEBSITES' }), byId);
    const b = renderContractCard(contract({ contract_id: 'b', project: 'SEC DEV TOOLS' }), byId);
    expect(a).toContain('47QTCA18D008M');
    expect(b).toContain('47QTCA18D008M');
    expect(a).toContain('SEC WEBSITES');
    expect(b).toContain('SEC DEV TOOLS');
  });

  it('links to the detail page by contract id', () => {
    expect(renderContractCard(contract(), byId))
      .toContain('href="/contracts/fedciv-sec-enterprise-websites"');
  });

  it('escapes survey-sourced values', () => {
    const html = renderContractCard(contract({ project: '<img src=x onerror=1>' }), byId);
    expect(html).not.toContain('<img src=x');
  });
});

describe('renderContractGrid', () => {
  it('renders one card per record', () => {
    const html = renderContractGrid([contract({ contract_id: 'a' }), contract({ contract_id: 'b' })], byId);
    expect(html.match(/contract-card/g)).toHaveLength(2);
  });

  it('renders an explicit empty state rather than a bare grid', () => {
    expect(renderContractGrid([], byId)).toMatch(/no contracts matched/i);
  });
});

describe('renderUnclassifiedToggle', () => {
  it('states how many are hidden', () => {
    expect(renderUnclassifiedToggle(82, false)).toContain('82');
    expect(renderUnclassifiedToggle(82, false)).toMatch(/no posture recorded/i);
  });

  it('offers to hide them again once shown', () => {
    expect(renderUnclassifiedToggle(82, true)).toMatch(/hide/i);
    expect(renderUnclassifiedToggle(82, true)).toContain('aria-pressed="true"');
  });

  it('says so plainly when nothing is hidden', () => {
    expect(renderUnclassifiedToggle(0, false)).toMatch(/every contract has a posture/i);
  });

  it('uses the singular for one hidden contract', () => {
    expect(renderUnclassifiedToggle(1, false)).toContain('1 contract with');
  });
});

describe('renderContractDetail', () => {
  const project = {
    project_code: 'FC001', project_name: 'DOJ Civil Rights Portal', portfolio: 'FEDCIV',
    agency: 'Department of Justice', archetype_primary: 'Product Team', archetype_additional: '',
    program_manager: 'Nancy Nussear', nava_contract_pp: 'Priya Contracts',
  };

  it('renders the posture label and its guidance steps in order', () => {
    const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, '2026-08-07T00:00:00Z');
    expect(html).toContain('AI ALLOWED');
    expect(html.indexOf('Step one.')).toBeLessThan(html.indexOf('Step two.'));
  });

  it('takes the posture colour from the record as an inline style', () => {
    const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
    expect(html).toContain('background-color: #e0f5f0');
  });

  it('says so plainly when no posture is recorded and falls back to the raw terms', () => {
    const html = renderContractDetail(
      contract({ posture_id: null, ai_posture: '', ai_use_terms: 'Silent on AI use.' }), byId, null,
    );
    expect(html).toMatch(/no ai posture recorded/i);
    expect(html).toContain('Silent on AI use.');
  });

  it('names an unresolvable posture value rather than hiding it', () => {
    const html = renderContractDetail(contract({ posture_id: null, ai_posture: 'prohibited' }), byId, null);
    expect(html).toContain('prohibited');
    expect(html).toMatch(/matches no posture on file/i);
  });

  it('renders the resolved project details', () => {
    const html = renderContractDetail(contract({ resolved_project: project }), byId, null);
    expect(html).toContain('DOJ Civil Rights Portal');
    expect(html).toContain('FC001');
    expect(html).toContain('Department of Justice');
    expect(html).toContain('Product Team');
    expect(html).not.toMatch(/no matching project/i);
  });

  // Three managers can appear on this page and they are often different people,
  // so each is labelled by which one it is.
  it('distinguishes the project, contracts, and engagement managers', () => {
    const html = renderContractDetail(
      contract({ resolved_project: project, nava_program_mgr: 'Other Person' }), byId, null,
    );
    expect(html).toContain('Project program manager');
    expect(html).toContain('Nancy Nussear');
    expect(html).toContain('Contracts program manager');
    expect(html).toContain('Priya Contracts');
    expect(html).toContain('Nava program manager');
    expect(html).toContain('Other Person');
  });

  it('omits the manager rows the sheet leaves blank', () => {
    const html = renderContractDetail(
      contract({ resolved_project: { ...project, program_manager: '', nava_contract_pp: '' } }),
      byId, null,
    );
    expect(html).not.toContain('Project program manager');
    expect(html).not.toContain('Contracts program manager');
  });

  it('omits an empty archetype row rather than showing a blank label', () => {
    const html = renderContractDetail(contract({ resolved_project: project }), byId, null);
    expect(html).not.toContain('Additional archetype');
  });

  it('marks the project link as missing when it did not resolve', () => {
    const html = renderContractDetail(contract({ project_name: 'MA PFML' }), byId, null);
    expect(html).toMatch(/no matching project/i);
    expect(html).toContain('MA PFML');
    // The posture answer does not depend on the join.
    expect(html).toContain('AI SILENT');
  });

  it('states the capture date', () => {
    expect(renderContractDetail(contract(), byId, '2026-08-07T18:53:15.161Z')).toMatch(/captured/i);
  });

  it('puts long clause text behind a disclosure so it cannot bury the posture', () => {
    const html = renderContractDetail(
      contract({ ai_use_terms_language: 'Para one.\n\nPara two.' }), byId, null,
    );
    expect(html).toContain('<details');
    expect(html.indexOf('AI SILENT')).toBeLessThan(html.indexOf('<details'));
  });

  it('omits rows for fields the survey left empty', () => {
    const html = renderContractDetail(contract({ notes: '', customer: '' }), byId, null);
    expect(html).not.toContain('>Notes<');
    expect(html).not.toContain('>Customer<');
  });

  it('offers no control that mutates data', () => {
    const html = renderContractDetail(contract(), byId, null);
    expect(html).not.toMatch(/<form|<button[^>]*type="submit"|contenteditable/i);
  });

  it('escapes clause text and field values', () => {
    const html = renderContractDetail(
      contract({ notes: '<script>alert(1)</script>', ai_use_terms_language: '<img src=x>' }), byId, null,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('hasPosture', () => {
  it('is false for a contract with no resolved posture', () => {
    expect(hasPosture(contract({ posture_id: null }))).toBe(false);
    expect(hasPosture(undefined)).toBe(false);
  });
  it('is true for a resolved one', () => {
    expect(hasPosture(contract())).toBe(true);
  });
});

describe('countHiddenUnclassified', () => {
  const set = [
    contract({ contract_id: 'a', posture_id: 'silent', portfolio: 'FEDCIV' }),
    contract({ contract_id: 'b', posture_id: null, ai_posture: '', portfolio: 'FEDCIV' }),
    contract({ contract_id: 'c', posture_id: null, ai_posture: '', portfolio: 'BEAM' }),
  ];

  it('counts contracts the default view is hiding', () => {
    expect(countHiddenUnclassified(set)).toBe(2);
  });

  it('respects the portfolio filter', () => {
    expect(countHiddenUnclassified(set, { portfolio: 'BEAM' })).toBe(1);
  });

  it('respects the search query', () => {
    expect(countHiddenUnclassified(set, { query: 'nomatch' })).toBe(0);
  });

  it('ignores the posture filter, which would always zero the count', () => {
    // Selecting a posture excludes every unclassified contract by definition, so
    // counting under it reports "nothing hidden" at the moment 2 are.
    expect(countHiddenUnclassified(set, { posture: 'silent' })).toBe(2);
  });
});

describe('renderUnclassifiedToggle with a posture filter active', () => {
  it('does not claim every contract has a posture while a posture filter narrows the set', () => {
    // The claim is false for 82 of 119 records and appeared the instant a user
    // picked a posture.
    expect(renderUnclassifiedToggle(0, false, true)).toBe('');
  });

  it('still makes the claim when nothing else is narrowing the set', () => {
    expect(renderUnclassifiedToggle(0, false, false)).toMatch(/every contract has a posture/i);
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
    const html = renderContractCard(contract({ project: '', contract_id: 'labs-blank' }), byId);
    expect(html).toContain('labs-blank');
  });

  it('falls back to the id on the detail heading', () => {
    const html = renderContractDetail(contract({ project: '', contract_id: 'labs-blank' }), byId, null);
    expect(html).toContain('labs-blank');
  });
});
