import { ddb, tables, GetCommand } from '../lib/dynamo.mjs';
import { cachedQueryPartition } from '../lib/partition-cache.mjs';
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

// The partition reads below are cached for a minute (see lib/partition-cache.mjs).
// That cache is INSIDE the Lambda, behind both the auth middleware and the
// capability gate, and this route is the reason it could not be at CloudFront: an
// edge cache is keyed on the request, not the reader, so it would serve whichever
// of the 403 or the 200 landed first to everyone who asked next.

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
  // `reason` distinguishes the two ways this can come back unavailable. They look
  // identical to the code and could not be less alike to a reader: one is an
  // environment that has not been applied yet, the other is a live fault on a
  // populated table. Collapsing them means the tab reassures someone about an IAM
  // regression or a resolution bug.
  const unavailable = (reason) => ({
    contract_count: 0,
    unresolved_projects: [],
    missing_posture: [],
    unresolved_postures: [],
    available: false,
    reason,
  });

  const table = tables.contracts();
  if (!table) return unavailable('not_configured');

  try {
    const contracts = await cachedQueryPartition(table, 'record_type', RECORD_CONTRACT);
    const postures = await cachedQueryPartition(
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
      reason: null,
    };
  } catch (err) {
    // Logged rather than swallowed: this catch spans the contracts read, the
    // postures read, and the resolution call, so a bug in any of them lands here.
    console.error('projects contract drift read failed', err);

    // `read_failed`, never `not_configured` — the table name resolved, so whatever
    // went wrong is a real fault and the tab must say so rather than offering the
    // before-first-apply explanation.
    return unavailable('read_failed');
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

    const projects = await cachedQueryPartition(table, 'record_type', RECORD_PROJECT);

    // Resolved on read, not stored at sync time: adding a missing archetype
    // record clears its findings on the next page load rather than waiting for
    // the next scheduled run. "Next page load" now means the next one after the
    // partition cache expires — up to a minute.
    const archetypes = await cachedQueryPartition(
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
