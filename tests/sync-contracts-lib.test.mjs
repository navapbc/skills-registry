import { describe, it, expect } from 'vitest';
import {
  HEADER_ROW,
  EXCLUDED_HEADERS,
  MAX_DELETE_FRACTION,
  SyncContractsError,
  slugAttribute,
  slugContractId,
  shapeContracts,
  reconcile,
  safetyVerdict,
} from '../scripts/lib/sync-contracts.mjs';

// The real tab: row 1 banners, row 2 prose headers, row 3 machine names, data below.
// Only the machine-name row and the data rows matter to shaping, but the grid is
// built with all three so the tests exercise the same offsets the sheet has.
const MACHINE_HEADERS = [
  '', 'PORTFOLIO', 'PROJECT', 'agreementType', 'contractNum', 'vehicle', 'taskOrder',
  'customer', 'navaProjectMgr', 'navaProgramMgr', 'SUBCONTRACTORS', 'aiUseTerms',
  'aiUseTermsLanguage', 'clientPolicy', 'navaPolicy', 'aiUsed', 'tools', 'usage',
  'reviewProcess', 'notes', 'projectName', 'aiPosture', 'terms', 'termsDetail',
  'clientPolicySummary', 'clientPolicyLink', 'vehicleFullname',
];

function gridOf(...dataRows) {
  return [
    ['', '', '', '', '', '', '', '', '', '', '', 'Contracts to Complete'],
    ['Contracts Team Member', 'PORTFOLIO', 'PROJECT'],
    MACHINE_HEADERS,
    ...dataRows,
  ];
}

/** A data row keyed by machine header name, padded to the grid's width. */
function rowOf(values) {
  return MACHINE_HEADERS.map((h, i) => (i === 0 ? (values[''] ?? '') : (values[h] ?? '')));
}

const SEC = {
  'PORTFOLIO': 'FEDCIV',
  'PROJECT': 'SEC ENTERPRISE WEBSITES',
  'agreementType': 'PRIME CONTRACTS',
  'contractNum': '47QTCA18D008M',
  'aiUseTerms': 'TO Silent, BPA Restricted',
  'projectName': 'SEC Enterprise Websites',
  'aiPosture': 'restricted',
  'terms': 'restricted',
  'navaProjectMgr': 'Someone Named',
};

describe('slugAttribute', () => {
  it('lowercases screaming headers', () => {
    expect(slugAttribute('PORTFOLIO')).toBe('portfolio');
    expect(slugAttribute('SUBCONTRACTORS')).toBe('subcontractors');
  });

  it('converts camelCase to snake_case', () => {
    expect(slugAttribute('agreementType')).toBe('agreement_type');
    expect(slugAttribute('aiUseTermsLanguage')).toBe('ai_use_terms_language');
    expect(slugAttribute('navaProjectMgr')).toBe('nava_project_mgr');
    expect(slugAttribute('clientPolicySummary')).toBe('client_policy_summary');
  });

  it('leaves already-flat names alone', () => {
    expect(slugAttribute('notes')).toBe('notes');
    expect(slugAttribute('tools')).toBe('tools');
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

  it('carries every attribute as a string, empty when the cell is blank', () => {
    const { contracts } = shapeContracts(gridOf(rowOf({
      PORTFOLIO: 'LABS', PROJECT: 'AECF',
    })));
    const record = contracts['labs-aecf'];
    expect(record.contract_num).toBe('');
    expect(record.notes).toBe('');
    expect(record.ai_posture).toBe('');
    for (const value of Object.values(record)) expect(typeof value).toBe('string');
  });

  it('never omits an attribute, so absent and empty are not confusable', () => {
    const { contracts } = shapeContracts(gridOf(rowOf({ PORTFOLIO: 'LABS', PROJECT: 'AECF' })));
    // The property Plan 2's default filter depends on.
    expect(Object.prototype.hasOwnProperty.call(contracts['labs-aecf'], 'ai_posture')).toBe(true);
  });

  it('drops the unnamed first column and the duplicate posture column', () => {
    const { contracts } = shapeContracts(gridOf(rowOf(SEC)));
    const record = contracts['fedciv-sec-enterprise-websites'];
    expect(record.terms).toBeUndefined();
    expect(Object.values(record)).not.toContain('Contracts Team Member');
    // The posture itself is still carried — only its duplicate is dropped.
    expect(record.ai_posture).toBe('restricted');
  });

  it('keeps a row whose only populated cells are the two key columns', () => {
    const { contracts, skippedBlankRows } = shapeContracts(
      gridOf(rowOf({ PORTFOLIO: 'LABS', PROJECT: 'AECF' })),
    );
    expect(Object.keys(contracts)).toHaveLength(1);
    expect(skippedBlankRows).toBe(0);
  });

  it('skips and counts fully blank spacer rows', () => {
    const { contracts, skippedBlankRows } = shapeContracts(
      gridOf(rowOf(SEC), [], rowOf({ PORTFOLIO: 'LABS', PROJECT: 'AECF' })),
    );
    expect(Object.keys(contracts)).toHaveLength(2);
    expect(skippedBlankRows).toBe(1);
  });

  it('fails when an expected machine name is missing from the header row', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = grid[HEADER_ROW].map((h) => (h === 'aiPosture' ? 'somethingElse' : h));
    expect(() => shapeContracts(grid)).toThrow(SyncContractsError);
    expect(() => shapeContracts(grid)).toThrow(/aiPosture/);
  });

  it('names the expected header row in the failure, since a shift looks plausible', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = [];
    expect(() => shapeContracts(grid)).toThrow(new RegExp(`row ${HEADER_ROW + 1}`));
  });

  it('fails on two headers slugging to the same attribute', () => {
    const grid = gridOf(rowOf(SEC));
    grid[HEADER_ROW] = grid[HEADER_ROW].map((h) => (h === 'notes' ? 'clientPolicy' : h));
    expect(() => shapeContracts(grid)).toThrow(/client_policy/);
  });

  it('fails on two rows producing the same contract id, naming both', () => {
    const grid = gridOf(
      rowOf({ PORTFOLIO: 'LABS', PROJECT: 'AECF' }),
      rowOf({ PORTFOLIO: 'labs', PROJECT: 'aecf' }),
    );
    expect(() => shapeContracts(grid)).toThrow(/labs-aecf/);
  });

  it('fails on a populated row with no portfolio or project rather than dropping it', () => {
    const grid = gridOf(rowOf({ aiUseTerms: 'Silent', notes: 'orphan' }));
    expect(() => shapeContracts(grid)).toThrow(SyncContractsError);
  });

  it('reports the excluded headers it applied', () => {
    expect(EXCLUDED_HEADERS).toContain('terms');
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
