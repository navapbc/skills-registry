#!/usr/bin/env node
/**
 * Reconcile the `initiatives` DynamoDB table against the `v2` tab of the
 * AI-initiatives workbook
 * (docs/plans/2026-08-24-001-feat-initiatives-v2-sheet-source-plan.md, U2).
 *
 * Run from CI on MANUAL DISPATCH only — there is no cron, deliberately, until the
 * workbook has proved stable across a few runs. Unlike scripts/sync-contracts.mjs
 * this is a CI job, so the GitHub deploy role does hold read/write on the table.
 *
 * The sheet is authoritative: an initiative it no longer lists is deleted here.
 *
 * Usage:
 *
 *   node scripts/sync-initiatives.mjs --env staging --dry-run
 *   node scripts/sync-initiatives.mjs --env staging
 *   node scripts/sync-initiatives.mjs --env prod
 *
 * Options (each falls back to an env var, then to a default):
 *   --env <staging|prod>   required
 *   --credentials <path>   GOOGLE_APPLICATION_CREDENTIALS   default ./credentials.json
 *   --spreadsheet <ref>    SYNC_INITIATIVES_SHEET_ID        URL or ID
 *   --table <name>         INITIATIVES_TABLE   default skills-registry-initiatives-<env>
 *   --projects-table <n>   PROJECTS_TABLE      default skills-registry-projects-<env>
 *   --dry-run              report the diff and the gate verdict, write nothing
 *   --force                waive the gate's overridable conditions
 *
 * --force never waives the zero-row refusal. A zero-row read means the tab, its
 * share, or its shape changed — not that every initiative was retired. It also
 * does not waive the project-resolution failure below, which is not a data-loss
 * guard and has no escape hatch.
 *
 * WHAT A RED RUN MEANS. Two findings come out of the resolution check and they
 * have different severities:
 *
 *   - A project name that is STATED and matches no project FAILS the run. The
 *     initiatives synced fine; the sheet names a project that does not exist. As
 *     of 2026-08-24 zero of the 14 stated names fail, so the expected steady state
 *     is green — which is what makes a red run worth reading.
 *   - A row with NO project name only warns. 23 of 46 rows carry none, plenty of
 *     initiatives are genuinely internal, and failing on half the sheet would
 *     train whoever reads these runs to ignore red. There is deliberately no flag
 *     to escalate it.
 *
 * IDS COME FROM THE SHEET'S `id` COLUMN, e.g. `init-12` or `ryan-41` — the prefix
 * is the author's and carries no meaning here. Retitling an initiative is an
 * ordinary update: the key holds, `first_seen_at`
 * survives, and the detail URL does not move. This REVERSES the previous rule, so
 * discount any older note claiming a rename is a delete plus a create.
 *
 * A run reporting both creates and deletes now means what it says — something was
 * genuinely added and something genuinely removed — or that the sheet's ids were
 * renumbered. Read the ids before assuming either. A wholesale renumbering trips
 * the delete ceiling and is refused; check the sheet before reaching for --force.
 *
 * This workbook is NOT the projects sync's workbook and needs its own share with
 * the service account. Being able to read one says nothing about the other.
 *
 * Exit codes:
 *   0  applied, or nothing to do, or a clean dry run
 *   1  a failure, the gate refused, or a stated project name resolved to nothing
 *
 * Prerequisites: a Google service-account key with read access to the workbook,
 * and AWS credentials with read/write on the initiatives table plus Query on the
 * projects table. The GitHub deploy role has both — see the
 * DynamoDBInitiativesSync and DynamoDBProjectsSync statements in terraform/iam.tf.
 */

import { appendFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { parseSpreadsheetId } from './lib/sheet-export.mjs';
import {
  SheetsError,
  loadServiceAccountKey,
  authorize,
  fetchTabTitles,
  fetchTabValues,
} from './lib/sheets-client.mjs';
import { SyncInitiativesError, EXPECTED_TAB_TITLE } from './lib/sync-initiatives.mjs';
import {
  populateInitiatives,
  checkInitiativeResolution,
} from './lib/sync-initiatives-apply.mjs';
import { buildRunSummary } from './lib/sync-initiatives-summary.mjs';
import { SEED_IN_PROGRESS, SEED_NEVER } from '../functions/api/lib/initiatives.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SPREADSHEET_ID = '1IOBjzJJ7J_LhTlkAf4iWzNevsWCv1jqRakKdOYBwdtg';
const PROJECT = 'skills-registry';

const USAGE =
  'Usage: node scripts/sync-initiatives.mjs --env <staging|prod> [--dry-run] [--force]\n' +
  '                                         [--credentials <path>] [--spreadsheet <url-or-id>]\n' +
  '                                         [--table <name>] [--projects-table <name>]';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];

    // A value-taking flag consumes the next token, so `--projects-table --dry-run`
    // swallows the --dry-run and the run proceeds LIVE against a table the operator
    // never named. Both shapes are rejected rather than guessed at: this script
    // deletes records, and the flag it is most likely to eat is the safety one.
    const requireValue = () => {
      if (value === undefined) fail(`${flag} requires a value.\n${USAGE}`);
      if (value.startsWith('--')) {
        fail(
          `${flag} requires a value, but the next argument is "${value}".\n` +
            `  If "${value}" was meant as its own flag, ${flag} is missing its value.\n${USAGE}`,
        );
      }
      return value;
    };

    switch (flag) {
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--env': opts.env = requireValue(); i++; break;
      case '--credentials': opts.credentials = requireValue(); i++; break;
      case '--spreadsheet': opts.spreadsheet = requireValue(); i++; break;
      case '--table': opts.table = requireValue(); i++; break;
      case '--projects-table': opts.projectsTable = requireValue(); i++; break;
      default: fail(`Unknown flag: ${flag}\n${USAGE}`);
    }
  }

  if (!['staging', 'prod'].includes(opts.env)) fail(`--env must be "staging" or "prod".\n${USAGE}`);

  let spreadsheetId;
  try {
    spreadsheetId = parseSpreadsheetId(
      opts.spreadsheet ?? process.env.SYNC_INITIATIVES_SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    );
  } catch (err) {
    fail(err.message);
  }

  // Derived from --env, matching every sibling sync. Keeps table configuration out
  // of the invocation, so a table name cannot drift between Terraform and the
  // operator's shell history.
  return {
    env: opts.env,
    dryRun: opts.dryRun,
    force: opts.force,
    credentialsPath: resolve(
      opts.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'credentials.json',
    ),
    spreadsheetId,
    table: opts.table ?? process.env.INITIATIVES_TABLE ?? `${PROJECT}-initiatives-${opts.env}`,
    projectsTable:
      opts.projectsTable ?? process.env.PROJECTS_TABLE ?? `${PROJECT}-projects-${opts.env}`,
  };
}

