import { describe, it, expect } from 'vitest';
import {
  HEADER_ROW,
  COLUMN_ATTRIBUTES,
  EXCLUDED_HEADERS,
  MAX_DELETE_FRACTION,
  ABSOLUTE_FLOOR,
  SyncContractsError,
  normalizeHeader,
  slugContractId,
  shapeContracts,
  reconcile,
  safetyVerdict,
} from '../scripts/lib/sync-contracts.mjs';

// The real "Compliance" tab: row 1 banners, row 2 prose headers, data below. The
// headers are the tab's own, in its own column order.
const HEADERS = [
  'Contracts Team Member',
  ...Object.keys(COLUMN_ATTRIBUTES).slice(0, 18),
  'Nava steps for compliance',
  'Nava Compliance Status',
  'Needed for compliance',
  'Notes',
  'Publish to Project Indices and Contract Explorer (Yes/No)?',
];

const header = (attribute) => Object.keys(COLUMN_ATTRIBUTES).find((h) => COLUMN_ATTRIBUTES[h] === attribute);

function gridOf(...dataRows) {
  return [
    ['', '', '', '', '', '', '', '', '', '', '', 'Contracts to Complete'],
    HEADERS,
    ...dataRows,
  ];
}

/** A data row keyed by stored attribute or by excluded header, padded to the grid's width. */
function rowOf(values) {
  return HEADERS.map((h) => values[COLUMN_ATTRIBUTES[h]] ?? values[h] ?? '');
}

const SEC = {
  portfolio: 'FEDCIV',
  project: 'SEC ENTERPRISE WEBSITES',
  agreement_type: 'PRIME CONTRACTS',
  contract_num: '47QTCA18D008M',
  ai_use_terms: 'Conditional, TO Silent, BPA Restricted',
  nava_project_mgr: 'Someone Named',
  publish: 'Yes',
  'Contracts Team Member': 'Andrew',
  'Nava Compliance Status': 'confirmed',
  'Notes': 'internal note',
};

describe('the header map', () => {
  it('maps every carried header of the real tab, in its column order', () => {
    expect(HEADERS).toHaveLength(24);
    expect(HEADERS.at(-1)).toBe(header('publish'));
  });

  it('reads the prose header row, sheet row 2', () => {
    expect(HEADER_ROW).toBe(1);
  });

  it('collapses whitespace so a doubled space is the same header', () => {
    expect(normalizeHeader('  agency  AI\napproval requirements ')).toBe('agency AI approval requirements');
  });
});

describe('slugContractId', () => {
  it('joins portfolio and project into a URL-safe slug', () => {
    expect(slugContractId('STATES', 'Maryland Statewide Agile Teams'))
      .toBe('states-maryland-statewide-agile-teams');
    expect(slugContractId('LABS', 'AECF')).toBe('labs-aecf');
  });

  it('collapses punctuation and repeated separators', () => {
    expect(slugContractId('BEAM', 'FPHNY/NYC DOHMH')).toBe('beam-fphny-nyc-dohmh');
    expect(slugContractId('STATES', 'MA PFML — Task Order B27'))
      .toBe('states-ma-pfml-task-order-b27');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(slugContractId('  states  ', 'DC HBX IDC')).toBe(slugContractId('STATES', 'DC HBX  IDC'));
  });
});

