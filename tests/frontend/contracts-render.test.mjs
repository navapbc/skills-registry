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

  // The same badge the card carried, so the answer survives the click rather than
  // making the reader scroll to the posture section to re-find it.
  it('badges the posture at the top, beside the portfolio', () => {
    const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
    const badge = html.indexOf('background-color: #e0f5f0');
    expect(badge).toBeGreaterThan(-1);
    expect(badge).toBeLessThan(html.indexOf('<h1'));
  });

  it('says the posture is unrecorded in the top badge rather than omitting it', () => {
    const html = renderContractDetail(contract({ posture_id: null, ai_posture: '' }), byId, null);
    expect(html.indexOf('Posture not recorded')).toBeLessThan(html.indexOf('<h1'));
  });

  it('renders the posture label and its guidance steps in order', () => {
    const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, '2026-08-07T00:00:00Z');
    expect(html).toContain('AI ALLOWED');
    expect(html.indexOf('Step one.')).toBeLessThan(html.indexOf('Step two.'));
  });

  // Tailwind's preflight resets ol to list-style:none, so the class is what makes
  // the steps numbered at all. Without it the guidance reads as an unordered pile
  // and the order a reader is meant to work through is lost.
  it('numbers the guidance steps', () => {
    const html = renderContractDetail(contract({ posture_id: 'allowed' }), byId, null);
    expect(html).toMatch(/<ol[^>]*class="[^"]*list-decimal/);
    expect(html.match(/<li/g)).toHaveLength(2);
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

  // The prose answers get their own section and a full-width row each, so a
  // six-line answer cannot stretch a one-line neighbour in the two-column grid.
  it('puts the narrative answers in their own section, outside the details grid', () => {
    const html = renderContractDetail(
      contract({ usage: 'Drafting only.\n\nNever for decisions.', notes: 'Reviewed Q3.' }),
      byId, null,
    );
    expect(html).toContain('aria-label="Policy and AI use"');
    expect(html).toContain('Never for decisions.');
    expect(html).toContain('Reviewed Q3.');
    // Outside the grid: the narrative section opens after the details grid closes.
    expect(html.indexOf('grid-cols-1 sm:grid-cols-2'))
      .toBeLessThan(html.indexOf('aria-label="Policy and AI use"'));
  });

  // The section is a fixed part of the page. A record that answered none of it
  // still shows every label, so a reader can see what the survey did not cover.
  it('keeps the narrative section even when the survey answered none of it', () => {
    const html = renderContractDetail(contract(), byId, null);
    expect(html).toContain('aria-label="Policy and AI use"');
    expect(html).toContain('Agency review process');
    expect(html).toContain('None listed');
  });

  it('escapes narrative values, which are free text', () => {
    const html = renderContractDetail(contract({ notes: '<img src=x onerror=1>' }), byId, null);
    expect(html).not.toContain('<img src=x');
  });

  // The sheet is editable by any Nava staffer, so the URL is untrusted input.
  describe('the client policy link', () => {
    const linkFor = (client_policy_link) =>
      renderContractDetail(contract({ client_policy_link }), byId, null);

    it('links an http(s) URL and opens it safely in a new tab', () => {
      const html = linkFor('https://agency.gov/ai-policy');
      expect(html).toContain('href="https://agency.gov/ai-policy"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('assumes https for a scheme-less host rather than making it relative', () => {
      // A bare href would resolve against /contracts/<id> and 404 on our own site.
      expect(linkFor('docs.google.com/d/policy')).toContain('href="https://docs.google.com/d/policy"');
    });

    it('refuses to put a javascript: URL in an href', () => {
      const html = linkFor('javascript:alert(1)');
      expect(html).not.toContain('href="javascript:');
      expect(html).toContain('javascript:alert(1)');
    });

    it('leaves prose as text instead of guessing a link out of it', () => {
      const html = linkFor('N/A, see the attached memo');
      expect(html).not.toContain('<a href="https://N/A');
      expect(html).toContain('N/A, see the attached memo');
    });

    it('escapes the link text, which the sheet controls', () => {
      expect(linkFor('https://x.gov/"><img src=x>')).not.toContain('<img src=x>');
    });
  });

  describe('the AI tools row', () => {
    const toolsRow = (tools) => renderContractDetail(contract({ tools }), byId, null);

    it('lists the tools when the survey names any', () => {
      expect(toolsRow('Copilot, Claude')).toContain('Copilot, Claude');
    });

    // On a page about whether AI may be used, "none recorded" is a fact worth
    // stating rather than one to infer from a row that is not there.
    it('states that none are listed rather than dropping the row', () => {
      const html = toolsRow('');
      expect(html).toContain('AI tools used');
      expect(html).toContain('None listed');
    });

    // "N/A" is an answer someone typed. Rewriting it would hide what the record
    // says; only an empty cell is genuinely unanswered.
    it('shows a literal N/A as written rather than rewriting it', () => {
      expect(toolsRow('N/A')).toContain('N/A');
    });

    it('does not mistake a real tool name for an absent answer', () => {
      expect(toolsRow('NAVA Assistant')).toContain('NAVA Assistant');
    });
  });

  describe("the Nava AI policy row", () => {
    it('appends the policy link after the survey answer', () => {
      const html = renderContractDetail(contract({ nava_policy: 'Yes' }), byId, null);
      expect(html).toContain('Yes');
      expect(html).toContain('href="https://navasage.atlassian.net/wiki/spaces/NH/pages/763494410/AI+Tool+Use+Policy"');
      expect(html).toContain('Open policy');
    });

    // The link is a fixed destination, so it must not read as the sheet's answer.
    it('keeps the answer, rather than replacing it with the link', () => {
      const html = renderContractDetail(contract({ nava_policy: 'No program policy' }), byId, null);
      expect(html.indexOf('No program policy')).toBeLessThan(html.indexOf('Open policy'));
    });

    // The policy exists whether or not this row mentions it, so a reader who sees
    // only "None listed" must still have somewhere to go.
    it('links the policy even when the survey left the answer blank', () => {
      const html = renderContractDetail(contract({ nava_policy: '' }), byId, null);
      expect(html).toContain('Open policy');
      expect(html).toContain('None listed');
    });
  });

  describe('the project name link', () => {
    const withProject = (extra) =>
      renderContractDetail(contract({ resolved_project: { ...project, ...extra } }), byId, null);

    it('links the project name to its Confluence space', () => {
      const html = withProject({ project_index_code: 'DOJCRP' });
      expect(html).toContain('href="https://navasage.atlassian.net/wiki/spaces/DOJCRP"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('escapes a space key rather than letting it break out of the href', () => {
      const html = withProject({ project_index_code: 'A B/"><img src=x>' });
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('/wiki/spaces/A%20B%2F');
    });

    // A link built from a missing key lands on /wiki/spaces/ — a real page, and the
    // wrong one. Plain text is the honest rendering.
    it('leaves the name unlinked when the project has no space key', () => {
      const html = withProject({ project_index_code: '' });
      expect(html).toContain('DOJ Civil Rights Portal');
      // The fixed Nava policy link also lives under /wiki/spaces/, so this asserts
      // no anchor wraps the project name rather than no Confluence URL at all.
      expect(html).not.toContain('>DOJ Civil Rights Portal</a>');
    });
  });

  it('renders the resolved project details', () => {
    const html = renderContractDetail(contract({ resolved_project: project }), byId, null);
    expect(html).toContain('DOJ Civil Rights Portal');
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

  it('keeps the manager rows the sheet leaves blank, marked as unlisted', () => {
    const html = renderContractDetail(
      contract({ resolved_project: { ...project, program_manager: '', nava_contract_pp: '' } }),
      byId, null,
    );
    expect(html).toContain('Project program manager');
    expect(html).toContain('Contracts program manager');
    expect(html).toContain('None listed');
  });

  it('labels an empty archetype row rather than dropping it', () => {
    const html = renderContractDetail(contract({ resolved_project: project }), byId, null);
    expect(html).toContain('Additional archetype');
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

  // A missing row is indistinguishable from a field the page does not show, so
  // every label stays and the absent value is named.
  it('keeps rows for fields the survey left empty', () => {
    const html = renderContractDetail(contract({ notes: '', customer: '' }), byId, null);
    expect(html).toContain('>Notes<');
    expect(html).toContain('>Customer<');
    expect(html).toContain('None listed');
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
