import { describe, it, expect } from 'vitest';
import {
  SyncInitiativesError,
  EXPECTED_TAB_TITLE,
  HEADER_ROW,
  ID_COLUMNS,
  EXCLUDED_HEADERS,
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
  PROJECT_ATTR,
  USE_CASE_ATTR,
  EXPOSURE_ATTR,
  TAGS_ATTR,
} from '../functions/api/lib/initiatives.mjs';

// The v2 tab's sixteen headers, in sheet order, as measured 2026-08-24.
const HEADERS = [
  'Title', 'Summary', 'Description', 'Practice', 'Exposure', 'Contacts',
  'Project', 'Link', 'Submitted By', 'Timestamp', 'Source Location', 'id',
  'Use Case', 'AI Governance', 'tags', 'status',
];

// Every header except `id`, which is the key source and deliberately not carried.
const CARRIED_HEADERS = HEADERS.filter((h) => h !== 'id');

// Values here are SYNTHETIC. They reproduce the shapes the real sheet contains —
// semicolon-separated lists, free-text dates, em dashes and ampersands in titles —
// without copying non-public initiative names into a public repo.
const row = (over = {}) => {
  const cells = {
    id: 'init-2',
    Title: 'Benefits navigator prototype',
    Summary: 'Prototype for a multi-benefit navigator.',
    Description: 'Exploring a navigator for multiple benefit types.',
    Practice: '',
    Exposure: 'Client',
    Contacts: 'Ada Lovelace; Grace Hopper',
    Project: 'User-Facing AI',
    Link: 'Demo: https://example.gov/demo',
    'Submitted By': 'Ada Lovelace',
    Timestamp: 'Jun 25, 2026, 7:00:00 PM',
    'Source Location': '',
    'Use Case': 'AI-powered benefits assistant',
    'AI Governance': '',
    tags: 'internal',
    status: 'Apr 7–14, 2026',
    ...over,
  };
  return HEADERS.map((h) => cells[h] ?? '');
};

const grid = (rows, headers = HEADERS) => [headers, ...rows];

