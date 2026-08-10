import { describe, it, expect } from 'vitest';
import {
  SyncInitiativesError,
  EXPECTED_TAB_TITLE,
  HEADER_ROW,
  ID_COLUMNS,
  REQUIRED_HEADERS,
  RESERVED_ATTRIBUTES,
  MAX_DELETE_FRACTION,
  MAX_ROW_DROP_FRACTION,
  ABSOLUTE_FLOOR,
  slugAttribute,
  slugInitiativeId,
  shapeInitiatives,
  reconcile,
  safetyVerdict,
} from '../scripts/lib/sync-initiatives.mjs';
import {
  TITLE_ATTR,
  PROJECT_NAME_ATTR,
  USE_CASE_LABEL_ATTR,
  EXPOSURE_ATTR,
  TAGS_ATTR,
} from '../functions/api/lib/initiatives.mjs';

// The workbook's ten machine headers, in sheet order, as measured 2026-08-10.
const HEADERS = [
  'title', 'desc', 'useCaseLabel', 'useCaseTheme', 'exposure',
  'people', 'status', 'tags', 'links', 'projectName',
];

// Titles here are SYNTHETIC. They reproduce the punctuation and length classes
// the real sheet contains — em dash, ampersand, apostrophe, parentheses, and a
// ~90-character maximum — without copying non-public initiative names into a
// public repo. The equivalent assertion over all 37 real titles is a manual
// verification step, not a committed test, for that reason.
const row = (over = {}) => {
  const cells = {
    title: 'Benefits navigator prototype',
    desc: 'Exploring a navigator for multiple benefit types.',
    useCaseLabel: 'AI-powered benefits assistant',
    useCaseTheme: 'AI-powered assistant that makes it easier to access benefits',
    exposure: 'client',
    people: 'Ada Lovelace; Grace Hopper',
    status: 'Apr 7–14, 2026',
    tags: 'internal',
    links: 'Demo: https://example.gov/demo',
    projectName: 'User-Facing AI',
    ...over,
  };
  return HEADERS.map((h) => cells[h] ?? '');
};

const grid = (rows, headers = HEADERS) => [headers, ...rows];

