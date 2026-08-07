#!/usr/bin/env node
/**
 * Reconcile the `projects` DynamoDB table against the "All Columns (Full View)"
 * tab of the Nava Projects and Programs Database
 * (docs/plans/2026-08-06-002-feat-projects-sync-admin-tab-plan.md, U3).
 *
 * The sheet is authoritative: a project it no longer lists is deleted here. That
 * makes this the first sync in this repo that removes rows, which is why the
 * safety gate in scripts/lib/sync-projects.mjs applies four conditions rather
 * than a single row-count comparison, and why apply is gated on all four.
 *
 * Every row is imported. The sync makes no validity judgement of its own — no
 * code-prefix rule, no denylist, no reference to the project count the sheet
 * states above its header. Rows the sheet should not contain get removed at the
 * sheet.
 *
 * Usage:
 *
 *   node scripts/sync-projects.mjs --env staging --dry-run
 *   node scripts/sync-projects.mjs --env staging
 *   node scripts/sync-projects.mjs --env prod
 *
 * Apply is the DEFAULT, unlike scripts/prune-orphan-skills.mjs. That script is a
 * one-off destructive cleanup where a human should read the diff first; this is a
 * scheduled reconciler whose whole job is to apply, and the safety gate is what
 * stands in for dry-run-by-default.
 *
 * Options (each falls back to an env var, then to a default):
 *   --env <staging|prod>   required
 *   --credentials <path>   GOOGLE_APPLICATION_CREDENTIALS   default ./credentials.json
 *   --spreadsheet <ref>    SYNC_PROJECTS_SHEET_ID           URL or ID
 *   --table <name>         PROJECTS_TABLE            default skills-registry-projects-<env>
 *   --reference-table <n>  PROJECT_REFERENCE_TABLE   default skills-registry-project-reference-<env>
 *   --dry-run              report the diff and the gate verdict, write nothing
 *   --force                waive the gate's overridable conditions
 *
 * --force never waives the zero-row refusal. A zero-row read means the tab, its
 * share, or its shape changed — not that every project was retired.
 *
 * Exit codes:
 *   0  applied, or nothing to do, or a clean dry run
 *   1  a failure, or the gate refused, or unresolved archetype values were found
 *
 * Prerequisites: a Google service-account key with read access to the workbook,
 * and AWS credentials with read/write on the projects table.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { appendFileSync } from 'fs';
import { parseSpreadsheetId } from './lib/sheet-export.mjs';
import {
  SheetsError,
  loadServiceAccountKey,
  authorize,
  fetchTabTitles,
  fetchTabValues,
} from './lib/sheets-client.mjs';
import { SyncProjectsError } from './lib/sync-projects.mjs';
import { syncProjects, checkDrift } from './lib/sync-projects-apply.mjs';
import { SYNC_IN_PROGRESS, SYNC_NEVER } from '../functions/api/lib/projects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SPREADSHEET_ID = '1hax9xwy69e5H8dfo4KI7g9Cvhe0j59CwjUSYRujShP4';
const TAB_TITLE = 'All Columns (Full View)';
const PROJECT = 'skills-registry';

const USAGE =
  'Usage: node scripts/sync-projects.mjs --env <staging|prod> [--dry-run] [--force]\n' +
  '                                     [--credentials <path>] [--spreadsheet <url-or-id>]\n' +
  '                                     [--table <name>] [--reference-table <name>]';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') { opts.dryRun = true; continue; }
    if (flag === '--force') { opts.force = true; continue; }
    if (!flag.startsWith('--')) fail(`Unexpected argument: ${flag}\n${USAGE}`);

    const value = argv[++i];
    if (value === undefined) fail(`${flag} requires a value.\n${USAGE}`);
    switch (flag) {
      case '--env': opts.env = value; break;
      case '--credentials': opts.credentials = value; break;
      case '--spreadsheet': opts.spreadsheet = value; break;
      case '--table': opts.table = value; break;
      case '--reference-table': opts.referenceTable = value; break;
      default: fail(`Unknown option: ${flag}\n${USAGE}`);
    }
  }

  if (!['staging', 'prod'].includes(opts.env)) fail(`--env must be "staging" or "prod".\n${USAGE}`);

  let spreadsheetId;
  try {
    spreadsheetId = parseSpreadsheetId(
      opts.spreadsheet ?? process.env.SYNC_PROJECTS_SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    );
  } catch (err) {
    fail(err.message);
  }

  // Derived from --env, matching scripts/seed-project-reference.mjs and
  // sync-registry-v2. Keeps the workflow free of table configuration, so a table
  // name cannot drift between Terraform and CI.
  return {
    env: opts.env,
    dryRun: opts.dryRun,
    force: opts.force,
    credentialsPath: resolve(
      opts.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'credentials.json',
    ),
    spreadsheetId,
    table: opts.table ?? process.env.PROJECTS_TABLE ?? `${PROJECT}-projects-${opts.env}`,
    referenceTable:
      opts.referenceTable ?? process.env.PROJECT_REFERENCE_TABLE ?? `${PROJECT}-project-reference-${opts.env}`,
  };
}

// GitHub renders this file as the run's summary. It is the channel that makes the
// scheduled run the trigger for drift, rather than someone remembering to open an
// unlinked admin page.
function writeJobSummary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${lines.join('\n')}\n`);
}

function reportDrift(drift) {
  const lines = ['## Projects sync — archetype drift', ''];

  if (drift.archetypeCount === 0) {
    lines.push(
      '> No archetype records exist yet, so every archetype value is unresolved.',
      '> Run `scripts/seed-project-reference.mjs` before reading anything into these counts.',
      '',
    );
  }

  if (drift.unresolved.length === 0) {
    lines.push('No unresolved archetype values. ✅', '');
  } else {
    lines.push(
      `**${drift.unresolved.length} unresolved archetype value(s).** Each names a real archetype in`,
      'neither label nor spelling — fix these in the sheet.',
      '',
      '| Project | Column | Value in sheet |',
      '| --- | --- | --- |',
      ...drift.unresolved.map(
        (u) => `| \`${u.project_code}\` ${u.project_name} | ${u.column} | \`${u.raw_value}\` |`,
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
      ...drift.missing.map((m) => `- \`${m.project_code}\` ${m.project_name}`),
      '',
      '</details>',
      '',
    );
  }

  writeJobSummary(lines);

  for (const u of drift.unresolved) {
    console.error(`  UNRESOLVED  ${u.project_code}  ${u.column} = "${u.raw_value}"`);
  }
  for (const m of drift.missing) {
    console.log(`  no archetype  ${m.project_code}  ${m.project_name}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const auth = await authorize(loadServiceAccountKey(args.credentialsPath));
  console.log(`Authenticated as ${auth.clientEmail}`);

  // Fetch by title so a renamed tab fails loudly rather than syncing whatever
  // happens to sit at some index.
  const titles = await fetchTabTitles(auth, args.spreadsheetId);
  if (!titles.includes(TAB_TITLE)) {
    fail(
      `Workbook ${args.spreadsheetId} has no tab named "${TAB_TITLE}".\n` +
        `Available tabs: ${titles.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  const values = await fetchTabValues(auth, args.spreadsheetId, [TAB_TITLE]);
  const grid = values[TAB_TITLE];

  // The AWS SDK is installed in functions/api, not at the root.
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand, QueryCommand,
  } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

  console.log(`\nReconciling ${args.table} (${args.env})${args.dryRun ? ' — DRY RUN' : ''}`);

  const report = await syncProjects({
    ddb,
    table: args.table,
    grid,
    now: new Date().toISOString(),
    override: args.force,
    dryRun: args.dryRun,
    PutCommand, DeleteCommand, GetCommand, QueryCommand,
  });

  if (report.previousState === SYNC_IN_PROGRESS) {
    console.log(
      '\n  NOTE: the previous run left an in-progress marker, so the table was mid-flight.\n' +
        '  The gate was measured against the last COMPLETED run, not that partial one.',
    );
  } else if (report.previousState === SYNC_NEVER) {
    console.log('\n  First run against this table — no baseline to compare against.');
  }

  console.log(
    `\n  ${String(report.incoming).padStart(4)} rows in sheet` +
      `\n  ${String(report.storedCount).padStart(4)} projects already stored` +
      `\n  ${String(report.created).padStart(4)} to create` +
      `\n  ${String(report.updated).padStart(4)} to update` +
      `\n  ${String(report.deleted).padStart(4)} to delete` +
      (report.skippedBlankRows ? `\n  ${String(report.skippedBlankRows).padStart(4)} blank rows skipped` : ''),
  );

  if (report.deletedCodes.length > 0) {
    console.log(`\n  deleting: ${report.deletedCodes.join(', ')}`);
  }

  if (report.newColumns.length > 0) {
    console.log(
      `\n  NEW COLUMNS since the last run: ${report.newColumns.join(', ')}\n` +
        '  A renamed column is indistinguishable from a new one, so check whether any of\n' +
        '  these is an excluded column that came back under a different name.',
    );
    writeJobSummary([
      '## Projects sync — new columns',
      '',
      ...report.newColumns.map((c) => `- \`${c}\``),
      '',
      'A rename looks identical to a new column here. Check whether any of these is an',
      'excluded column re-admitted under a new name.',
      '',
    ]);
  }

  if (report.refusal) {
    writeJobSummary(['## Projects sync — refused', '', report.refusal, '']);
    fail(report.refusal);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  console.log(`\n  applied.${report.created + report.updated + report.deleted === 0 ? ' (nothing to do)' : ''}`);

  if (!args.referenceTable) {
    console.log(
      '\n  Skipping the archetype drift check: no reference table given.\n' +
        '  Pass --reference-table, or set PROJECT_REFERENCE_TABLE, to enable it.\n',
    );
    return;
  }

  // Resolution happens here as well as on read. That duplication is deliberate:
  // the tab must resolve on request so an archetype edit clears findings at once,
  // and the run must resolve so a typo reaches a human without a page load. Both
  // call the same rule in functions/api/lib/projects.mjs.
  // A drift-check failure is reported separately from a sync failure, because by
  // this point the projects have already been written successfully. Letting the
  // exception escape produced a raw stack trace on a run that had actually done
  // its job, which reads as "the sync broke" when nothing of the sort happened.
  let drift;
  try {
    drift = await checkDrift({
      ddb,
      referenceTable: args.referenceTable,
      projects: report.projects,
      QueryCommand,
    });
  } catch (err) {
    const message =
      `The projects synced successfully, but the archetype drift check could not run: ` +
      `${err.message ?? err}\n\n` +
      `  The table is correct — only the alarm failed. Most likely the caller lacks\n` +
      `  dynamodb:Query on ${args.referenceTable}; see the DynamoDBArchetypeRead\n` +
      `  statement in terraform/iam.tf.`;
    writeJobSummary([
      '## Projects sync — drift check could not run',
      '',
      'Projects synced successfully. Only the archetype drift check failed, so this run',
      'cannot say whether the sheet and the archetype records agree.',
      '',
      '```',
      String(err.message ?? err),
      '```',
      '',
    ]);
    // Still non-zero: a silently skipped drift alarm is worse than a visible failure.
    fail(message);
  }

  console.log();
  reportDrift(drift);

  if (drift.unresolved.length > 0) {
    fail(
      `${drift.unresolved.length} archetype value(s) in the sheet match no archetype record. ` +
        'The projects synced successfully — this failure is the drift alarm, not a sync error.',
    );
  }

  console.log('\n  no unresolved archetype values.\n');
}

main().catch((err) => {
  if (err instanceof SheetsError || err instanceof SyncProjectsError) fail(err.message);
  throw err;
});