const stored = (id, over = {}) => ({
  record_type: 'initiative',
  initiative_id: id,
  ...Object.fromEntries(CARRIED_HEADERS.map((h) => [slugAttribute(h), ''])),
  first_seen_at: '2026-01-01T00:00:00.000Z',
  last_synced_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('constants', () => {
  it('pins the tab title and the header row measured from the workbook', () => {
    expect(EXPECTED_TAB_TITLE).toBe('v2');
    // Verified, not assumed: the projects tab needed row 6 and the contracts tab
    // row 2. This one genuinely starts at the top.
    expect(HEADER_ROW).toBe(0);
  });

  it('keys on the sheet id column, not the title', () => {
    // The change this whole migration turns on. Under the previous rule a retitle
    // re-keyed the record; see the reconcile test that pins the new behaviour.
    expect(ID_COLUMNS).toEqual(['id']);
  });

  it('does not carry the key source as a duplicate attribute', () => {
    expect(EXCLUDED_HEADERS).toContain('id');
  });

  it('requires the key source, the title, the join column, and the three facets', () => {
    expect(REQUIRED_HEADERS).toContain('id');
    expect(REQUIRED_HEADERS).toContain('Title');
    expect(REQUIRED_HEADERS).toContain('Project');
    expect(REQUIRED_HEADERS).toContain('Use Case');
    expect(REQUIRED_HEADERS).toContain('Exposure');
    expect(REQUIRED_HEADERS).toContain('tags');
  });

  it('reserves the attributes the population writes itself', () => {
    expect(RESERVED_ATTRIBUTES).toEqual(
      expect.arrayContaining(['record_type', 'initiative_id', 'first_seen_at', 'last_synced_at']),
    );
  });

  it('carries a floor and two fractions calibrated to 46 rows', () => {
    expect(ABSOLUTE_FLOOR).toBe(38);
    expect(MAX_DELETE_FRACTION).toBe(0.1);
    expect(MAX_ROW_DROP_FRACTION).toBe(0.1);
  });
});

describe('slugAttribute', () => {
  it('maps all sixteen v2 headers to their expected slugs', () => {
    expect(HEADERS.map(slugAttribute)).toEqual([
      'title', 'summary', 'description', 'practice', 'exposure', 'contacts',
      'project', 'link', 'submitted_by', 'timestamp', 'source_location', 'id',
      'use_case', 'ai_governance', 'tags', 'status',
    ]);
  });

  it('splits a two-word header on its space', () => {
    expect(slugAttribute('Submitted By')).toBe('submitted_by');
    expect(slugAttribute('AI Governance')).toBe('ai_governance');
  });

  it('reproduces the attribute names functions/api/lib/initiatives.mjs declares', () => {
    // A mismatch here reports zero findings from the resolution check — a false
    // all-clear rather than a visible failure. This is the assertion that catches it.
    expect(slugAttribute('Title')).toBe(TITLE_ATTR);
    expect(slugAttribute('Project')).toBe(PROJECT_ATTR);
    expect(slugAttribute('Use Case')).toBe(USE_CASE_ATTR);
    expect(slugAttribute('Exposure')).toBe(EXPOSURE_ATTR);
    expect(slugAttribute('tags')).toBe(TAGS_ATTR);
  });
});

describe('slugInitiativeId', () => {
  it('passes the sheet ids through unchanged', () => {
    // The reason the id column is usable as a key as-is: every real value is
    // already lowercase [a-z0-9-], so this is a no-op across the whole sheet.
    for (const id of ['init-2', 'init-19', 'init-47']) {
      expect(slugInitiativeId(id)).toBe(id);
    }
  });

  it('normalizes a malformed id rather than trusting the sheet', () => {
    // Nothing enforces the id format at write time, and this value reaches a URL.
    expect(slugInitiativeId('  INIT 48 ')).toBe('init-48');
    expect(slugInitiativeId('init_49')).toBe('init-49');
  });

  it('collapses punctuation runs without leaving doubled hyphens', () => {
    const id = slugInitiativeId('init — (48)');
    expect(id).not.toMatch(/--/);
    expect(id).not.toMatch(/^-|-$/);
  });

  it('does not truncate, so two long ids stay distinguishable', () => {
    // Truncation would manufacture collisions, which is the one failure this
    // function must not introduce.
    const a = slugInitiativeId(`${'part-'.repeat(17)}alpha`);
    const b = slugInitiativeId(`${'part-'.repeat(17)}beta`);
    expect(a.length).toBeGreaterThan(60);
    expect(a).not.toBe(b);
  });

  it('returns an empty string for an id of only punctuation', () => {
    expect(slugInitiativeId('—')).toBe('');
    expect(slugInitiativeId('')).toBe('');
  });
});

describe('shapeInitiatives', () => {
  it('keys rows by the id cell and carries every column except the key source', () => {
    const result = shapeInitiatives(grid([
      row({ id: 'init-2' }),
      row({ id: 'init-3' }),
      row({ id: 'init-4' }),
    ]));

    expect(Object.keys(result.initiatives).sort()).toEqual(['init-2', 'init-3', 'init-4']);

    const first = result.initiatives['init-2'];
    for (const header of CARRIED_HEADERS) {
      expect(first).toHaveProperty(slugAttribute(header));
    }
    expect(first.initiative_id).toBe('init-2');
  });

  it('does not carry the id column as a duplicate attribute', () => {
    // Otherwise every record holds initiative_id and an identical id, leaving a
    // reader two candidate keys and no rule for choosing.
    const result = shapeInitiatives(grid([row({ id: 'init-2' })]));
    expect(Object.hasOwn(result.initiatives['init-2'], 'id')).toBe(false);
    expect(result.initiatives['init-2'].initiative_id).toBe('init-2');
  });

  it('carries the renamed and added v2 columns under their new attributes', () => {
    const result = shapeInitiatives(grid([row({
      id: 'init-2',
      'Use Case': 'AI-powered benefits assistant',
      Project: 'User-Facing AI',
      'Submitted By': 'Ada Lovelace',
      'AI Governance': 'Reviewed',
    })]));

    const record = result.initiatives['init-2'];
    expect(record.use_case).toBe('AI-powered benefits assistant');
    expect(record.project).toBe('User-Facing AI');
    expect(record.submitted_by).toBe('Ada Lovelace');
    expect(record.ai_governance).toBe('Reviewed');
  });

  it('keeps title as a carried attribute, since the page renders it', () => {
    const result = shapeInitiatives(grid([row({ id: 'init-2', Title: 'Alpha initiative' })]));
    expect(result.initiatives['init-2'].title).toBe('Alpha initiative');
  });

  it('reports the header text behind each attribute', () => {
    const result = shapeInitiatives(grid([row()]));
    expect(result.columnHeaders.use_case).toBe('Use Case');
    expect(result.columnHeaders.project).toBe('Project');
  });

  it('leaves multi-value cells byte-identical — shaping parses nothing', () => {
    const contacts = 'Ada Lovelace; Grace Hopper; Katherine Johnson';
    const link = 'Demo: https://example.gov/a; Notes: https://example.gov/b';
    const result = shapeInitiatives(grid([row({ id: 'init-2', Contacts: contacts, Link: link })]));
    expect(result.initiatives['init-2'].contacts).toBe(contacts);
    expect(result.initiatives['init-2'].link).toBe(link);
  });

  it('records an empty cell as an empty string, never undefined or null', () => {
    const result = shapeInitiatives(grid([row({ id: 'init-2', status: '' })]));
    expect(result.initiatives['init-2'].status).toBe('');
    expect(Object.hasOwn(result.initiatives['init-2'], 'status')).toBe(true);
  });

  it('imports a row with no exposure, use case, or description', () => {
    // The shape of 9 of the 46 real rows: Substack and marketing entries carrying
    // a Summary instead. Requiring those cells would reject the sheet as it is.
    const result = shapeInitiatives(grid([row({
      id: 'init-40', Exposure: '', 'Use Case': '', Description: '', Summary: 'A field note.',
    })]));

    const record = result.initiatives['init-40'];
    expect(record.exposure).toBe('');
    expect(record.use_case).toBe('');
    expect(record.description).toBe('');
    expect(record.summary).toBe('A field note.');
  });

  it('skips and counts a fully blank spacer row', () => {
    const result = shapeInitiatives(grid([
      row({ id: 'init-2' }),
      HEADERS.map(() => ''),
      row({ id: 'init-3' }),
    ]));
    expect(Object.keys(result.initiatives)).toHaveLength(2);
    expect(result.skippedBlankRows).toBe(1);
  });

  it('treats a row holding only an id as blank, since id is not carried', () => {
    // A consequence of excluding the key source from the carry: the populated-row
    // test reads carried cells only. Pinned so it stays a choice, not an accident.
    const idOnly = HEADERS.map((h) => (h === 'id' ? 'init-99' : ''));
    const result = shapeInitiatives(grid([row({ id: 'init-2' }), idOnly]));
    expect(Object.keys(result.initiatives)).toEqual(['init-2']);
    expect(result.skippedBlankRows).toBe(1);
  });

  it('throws naming the missing key column when id is absent', () => {
    const headers = HEADERS.filter((h) => h !== 'id');
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(SyncInitiativesError);
    expect(() => shapeInitiatives(cells)).toThrow(/id/);
  });

  it('throws when Project is absent rather than treating every row as unlinked', () => {
    const headers = HEADERS.filter((h) => h !== 'Project');
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/Project/);
  });

  it('names the expected grid index and sheet row when the header row is empty', () => {
    expect(() => shapeInitiatives([[], []])).toThrow(/grid index 0.*sheet row 1/s);
  });

  it('throws when two headers slug to the same attribute', () => {
    const headers = [...HEADERS, 'use_case'];
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/Use Case.*use_case/s);
  });

  it('throws when a header slugs onto an attribute the population writes', () => {
    const headers = [...HEADERS, 'initiativeId'];
    const cells = [headers, headers.map(() => 'x')];
    expect(() => shapeInitiatives(cells)).toThrow(/initiative_id/);
  });

  it('throws naming the sheet row when a populated row slugs to an empty id', () => {
    const cells = grid([row({ id: '—' })]);
    expect(() => shapeInitiatives(cells)).toThrow(/Sheet row 2/);
    expect(() => shapeInitiatives(cells)).toThrow(/id/);
  });

  it('throws naming both sheet rows when two rows share an id', () => {
    // A copied row is the usual cause. This is the uniqueness guard.
    const cells = grid([
      row({ id: 'init-2', Title: 'AskCA chatbot' }),
      row({ id: 'init-2', Title: 'Something else' }),
    ]);
    expect(() => shapeInitiatives(cells)).toThrow(/row 2.*row 3/s);
  });
});

