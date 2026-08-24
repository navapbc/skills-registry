/**
 * The initiatives sync's DynamoDB orchestration, with the client injected.
 *
 * Kept out of scripts/sync-initiatives.mjs because that file calls main() at
 * import and needs live Google and AWS credentials. Kept out of
 * scripts/lib/sync-initiatives.mjs because that file is pure and this one talks
 * to a table.
 *
 * Everything here takes `ddb` and the command constructors as arguments so the
 * composed flow — read, diff, gate, apply — can be tested against a fake client
 * without AWS. The gate preventing deletes is exactly the behaviour a
 * pure-function test alone cannot prove.
 */

import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
  collectInitiativeIssues,
} from '../../functions/api/lib/initiatives.mjs';
import { RECORD_PROJECT } from '../../functions/api/lib/projects.mjs';
import { shapeInitiatives, reconcile, safetyVerdict } from './sync-initiatives.mjs';

/** Read one partition in full, paging until exhausted. */
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
 * Read every initiative record, keyed by id.
 *
 * 37 rows is one page, but this paginates anyway. The alternative failure is
 * silent: a truncated read looks like a smaller sheet, and reconcile turns that
 * into a mass delete.
 */
async function readStoredInitiatives({ ddb, table, QueryCommand }) {
  const items = await readPartition({
    ddb, table, keyName: 'record_type', keyValue: RECORD_INITIATIVE, QueryCommand,
  });
  return Object.fromEntries(items.map((item) => [item.initiative_id, item]));
}

/**
 * Read the population-metadata record.
 *
 * Three observable states, not two. A run that wrote initiatives and then died
 * leaves an in-progress marker; without that distinction a populated table would
 * report as never-populated.
 */
export async function readSeedMeta({ ddb, table, GetCommand }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY },
    }),
  );

  if (!result.Item) return { state: SEED_NEVER, baseline: null, columnNames: [] };

  return {
    state: result.Item.status === SEED_IN_PROGRESS ? SEED_IN_PROGRESS : SEED_COMPLETE,
    baseline: typeof result.Item.row_count === 'number' ? result.Item.row_count : null,
    columnNames: result.Item.column_names ?? [],
    item: result.Item,
  };
}

/**
 * Reconcile the initiatives table against a sheet grid.
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
 *
 * The caller resolves projects AFTER this returns, and may then fail the run. By
 * that point the table is correct and its marker says so, which is what lets the
 * failure read as "the sheet names a project that does not exist" rather than
 * "the sync broke".
 */
