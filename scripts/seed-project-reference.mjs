#!/usr/bin/env node
/**
 * One-time seed for the project-reference table: delivery archetypes and AI
 * posture guidance for the Contract Explorer.
 *
 * The source files live OUTSIDE this repository and must stay that way — this
 * repo is public — so both paths are supplied by the operator:
 *
 *   node scripts/seed-project-reference.mjs --env staging \
 *     --archetypes "/path/to/archetypes.json" \
 *     --policy "/path/to/policy.json"
 *
 *   --dry-run   transform and validate, print what would be written, write nothing
 *
 * Safe to re-run. Every write is conditional on the record not already existing,
 * so a second run reports "exists" and changes nothing — it cannot revert an edit
 * made through the admin tabs. The check is a condition on the write rather than
 * a read-then-write, which would race.
 *
 * Only the `guidance` block of the policy file is carried. The file's approver,
 * dates, source link, checklist, standard client response, and hard limits are
 * deliberately not stored — the hub does not become a second source of truth for
 * the governed policy. Those fields are logged as skipped so the narrowing is
 * visible rather than silent, and they are the reason the source files should be
 * archived rather than deleted after seeding.
 *
 * Prerequisites: AWS credentials in the environment with write access to the
 * table. The GitHub deploy role does not have it — this runs as an operator.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { buildRecords, skippedPolicyFields, SeedError } from './lib/seed-project-reference.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--env') args.env = argv[++i];
    else if (flag === '--archetypes') args.archetypes = argv[++i];
    else if (flag === '--policy') args.policy = argv[++i];
    else if (flag === '--table') args.table = argv[++i];
    else {
      throw new SeedError(`Unknown flag: ${flag}`);
    }
  }
  if (!['staging', 'prod'].includes(args.env)) {
    throw new SeedError('--env must be "staging" or "prod"');
  }
  for (const required of ['archetypes', 'policy']) {
    if (!args[required]) throw new SeedError(`--${required} <path> is required`);
  }
  return args;
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SeedError(
      err.code === 'ENOENT'
        ? `${label} file not found: ${path}`
        : `${label} file could not be read (${err.code}): ${path}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new SeedError(`${label} file is not valid JSON: ${path} — ${err.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const table = args.table ?? `skills-registry-project-reference-${args.env}`;

  const archetypes = readJson(args.archetypes, 'Archetypes');
  const policy = readJson(args.policy, 'Policy');

  // Transform and validate everything before opening a connection. A file that
  // cannot produce a valid record set should fail before any partial write.
  const records = buildRecords({ archetypes, policy });

  const skipped = skippedPolicyFields(policy);
  console.log(`\nSeeding ${table}`);
  console.log(`  archetypes: ${records.filter((r) => r.entity_type === 'archetype').length}`);
  console.log(`  postures:   ${records.filter((r) => r.entity_type === 'posture').length}`);
  if (skipped.length) {
    console.log(`  policy fields deliberately not carried: ${skipped.join(', ')}`);
    console.log('  → archive the source files rather than deleting them.');
  }

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    for (const r of records) console.log(`  would create ${r.entity_type}/${r.id}`);
    console.log();
    return;
  }

  // Resolve the AWS SDK from functions/api, where it is installed.
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

  const now = new Date().toISOString();
  let created = 0;
  let existing = 0;

  console.log();
  for (const record of records) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: { ...record, created_by: 'seed', created_at: now, updated_at: now },
          // Create-if-absent. This is what makes a re-run safe: an existing
          // record — including one an admin has since edited — is left alone.
          ConditionExpression: 'attribute_not_exists(id)',
        })
      );
      created++;
      console.log(`  created  ${record.entity_type}/${record.id}`);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        existing++;
        console.log(`  exists   ${record.entity_type}/${record.id} (left unchanged)`);
      } else {
        throw err;
      }
    }
  }

  console.log(`\n${created} created, ${existing} already present.\n`);
}

main().catch((err) => {
  console.error(`\n${err instanceof SeedError ? err.message : err.stack}\n`);
  process.exit(1);
});
