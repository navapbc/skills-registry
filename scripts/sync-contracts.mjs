#!/usr/bin/env node
/**
 * Reconcile the `contracts` DynamoDB table against the "AI Survey (Contracts and
 * Delivery Completes)" tab
 * (docs/plans/2026-08-07-001-feat-contracts-table-and-population-plan.md, U3).
 *
 * Population is operator-run, NOT scheduled — unlike scripts/sync-projects.mjs.
 * There is no workflow calling this, and the GitHub deploy role has no access to
 * the table. The origin document treats population as a one-time event; this is
 * written to reconcile anyway, so the certain future refresh is one command
 * rather than a rewrite.
 *
 * The sheet is authoritative: a contract it no longer lists is deleted here.
 *
 * Every row is imported. This makes no validity judgement of its own — no
 * portfolio allowlist, no posture requirement. 82 of 119 rows carry no posture
 * and that is the survey's current state, not an error. Rows the survey should
 * not contain get removed at the sheet.
 *
 * Usage:
 *
 *   node scripts/sync-contracts.mjs --env staging --dry-run
 *   node scripts/sync-contracts.mjs --env staging
 *   node scripts/sync-contracts.mjs --env prod
 *
 * Options (each falls back to an env var, then to a default):
 *   --env <staging|prod>   required
 *   --credentials <path>   GOOGLE_APPLICATION_CREDENTIALS   default ./credentials.json
 *   --spreadsheet <ref>    SYNC_CONTRACTS_SHEET_ID          URL or ID
 *   --table <name>         CONTRACTS_TABLE           default skills-registry-contracts-<env>
 *   --projects-table <n>   PROJECTS_TABLE            default skills-registry-projects-<env>
 *   --reference-table <n>  PROJECT_REFERENCE_TABLE   default skills-registry-project-reference-<env>
 *   --dry-run              report the diff and the gate verdict, write nothing
 *   --force                waive the gate's overridable conditions
 *
 * --force never waives the zero-row refusal. A zero-row read means the tab, its
 * share, or its shape changed — not that every contract was retired.
 *
 * This workbook is NOT the projects sync's workbook and needs its own share with
 * the service account. Being able to read one says nothing about the other.
 *
 * Exit codes:
 *   0  applied, or nothing to do, or a clean dry run
 *   1  a failure, or the gate refused
 *
 * Unresolved project names and missing postures WARN rather than fail. Both
 * describe the survey's current state rather than a regression, and a run that
 * is always red is a run nobody reads.
 *
 * Prerequisites: a Google service-account key with read access to the workbook,
 * and operator AWS credentials with read/write on the contracts table. CI does
 * not have them, deliberately.
 */

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
import { SyncContractsError } from './lib/sync-contracts.mjs';
import { populateContracts, checkContractDrift } from './lib/sync-contracts-apply.mjs';
import { SEED_IN_PROGRESS, SEED_NEVER } from '../functions/api/lib/contracts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SPREADSHEET_ID = '1GdeIJI92Rb6LipM3l6FhWte7BYXCXe-zPKgJvvmu8G4';
const TAB_TITLE = 'AI Survey (Contracts and Delivery Completes)';
const PROJECT = 'skills-registry';

const USAGE =
  'Usage: node scripts/sync-contracts.mjs --env <staging|prod> [--dry-run] [--force]\n' +
  '                                       [--credentials <path>] [--spreadsheet <url-or-id>]\n' +
  '                                       [--table <name>] [--projects-table <name>]\n' +
  '                                       [--reference-table <name>]';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--env': opts.env = value; i++; break;
      case '--credentials': opts.credentials = value; i++; break;
      case '--spreadsheet': opts.spreadsheet = value; i++; break;
      case '--table': opts.table = value; i++; break;
      case '--projects-table': opts.projectsTable = value; i++; break;
      case '--reference-table': opts.referenceTable = value; i++; break;
      default: fail(`Unknown flag: ${flag}\n${USAGE}`);
    }
  }

  if (!['staging', 'prod'].includes(opts.env)) fail(`--env must be "staging" or "prod".\n${USAGE}`);

  let spreadsheetId;
  try {
    spreadsheetId = parseSpreadsheetId(
      opts.spreadsheet ?? process.env.SYNC_CONTRACTS_SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    );
  } catch (err) {
    fail(err.message);
  }

  // Derived from --env, matching sync-projects and seed-project-reference. Keeps
  // table configuration out of the invocation, so a table name cannot drift
  // between Terraform and the operator's shell history.
  return {
    env: opts.env,
    dryRun: opts.dryRun,
    force: opts.force,
    credentialsPath: resolve(
      opts.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'credentials.json',
    ),
    spreadsheetId,
    table: opts.table ?? process.env.CONTRACTS_TABLE ?? `${PROJECT}-contracts-${opts.env}`,
    projectsTable: opts.projectsTable ?? process.env.PROJECTS_TABLE ?? `${PROJECT}-projects-${opts.env}`,
    referenceTable:
      opts.referenceTable ?? process.env.PROJECT_REFERENCE_TABLE
      ?? `${PROJECT}-project-reference-${opts.env}`,
  };
}