// GitHub renders this file as the run's summary. It is the channel that makes a
// dispatched run legible after the fact, rather than something someone has to have
// been watching the console for.
function writeJobSummary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${lines.join('\n')}\n`);
}

// The two buckets go to different streams, so a reader can tell the alarm from the
// background at a glance.
function logResolution(resolution) {
  for (const u of resolution.unresolvedProjects) {
    console.error(`  NO SUCH PROJECT   ${u.initiative_id}  Project = "${u.raw_value}"`);
  }
  if (resolution.missingProject.length > 0) {
    console.log(`  ${resolution.missingProject.length} initiative(s) state no project:`);
    for (const m of resolution.missingProject) {
      console.log(`    no project    ${m.title}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const auth = await authorize(loadServiceAccountKey(args.credentialsPath));
  console.log(`Authenticated as ${auth.clientEmail}`);

  // Located BY TITLE, not by index. The workbook holds four tabs and was
  // reorganized around v2 on 2026-08-24 — the tab moved to index 0 and the former
  // source was renamed "OLD: v1 from initiatives.json". Reading index 0 would be
  // correct today and is a coincidence, not a contract.
  const titles = await fetchTabTitles(auth, args.spreadsheetId);
  if (!titles.includes(EXPECTED_TAB_TITLE)) {
    fail(
      `Workbook ${args.spreadsheetId} has no tab named "${EXPECTED_TAB_TITLE}", which is the ` +
        'tab this sync reads.\n' +
        '  Either it was renamed, or this is the wrong workbook. Rename the tab back, or update\n' +
        '  EXPECTED_TAB_TITLE in scripts/lib/sync-initiatives.mjs.\n' +
        `  Available tabs, in order: ${titles.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  const values = await fetchTabValues(auth, args.spreadsheetId, [EXPECTED_TAB_TITLE]);
  const grid = values[EXPECTED_TAB_TITLE];

  // The AWS SDK is installed in functions/api, not at the root.
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand, QueryCommand,
  } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

  console.log(`\nReconciling ${args.table} (${args.env})${args.dryRun ? ' — DRY RUN' : ''}`);

  const report = await populateInitiatives({
    ddb,
    table: args.table,
    grid,
    now: new Date().toISOString(),
    override: args.force,
    dryRun: args.dryRun,
    PutCommand, DeleteCommand, GetCommand, QueryCommand,
  });

  if (report.previousState === SEED_IN_PROGRESS) {
    console.log(
      '\n  NOTE: the previous run left an in-progress marker, so the table was mid-flight.\n' +
        '  The gate was measured against the last COMPLETED run, not that partial one.',
    );
  } else if (report.previousState === SEED_NEVER) {
    console.log('\n  First run against this table — nothing populated yet.');
  }

  console.log(
    `\n  ${String(report.incoming).padStart(4)} rows in sheet` +
      `\n  ${String(report.storedCount).padStart(4)} initiatives already stored` +
      `\n  ${String(report.created).padStart(4)} to create` +
      `\n  ${String(report.updated).padStart(4)} to update` +
      `\n  ${String(report.deleted).padStart(4)} to delete` +
      (report.skippedBlankRows ? `\n  ${String(report.skippedBlankRows).padStart(4)} blank rows skipped` : ''),
  );

  if (report.deletedIds.length > 0) {
    console.log(`\n  deleting: ${report.deletedIds.join(', ')}`);
  }

  if (report.newColumns.length > 0) {
    console.log(
      `\n  NEW COLUMNS since the last run: ${report.newColumns.join(', ')}\n` +
        '  A renamed column is indistinguishable from a new one. Note that a new column\n' +
        '  reaches the TABLE automatically but NOT the page — it has to be added to\n' +
        '  INITIATIVE_FIELDS in functions/api/routes/initiatives.mjs first.',
    );
  }

  // Ids come from the sheet's id column, so this combination is no longer the
  // reassuring case it used to be. Saying so costs one line and stops an operator
  // who remembers the old rule from waving it through.
  if (report.created > 0 && report.deleted > 0) {
    console.log(
      '\n  NOTE: this run both creates and deletes. Ids come from the sheet\'s `id` column,\n' +
        '  so a retitled initiative is an ordinary UPDATE and cannot explain this. Either\n' +
        '  rows were genuinely added and removed, or the ids were renumbered. Check the ids\n' +
        '  above against the sheet before letting this stand.',
    );
  }

  // The summary is written on every exit path below, including the clean one. A run
  // that reports nothing looks identical on the Actions page to a run that did
  // nothing — and since the steady state here is "no drift", the reassuring case is
  // exactly the one that has to be legible.
  const summarise = (extra = {}) =>
    writeJobSummary(buildRunSummary({ env: args.env, report, dryRun: args.dryRun, ...extra }));

  if (report.refusal) {
    summarise();
    fail(report.refusal);
  }

  if (args.dryRun) {
    summarise();
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  console.log(`\n  applied.${report.created + report.updated + report.deleted === 0 ? ' (nothing to do)' : ''}`);

  // Resolution happens here as well as on read. That duplication is deliberate: the
  // page must resolve on request so a sheet fix clears findings at once, and the run
  // must resolve so a typo reaches a human without a page load. Both call the same
  // rule in functions/api/lib/initiatives.mjs.
  //
  // A resolution failure is reported separately from a sync failure, because by this
  // point the initiatives have already been written successfully. Letting the
  // exception escape produced a raw stack trace on a run that had actually done its
  // job, which reads as "the sync broke" when nothing of the sort happened.
  let resolution;
  try {
    resolution = await checkInitiativeResolution({
      ddb,
      projectsTable: args.projectsTable,
      initiatives: report.initiatives,
      QueryCommand,
    });
  } catch (err) {
    summarise({ resolutionError: err.message ?? err });
    fail(
      'The initiatives synced successfully, but the project resolution check could not run: ' +
        `${err.message ?? err}\n\n` +
        '  The table is correct — only the alarm failed. Most likely the caller lacks\n' +
        `  dynamodb:Query on ${args.projectsTable}; see the DynamoDBProjectsSync statement\n` +
        '  in terraform/iam.tf.',
    );
  }

  summarise({ resolution });

  console.log(
    `\n  Resolution against ${resolution.projectCount} projects:` +
      `\n  ${String(resolution.missingProject.length).padStart(4)} initiatives stating no project` +
      `\n  ${String(resolution.unresolvedProjects.length).padStart(4)} stated project names matching no project`,
  );
  console.log();
  logResolution(resolution);

  if (resolution.unresolvedProjects.length > 0) {
    fail(
      `${resolution.unresolvedProjects.length} stated project name(s) match no project record. ` +
        'The initiatives synced successfully — this failure is the resolution alarm, not a ' +
        'sync error.\n' +
        '  Fix the value in the sheet, or check whether the project exists in the projects\n' +
        '  table under a different name.',
    );
  }

  console.log('\n  every stated project name resolves.\n');
}

main().catch((err) => {
  if (err instanceof SyncInitiativesError || err instanceof SheetsError) fail(err.message);

  // The likeliest operator mistake is running this before the table exists —
  // Terraform apply is manual and per-environment (docs/DEPLOY.md), so the table
  // trails the code by however long that takes. A stack trace buries that.
  if (err?.name === 'ResourceNotFoundException') {
    fail(
      'No such DynamoDB table. Run `terraform apply` for this environment first, or pass\n' +
        '  --table / --projects-table if the names differ from the defaults.\n' +
        `  Original error: ${err.message}`,
    );
  }

  if (err?.name === 'AccessDeniedException') {
    fail(
      'AWS denied the request. This sync needs read/write on the initiatives table and Query\n' +
        '  on the projects table — see the DynamoDBInitiativesSync and DynamoDBProjectsSync\n' +
        '  statements in terraform/iam.tf, both attached to the GitHub deploy role alone.\n' +
        `  Original error: ${err.message}`,
    );
  }

  console.error(err);
  process.exit(1);
});
