/**
 * The contracts population's DynamoDB orchestration, with the client injected.
 *
 * Kept out of scripts/sync-contracts.mjs because that file calls main() at
 * import and needs live Google and AWS credentials. Kept out of
 * scripts/lib/sync-contracts.mjs because that file is pure and this one talks to
 * a table.
 *
 * Everything here takes `ddb` and the command constructors as arguments so the
 * composed flow — read, diff, gate, apply — can be tested against a fake client
 * without AWS. The gate preventing deletes is exactly the behaviour a
 * pure-function test alone cannot prove.
 */

import {
  RECORD_CONTRACT,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
  collectContractIssues,
} from '../../functions/api/lib/contracts.mjs';
import { RECORD_PROJECT } from '../../functions/api/lib/projects.mjs';
import { ENTITY_POSTURE } from '../../functions/api/lib/project-reference.mjs';
import { shapeContracts, reconcile, safetyVerdict } from './sync-contracts.mjs';

/** Read every contract record, keyed by id. 119 rows is one page, but paginate. */
async function readStoredContracts({ ddb, table, QueryCommand }) {
  const items = await readPartition({
    ddb, table, keyName: 'record_type', keyValue: RECORD_CONTRACT, QueryCommand,
  });
  return Object.fromEntries(items.map((item) => [item.contract_id, item]));
}

/**
 * Read the population-metadata record.
 *
 * Three observable states, not two. A run that wrote contracts and then died
 * leaves an in-progress marker; without that distinction a populated table would
 * report as never-populated.
 */
export async function readSeedMeta({ ddb, table, GetCommand }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { record_type: RECORD_SEED_META, contract_id: SEED_META_KEY },
    }),
  );

  if (!result.Item) return { state: SEED_NEVER, baseline: null };

  return {
    state: result.Item.status === SEED_IN_PROGRESS ? SEED_IN_PROGRESS : SEED_COMPLETE,
    baseline: typeof result.Item.row_count === 'number' ? result.Item.row_count : null,
    item: result.Item,
  };
}

/** Read one partition in full. Used for both projects and postures. */
async function readPartition({ ddb, table, keyName, keyValue, QueryCommand }) {
  const items = [];
  let lastKey;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: `${keyName} = :t`,
        ExpressionAttributeValues: { ':t': keyValue },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * Reconcile the contracts table against a sheet grid.
 *
 * Order matters and is load-bearing:
 *
 *   1. shape and diff        — no writes yet
 *   2. gate                  — a refusal costs nothing, because nothing is written
 *   3. in-progress marker    — so a death mid-apply is legible afterwards
 *   4. creates and updates, then deletes
 *   5. completed marker      — carrying the new baseline
 *
 * Writing the completed marker last means a failure part-way through leaves the
 * in-progress marker rather than a baseline describing a half-applied table.
 */
export async function populateContracts({
  ddb,
  table,
  grid,
  now,
  override = false,
  dryRun = false,
  PutCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
}) {
  const shaped = shapeContracts(grid);
  const incomingCount = Object.keys(shaped.contracts).length;

  const meta = await readSeedMeta({ ddb, table, GetCommand });
  const stored = await readStoredContracts({ ddb, table, QueryCommand });
  const storedCount = Object.keys(stored).length;

  const diff = reconcile(shaped.contracts, stored);

  const refusal = safetyVerdict({
    incoming: incomingCount,
    storedCount,
    deletes: diff.deletes.length,
    // The baseline describes the last COMPLETED run, which is what makes the
    // compounding-drain check work: measuring against the current stored count
    // would move the goalposts with the damage.
    baseline: meta.baseline,
    override,
  });

  const report = {
    // Returned so the caller's drift check reuses this shaping rather than
    // repeating it — two shapings of the same grid could diverge.
    contracts: shaped.contracts,
    incoming: incomingCount,
    storedCount,
    created: diff.creates.length,
    updated: diff.updates.length,
    deleted: diff.deletes.length,
    deletedIds: diff.deletes,
    skippedBlankRows: shaped.skippedBlankRows,
    previousState: meta.state,
    refusal,
    applied: false,
  };

  if (refusal) return report;
  if (dryRun) return report;

  // In-progress marker before any contract write.
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SEED_META,
        contract_id: SEED_META_KEY,
        status: SEED_IN_PROGRESS,
        started_at: now,
        // Deliberately NOT row_count: the baseline must keep describing the last
        // COMPLETED run until this one finishes, or a death mid-apply would leave
        // the next run measuring against a table that was never fully written.
        incoming_row_count: incomingCount,
        ...(meta.item?.row_count !== undefined && { row_count: meta.item.row_count }),
      },
    }),
  );

  for (const record of [...diff.creates, ...diff.updates]) {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          record_type: RECORD_CONTRACT,
          ...record,
          first_seen_at: record.first_seen_at ?? now,
          last_synced_at: now,
        },
      }),
    );
  }

  for (const id of diff.deletes) {
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { record_type: RECORD_CONTRACT, contract_id: id },
      }),
    );
  }

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SEED_META,
        contract_id: SEED_META_KEY,
        status: SEED_COMPLETE,
        last_run_at: now,
        row_count: incomingCount,
        created: diff.creates.length,
        updated: diff.updates.length,
        deleted: diff.deletes.length,
      },
    }),
  );

  report.applied = true;
  return report;
}

/**
 * Compare the populated contracts against the projects and posture records.
 *
 * Everything here warns rather than fails, which is the opposite of the projects
 * sync's unresolved-archetype behaviour, and deliberately so. 82 of 119 rows
 * carry no posture and 14 named projects resolve to nothing — that is the
 * survey's current state, not a regression. Failing would make every run red and
 * train the operator to ignore it.
 */
export async function checkContractDrift({
  ddb,
  projectsTable,
  referenceTable,
  contracts,
  QueryCommand,
}) {
  const projects = await readPartition({
    ddb, table: projectsTable, keyName: 'record_type', keyValue: RECORD_PROJECT, QueryCommand,
  });
  const postures = await readPartition({
    ddb, table: referenceTable, keyName: 'entity_type', keyValue: ENTITY_POSTURE, QueryCommand,
  });

  const issues = collectContractIssues(Object.values(contracts), projects, postures);

  return { ...issues, projectCount: projects.length, postureCount: postures.length };
}
