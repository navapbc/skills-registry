#!/usr/bin/env node
/**
 * Verify (and optionally reconcile) that every enterprise skill's category/tags
 * are present in DynamoDB BEFORE the frontmatter is stripped
 * (docs/plans/2026-07-28-001-refactor-admin-owned-category-tags-plan.md, U5).
 *
 * `category` and `tags` are moving from author-owned frontmatter to admin-owned
 * DynamoDB. This script is the safety gate for the destructive frontmatter
 * removal (U2): it reads each enterprise/*\/SKILL.md's frontmatter category/tags,
 * compares against the DynamoDB record, and reports one of:
 *   match | ddb-missing-record | ddb-missing-field | mismatch
 *
 * Frontmatter is the SOURCE OF RECORD until it is stripped, so --apply writes
 * the frontmatter value into DynamoDB for anything not already stored. The
 * classification logic lives in scripts/lib/verify-category-tags.mjs and is unit
 * tested there.
 *
 * PRECONDITION: run this only AFTER U1 (sync no longer writes category/tags) is
 * deployed to the target environment — otherwise a scheduled sync could clobber
 * a reconciled value before U2 runs.
 *
 * Dry-run by DEFAULT. Writing requires the explicit --apply flag.
 *
 *   node scripts/verify-category-tags-ddb.mjs --env staging            # report only
 *   node scripts/verify-category-tags-ddb.mjs --env staging --apply    # reconcile
 *   node scripts/verify-category-tags-ddb.mjs --env prod   --apply
 *
 * Prerequisites: AWS credentials in environment with DynamoDB read/write access.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';
import { slugify, deriveName, parseFrontmatter, normalizeArray } from '../src/lib/parse-skill.mjs';
import { classifyCategoryTags, isClean } from './lib/verify-category-tags.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const require = createRequire(resolve(ROOT, 'functions/api/package.json'));
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/verify-category-tags-ddb.mjs --env <staging|prod> [--apply]');
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

// Read enterprise frontmatter category/tags, keyed by the same slug the sync uses.
function frontmatterEntries() {
  const entries = [];
  for (const dir of readdirSync(ENTERPRISE_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const filename of SOURCE_FILES) {
      const full = join(ENTERPRISE_DIR, dir.name, filename);
      if (!existsSync(full)) continue;
      const relPath = `enterprise/${dir.name}/${filename}`;
      const { meta } = parseFrontmatter(readFileSync(full, 'utf8'));
      const slug = slugify(meta.slug || deriveName(meta, relPath, 'skills-registry'));
      entries.push({
        slug,
        path: relPath,
        category: meta.category,
        tags: meta.tags === undefined ? undefined : normalizeArray(meta.tags),
      });
    }
  }
  return entries;
}

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

async function scanEnterpriseRecords() {
  const bySlug = new Map();
  let lastKey;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: SKILLS_TABLE,
      FilterExpression: '#s = :e',
      ExpressionAttributeNames: { '#s': 'source' },
      ExpressionAttributeValues: { ':e': 'enterprise' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }));
    for (const item of page.Items ?? []) bySlug.set(item.slug, item);
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return bySlug;
}

async function reconcile(slug, fields) {
  // Only touch existing enterprise records; never resurrect a deleted slug.
  const names = { '#source': 'source' };
  const values = { ':enterprise': 'enterprise' };
  const sets = [];
  if ('category' in fields) { names['#category'] = 'category'; values[':category'] = fields.category; sets.push('#category = :category'); }
  if ('tags' in fields) { names['#tags'] = 'tags'; values[':tags'] = fields.tags; sets.push('#tags = :tags'); }
  if (!sets.length) return;
  await ddb.send(new UpdateCommand({
    TableName: SKILLS_TABLE,
    Key: { slug },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(slug) AND #source = :enterprise',
  }));
}

async function main() {
  const fm = frontmatterEntries();
  console.log(`[${env}] ${fm.length} enterprise source file(s) with frontmatter.`);
  const ddbBySlug = await scanEnterpriseRecords();
  console.log(`[${env}] ${ddbBySlug.size} source=enterprise record(s) in DynamoDB.\n`);

  const classification = classifyCategoryTags(fm, ddbBySlug);
  const needsWork = classification.filter((c) => c.reconcile !== null);

  for (const c of classification) {
    const tag = c.status === 'match' ? '✓' : '✗';
    const detail = c.reconcile ? ` → reconcile ${JSON.stringify(c.reconcile)}` : '';
    console.log(`  ${tag} ${c.slug}  [${c.status}]${detail}`);
  }

  if (isClean(classification)) {
    console.log('\nAll enterprise skills have category/tags safely stored in DynamoDB. ✓ (U2 is unblocked)');
    return;
  }

  console.log(`\n${needsWork.length} record(s) need reconciliation${APPLY ? '' : ' (dry run — nothing will be written)'}.`);
  if (!APPLY) {
    console.log('Re-run with --apply to write the frontmatter values into DynamoDB.');
    process.exitCode = 1; // non-clean: signal that U2 must NOT proceed yet
    return;
  }

  console.log('');
  let written = 0;
  for (const c of needsWork) {
    if (c.status === 'ddb-missing-record') {
      console.error(`  ! ${c.slug}: no DynamoDB record — cannot reconcile via update. Investigate before proceeding.`);
      continue;
    }
    await reconcile(c.slug, c.reconcile);
    console.log(`  ✓ reconciled ${c.slug} ${JSON.stringify(c.reconcile)}`);
    written++;
  }
  console.log(`\nDone. Reconciled ${written} record(s). Re-run without --apply to confirm a clean report before U2.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