describe('reconcile', () => {
  const incoming = (over = {}) => ({
    'init-2': { initiative_id: 'init-2', title: 'Alpha', exposure: 'Client', ...over },
  });

  it('reports nothing for an unchanged re-run', () => {
    const diff = reconcile(incoming(), {
      'init-2': stored('init-2', { title: 'Alpha', exposure: 'Client' }),
    });
    expect(diff).toEqual({ creates: [], updates: [], deletes: [] });
  });

  it('reports an unseen id as a create', () => {
    const diff = reconcile(incoming(), {});
    expect(diff.creates.map((c) => c.initiative_id)).toEqual(['init-2']);
    expect(diff.updates).toHaveLength(0);
  });

  it('reports a changed carried attribute as an update', () => {
    const diff = reconcile(incoming({ exposure: 'Internal' }), {
      'init-2': stored('init-2', { title: 'Alpha', exposure: 'Client' }),
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.creates).toHaveLength(0);
  });

  it('carries first_seen_at forward onto an update', () => {
    const diff = reconcile(incoming({ exposure: 'Internal' }), {
      'init-2': stored('init-2', {
        title: 'Alpha', exposure: 'Client', first_seen_at: '2025-06-01T00:00:00.000Z',
      }),
    });
    expect(diff.updates[0].first_seen_at).toBe('2025-06-01T00:00:00.000Z');
  });

  it('ignores a last_synced_at-only difference', () => {
    // Without this, all 46 rows report as updated on every run forever and the
    // counts stop answering "did anything change?".
    const diff = reconcile(incoming(), {
      'init-2': stored('init-2', {
        title: 'Alpha', exposure: 'Client', last_synced_at: '2026-08-24T00:00:00.000Z',
      }),
    });
    expect(diff.updates).toHaveLength(0);
  });

  it('reports a stored id absent from the sheet as a delete', () => {
    const diff = reconcile(incoming(), {
      'init-2': stored('init-2', { title: 'Alpha', exposure: 'Client' }),
      'init-99': stored('init-99'),
    });
    expect(diff.deletes).toEqual(['init-99']);
  });

  it('turns a retitle into a plain update, since the key comes from the id column', () => {
    // The inverse of the previous behaviour, and the point of the migration. Under
    // a title-derived key this was one create plus one delete, `first_seen_at` did
    // not survive, and the URL changed. Pinned because four places used to document
    // that cost and a reader who remembers it needs to see the change.
    const diff = reconcile(
      { 'init-2': { initiative_id: 'init-2', title: 'Alpha renamed' } },
      { 'init-2': stored('init-2', { title: 'Alpha' }) },
    );
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].title).toBe('Alpha renamed');
    expect(diff.creates).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
  });

  it('still reports a re-keyed row as one create plus one delete', () => {
    // Only the sheet's id column can cause this now — a renumbering or re-sort.
    const diff = reconcile(
      { 'init-9': { initiative_id: 'init-9', title: 'Alpha' } },
      { 'init-2': stored('init-2', { title: 'Alpha' }) },
    );
    expect(diff.creates.map((c) => c.initiative_id)).toEqual(['init-9']);
    expect(diff.deletes).toEqual(['init-2']);
    expect(diff.updates).toHaveLength(0);
  });
});