const stored = (id, over = {}) => ({
  record_type: 'initiative',
  initiative_id: id,
  ...Object.fromEntries(HEADERS.map((h) => [slugAttribute(h), ''])),
  first_seen_at: '2026-01-01T00:00:00.000Z',
  last_synced_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('constants', () => {
  it('pins the tab title and the header row measured from the workbook', () => {
    expect(EXPECTED_TAB_TITLE).toBe('from initiatives.json');
    // Verified, not assumed: the projects tab needed row 6 and the contracts tab
    // row 2. This one genuinely starts at the top.
    expect(HEADER_ROW).toBe(0);
  });

  it('keys on title alone', () => {
    expect(ID_COLUMNS).toEqual(['title']);
  });

  it('requires the key source, the join column, and the three filter facets', () => {
    expect(REQUIRED_HEADERS).toContain('title');
    expect(REQUIRED_HEADERS).toContain('projectName');
    expect(REQUIRED_HEADERS).toContain('useCaseLabel');
    expect(REQUIRED_HEADERS).toContain('exposure');
    expect(REQUIRED_HEADERS).toContain('tags');
  });

  it('reserves the attributes the population writes itself', () => {
    expect(RESERVED_ATTRIBUTES).toEqual(
      expect.arrayContaining(['record_type', 'initiative_id', 'first_seen_at', 'last_synced_at']),
    );
  });

  it('carries a floor and two fractions calibrated to 37 rows', () => {
    expect(ABSOLUTE_FLOOR).toBe(30);
    expect(MAX_DELETE_FRACTION).toBe(0.1);
    expect(MAX_ROW_DROP_FRACTION).toBe(0.1);
  });
});

describe('slugAttribute', () => {
  it('maps all ten real headers to their expected slugs', () => {
    expect(HEADERS.map(slugAttribute)).toEqual([
      'title', 'desc', 'use_case_label', 'use_case_theme', 'exposure',
      'people', 'status', 'tags', 'links', 'project_name',
    ]);
  });

  it('reproduces the attribute names functions/api/lib/initiatives.mjs declares', () => {
    // A mismatch here reports zero findings from the resolution check — a false
    // all-clear rather than a visible failure. This is the assertion that catches it.
    expect(slugAttribute('title')).toBe(TITLE_ATTR);
    expect(slugAttribute('projectName')).toBe(PROJECT_NAME_ATTR);
    expect(slugAttribute('useCaseLabel')).toBe(USE_CASE_LABEL_ATTR);
    expect(slugAttribute('exposure')).toBe(EXPOSURE_ATTR);
    expect(slugAttribute('tags')).toBe(TAGS_ATTR);
  });
});

describe('slugInitiativeId', () => {
  it('collapses em dashes and parentheses without leaving doubled hyphens', () => {
    const id = slugInitiativeId('Government Services Navigator prototype — (user-facing AI Team)');
    expect(id).toBe('government-services-navigator-prototype-user-facing-ai-team');
    expect(id).not.toMatch(/--/);
    expect(id).not.toMatch(/^-|-$/);
  });

  it('collapses apostrophes and ampersands without leaving doubled hyphens', () => {
    const id = slugInitiativeId("Agency's SNAP upload MVP & AI-assisted verification");
    expect(id).toBe('agency-s-snap-upload-mvp-ai-assisted-verification');
    expect(id).not.toMatch(/--/);
  });

  it('is stable under case and surrounding whitespace', () => {
    expect(slugInitiativeId('  AskCA  ')).toBe(slugInitiativeId('askca'));
  });

  it('does not truncate, so two long titles stay distinguishable', () => {
    // The removed `id` column truncated at 60 characters, which is exactly how two
    // similar titles would have collided. No cap here; the duplicate check is the
    // uniqueness guard.
    const a = slugInitiativeId(`${'word '.repeat(17)}alpha`);
    const b = slugInitiativeId(`${'word '.repeat(17)}beta`);
    expect(a.length).toBeGreaterThan(60);
    expect(a).not.toBe(b);
  });

  it('returns an empty string for a title of only punctuation', () => {
    expect(slugInitiativeId('—')).toBe('');
    expect(slugInitiativeId('')).toBe('');
  });
});

describe('shapeInitiatives', () => {
  it('keys rows by the title slug and carries all ten columns', () => {
    const result = shapeInitiatives(grid([
      row({ title: 'Alpha initiative' }),
      row({ title: 'Beta initiative' }),
      row({ title: 'Gamma initiative' }),
    ]));

    expect(Object.keys(result.initiatives).sort()).toEqual([
      'alpha-initiative', 'beta-initiative', 'gamma-initiative',
    ]);

    const alpha = result.initiatives['alpha-initiative'];
    for (const header of HEADERS) {
      expect(alpha).toHaveProperty(slugAttribute(header));
    }
    expect(alpha.initiative_id).toBe('alpha-initiative');
  });

  it('keeps title as a carried attribute, since the page renders it', () => {
    const result = shapeInitiatives(grid([row({ title: 'Alpha initiative' })]));
    expect(result.initiatives['alpha-initiative'].title).toBe('Alpha initiative');
  });

  it('reports the header text behind each attribute', () => {
    const result = shapeInitiatives(grid([row()]));
    expect(result.columnHeaders.use_case_label).toBe('useCaseLabel');
    expect(result.columnHeaders.project_name).toBe('projectName');
  });

  it('leaves multi-value cells byte-identical — shaping parses nothing', () => {
    const people = 'Ada Lovelace; Grace Hopper; Katherine Johnson';
    const links = 'Demo: https://example.gov/a; Notes: https://example.gov/b';
    const result = shapeInitiatives(grid([row({ title: 'Alpha', people, links })]));
    expect(result.initiatives.alpha.people).toBe(people);
    expect(result.initiatives.alpha.links).toBe(links);
  });

  it('records an empty cell as an empty string, never undefined or null', () => {
    const result = shapeInitiatives(grid([row({ title: 'Alpha', status: '' })]));
    expect(result.initiatives.alpha.status).toBe('');
    expect(Object.hasOwn(result.initiatives.alpha, 'status')).toBe(true);
  });

  it('skips and counts a fully blank spacer row', () => {
    const result = shapeInitiatives(grid([
      row({ title: 'Alpha' }),
      HEADERS.map(() => ''),
      row({ title: 'Beta' }),
    ]));
    expect(Object.keys(result.initiatives)).toHaveLength(2);
    expect(result.skippedBlankRows).toBe(1);
  });

  it('throws naming the missing key column when title is absent', () => {
    const headers = HEADERS.filter((h) => h !== 'title');
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(SyncInitiativesError);
    expect(() => shapeInitiatives(cells)).toThrow(/title/);
  });

  it('throws when projectName is absent rather than treating every row as unlinked', () => {
    const headers = HEADERS.filter((h) => h !== 'projectName');
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/projectName/);
  });

  it('names the expected grid index and sheet row when the header row is empty', () => {
    expect(() => shapeInitiatives([[], []])).toThrow(/grid index 0.*sheet row 1/s);
  });

  it('throws when two headers slug to the same attribute', () => {
    const headers = [...HEADERS, 'project_name'];
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/projectName.*project_name/s);
  });

  it('throws when a header slugs onto an attribute the population writes', () => {
    const headers = [...HEADERS, 'initiativeId'];
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/initiative_id/);
  });

  it('throws naming the sheet row when a populated row slugs to an empty id', () => {
    const cells = grid([row({ title: '—' })]);
    expect(() => shapeInitiatives(cells)).toThrow(/Sheet row 2/);
    expect(() => shapeInitiatives(cells)).toThrow(/title/);
  });

  it('throws naming both sheet rows when two titles slug to the same id', () => {
    // Two titles differing only in punctuation. This is the collision the removed
    // `id` column used to prevent, and it is now the primary uniqueness guard.
    const cells = grid([
      row({ title: 'AskCA chatbot' }),
      row({ title: 'AskCA — chatbot' }),
    ]);
    expect(() => shapeInitiatives(cells)).toThrow(/row 2.*row 3/s);
  });
});