export async function populateInitiatives({
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
  const shaped = shapeInitiatives(grid);
  const incomingCount = Object.keys(shaped.initiatives).length;

  const meta = await readSeedMeta({ ddb, table, GetCommand });
  const stored = await readStoredInitiatives({ ddb, table, QueryCommand });
  const storedCount = Object.keys(stored).length;

  const diff = reconcile(shaped.initiatives, stored);

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

  // The sheet's machine headers this run saw. Compared against the previous run's
  // set to surface a column that appeared since — worth surfacing here more than on
  // the sibling syncs, because this workbook demonstrably churns: it lost an `id`
  // column and a `programId` column during this feature's implementation alone.
  const columnNames = Object.values(shaped.columnHeaders);

  // Only meaningful against a previous header set. On a first run every column is
  // trivially "new", and reporting all ten with a check-these-for-renames warning is
  // noise that trains the reader to ignore the one signal that matters. Mirrors the
  // gate's no-baseline case.
  const newColumns = meta.columnNames.length
    ? columnNames.filter((name) => !meta.columnNames.includes(name))
    : [];

  const report = {
    // Returned so the caller's resolution check reuses this shaping rather than
    // repeating it — two shapings of the same grid could diverge.
    initiatives: shaped.initiatives,
    columnHeaders: shaped.columnHeaders,
    incoming: incomingCount,
    storedCount,
    created: diff.creates.length,
    updated: diff.updates.length,
    deleted: diff.deletes.length,
    deletedIds: diff.deletes,
    skippedBlankRows: shaped.skippedBlankRows,
    newColumns,
    previousState: meta.state,
    refusal,
    applied: false,
  };

  if (refusal) return report;
  if (dryRun) return report;

  // In-progress marker before any initiative write.
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SEED_META,
        initiative_id: SEED_META_KEY,
        status: SEED_IN_PROGRESS,
        started_at: now,
        // Deliberately NOT row_count: the baseline must keep describing the last
        // COMPLETED run until this one finishes, or a death mid-apply would leave
        // the next run measuring against a table that was never fully written.
        incoming_row_count: incomingCount,
        ...(meta.item?.row_count !== undefined && { row_count: meta.item.row_count }),
        // Carried forward for the same reason as row_count: the header set must keep
        // describing the last COMPLETED run, or a death mid-apply would make the next
        // run report every column as unchanged against a set that was never finished.
        ...(meta.item?.column_names !== undefined && { column_names: meta.item.column_names }),
      },
    }),
  );

  for (const record of [...diff.creates, ...diff.updates]) {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          record_type: RECORD_INITIATIVE,
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
        Key: { record_type: RECORD_INITIATIVE, initiative_id: id },
      }),
    );
  }

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        record_type: RECORD_SEED_META,
        initiative_id: SEED_META_KEY,
        status: SEED_COMPLETE,
        last_run_at: now,
        row_count: incomingCount,
        created: diff.creates.length,
        updated: diff.updates.length,
        deleted: diff.deletes.length,
        column_names: columnNames,
        // Stored rather than derived at read time: only this run sees both the
        // previous and the current header set, so nothing downstream can recompute it.
        new_columns: newColumns,
      },
    }),
  );

  report.applied = true;
  return report;
}

/**
 * Delete every initiative record in one table.
 *
 * Lives here rather than in the CLI for the same reason the gate does: a
 * destructive path has to be testable against an injected client. It is exercised
 * by tests/sync-initiatives-apply.test.mjs against the same fake table.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *   - It does not touch the `seed_meta` record. The next run's baseline and header
 *     set must keep describing the last COMPLETED run; clearing them would disable
 *     the row-drop check on exactly the run that repopulates the table, which is
 *     the run least able to afford it.
 *   - It does not consult the safety gate. There is nothing for a gate to weigh —
 *     the caller has asked for everything to go. What protects the operator is that
 *     the CLI is dry-run by default and needs an explicit --apply.
 *
 * The read paginates. A truncated read here leaves orphans behind that the next
 * sync cannot see, which is the failure mode worth spending a loop on.
 */
export async function purgeInitiatives({
  ddb,
  table,
  dryRun = true,
  DeleteCommand,
  QueryCommand,
}) {
  const items = await readPartition({
    ddb, table, keyName: 'record_type', keyValue: RECORD_INITIATIVE, QueryCommand,
  });
  const ids = items.map((item) => item.initiative_id);

  if (dryRun || ids.length === 0) return { deleted: 0, ids, applied: false };

  for (const id of ids) {
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { record_type: RECORD_INITIATIVE, initiative_id: id },
      }),
    );
  }

  return { deleted: ids.length, ids, applied: true };
}

/**
 * Compare the populated initiatives against the project records.
 *
 * This function REPORTS; it does not decide. The caller fails the run on
 * `unresolvedProjects` and warns on `missingProject`, and keeping that decision in
 * the CLI is what lets the failure message distinguish "the initiatives synced,
 * the sheet is wrong" from "the sync broke" — by the time this runs, the table is
 * already correct.
 */
export async function checkInitiativeResolution({
  ddb,
  projectsTable,
  initiatives,
  QueryCommand,
}) {
  const projects = await readPartition({
    ddb, table: projectsTable, keyName: 'record_type', keyValue: RECORD_PROJECT, QueryCommand,
  });

  const issues = collectInitiativeIssues(Object.values(initiatives), projects);

  return { ...issues, projectCount: projects.length };
}