describe('shapeContracts', () => {
  it('keys each row by the slug of its portfolio and project', () => {
    const { contracts } = shapeContracts(gridOf(rowOf(SEC)));
    expect(Object.keys(contracts)).toEqual(['fedciv-sec-enterprise-websites']);
  });

  it('stores the AI use terms exactly as written, deriving nothing from them', () => {
    const record = shapeContracts(gridOf(rowOf(SEC))).contracts['fedciv-sec-enterprise-websites'];
    expect(record.ai_use_terms).toBe('Conditional, TO Silent, BPA Restricted');
    expect(record).not.toHaveProperty('ai_posture');
  });

  it('carries every attribute as a string, empty when the cell is blank', () => {
    const { contracts } = shapeContracts(gridOf(rowOf({ portfolio: 'LABS', project: 'AECF' })));
    const record = contracts['labs-aecf'];
    expect(record.contract_num).toBe('');
    expect(record.review_process).toBe('');
    for (const value of Object.values(record)) expect(typeof value).toBe('string');
  });

  it('stores the publish flag, and stores a row marked No', () => {
    // The API applies the flag. The table stays a copy of the sheet.
    const { contracts } = shapeContracts(gridOf(
      rowOf(SEC),
      rowOf({ portfolio: 'LABS', project: 'AECF', publish: 'No' }),
    ));
    expect(contracts['fedciv-sec-enterprise-websites'].publish).toBe('Yes');
    expect(contracts['labs-aecf'].publish).toBe('No');
  });

  it('drops the team member and the compliance columns', () => {
    const record = shapeContracts(gridOf(rowOf(SEC))).contracts['fedciv-sec-enterprise-websites'];
    expect(Object.values(record)).not.toContain('Andrew');
    expect(Object.values(record)).not.toContain('confirmed');
    expect(Object.values(record)).not.toContain('internal note');
    expect(record).not.toHaveProperty('notes');
  });

  it('excludes the four compliance columns and the team member by name', () => {
    expect(EXCLUDED_HEADERS).toEqual(expect.arrayContaining([
      'Contracts Team Member', 'Nava steps for compliance', 'Nava Compliance Status',
      'Needed for compliance', 'Notes',
    ]));
  });

  it('keeps a row whose only populated cells are the two key columns', () => {
    const { contracts, skippedBlankRows } = shapeContracts(
      gridOf(rowOf({ portfolio: 'LABS', project: 'AECF' })),
    );
    expect(Object.keys(contracts)).toHaveLength(1);
    expect(skippedBlankRows).toBe(0);
  });

  it('skips and counts fully blank spacer rows', () => {
    const { contracts, skippedBlankRows } = shapeContracts(
      gridOf(rowOf(SEC), [], rowOf({ portfolio: 'LABS', project: 'AECF' })),
    );
    expect(Object.keys(contracts)).toHaveLength(2);
    expect(skippedBlankRows).toBe(1);
  });

  it('counts a row holding only an excluded column as blank', () => {
    const { contracts, skippedBlankRows } = shapeContracts(gridOf(rowOf({ Notes: 'stray' })));
    expect(Object.keys(contracts)).toHaveLength(0);
    expect(skippedBlankRows).toBe(1);
  });

  it('fails when a required header is missing, naming it', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = grid[HEADER_ROW].map((h) => (h === header('publish') ? '' : h));
    expect(() => shapeContracts(grid)).toThrow(SyncContractsError);
    expect(() => shapeContracts(grid)).toThrow(/Publish to Project Indices/);
  });

  it('names the expected header row in the failure, since a shift looks plausible', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = [];
    expect(() => shapeContracts(grid)).toThrow(new RegExp(`row ${HEADER_ROW + 1}`));
  });

  it('fails on a header in neither the map nor the exclusions', () => {
    // A new or reworded column is carried only once someone decides it should be.
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = [...grid[HEADER_ROW], 'Something New'];
    expect(() => shapeContracts(grid)).toThrow(/"Something New"/);
  });

  it('fails on two columns with the same header', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = [...grid[HEADER_ROW], header('tools')];
    expect(() => shapeContracts(grid)).toThrow(/AI Tools Used/);
  });

  it('matches headers whatever their spacing', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = grid[HEADER_ROW].map((h) => h.replace(/ /g, '  '));
    expect(Object.keys(shapeContracts(grid).contracts)).toEqual(['fedciv-sec-enterprise-websites']);
  });

  it('reads columns by header, so a moved column keeps its data', () => {
    // Column A deleted from the sheet: every column shifts left one place.
    const grid = gridOf(rowOf(SEC)).map((row) => row.slice(1));
    const record = shapeContracts(grid).contracts['fedciv-sec-enterprise-websites'];
    expect(record.portfolio).toBe('FEDCIV');
    expect(record.contract_num).toBe('47QTCA18D008M');
  });

  it('fails on two rows producing the same contract id, naming both', () => {
    const grid = gridOf(
      rowOf({ portfolio: 'LABS', project: 'AECF' }),
      rowOf({ portfolio: 'labs', project: 'aecf', publish: 'No' }),
    );
    expect(() => shapeContracts(grid)).toThrow(/labs-aecf/);
  });

  it('fails on a populated row with no portfolio or project rather than dropping it', () => {
    const grid = gridOf(rowOf({ ai_use_terms: 'Silent', tools: 'orphan' }));
    expect(() => shapeContracts(grid)).toThrow(SyncContractsError);
  });
});

