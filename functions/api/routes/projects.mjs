import { ddb, tables, GetCommand, QueryCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { ENTITY_ARCHETYPE, ENTITY_POSTURE } from '../lib/project-reference.mjs';
import { RECORD_CONTRACT, collectContractIssues } from '../lib/contracts.mjs';
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

/**
 * Resolve populated contracts against the projects they name and the postures
 * they carry.
 *
 * Reported here rather than on a route of its own: the audience is identical —
 * this endpoint is already gated to the same capability — and a second endpoint
 * with the same gate would be unused surface.
 *
 * Degrades to empty findings rather than throwing. The contracts table was added
 * after this route existed and is populated by an operator, so it can legitimately
 * be absent or empty in an environment where projects are fine. Failing the whole
 * response would take the Projects tab down for a table it never needed.
 */
async function readContractDrift(projects) {
  const empty = {
    contract_count: 0,
    unresolved_projects: [],
    missing_posture: [],
    unresolved_postures: [],
    available: false,
  };

  const table = tables.contracts();
  if (!table) return empty;

  try {
    const contracts = await queryPartition(table, 'record_type', RECORD_CONTRACT);
    const postures = await queryPartition(
      tables.projectReference(),
      'entity_type',
      ENTITY_POSTURE,
    );

    const issues = collectContractIssues(contracts, projects, postures);

    return {
      contract_count: contracts.length,
      unresolved_projects: issues.unresolvedProjects,
      missing_posture: issues.missingPosture,
      unresolved_postures: issues.unresolvedPostures,
      available: true,
    };
  } catch {
    // `available: false` is deliberately distinct from a zero count: the tab must
    // be able to say "not checked" rather than claiming a clean bill of health it
    // did not verify.
    return empty;
  }
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

    const contractDrift = await readContractDrift(projects);

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
      contract_drift: contractDrift,
    });
  });
}