describe('safetyVerdict', () => {
  const verdict = (over = {}) => safetyVerdict({
    incoming: 46, storedCount: 46, deletes: 0, baseline: 46, ...over,
  });

  it('permits a clean run', () => {
    expect(verdict()).toBeNull();
  });

  it('refuses zero incoming rows, and never overridably', () => {
    expect(verdict({ incoming: 0 })).toMatch(/zero rows/);
    expect(verdict({ incoming: 0, override: true })).toMatch(/never overridable/);
  });

  it('refuses at 5 deletes against 46 stored, and permits them under override', () => {
    // The measured small-N arithmetic: 10% of 46 is 4.6, so 5 refuses and 4 does
    // not. Pinned so changing a constant is a visible test change.
    expect(verdict({ deletes: 4 })).toBeNull();
    expect(verdict({ deletes: 5 })).toMatch(/would delete 5 of 46/);
    expect(verdict({ deletes: 5, override: true })).toBeNull();
  });

  it('tells the operator a renumbered id column looks like this, not a retitle', () => {
    // The message is the whole value of this refusal — it is what stops someone
    // reaching for --force on a mass re-key.
    expect(verdict({ deletes: 46 })).toMatch(/renumbered id column/);
    expect(verdict({ deletes: 46 })).toMatch(/Retitling initiatives does NOT cause this/);
  });

  it('refuses a row-count drop past the fraction, and permits it under override', () => {
    expect(verdict({ incoming: 42 })).toBeNull();
    expect(verdict({ incoming: 41 })).toMatch(/41 rows against a previous 46/);
    expect(verdict({ incoming: 41, override: true })).toBeNull();
  });

  it('refuses below the absolute floor, and permits it under override', () => {
    // Reached by a baseline that has already walked down, which is the compounding
    // drain the per-run ceiling cannot see.
    expect(verdict({ incoming: 37, baseline: 38, storedCount: 38 })).toMatch(/absolute floor of 38/);
    expect(verdict({ incoming: 37, baseline: 38, storedCount: 38, override: true })).toBeNull();
  });

  it('permits any delete count against an empty table, so a first run is never blocked', () => {
    // This is also the state the purge leaves behind: the ceiling and the floor are
    // both inactive on the run that repopulates. Deliberate, and documented in
    // scripts/purge-initiatives.mjs.
    expect(safetyVerdict({ incoming: 46, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
    expect(safetyVerdict({ incoming: 5, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
  });

  it('skips the baseline check when there is no baseline, rather than throwing', () => {
    expect(safetyVerdict({ incoming: 46, storedCount: 46, deletes: 0, baseline: null })).toBeNull();
    expect(
      safetyVerdict({ incoming: 46, storedCount: 46, deletes: 0, baseline: undefined }),
    ).toBeNull();
  });
});
