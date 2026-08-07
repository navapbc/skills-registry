/**
 * Markdown for the sync's GitHub Actions run summary.
 *
 * Pure string building, kept separate from the CLI so it is testable — the CLI
 * calls main() at import and cannot be imported by a test.
 *
 * The summary is written on EVERY run, including a clean one. A run that reports
 * nothing is indistinguishable on the Actions page from a run that did nothing,
 * and the steady state here is "no drift" — so the reassuring case is exactly the
 * one that has to be legible. The freshness and counts are the whole point.
 */

const tick = (s) => `\`${s}\``;

function countsTable(report) {
  const rows = [
    ['Rows in sheet', report.incoming],
    ['Already stored', report.storedCount],
    ['Created', report.created],
    ['Updated', report.updated],
    ['Deleted', report.deleted],
  ];
  if (report.skippedBlankRows) rows.push(['Blank rows skipped', report.skippedBlankRows]);

  return [
    '| | |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
  ];
}

/**
 * @param env      'staging' | 'prod'
 * @param report   the object returned by syncProjects
 * @param options  dryRun, and drift (omitted when the check did not run)
 */
export function buildRunSummary({ env, report, dryRun = false, drift = null, driftError = null }) {
  const lines = [`## Projects sync — ${env}`, ''];

  if (report.refusal) {
    lines.push(
      '### Refused — nothing was written',
      '',
      report.refusal,
      '',
      'The table is untouched. Re-run from the Actions tab with **force** if this is intended;',
      'a zero-row read is never overridable.',
      '',
    );
  } else if (dryRun) {
    lines.push('### Dry run — nothing was written', '');
  } else if (report.created + report.updated + report.deleted === 0) {
    lines.push('### Applied — the sheet and the table already agreed', '');
  } else {
    lines.push('### Applied', '');
  }

  lines.push(...countsTable(report), '');

  if (report.deletedCodes?.length) {
    lines.push(
      `<details><summary>${report.deletedCodes.length} project(s) ${
        report.refusal || dryRun ? 'that would be' : ''
      } deleted</summary>`,
      '',
      ...report.deletedCodes.map((c) => `- ${tick(c)}`),
      '',
      '</details>',
      '',
    );
  }

  if (report.previousState) {
    const note = {
      never_synced: 'First run against this table — no baseline was available to compare against.',
      in_progress:
        'The previous run left an in-progress marker, so the table was mid-flight. ' +
        'The gate was measured against the last **completed** run, not that partial one.',
    }[report.previousState];
    if (note) lines.push(`> ${note}`, '');
  }

  // A rename is indistinguishable from a new column, which is why this is worth
  // surfacing: a rename can re-admit a column the sync's exclusion list drops.
  if (report.newColumns?.length) {
    lines.push(
      `### ${report.newColumns.length} new column(s) since the last run`,
      '',
      ...report.newColumns.map((c) => `- ${tick(c)}`),
      '',
      'A renamed column looks identical to a new one here. Check whether any of these is an',
      'excluded column that came back under a different name.',
      '',
    );
  }

  if (driftError) {
    lines.push(
      '### Drift check could not run',
      '',
      'The projects synced successfully — only the archetype check failed, so this run cannot',
      'say whether the sheet and the archetype records agree.',
      '',
      '```',
      String(driftError),
      '```',
      '',
    );
  } else if (drift) {
    lines.push(...driftSection(drift));
  }

  return lines;
}

function driftSection(drift) {
  const lines = ['### Archetype drift', ''];

  if (drift.archetypeCount === 0) {
    lines.push(
      '> No archetype records exist, so every value below is unresolved for that reason alone.',
      '> Seed the archetypes before reading anything into these findings.',
      '',
    );
  }

  if (drift.unresolved.length === 0) {
    lines.push('No unresolved archetype values. ✅', '');
  } else {
    lines.push(
      `**${drift.unresolved.length} value(s) match no archetype record.** Fix these in the sheet,`,
      'or add the missing archetype on the Archetypes tab.',
      '',
      '| Project | Column | Value in sheet |',
      '| --- | --- | --- |',
      ...drift.unresolved.map(
        (u) => `| ${tick(u.project_code)} ${u.project_name ?? ''} | ${u.column} | ${tick(u.raw_value)} |`,
      ),
      '',
    );
  }

  // Warned, never failed: an unassigned archetype on a new project is normal
  // in-progress state, and failing on it would train people to ignore red runs.
  if (drift.missing.length > 0) {
    lines.push(
      `<details><summary>${drift.missing.length} project(s) with no archetype assigned yet ` +
        '(not a failure)</summary>',
      '',
      ...drift.missing.map((m) => `- ${tick(m.project_code)} ${m.project_name ?? ''}`),
      '',
      '</details>',
      '',
    );
  }

  return lines;
}
