#!/usr/bin/env node
/**
 * One-time cleanup: removes all category-config rows from the skills table.
 *
 * "Featured skills" used synthetic rows keyed `slug = "category::<id>"` with
 * `source: "category-config"`. The feature has been retired (never reached the
 * UI), so every such row is now dead data and should be deleted. This covers
 * both the current category ids and the old pre-rename ids (issue #32) that may
 * still linger, so a single run cleans everything.
 *
 * Run staging first, verify, then prod:
 *   node scripts/cleanup-category-rows.mjs --env staging
 *   node scripts/cleanup-category-rows.mjs --env prod
 *
 * Add --dry-run to print what would be deleted without deleting.
 *
 * Prerequisites: AWS credentials in environment with DynamoDB write access.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

// Resolve AWS SDK from functions/api where it is installed
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/cleanup-category-rows.mjs --env <staging|prod> [--dry-run]');
  process.exit(1);
}
const env = args[envIdx + 1];
if (!['staging', 'prod'].includes(env)) {
  console.error('env must be "staging" or "prod"');
  process.exit(1);
}

const SKILLS_TABLE = `skills-registry-skills-${env}`;

// All category ids whose `category::<id>` config rows should be deleted:
// the current ids plus the old pre-rename ids (issue #32) that may still exist.
const CATEGORY_IDS = [
  // current ids
  'personal-productivity',
  'research-and-analyze',
  'write-and-review',
  'team-automations',
  'build-and-ship',
  // old pre-rename ids (issue #32)
  'writing-comms',
  'research-analysis',
  'planning',
  'dev-code',
  'ops-automation',
];

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

async function main() {
  console.log(`[${env}] Cleaning up category-config rows${DRY_RUN ? ' (dry run)' : ''}\n`);
  let deleted = 0;
  for (const id of CATEGORY_IDS) {
    const slug = `category::${id}`;
    const existing = await ddb.send(new GetCommand({ TableName: SKILLS_TABLE, Key: { slug } }));
    if (!existing.Item) {
      console.log(`  – ${slug}: not present, skipping`);
      continue;
    }
    if (existing.Item.source !== 'category-config') {
      // Safety: never delete anything that isn't a category-config row.
      console.warn(`  ! ${slug}: unexpected source "${existing.Item.source}", skipping`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ~ ${slug}: would delete (featuredSlugs: ${JSON.stringify(existing.Item.featuredSlugs ?? [])})`);
      continue;
    }
    await ddb.send(new DeleteCommand({ TableName: SKILLS_TABLE, Key: { slug } }));
    console.log(`  ✓ ${slug}: deleted`);
    deleted++;
  }
  console.log(`\nDone. ${DRY_RUN ? 'Would delete' : 'Deleted'} ${deleted} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
