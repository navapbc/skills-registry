import { ddb, tables, GetCommand, QueryCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { ENTITY_ARCHETYPE } from '../lib/project-reference.mjs';
import {
  RECORD_PROJECT,
  RECORD_SYNC_META,
  SYNC_META_KEY,
  SYNC_IN_PROGRESS,
  SYNC_COMPLETE,
  SYNC_NEVER,
  collectArchetypeIssues,
} from '../lib/projects.mjs';

// Reuses the reference-data capability rather than adding one: the origin scoped
// this tab to the same audience as the archetypes and policy tabs, and a second
// action nobody could hold independently would be unused surface.
//
// The coupling is real though — this capability now spans two tables and three
// tabs, so splitting the audiences later means a permission change as well as a
// route change.
const CAPABILITY = 'manage:project-reference';

// NOTE: every route here is gated, reads included. This mirrors
// project-reference.mjs, NOT plugins.mjs — the latter deliberately leaves its
// list/get open to any signed-in user, and copying that pattern literally is the
// likeliest way this gate goes missing. These records carry contract names,
// agencies, offices, and period-of-performance dates.
const forbidden = (c) => c.json({ error: 'Forbidden' }, 403);

// There is deliberately NO create, update, or delete route in this module. The
// sheet is the only write surface. The API Lambda's IAM grant on this table omits
// write actions too, so a future write route fails against infrastructure rather
// than succeeding quietly (see terraform/lambda.tf, DynamoDBProjectsRead).

async function queryPartition(table, keyName, keyValue) {
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
 * Describe the last sync run.
 *
 * Three states rather than two. Absent metadata means never synced. An
 * in-progress marker means a run wrote projects and then died, so the table is
 * mid-flight — reporting that as synced would vouch for a half-written table,
 * and reporting it as never-synced would label a populated table empty.
 */
function describeSync(item) {
  if (!item) {
    return {
      state: SYNC_NEVER,
      last_run_at: null,
      row_count: null,
      created: null,
      updated: null,
      deleted: null,
      new_columns: [],
    };
  }

  return {
    state: item.status === SYNC_IN_PROGRESS ? SYNC_IN_PROGRESS : SYNC_COMPLETE,
    last_run_at: item.last_run_at ?? null,
    row_count: item.row_count ?? null,
    created: item.created ?? null,
    updated: item.updated ?? null,
    deleted: item.deleted ?? null,
    // Recorded by the sync, which is the only thing that sees both the previous
    // and current header sets. A rename is indistinguishable from a new column
    // here, and that is exactly why it is surfaced: a rename can re-admit a
    // column the sync's denylist was excluding.
    new_columns: item.new_columns ?? [],
  };
}

export function projectsRoutes(app) {
  // One endpoint rather than two. 53 records at ~34 columns is far below a
  // payload where splitting buys anything, and a single response means the drift
  // summary and the project table cannot disagree about how fresh the data is.
  app.get('/api/projects', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const table = tables.projects();

    const metaResult = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { record_type: RECORD_SYNC_META, project_code: SYNC_META_KEY },
      }),
    );
    const metaItem = metaResult.Item;

    const projects = await queryPartition(table, 'record_type', RECORD_PROJECT);

    // Resolved on read, not stored at sync time: adding a missing archetype
    // record clears its findings on the next page load rather than waiting for
    // the next scheduled run.
    const archetypes = await queryPartition(
      tables.projectReference(),
      'entity_type',
      ENTITY_ARCHETYPE,
    );

    const { unresolved, missing } = collectArchetypeIssues(projects, archetypes);

    const sync = describeSync(metaItem);

    return c.json({
      projects,
      column_groups: metaItem?.column_groups ?? {},
      column_headers: metaItem?.column_headers ?? {},
      sync,
      drift: {
        archetype_count: archetypes.length,
        unresolved,
        missing,
      },
    });
  });
}
