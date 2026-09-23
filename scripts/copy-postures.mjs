#!/usr/bin/env node
/**
 * Copy AI posture records from one environment to another.
 *
 *   node scripts/copy-postures.mjs --from staging --to prod           # dry run
 *   node scripts/copy-postures.mjs --from staging --to prod --apply
 *
 * Postures are edited on the Policy Guidance tab of /projects-admin. This makes
 * the target's postures match the source's label, color, status, position, steps,
 * and definition, so an environment seeded from the policy export (which carries
 * no definitions) can take the edited guidance in one command. The plan lives in
 * scripts/lib/copy-postures.mjs.
 *
 * A dry run by default: it prints each posture as create, update (with the fields
 * that differ), or same, and writes nothing without --apply. A posture that only
 * the target holds is reported and left in place.
 *
 * Prerequisites: AWS credentials with Query on the source table and PutItem on the
 * target. The GitHub deploy role does not have PutItem on this table, so this runs
 * as an operator.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { ENTITY_POSTURE } from '../functions/api/lib/project-reference.mjs';
import { planPostureCopy } from './lib/copy-postures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENVS = ['staging', 'prod'];
const USAGE = 'Usage: node scripts/copy-postures.mjs --from <staging|prod> --to <staging|prod> [--apply]';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = true;
    else if (flag === '--from') args.from = argv[++i];
    else if (flag === '--to') args.to = argv[++i];
    else fail(`Unknown flag: ${flag}\n${USAGE}`);
  }
  if (!ENVS.includes(args.from) || !ENVS.includes(args.to)) fail(USAGE);
  if (args.from === args.to) fail(`--from and --to are both "${args.from}".\n${USAGE}`);
  return args;
}

const tableFor = (env) => `skills-registry-project-reference-${env}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The AWS SDK is installed in functions/api, not at the root.
  const require = createRequire(resolve(__dirname, '../functions/api/package.json'));
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

  const read = async (env) => {
    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new QueryCommand({
        TableName: tableFor(env),
        KeyConditionExpression: 'entity_type = :t',
        ExpressionAttributeValues: { ':t': ENTITY_POSTURE },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    return items;
  };

  const plan = planPostureCopy(await read(args.from), await read(args.to), new Date().toISOString());

  console.log(`\nCopying postures ${tableFor(args.from)} -> ${tableFor(args.to)}${args.apply ? '' : ' — DRY RUN'}\n`);
  for (const entry of plan.entries) {
    console.log(`  ${entry.action.padEnd(6)}  posture/${entry.id}`);
    for (const field of entry.changed) console.log(`            ${field} differs`);
  }
  for (const id of plan.targetOnly) console.log(`  kept    posture/${id} (only in ${args.to})`);

  const writes = plan.entries.filter((e) => e.item);
  if (!args.apply) {
    console.log(`\n${writes.length} to write. --apply to write them.\n`);
    return;
  }
  for (const { item } of writes) {
    await ddb.send(new PutCommand({ TableName: tableFor(args.to), Item: item }));
  }
  console.log(`\n${writes.length} written.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
