/**
 * Markdown for the initiatives sync's GitHub Actions run summary.
 *
 * Pure string building, kept separate from the CLI so it is testable — the CLI
 * calls main() at import and cannot be imported by a test.
 *
 * The summary is written on EVERY run, including a clean one. A run that reports
 * nothing is indistinguishable on the Actions page from a run that did nothing,
 * and the steady state here is "no drift" — so the reassuring case is exactly the
 * one that has to be legible.
 */

// Titles carry em dashes, ampersands, apostrophes, and parentheses. A pipe or a
// backtick in one would break the table it lands in, so cell text is escaped
// rather than interpolated raw.
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const tick = (s) => `\`${String(s ?? '').replace(/`/g, '')}\``;

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
 * @param env         'staging' | 'prod'
 * @param report      the object returned by populateInitiatives
 * @param options     dryRun, resolution (omitted when the check did not run), and
 *                    resolutionError
 */
export function buildRunSummary({
  env,
  report,
  dryRun = false,
  resolution = null,
  resolutionError = null,
}) {
  const lines = [`## Initiatives sync — ${env}`, ''];

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

  // Creates AND deletes in the same run is almost always one or more retitled
  // initiatives, because the id is a slug of the title. Saying so here saves an
  // operator from investigating a data loss that did not happen.
  if (report.created > 0 && report.deleted > 0) {
    lines.push(
      '> This run both created and deleted records. Ids are derived from the initiative',
      '> **title**, so a retitled initiative appears as one create plus one delete rather',
      '> than as an update — that is the usual explanation, not a removal and an addition.',
      '',
    );
  }

  if (report.deletedIds?.length) {
    lines.push(
      `<details><summary>${report.deletedIds.length} initiative(s) ${
        report.refusal || dryRun ? 'that would be ' : ''
      }deleted</summary>`,
      '',
      ...report.deletedIds.map((id) => `- ${tick(id)}`),
      '',
      '</details>',
      '',
    );
  }

  if (report.previousState) {
    const note = {
      never_populated:
        'First run against this table — no baseline was available to compare against.',
      in_progress:
        'The previous run left an in-progress marker, so the table was mid-flight. ' +
        'The gate was measured against the last **completed** run, not that partial one.',
    }[report.previousState];
    if (note) lines.push(`> ${note}`, '');
  }

  // A rename is indistinguishable from a new column, which is why this is worth
  // surfacing at all.
  if (report.newColumns?.length) {
    lines.push(
      `### ${report.newColumns.length} new column(s) since the last run`,
      '',
      ...report.newColumns.map((c) => `- ${tick(c)}`),
      '',
      'A renamed column looks identical to a new one here. Note that a new column reaches the',
      'table automatically but does NOT reach the page — it has to be added to',
      'INITIATIVE_FIELDS in functions/api/routes/initiatives.mjs, which is the review step.',
      '',
    );
  }

  if (resolutionError) {
    lines.push(
      '### Project resolution could not run',
      '',
      'The initiatives synced successfully — only the resolution check failed, so this run',
      'cannot say whether every stated project name matches a real project.',
      '',
      '```',
      String(resolutionError),
      '```',
      '',
    );
  } else if (resolution) {
    lines.push(...resolutionSection(resolution));
  }

  return lines;
}

function resolutionSection(resolution) {
  const lines = ['### Project resolution', ''];

  if (resolution.projectCount === 0) {
    lines.push(
      '> No project records exist, so every stated name below is unresolved for that reason',
      '> alone. Run the projects sync before reading anything into these findings.',
      '',
    );
  }

  if (resolution.unresolvedProjects.length === 0) {
    lines.push('Every stated project name matches a project on file. ✅', '');
  } else {
    lines.push(
      `⚠️ **${resolution.unresolvedProjects.length} stated project name(s) match no project.**`,
      'A warning, not a failure: the initiatives synced correctly and each of these renders on',
      'the page with its project name marked as unregistered. Fix the value in the sheet, or',
      'check whether the project exists in the projects table under a different name.',
      '',
      '| Initiative | Name in sheet |',
      '| --- | --- |',
      ...resolution.unresolvedProjects.map(
        (u) => `| ${cell(u.title)} | ${tick(cell(u.raw_value))} |`,
      ),
      '',
    );
  }

  // Warned, never failed: 23 of 46 rows state no project, plenty of initiatives are
  // genuinely internal, and failing on half the sheet would train the operator to
  // ignore red runs.
  if (resolution.missingProject.length > 0) {
    lines.push(
      `<details><summary>${resolution.missingProject.length} initiative(s) with no project ` +
        'stated (not a failure)</summary>',
      '',
      ...resolution.missingProject.map((m) => `- ${cell(m.title)}`),
      '',
      '</details>',
      '',
    );
  }

  return lines;
}