function logDrift(drift) {
  for (const u of drift.unresolvedProjects) {
    console.log(`  no such project   ${u.contract_id}  project_name = "${u.raw_value}"`);
  }
  for (const u of drift.unresolvedPostures) {
    console.error(`  UNKNOWN POSTURE   ${u.contract_id}  ai_posture = "${u.raw_value}"`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const auth = await authorize(loadServiceAccountKey(args.credentialsPath));
  console.log(`Authenticated as ${auth.clientEmail}`);

  // Fetch by title so a renamed tab fails loudly rather than populating from
  // whatever happens to sit at some index.
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

  const report = await populateContracts({
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
        '  Its records were written but its completion marker never was.',
    );
  } else if (report.previousState === SEED_NEVER) {
    console.log('\n  First run against this table — nothing populated yet.');
  }

  console.log(
    `\n  ${String(report.incoming).padStart(4)} rows in sheet` +
      `\n  ${String(report.storedCount).padStart(4)} contracts already stored` +
      `\n  ${String(report.created).padStart(4)} to create` +
      `\n  ${String(report.updated).padStart(4)} to update` +
      `\n  ${String(report.deleted).padStart(4)} to delete` +
      (report.skippedBlankRows ? `\n  ${String(report.skippedBlankRows).padStart(4)} blank rows skipped` : ''),
  );

  if (report.deletedIds.length > 0) {
    console.log(`\n  deleting: ${report.deletedIds.join(', ')}`);
  }

  if (report.refusal) fail(report.refusal);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  const drift = await checkContractDrift({
    ddb,
    projectsTable: args.projectsTable,
    referenceTable: args.referenceTable,
    contracts: report.contracts,
    QueryCommand,
  });

  console.log(
    `\n  Resolution against ${drift.projectCount} projects and ${drift.postureCount} postures:` +
      `\n  ${String(drift.missingPosture.length).padStart(4)} contracts with no posture recorded` +
      `\n  ${String(drift.unresolvedProjects.length).padStart(4)} project names matching no project` +
      `\n  ${String(drift.unresolvedPostures.length).padStart(4)} posture values matching no posture record`,
  );
  logDrift(drift);

  if (drift.unresolvedPostures.length > 0) {
    console.error(
      '\n  A posture value naming no record renders no guidance on the Contract Explorer.\n' +
        '  Fix the value in the sheet, or add the posture on the Policy Guidance tab.',
    );
  }

  console.log(`\nDone. ${report.incoming} contracts in ${args.table}.\n`);
}

main().catch((err) => {
  if (err instanceof SyncContractsError || err instanceof SheetsError) fail(err.message);

  // The likeliest operator mistake is running this before the table exists —
  // Terraform apply is manual and per-environment (docs/DEPLOY.md), so the table
  // trails the code by however long that takes. A stack trace buries that.
  if (err?.name === 'ResourceNotFoundException') {
    fail(
      'No such DynamoDB table. Run `terraform apply` for this environment first, or pass\n' +
        '  --table / --projects-table / --reference-table if the names differ from the defaults.\n' +
        `  Original error: ${err.message}`,
    );
  }

  if (err?.name === 'AccessDeniedException') {
    fail(
      'AWS denied the request. Population runs as an OPERATOR, not as CI — the GitHub deploy\n' +
        '  role deliberately has no access to the contracts table.\n' +
        `  Original error: ${err.message}`,
    );
  }

  console.error(err);
  process.exit(1);
});
