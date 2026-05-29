#!/usr/bin/env node
/**
 * One-time migration: imports skills/plugins from public/registry/index.json
 * into DynamoDB.
 *
 * Usage:
 *   node scripts/migrate-to-dynamodb.mjs --env staging
 *   node scripts/migrate-to-dynamodb.mjs --env prod
 *
 * Prerequisites: AWS credentials in environment with DynamoDB write access.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

// Resolve AWS SDK from functions/api where it is installed
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage: node scripts/migrate-to-dynamodb.mjs --env <staging|prod>');
  process.exit(1);
}
const env = args[envIdx + 1];
if (!['staging', 'prod'].includes(env)) {
  console.error('env must be "staging" or "prod"');
  process.exit(1);
}

const PROJECT = 'skills-registry';
const SKILLS_TABLE  = `${PROJECT}-skills-${env}`;
const PLUGINS_TABLE = `${PROJECT}-plugins-${env}`;

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const registry = JSON.parse(readFileSync('public/registry/index.json', 'utf8'));
const now = new Date().toISOString();

console.log(`\nMigrating to ${env}:`);
console.log(`  Skills table:  ${SKILLS_TABLE}`);
console.log(`  Plugins table: ${PLUGINS_TABLE}`);
console.log(`  Skills count:  ${registry.skills.length}`);
console.log(`  Plugins count: ${registry.plugins.length}\n`);

let skillOk = 0, skillErr = 0;
for (const skill of registry.skills) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: SKILLS_TABLE,
        Item: {
          ...skill,
          visibility: 'public',
          status: 'approved',
          source: 'github',
          created_by: 'system',
          created_at: skill.last_updated ?? now,
          updated_at: now,
        },
        ConditionExpression: 'attribute_not_exists(slug)',
      })
    );
    skillOk++;
    process.stdout.write('.');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      process.stdout.write('s');
      skillOk++;
    } else {
      console.error(`\nError migrating skill ${skill.slug}:`, err.message);
      skillErr++;
    }
  }
}

console.log(`\n\nSkills: ${skillOk} ok, ${skillErr} errors`);

let pluginOk = 0, pluginErr = 0;
for (const plugin of registry.plugins) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: PLUGINS_TABLE,
        Item: {
          ...plugin,
          visibility: 'public',
          status: 'approved',
          source: 'github',
          created_by: 'system',
          created_at: now,
          updated_at: now,
          skills_count: registry.skills.filter((s) => s.plugin === plugin.slug).length,
        },
        ConditionExpression: 'attribute_not_exists(slug)',
      })
    );
    pluginOk++;
    process.stdout.write('.');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      process.stdout.write('s');
      pluginOk++;
    } else {
      console.error(`\nError migrating plugin ${plugin.slug}:`, err.message);
      pluginErr++;
    }
  }
}

console.log(`\n\nPlugins: ${pluginOk} ok, ${pluginErr} errors`);

if (skillErr === 0 && pluginErr === 0) {
  console.log('\n✓ Migration complete. Verify spot-checks, then disable the GitHub sync workflow.');
  console.log('  In .github/workflows/sync-registry.yml, remove or comment out the `schedule:` trigger.');
}