describe('reconcile', () => {
  const stored = {
    'labs-aecf': {
      record_type: 'contract', contract_id: 'labs-aecf',
      portfolio: 'LABS', project: 'AECF', notes: 'old',
      first_seen_at: '2026-01-01T00:00:00.000Z', last_synced_at: '2026-01-01T00:00:00.000Z',
    },
  };

  it('reports every row as a create against an empty store', () => {
    const diff = reconcile({ 'labs-aecf': { contract_id: 'labs-aecf', notes: 'new' } }, {});
    expect(diff.creates).toHaveLength(1);
    expect(diff.updates).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
  });

  it('reports nothing when incoming matches stored', () => {
    const incoming = {
      'labs-aecf': { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', notes: 'old' },
    };
    const diff = reconcile(incoming, stored);
    expect(diff).toEqual({ creates: [], updates: [], deletes: [] });
  });

  it('ignores the sync-written fields when deciding whether a record changed', () => {
    // Without this, every record reports as updated on every run forever.
    const incoming = {
      'labs-aecf': { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', notes: 'old' },
    };
    expect(reconcile(incoming, stored).updates).toHaveLength(0);
  });

  it('reports a changed attribute as an update and preserves first_seen_at', () => {
    const incoming = {
      'labs-aecf': { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', notes: 'new' },
    };
    const diff = reconcile(incoming, stored);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].first_seen_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('treats a contract number filled in later as an update, not a delete plus create', () => {
    // Covers AE7 — the identifier must not move when a sparse column is populated.
    const incoming = {
      'labs-aecf': {
        contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', notes: 'old',
        contract_num: 'NEW-123',
      },
    };
    const diff = reconcile(incoming, stored);
    expect(diff.creates).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].first_seen_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports stored records absent from incoming as deletes', () => {
    const diff = reconcile({}, stored);
    expect(diff.deletes).toEqual(['labs-aecf']);
  });

  it('treats an attribute cleared to empty string as a change', () => {
    const incoming = {
      'labs-aecf': { contract_id: 'labs-aecf', portfolio: 'LABS', project: 'AECF', notes: '' },
    };
    expect(reconcile(incoming, stored).updates).toHaveLength(1);
  });
});

describe('safetyVerdict', () => {
  it('passes a normal run', () => {
    expect(safetyVerdict({ incoming: 119, storedCount: 119, deletes: 0 })).toBeNull();
  });

  it('refuses zero incoming rows', () => {
    expect(safetyVerdict({ incoming: 0, storedCount: 119, deletes: 119 })).toMatch(/zero/i);
  });

  it('will not let the override past a zero-row read', () => {
    const verdict = safetyVerdict({ incoming: 0, storedCount: 119, deletes: 119, override: true });
    expect(verdict).toMatch(/zero/i);
  });

  it('refuses when deletes exceed the ceiling', () => {
    const deletes = Math.floor(119 * MAX_DELETE_FRACTION) + 1;
    expect(safetyVerdict({ incoming: 119, storedCount: 119, deletes })).toMatch(/delete/i);
  });

  it('allows the override past a delete-ceiling refusal', () => {
    const deletes = Math.floor(119 * MAX_DELETE_FRACTION) + 1;
    expect(safetyVerdict({ incoming: 119, storedCount: 119, deletes, override: true })).toBeNull();
  });

  it('does not apply the delete ceiling to a first run against an empty table', () => {
    expect(safetyVerdict({ incoming: 119, storedCount: 0, deletes: 0 })).toBeNull();
  });
});

describe('safetyVerdict compounding-drain protection', () => {
  it('refuses a row count that dropped more than 10% below the last completed run', () => {
    const verdict = safetyVerdict({ incoming: 100, storedCount: 119, deletes: 19, baseline: 119 });
    expect(verdict).toMatch(/drop|previous/i);
  });

  it('measures the drop against the baseline, not the current stored count', () => {
    // The stored count shrinks with the damage; the baseline does not. Measuring
    // against stored would move the goalposts with each successive run.
    const verdict = safetyVerdict({ incoming: 100, storedCount: 100, deletes: 0, baseline: 119 });
    expect(verdict).toMatch(/drop|previous/i);
  });

  it('allows a first run with no baseline', () => {
    expect(safetyVerdict({ incoming: 119, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
  });

  it('refuses when survivors fall below the absolute floor', () => {
    const verdict = safetyVerdict({
      incoming: ABSOLUTE_FLOOR - 1, storedCount: ABSOLUTE_FLOOR, deletes: 1, baseline: ABSOLUTE_FLOOR,
    });
    expect(verdict).toMatch(/floor|minimum/i);
  });

  it('terminates a compounding drain that no single run could catch', () => {
    // Each step deletes under 10% of what is stored and reports a clean run. Only
    // the floor stops the decay. Baseline tracks the previous successful run.
    let stored = 119;
    let baseline = 119;
    const verdicts = [];
    for (let i = 0; i < 6; i++) {
      const deletes = Math.floor(stored * MAX_DELETE_FRACTION);
      const incoming = stored - deletes;
      const verdict = safetyVerdict({ incoming, storedCount: stored, deletes, baseline });
      verdicts.push(verdict);
      if (verdict) break;
      stored = incoming;
      baseline = incoming;
    }
    expect(verdicts.some((v) => v !== null)).toBe(true);
    expect(verdicts[verdicts.length - 1]).toMatch(/floor|minimum|drop/i);
  });

  it('does not apply the floor to a first population of an empty table', () => {
    expect(safetyVerdict({ incoming: 5, storedCount: 0, deletes: 0, baseline: null })).toBeNull();
  });

  it('lets the override past the baseline and floor refusals', () => {
    expect(safetyVerdict({
      incoming: 1, storedCount: 119, deletes: 118, baseline: 119, override: true,
    })).toBeNull();
  });
});
