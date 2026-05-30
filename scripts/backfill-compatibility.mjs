#!/usr/bin/env node
/**
 * Backfills the `compatibility` field on DynamoDB skill records based on file path patterns.
 *
 * Rules:
 *   type=skill  (any SKILL.md)              → ['claude-code']
 *   type=agent  path=CLAUDE.md / AGENTS.md  → ['claude-code']
 *   type=agent  path contains .cursor/      → ['cursor']
 *   type=agent  path contains copilot-      → ['github-copilot']
 *   type=agent  anything else               → ['claude-code']  (safe default)
 *
 * Only updates records where compatibility is currently empty ([]).
 *
 * Usage:
 *   node scripts/backfill-compatibility.mjs --env staging --dry-run
 *   node scripts/backfill-compatibility.mjs --env staging
 *   node scripts/backfill-compatibility.mjs --env prod
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/backfill-compatibility.mjs --env <staging|prod> [--dry-run]');
  process.exit(1);
}
const env = args[envIdx + 1];
if (!['staging', 'prod'].includes(env)) {
  console.error('env must be "staging" or "prod"');
  process.exit(1);
}
const dryRun = args.includes('--dry-run');

const PROJECT = 'skills-registry';
const SKILLS_TABLE = `${PROJECT}-skills-${env}`;

// AWS SDK lives in functions/api/node_modules
const apiDir = join(dirname(fileURLToPath(import.meta.url)), '../functions/api');
const req = createRequire(join(apiDir, 'package.json'));

const { DynamoDBClient } = req('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = req('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

function inferCompatibility(skill) {
  const path = skill.path || '';

  if (skill.type === 'skill') {
    return ['claude-code'];
  }

  // Agent — detect by path pattern
  if (path.includes('.cursor/') || path.endsWith('.mdc') || path.includes('.cursorrules')) {
    return ['cursor'];
  }

  if (path.includes('copilot-instructions')) {
    return ['github-copilot'];
  }

  // CLAUDE.md, AGENTS.md, and unrecognised agent paths
  return ['claude-code'];
}

console.log(`\nBackfilling compatibility on ${env}:`);
console.log(`  Table:    ${SKILLS_TABLE}`);
console.log(`  Dry run:  ${dryRun}\n`);

// Scan all skills — paginate until LastEvaluatedKey is absent
const skills = [];
let lastKey;
do {
  const result = await ddb.send(new ScanCommand({
    TableName: SKILLS_TABLE,
    ...(lastKey && { ExclusiveStartKey: lastKey }),
  }));
  skills.push(...(result.Items ?? []));
  lastKey = result.LastEvaluatedKey;
} while (lastKey);

// Only target records where compatibility is currently empty
const toUpdate = skills.filter(s => !s.compatibility || s.compatibility.length === 0);

console.log(`  Total skills: ${skills.length}`);
console.log(`  Need update:  ${toUpdate.length}`);
console.log(`  Already set:  ${skills.length - toUpdate.length}\n`);

if (toUpdate.length === 0) {
  console.log('Nothing to update.');
  process.exit(0);
}

// Preview what will be set
const preview = {};
for (const skill of toUpdate) {
  const compat = inferCompatibility(skill);
  const key = compat.join(',');
  if (!preview[key]) preview[key] = { compat, slugs: [] };
  preview[key].slugs.push(skill.slug);
}

console.log('Preview of changes:');
for (const { compat, slugs } of Object.values(preview)) {
  console.log(`  → [${compat.join(', ')}]  (${slugs.length} skills)`);
  slugs.slice(0, 3).forEach(s => console.log(`      ${s}`));
  if (slugs.length > 3) console.log(`      ... and ${slugs.length - 3} more`);
}
console.log();

if (dryRun) {
  console.log('Dry run — no changes written. Remove --dry-run to apply.');
  process.exit(0);
}

// Apply updates
let ok = 0, err = 0;
for (const skill of toUpdate) {
  const compat = inferCompatibility(skill);
  try {
    await ddb.send(new UpdateCommand({
      TableName: SKILLS_TABLE,
      Key: { slug: skill.slug },
      UpdateExpression: 'SET compatibility = :c',
      ExpressionAttributeValues: { ':c': compat },
    }));
    ok++;
    process.stdout.write('.');
  } catch (e) {
    console.error(`\nError updating ${skill.slug}: ${e.message}`);
    err++;
  }
}

console.log(`\n\nDone: ${ok} updated, ${err} errors`);
