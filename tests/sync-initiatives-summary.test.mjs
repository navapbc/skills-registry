import { describe, it, expect } from 'vitest';
import { buildRunSummary } from '../scripts/lib/sync-initiatives-summary.mjs';

const report = (over = {}) => ({
  incoming: 37,
  storedCount: 37,
  created: 0,
  updated: 0,
  deleted: 0,
  deletedIds: [],
  createdIds: [],
  skippedBlankRows: 0,
  previousState: 'complete',
  refusal: null,
  applied: true,
  ...over,
});

const resolution = (over = {}) => ({
  projectCount: 53,
  unresolvedProjects: [],
  missingProject: [],
  ...over,
});

const build = (opts) => buildRunSummary({ env: 'staging', ...opts }).join('\n');

describe('buildRunSummary — applied runs', () => {
  it('names the environment and renders the counts', () => {
    const md = build({ report: report({ created: 2, updated: 1 }) });
    expect(md).toContain('## Initiatives sync — staging');
    expect(md).toContain('### Applied');
    expect(md).toContain('| Rows in sheet | 37 |');
    expect(md).toContain('| Created | 2 |');
  });

  it('says so plainly when the sheet and the table already agreed', () => {
    expect(build({ report: report() })).toContain('already agreed');
  });

  it('reports blank rows only when there were some', () => {
    expect(build({ report: report() })).not.toContain('Blank rows skipped');
    expect(build({ report: report({ skippedBlankRows: 2 }) })).toContain('| Blank rows skipped | 2 |');
  });
});

describe('buildRunSummary — resolution', () => {
  it('states the all-clear when every stated name resolves', () => {
    const md = build({ report: report(), resolution: resolution() });
    expect(md).toContain('Every stated project name matches a project on file.');
  });

  it('tables an unresolved name with the sheet’s own string, and says it failed', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        unresolvedProjects: [
          { initiative_id: 'a', title: 'AskCA chatbot', raw_value: 'MD ADEPT WO4' },
        ],
      }),
    });
    expect(md).toContain('1 stated project name(s) match no project.');
    // A warning, not a failure. The run stays green and the page names the value.
    expect(md).toContain('A warning, not a failure');
    expect(md).not.toContain('This failed the run.');
    expect(md).toContain('AskCA chatbot');
    expect(md).toContain('`MD ADEPT WO4`');
  });

  it('renders absent project names as a collapsed non-failure, not as an alarm', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        missingProject: Array.from({ length: 14 }, (_, i) => ({
          initiative_id: `i${i}`, title: `Initiative ${i}`,
        })),
      }),
    });
    expect(md).toContain('14 initiative(s) with no project stated (not a failure)');
    expect(md).not.toContain('A warning, not a failure');
  });

  it('does not read as a failure when there are blanks but nothing unresolved', () => {
    // The measured steady state: 14 blank, 0 unresolved. This run is green.
    const md = build({
      report: report(),
      resolution: resolution({ missingProject: [{ initiative_id: 'a', title: 'A' }] }),
    });
    expect(md).toContain('Every stated project name matches a project on file.');
    expect(md).toContain('(not a failure)');
  });

  it('warns when there are no project records at all', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        projectCount: 0,
        unresolvedProjects: [{ initiative_id: 'a', title: 'A', raw_value: 'Anything' }],
      }),
    });
    expect(md).toContain('No project records exist');
  });

  it('says the initiatives synced when only the check failed', () => {
    const md = build({ report: report(), resolutionError: 'AccessDeniedException: nope' });
    expect(md).toContain('Project resolution could not run');
    expect(md).toContain('The initiatives synced successfully');
    expect(md).toContain('AccessDeniedException: nope');
  });
});

describe('buildRunSummary — the retitle explanation', () => {
  it('explains a run that both creates and deletes', () => {
    const md = build({
      report: report({ created: 1, deleted: 1, deletedIds: ['alpha'] }),
    });
    expect(md).toContain('retitled initiative appears as one create plus one delete');
  });

  it('stays quiet when only creates, or only deletes, happened', () => {
    expect(build({ report: report({ created: 3 }) })).not.toContain('retitled initiative');
    expect(build({ report: report({ deleted: 1, deletedIds: ['a'] }) }))
      .not.toContain('retitled initiative');
  });
});

describe('buildRunSummary — dry run and refusal', () => {
  it('says nothing was written on a dry run', () => {
    const md = build({ report: report({ created: 5, applied: false }), dryRun: true });
    expect(md).toContain('Dry run — nothing was written');
  });

  it('labels dry-run deletes as hypothetical', () => {
    const md = build({
      report: report({ deleted: 1, deletedIds: ['alpha'], applied: false }),
      dryRun: true,
    });
    expect(md).toContain('that would be deleted');
  });

  it('says the table is untouched and that zero rows is never overridable', () => {
    const md = build({
      report: report({ refusal: 'Refusing: the sheet returned zero rows.', applied: false }),
    });
    expect(md).toContain('Refused — nothing was written');
    expect(md).toContain('The table is untouched.');
    expect(md).toContain('never overridable');
  });
});

describe('buildRunSummary — previous state notes', () => {
  it('notes a first run against the table', () => {
    const md = build({ report: report({ previousState: 'never_populated' }) });
    expect(md).toContain('First run against this table');
  });

  it('notes a mid-flight table and which baseline the gate used', () => {
    const md = build({ report: report({ previousState: 'in_progress' }) });
    expect(md).toContain('in-progress marker');
    expect(md).toContain('last **completed** run');
  });

  it('adds no note for a normal completed run', () => {
    const md = build({ report: report() });
    expect(md).not.toContain('First run against this table');
    expect(md).not.toContain('in-progress marker');
  });
});

describe('buildRunSummary — new columns', () => {
  it('says a new column reaches the table but not the page', () => {
    const md = build({ report: report({ newColumns: ['owner'] }) });
    expect(md).toContain('1 new column(s) since the last run');
    expect(md).toContain('INITIATIVE_FIELDS');
  });
});

describe('buildRunSummary — escaping', () => {
  it('does not let a pipe in a title break the table', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        unresolvedProjects: [
          { initiative_id: 'a', title: 'Alpha | Beta prototype', raw_value: 'X | Y' },
        ],
      }),
    });
    const tableRow = md.split('\n').find((l) => l.includes('Alpha'));
    expect(tableRow).toContain('Alpha \\| Beta prototype');
    // Three pipes are the cell delimiters; a fourth would split the row.
    expect(tableRow.match(/(?<!\\)\|/g)).toHaveLength(3);
  });

  it('strips backticks from a value it wraps in backticks', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        unresolvedProjects: [{ initiative_id: 'a', title: 'A', raw_value: 'we`ird' }],
      }),
    });
    expect(md).toContain('`weird`');
  });

  it('flattens a newline in a title rather than breaking out of the row', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        unresolvedProjects: [{ initiative_id: 'a', title: 'Alpha\nBeta', raw_value: 'X' }],
      }),
    });
    expect(md).toContain('Alpha Beta');
  });

  it('handles the real punctuation classes without mangling them', () => {
    const md = build({
      report: report(),
      resolution: resolution({
        unresolvedProjects: [{
          initiative_id: 'a',
          title: "Agency's SNAP MVP & AI-assisted verification — (Labs)",
          raw_value: 'PA HR1 IDP 1 & 2',
        }],
      }),
    });
    expect(md).toContain("Agency's SNAP MVP & AI-assisted verification — (Labs)");
    expect(md).toContain('`PA HR1 IDP 1 & 2`');
  });
});