describe('reconcile', () => {
  const incoming = (over = {}) => ({
    alpha: { initiative_id: 'alpha', title: 'Alpha', exposure: 'client', ...over },
  });

  it('reports nothing for an unchanged re-run', () => {
    const diff = reconcile(incoming(), {
      alpha: stored('alpha', { title: 'Alpha', exposure: 'client' }),
    });
    expect(diff).toEqual({ creates: [], updates: [], deletes: [] });
  });

  it('reports an unseen id as a create', () => {
    const diff = reconcile(incoming(), {});
    expect(diff.creates.map((c) => c.initiative_id)).toEqual(['alpha']);
    expect(diff.updates).toHaveLength(0);
  });

  it('reports a changed carried attribute as an update', () => {
    const diff = reconcile(incoming({ exposure: 'internal' }), {
      alpha: stored('alpha', { title: 'Alpha', exposure: 'client' }),
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.creates).toHaveLength(0);
  });

  it('carries first_seen_at forward onto an update', () => {
    const diff = reconcile(incoming({ exposure: 'internal' }), {
      alpha: stored('alpha', {
        title: 'Alpha', exposure: 'client', first_seen_at: '2025-06-01T00:00:00.000Z',
      }),
    });
    expect(diff.updates[0].first_seen_at).toBe('2025-06-01T00:00:00.000Z');
  });

  it('ignores a last_synced_at-only difference', () => {
    // Without this, all 37 rows report as updated on every run forever and the
    // counts stop answering "did anything change?".
    const diff = reconcile(incoming(), {
      alpha: stored('alpha', {
        title: 'Alpha', exposure: 'client', last_synced_at: '2026-08-10T00:00:00.000Z',
      }),
    });
    expect(diff.updates).toHaveLength(0);
  });

  it('reports a stored id absent from the sheet as a delete', () => {
    const diff = reconcile(incoming(), {
      alpha: stored('alpha', { title: 'Alpha', exposure: 'client' }),
      orphan: stored('orphan'),
    });
    expect(diff.deletes).toEqual(['orphan']);
  });

  it('turns a retitle into one create plus one delete, not an update', () => {
    // The documented consequence of a title-derived key. Pinned so it is
    // discovered here rather than in production.
    const diff = reconcile(
      { 'alpha-renamed': { initiative_id: 'alpha-renamed', title: 'Alpha renamed' } },
      { alpha: stored('alpha', { title: 'Alpha' }) },
    );
    expect(diff.creates.map((c) => c.initiative_id)).toEqual(['alpha-renamed']);
    expect(diff.deletes).toEqual(['alpha']);
    expect(diff.updates).toHaveLength(0);
  });
});

describe('safetyVerdict', () => {
  const verdict = (over = {}) => safetyVerdict({
    incoming: 37, storedCount: 37, deletes: 0, baseline: 37, ...over,
  });

  it('permits a clean run', () => {
    expect(verdict()).toBeNull();
  });

  it('refuses zero incoming rows, and never overridably', () => {
    expect(verdict({ incoming: 0 })).toMatch(/zero rows/);
    expect(verdict({ incoming: 0, override: true })).toMatch(/never overridable/);
  });

  it('refuses at 4 deletes against 37 stored, and permits them under override', () => {
    // The measured small-N arithmetic: 10% of 37 is 3.7, so 4 refuses and 3 does
    // not. Pinned so changing a constant is a visible test change.
    expect(verdict({ deletes: 3 })).toBeNull();
    expect(verdict({ deletes: 4 })).toMatch(/would delete 4 of 37/);
    expect(verdict({ deletes: 4, override: true })).toBeNull();
  });

  it('refuses a row-count drop past the fraction, and permits it under override', () => {
    expect(verdict({ incoming: 34 })).toBeNull();
    expect(verdict({ incoming: 33 })).toMatch(/33 rows against a previous 37/);
    expect(verdict({ incoming: 33, override: true })).toBeNull();
  });

  it('refuses below the absolute floor, and permits it under override', () => {
    // Reached by a baseline that has already walked down, which is the compounding
    // drain the per-run ceiling cannot see.
    expect(verdict({ incoming: 29, baseline: 30, storedCount: 30 })).toMatch(/absolute floor of 30/);
    expect(verdict({ incoming: 29, baseline: 30, storedCount: 30, override: true })).toBeNull();
  });

  it('permits any delete count against an empty table, so a first run is never blocked', () => {
    expect(safetyVerdict({ incoming: 37, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
    expect(safetyVerdict({ incoming: 5, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
  });

  it('skips the baseline check when there is no baseline, rather than throwing', () => {
    expect(safetyVerdict({ incoming: 37, storedCount: 37, deletes: 0, baseline: null })).toBeNull();
    expect(
      safetyVerdict({ incoming: 37, storedCount: 37, deletes: 0, baseline: undefined }),
    ).toBeNull();
  });
});
