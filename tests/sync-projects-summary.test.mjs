import { describe, it, expect } from 'vitest';
import { buildRunSummary } from '../scripts/lib/sync-projects-summary.mjs';

const md = (opts) => buildRunSummary(opts).join('\n');

const report = (overrides = {}) => ({
  incoming: 53,
  storedCount: 53,
  created: 0,
  updated: 0,
  deleted: 0,
  deletedCodes: [],
  skippedBlankRows: 0,
  newColumns: [],
  previousState: 'complete',
  refusal: null,
  applied: true,
  ...overrides,
});

const CLEAN_DRIFT = { archetypeCount: 5, unresolved: [], missing: [] };

describe('always renders something', () => {
  // A run that reports nothing is indistinguishable on the Actions page from a run
  // that did nothing, and the steady state here is "no drift" — so the reassuring
  // case is the one that most needs to be legible.
  it('renders counts and a verdict on a fully clean run', () => {
    const out = md({ env: 'staging', report: report(), drift: CLEAN_DRIFT });
    expect(out).toContain('## Projects sync — staging');
    expect(out).toMatch(/already agreed/i);
    expect(out).toContain('| Rows in sheet | 53 |');
    expect(out).toMatch(/No unresolved archetype values/);
  });

  it('names the environment it ran against', () => {
    expect(md({ env: 'prod', report: report(), drift: CLEAN_DRIFT })).toContain('— prod');
  });

  it('renders counts even with no drift information at all', () => {
    const out = md({ env: 'staging', report: report() });
    expect(out).toContain('| Rows in sheet | 53 |');
    expect(out).not.toContain('Archetype drift');
  });
});

describe('run outcome', () => {
  it('distinguishes an applied run with changes from one without', () => {
    const changed = md({ env: 'staging', report: report({ created: 2, updated: 1 }), drift: CLEAN_DRIFT });
    expect(changed).toContain('### Applied');
    expect(changed).not.toMatch(/already agreed/i);
  });

  it('marks a dry run as having written nothing', () => {
    const out = md({ env: 'staging', report: report({ created: 3 }), dryRun: true });
    expect(out).toMatch(/Dry run — nothing was written/);
  });

  it('leads with the refusal and says the table is untouched', () => {
    const out = md({
      env: 'staging',
      report: report({ refusal: 'Refusing: the sheet returned zero rows.', deleted: 53 }),
    });
    expect(out).toMatch(/Refused — nothing was written/);
    expect(out).toContain('zero rows');
    expect(out).toMatch(/table is untouched/i);
  });

  it('reports blank rows only when some were skipped', () => {
    expect(md({ env: 'staging', report: report() })).not.toContain('Blank rows skipped');
    expect(md({ env: 'staging', report: report({ skippedBlankRows: 2 }) })).toContain('| Blank rows skipped | 2 |');
  });

  it('lists deleted project codes behind a disclosure', () => {
    const out = md({
      env: 'staging',
      report: report({ deleted: 2, deletedCodes: ['ST099', 'LB004'] }),
      drift: CLEAN_DRIFT,
    });
    expect(out).toContain('ST099');
    expect(out).toContain('LB004');
    expect(out).toContain('<details>');
  });

  it('says deletes "would be" applied on a dry run', () => {
    const out = md({
      env: 'staging',
      report: report({ deleted: 1, deletedCodes: ['ST099'] }),
      dryRun: true,
    });
    expect(out).toMatch(/would be/);
  });
});

describe('previous-run state', () => {
  it('notes a first run has no baseline', () => {
    const out = md({ env: 'staging', report: report({ previousState: 'never_synced' }), drift: CLEAN_DRIFT });
    expect(out).toMatch(/no baseline/i);
  });

  // Otherwise a reader would assume the gate compared against a table that was
  // never fully written.
  it('notes a mid-flight previous run and which baseline was used', () => {
    const out = md({ env: 'staging', report: report({ previousState: 'in_progress' }), drift: CLEAN_DRIFT });
    expect(out).toMatch(/mid-flight/i);
    expect(out).toMatch(/completed/);
  });

  it('adds no note after an ordinary completed run', () => {
    const out = md({ env: 'staging', report: report(), drift: CLEAN_DRIFT });
    expect(out).not.toMatch(/no baseline|mid-flight/i);
  });
});

describe('drift', () => {
  it('tabulates unresolved values with the sheet string verbatim', () => {
    const out = md({
      env: 'staging',
      report: report(),
      drift: {
        archetypeCount: 5,
        unresolved: [{
          project_code: 'FC026', project_name: 'CO COBEES',
          column: 'Archetype (Primary)', raw_value: 'Prodcut Team',
        }],
        missing: [],
      },
    });
    expect(out).toContain('| Project | Column | Value in sheet |');
    expect(out).toContain('Prodcut Team');
    expect(out).toContain('FC026');
  });

  // Same warn-versus-fail split the sync uses: a typo is an error, an unassigned
  // archetype is normal in-progress state.
  it('separates missing archetypes and marks them as not a failure', () => {
    const out = md({
      env: 'staging',
      report: report(),
      drift: {
        archetypeCount: 5,
        unresolved: [],
        missing: [{ project_code: 'LB007', project_name: 'Brand New', column: 'Archetype (Primary)' }],
      },
    });
    expect(out).toMatch(/not a failure/i);
    expect(out).toMatch(/No unresolved archetype values/);
  });

  it('explains an empty archetype table rather than blaming the sheet', () => {
    const out = md({
      env: 'staging',
      report: report(),
      drift: {
        archetypeCount: 0,
        unresolved: [{ project_code: 'FC026', project_name: 'X', column: 'Archetype (Primary)', raw_value: 'Product Team' }],
        missing: [],
      },
    });
    expect(out).toMatch(/Seed the archetypes/);
  });

  it('says the projects synced when only the drift check failed', () => {
    const out = md({
      env: 'staging',
      report: report(),
      driftError: 'AccessDeniedException: not authorized to perform: dynamodb:Query',
    });
    expect(out).toMatch(/Drift check could not run/);
    expect(out).toMatch(/synced successfully/);
    expect(out).toContain('dynamodb:Query');
  });
});
