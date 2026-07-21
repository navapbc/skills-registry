#!/usr/bin/env node
/**
 * Prune orphaned enterprise skill records from DynamoDB.
 *
 * The sync (scripts/sync-registry-v2.mjs) is upsert-only — it never deletes.
 * When an enterprise skill's computed slug changes between syncs (e.g. a
 * `name:` field was added, or the parser's slug derivation changed), the sync
 * writes a NEW record under the new slug and the OLD record is left behind as
 * a stale orphan (often with an empty category). This script finds and removes
 * those orphans.
 *
 * An enterprise record is an ORPHAN when its slug is not in the canonical set
 * derived from this repo's enterprise/*\/SKILL.md (+ AGENT.md) files — i.e. no
 * current enterprise source file would produce that slug. `source=enterprise`
 * is assigned iff the file path starts with `enterprise/` (see
 * src/lib/parse-skill.mjs), so the repo's enterprise/ tree is the source of
 * truth for which enterprise slugs are legitimate.
 *
 * SAFETY:
 *   - Only ever considers records with source == 'enterprise'. Never touches
 *     github, user-submitted, anthropic-*, or category-config records.
 *   - Dry-run by DEFAULT. Deletion requires the explicit --apply flag.
 *   - Aborts if the canonical set is empty (guards against a parse failure
 *     nuking every enterprise record).
 *
 * Run staging first, verify, then prod:
 *   node scripts/prune-orphan-skills.mjs --env staging            # dry-run
 *   node scripts/prune-orphan-skills.mjs --env staging --apply    # delete
 *   node scripts/prune-orphan-skills.mjs --env prod --apply
 *
 * Prerequisites: AWS credentials in environment with DynamoDB read/write access.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';
import { slugify, deriveName, parseFrontmatter } from '../src/lib/parse-skill.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Resolve AWS SDK from functions/api where it is installed
const require = createRequire(resolve(ROOT, 'functions/api/package.json'));
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/prune-orphan-skills.mjs --env <staging|prod> [--apply]');
  process.exit(1);
}
const env = args[envIdx + 1];
if (!['staging', 'prod'].includes(env)) {
  console.error('env must be "staging" or "prod"');
  process.exit(1);
}

const SKILLS_TABLE = `skills-registry-skills-${env}`;
const ENTERPRISE_DIR = join(ROOT, 'enterprise');
const SOURCE_FILES = ['SKILL.md', 'AGENT.md'];

// Compute the canonical set of enterprise slugs from the repo, using the same
// derivation the sync uses: slug = slugify(meta.slug || deriveName(...)).
function canonicalEnterpriseSlugs() {
  const slugs = new Set();
  for (const dir of readdirSync(ENTERPRISE_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const filename of SOURCE_FILES) {
      const full = join(ENTERPRISE_DIR, dir.name, filename);
      if (!existsSync(full)) continue;
      const relPath = `enterprise/${dir.name}/${filename}`;
      const { meta } = parseFrontmatter(readFileSync(full, 'utf8'));
      const name = deriveName(meta, relPath, 'skills-registry');
      slugs.add(slugify(meta.slug || name));
    }
  }
  return slugs;
}

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

async function scanEnterpriseRecords() {
  const items = [];
  let lastKey;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: SKILLS_TABLE,
      FilterExpression: '#s = :e',
      ExpressionAttributeNames: { '#s': 'source' },
      ExpressionAttributeValues: { ':e': 'enterprise' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }));
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function main() {
  const canonical = canonicalEnterpriseSlugs();
  if (canonical.size === 0) {
    console.error('Refusing to run: canonical enterprise slug set is empty (parse failure?).');
    process.exit(1);
  }
  console.log(`[${env}] ${canonical.size} canonical enterprise slugs from repo enterprise/ tree.`);

  const records = await scanEnterpriseRecords();
  console.log(`[${env}] ${records.length} source=enterprise records in DynamoDB.\n`);

  const orphans = records.filter(r => !canonical.has(r.slug));
  if (orphans.length === 0) {
    console.log('No orphans found. ✓');
    return;
  }

  console.log(`Found ${orphans.length} orphan(s)${APPLY ? '' : ' (dry run — nothing will be deleted)'}:`);
  for (const o of orphans) {
    console.log(`  - ${o.slug}  (name: ${o.name ?? '?'}, category: ${JSON.stringify(o.category ?? '')})`);
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to delete these records.');
    return;
  }

  console.log('');
  let deleted = 0;
  for (const o of orphans) {
    await ddb.send(new DeleteCommand({ TableName: SKILLS_TABLE, Key: { slug: o.slug } }));
    console.log(`  ✓ deleted ${o.slug}`);
    deleted++;
  }
  console.log(`\nDone. Deleted ${deleted} orphan record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
