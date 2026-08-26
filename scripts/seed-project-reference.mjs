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
 * That safety is also a limitation: a changed value in POSTURE_COLORS can never
 * reach a posture that already exists. For that one case there is a second mode:
 *
 *   node scripts/seed-project-reference.mjs --env staging --update-colors
 *
 * It rewrites the `color` attribute of the four posture records from
 * POSTURE_COLORS and touches nothing else — not labels, not steps, not
 * archetypes — so an admin's edits to the guidance survive a restyle. It needs
 * neither source file, because a posture color lives in this repo rather than in
 * the policy export. Combine it with --dry-run to see the before/after first.
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
import {
  buildRecords,
  postureColorUpdates,
  skippedPolicyFields,
  SeedError,
} from './lib/seed-project-reference.mjs';

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
    else if (flag === '--update-colors') args.updateColors = true;
    else {
      throw new SeedError(`Unknown flag: ${flag}`);
    }
  }
  if (!['staging', 'prod'].includes(args.env)) {
    throw new SeedError('--env must be "staging" or "prod"');
  }
  // The two modes write differently — create-if-absent vs. update-in-place — so
  // an invocation that names both is an operator who has not decided which they
  // want. Refuse rather than silently picking one.
  if (args.updateColors) {
    for (const unused of ['archetypes', 'policy']) {
      if (args[unused]) {
        throw new SeedError(
          `--update-colors does not read the ${unused} file; posture colors come from ` +
            `POSTURE_COLORS in scripts/lib/. Drop --${unused}, or drop --update-colors ` +
            `to run a full seed.`
        );
      }
    }
    return args;
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

/** Resolve the AWS SDK from functions/api, where it is installed. */
async function connect() {
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
    PutCommand,
    UpdateCommand,
  };
}

/**
 * Rewrite the posture `color` attribute, and only that attribute.
 *
 * A targeted UpdateExpression rather than a Put: a Put would need the whole item,
 * so it would overwrite the label and steps an admin may have edited with whatever
 * the policy export happened to say. This touches one attribute and leaves the
 * rest of the record alone, which is the entire reason the mode exists.
 *
 * `attribute_exists(id)` keeps it an update and never a create. A posture invented
 * here would have a color and nothing else — no label, no steps — which is a record
 * the API's own validation would have rejected, and the badge would render blank.
 */
async function updateColors(args, table) {
  const updates = postureColorUpdates();

  console.log(`\nUpdating posture colors in ${table}`);
  console.log(`  postures: ${updates.length}`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    for (const u of updates) console.log(`  would set ${u.entity_type}/${u.id} color = ${u.color}`);
    console.log();
    return;
  }

  const { ddb, UpdateCommand } = await connect();
  const now = new Date().toISOString();
  let changed = 0;
  let same = 0;
  let missing = 0;

  console.log();
  for (const { entity_type, id, color } of updates) {
    try {
      const res = await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { entity_type, id },
          UpdateExpression: 'SET #color = :color, updated_at = :now',
          // `color` is a DynamoDB reserved word and has to go through a name
          // placeholder; an inline `color = :color` is rejected at request time.
          ExpressionAttributeNames: { '#color': 'color' },
          ExpressionAttributeValues: { ':color': color, ':now': now },
          ConditionExpression: 'attribute_exists(id)',
          // The previous value, so the run log says what actually moved rather
          // than reporting four updates when nothing changed.
          ReturnValues: 'UPDATED_OLD',
        })
      );
      const before = res.Attributes?.color;
      if (before === color) {
        same++;
        console.log(`  same     ${entity_type}/${id} already ${color}`);
      } else {
        changed++;
        console.log(`  updated  ${entity_type}/${id} ${before ?? '(unset)'} -> ${color}`);
      }
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        missing++;
        console.log(`  missing  ${entity_type}/${id} (no such record — run a full seed first)`);
      } else {
        throw err;
      }
    }
  }

  console.log(`\n${changed} updated, ${same} already current, ${missing} missing.\n`);
  if (missing) {
    console.log('A missing posture means this environment was never seeded. Run the');
    console.log('full seed with --archetypes and --policy before updating colors.\n');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const table = args.table ?? `skills-registry-project-reference-${args.env}`;

  if (args.updateColors) return updateColors(args, table);

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

  const { ddb, PutCommand } = await connect();

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
