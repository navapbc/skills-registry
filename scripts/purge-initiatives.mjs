#!/usr/bin/env node
/**
 * Delete every initiative record from the `initiatives` DynamoDB table, so a
 * following sync run repopulates it from scratch
 * (docs/plans/2026-08-24-001-feat-initiatives-v2-sheet-source-plan.md, U6).
 *
 * WHY THIS EXISTS. The sync reconciles; it does not rebuild. That is the right
 * default and it is not enough when every KEY changes at once. Moving the range
 * key from a slug of the initiative title to the sheet's own `id` column re-keys
 * all 46 records, which reconciliation would present as 46 creates plus a delete
 * of everything stored — refused by the delete ceiling, and only forceable by
 * waiving the guard that exists for exactly that shape. Purging first says what is
 * actually happening.
 *
 * This is a MIGRATION TOOL, not maintenance. In steady state the sync is the only
 * thing that should write this table.
 *
 * SAFETY:
 *   - Dry-run by DEFAULT. Deletion requires the explicit --apply flag.
 *   - Deletes only the initiative partition. The `seed_meta` record is left in
 *     place on purpose — see the note below, it is load-bearing.
 *   - Refuses when the partition is already empty, so a double-run is a clear
 *     no-op rather than an ambiguous success.
 *   - Not wired into any workflow. A one-click mass delete of a populated table is
 *     not something this repo should offer; run it from a shell, deliberately.
 *
 * THE SAFETY NET IS DOWN BETWEEN THE TWO COMMANDS. The sync's delete ceiling and
 * its absolute floor are both conditioned on a non-zero stored count, so neither
 * applies to a run against an empty table. That is deliberate — they would
 * otherwise block every first population — but it means the window between this
 * script and the sync is unguarded. Two consequences:
 *
 *   - Run the sync's --dry-run BEFORE purging, not after. Confirming the sheet
 *     reads cleanly while the table is still populated costs nothing; discovering
 *     it does not, with the table already empty, leaves the page empty until the
 *     read is fixed.
 *   - Run the sync immediately after. Do not leave the table empty.
 *
 * `seed_meta` IS NOT DELETED, and that is not an oversight. Its `row_count` and
 * `column_names` describe the last COMPLETED run, which is what the sync's
 * row-drop check measures against. Clearing it would silently disable that check
 * on the repopulating run — the run least able to afford a missing guard. The
 * metadata is overwritten by that run anyway.
 *
 * Run staging first, verify the page, then prod:
 *   node scripts/sync-initiatives.mjs --env staging --dry-run   # confirm the read
 *   node scripts/purge-initiatives.mjs --env staging            # dry-run
 *   node scripts/purge-initiatives.mjs --env staging --apply     # delete
 *   node scripts/sync-initiatives.mjs --env staging              # repopulate
 *
 * Exit codes:
 *   0  a clean dry run, or the purge applied
 *   1  a failure, or nothing to purge
 *
 * Prerequisites: AWS credentials with read/write on the initiatives table. The
 * GitHub deploy role holds them (terraform/iam.tf, DynamoDBInitiativesSync), but
 * this is not run from CI.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { purgeInitiatives } from './lib/sync-initiatives-apply.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT = 'skills-registry';

const USAGE =
  'Usage: node scripts/purge-initiatives.mjs --env <staging|prod> [--apply] [--table <name>]';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { apply: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];

    // A value-taking flag consumes the next token, so `--table --apply` would
    // swallow the --apply and read as a dry run against a table nobody named. Both
    // shapes are rejected rather than guessed at, matching sync-initiatives.mjs.
    // Here the flag most likely to be eaten is the destructive one.
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
      case '--apply': opts.apply = true; break;
      case '--env': opts.env = requireValue(); i++; break;
      case '--table': opts.table = requireValue(); i++; break;
      default: fail(`Unknown flag: ${flag}\n${USAGE}`);
    }
  }

  if (!['staging', 'prod'].includes(opts.env)) fail(`--env must be "staging" or "prod".\n${USAGE}`);

  return {
    env: opts.env,
    apply: opts.apply,
    table: opts.table ?? process.env.INITIATIVES_TABLE ?? `${PROJECT}-initiatives-${opts.env}`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The AWS SDK is installed in functions/api, not at the root.
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

  console.log(
    `\nPurging initiatives from ${args.table} (${args.env})` +
      `${args.apply ? '' : ' — DRY RUN'}`,
  );

  // Always read first, whether or not this will apply, so the dry run reports the
  // same set the live run would delete.
  const report = await purgeInitiatives({
    ddb, table: args.table, dryRun: true, DeleteCommand, QueryCommand,
  });

  if (report.ids.length === 0) {
    fail(
      `${args.table} holds no initiative records, so there is nothing to purge.\n` +
        '  If you expected records here, check --env and --table before assuming the table\n' +
        '  was already emptied — a purge that finds nothing and a wrong table name look the\n' +
        '  same from here.',
    );
  }

  console.log(`\n  ${String(report.ids.length).padStart(4)} initiative(s) to delete`);
  console.log(`\n  ${report.ids.join(', ')}\n`);
  console.log('  the seed_meta record is NOT deleted: its row_count is the baseline the');
  console.log('  next run measures against.');

  if (!args.apply) {
    console.log(
      '\n  DRY RUN — nothing deleted. Re-run with --apply to delete, then run\n' +
        `  \`node scripts/sync-initiatives.mjs --env ${args.env}\` immediately after:\n` +
        '  the sync\'s delete ceiling and floor do not apply to an empty table, so do not\n' +
        '  leave it empty.\n',
    );
    return;
  }

  const applied = await purgeInitiatives({
    ddb, table: args.table, dryRun: false, DeleteCommand, QueryCommand,
  });

  console.log(`\n  deleted ${applied.deleted} initiative(s).`);
  console.log(
    `\n  NEXT: node scripts/sync-initiatives.mjs --env ${args.env}\n` +
      '  The table is empty and the page will say so until that run completes.\n',
  );
}

main().catch((err) => {
  if (err?.name === 'ResourceNotFoundException') {
    fail(
      'No such DynamoDB table. Check --env, or pass --table if the name differs from the\n' +
        `  default.\n  Original error: ${err.message}`,
    );
  }

  if (err?.name === 'AccessDeniedException') {
    fail(
      'AWS denied the request. This script needs Query and DeleteItem on the initiatives\n' +
        '  table — see the DynamoDBInitiativesSync statement in terraform/iam.tf.\n' +
        `  Original error: ${err.message}`,
    );
  }

  // A failure part-way through leaves a PARTIALLY purged table. Say so rather than
  // letting a bare stack trace imply nothing happened.
  console.error(err);
  console.error(
    '\nThe purge may have deleted some records before failing. Re-run the dry run to see\n' +
      'what remains before deciding what to do next.\n',
  );
  process.exit(1);
});
