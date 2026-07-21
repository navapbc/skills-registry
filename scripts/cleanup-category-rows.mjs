#!/usr/bin/env node
/**
 * One-time cleanup: removes orphaned category-config rows left behind by the
 * category id rename (issue #32). Featured slugs are stored as synthetic rows
 * in the skills table keyed `slug = "category::<id>"`. After renaming the
 * category ids, the old-id rows are orphaned and must be deleted — new-id rows
 * are re-created fresh via the admin panel.
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

// Old category ids from before the issue #32 rename. New-id rows
// (personal-productivity, research-and-analyze, write-and-review,
// team-automations, build-and-ship) are intentionally left untouched.
const OLD_CATEGORY_IDS = [
  'writing-comms',
  'research-analysis',
  'planning',
  'dev-code',
  'ops-automation',
];

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

async function main() {
  console.log(`[${env}] Cleaning up orphaned category-config rows${DRY_RUN ? ' (dry run)' : ''}\n`);
  let deleted = 0;
  for (const id of OLD_CATEGORY_IDS) {
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
