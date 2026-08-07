/**
 * The projects sync's DynamoDB orchestration, with the client injected.
 *
 * Kept out of scripts/sync-projects.mjs because that file calls main() at import
 * and needs live Google and AWS credentials — the same reason sync-ddb.mjs was
 * split out of sync-registry-v2. Kept out of scripts/lib/sync-projects.mjs
 * because that file is pure and this one talks to a table.
 *
 * Everything here takes `ddb` and the command constructors as arguments so the
 * composed flow — read, diff, gate, apply — can be tested against a fake client
 * without AWS. The gate preventing deletes is exactly the behaviour that a
 * pure-function test alone cannot prove.
 */

import {
  RECORD_PROJECT,
  RECORD_SYNC_META,
  SYNC_META_KEY,
  SYNC_IN_PROGRESS,
  SYNC_COMPLETE,
  SYNC_NEVER,
  collectArchetypeIssues,
} from '../../functions/api/lib/projects.mjs';
import { shapeProjects, reconcile, safetyVerdict } from './sync-projects.mjs';

/** Read every project record. 53 rows is one page, but paginate anyway. */
async function readStoredProjects({ ddb, table, QueryCommand }) {
  const stored = {};
  let lastKey;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'record_type = :t',
        ExpressionAttributeValues: { ':t': RECORD_PROJECT },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }),
    );
    for (const item of page.Items ?? []) stored[item.project_code] = item;
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  return stored;
}

/**
 * Read the sync-metadata record.
 *
 * Three observable states, not two. A run that wrote projects and then died
 * leaves an in-progress marker; without that distinction the tab would report a
 * populated table as never-synced, and the next run would have no baseline.
 */
export async function readSyncMeta({ ddb, table, GetCommand }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY },
    }),
  );

  if (!result.Item) return { state: SYNC_NEVER, baseline: null, columnNames: [] };

  return {
    state: result.Item.status === SYNC_IN_PROGRESS ? SYNC_IN_PROGRESS : SYNC_COMPLETE,
    baseline: typeof result.Item.row_count === 'number' ? result.Item.row_count : null,
    columnNames: result.Item.column_names ?? [],
    item: result.Item,
  };
}

/** Read the archetype records the drift check compares against. */
async function readArchetypes({ ddb, referenceTable, QueryCommand }) {
  const page = await ddb.send(
    new QueryCommand({
      TableName: referenceTable,
      KeyConditionExpression: 'entity_type = :t',
      ExpressionAttributeValues: { ':t': 'archetype' },
    }),
  );
  return page.Items ?? [];
}

/**
 * Reconcile the projects table against a sheet grid.
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
 * in-progress marker rather than a baseline that describes a half-applied table.
 */
export async function syncProjects({
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
  const shaped = shapeProjects(grid);
  const incomingCount = Object.keys(shaped.projects).length;

  const meta = await readSyncMeta({ ddb, table, GetCommand });
  const stored = await readStoredProjects({ ddb, table, QueryCommand });
  const storedCount = Object.keys(stored).length;

  const diff = reconcile(shaped.projects, stored);

  const refusal = safetyVerdict({
    incoming: incomingCount,
    storedCount,
    deletes: diff.deletes.length,
    baseline: meta.baseline,
    override,
  });

  const newColumns = shaped.columnNames.filter((name) => !meta.columnNames.includes(name));

  const report = {
    // Returned so the caller's drift check reuses this shaping rather than
    // repeating it — two shapings of the same grid could diverge.
    projects: shaped.projects,
    incoming: incomingCount,
    storedCount,
    created: diff.creates.length,
    updated: diff.updates.length,
    deleted: diff.deletes.length,
    deletedCodes: diff.deletes,
    skippedBlankRows: shaped.skippedBlankRows,
    newColumns,
    previousState: meta.state,
    refusal,
    applied: false,
  };

  if (refusal) return report;
  if (dryRun) return report;

  // In-progress marker before any project write.
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SYNC_META,
        project_code: SYNC_META_KEY,
        status: SYNC_IN_PROGRESS,
        started_at: now,
        // Deliberately NOT row_count: the baseline must keep describing the last
        // COMPLETED run until this one finishes, or a death mid-apply would leave
        // the next run measuring against a table that was never fully written.
        incoming_row_count: incomingCount,
        ...(meta.item?.row_count !== undefined && { row_count: meta.item.row_count }),
        ...(meta.item?.column_names && { column_names: meta.item.column_names }),
        ...(meta.item?.column_groups && { column_groups: meta.item.column_groups }),
      },
    }),
  );

  for (const record of [...diff.creates, ...diff.updates]) {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          record_type: RECORD_PROJECT,
          ...record,
          first_seen_at: record.first_seen_at ?? now,
          last_synced_at: now,
        },
      }),
    );
  }

  for (const code of diff.deletes) {
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { record_type: RECORD_PROJECT, project_code: code },
      }),
    );
  }

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SYNC_META,
        project_code: SYNC_META_KEY,
        status: SYNC_COMPLETE,
        last_run_at: now,
        row_count: incomingCount,
        created: diff.creates.length,
        updated: diff.updates.length,
        deleted: diff.deletes.length,
        column_names: shaped.columnNames,
        // Stored rather than derived at read time: only this run sees both the
        // previous and current header sets, so the read path cannot recompute it.
        new_columns: newColumns,
        column_groups: shaped.columnGroups,
        column_headers: shaped.columnHeaders,
      },
    }),
  );

  report.applied = true;
  return report;
}

/**
 * Compare the freshly synced projects against the archetype records.
 *
 * Returns findings split so the caller can fail on one and warn on the other: an
 * unresolved value is a typo or a rename and fails the run; a missing primary is
 * an unassigned new project and only warns. Failing on the latter would train
 * people to ignore red runs, which costs more than the check buys.
 */
export async function checkDrift({ ddb, referenceTable, projects, QueryCommand }) {
  const archetypes = await readArchetypes({ ddb, referenceTable, QueryCommand });
  const { unresolved, missing } = collectArchetypeIssues(Object.values(projects), archetypes);
  return { archetypeCount: archetypes.length, unresolved, missing };
}

