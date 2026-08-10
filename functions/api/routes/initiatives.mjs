import { ddb, tables, GetCommand, QueryCommand } from '../lib/dynamo.mjs';
import { RECORD_PROJECT } from '../lib/projects.mjs';
import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
  resolveProject,
} from '../lib/initiatives.mjs';

// NOTE: this read is deliberately NOT capability-gated, matching the Contract
// Explorer and unlike projects.mjs and project-reference.mjs, which both gate on
// `manage:project-reference`. The Initiatives Hub exists to let any delivery team
// member see what AI work is running and where, and a capability role would be
// assigned to nobody.
//
// It is still authenticated — the auth middleware 401s before any handler runs,
// matching how plugins.mjs leaves its GETs open to any signed-in user.
//
// There is deliberately NO create, update, or delete route. The sync workflow is
// the only write surface, and the API Lambda's IAM grant on this table omits write
// actions (see terraform/lambda.tf, DynamoDBInitiativesRead), so a future write
// route fails against infrastructure rather than succeeding quietly.

/**
 * Fields served for each initiative.
 *
 * An ALLOWLIST, not a spread, and the pairing matters. The sync deliberately uses
 * a DENYLIST — a new sheet column reaches the table automatically so a column is
 * never silently dropped. Composed with a spread here, that would mean a column
 * added to the sheet ships to every signed-in user with no code change and no
 * review. This list is that review step: a new column is invisible to the page
 * until someone adds it here on purpose.
 *
 * `people` names individuals. It is included on the same basis contracts.mjs
 * includes its three managers — the reader's whole question is often who to ask —
 * and the exposure is identical: Nava staff names on an authenticated internal
 * page.
 */
const INITIATIVE_FIELDS = [
  // Required, not cosmetic: every card's href and the detail route's lookup key.
  // Dropping it renders every link as /initiatives/undefined.
  'initiative_id',
  'title',
  'desc',
  'use_case_label',
  'use_case_theme',
  'exposure',
  'people',
  'status',
  'tags',
  'links',
  // The sheet's own string. Kept even when it resolves, so the page can name the
  // value that failed when it does not.
  'project_name',

  'first_seen_at',
  'last_synced_at',
];

/**
 * Fields carried from a resolved project onto an initiative.
 *
 * A deliberate projection rather than the whole record, and the same one
 * contracts.mjs uses. Initiatives are readable by every signed-in user; the
 * projects table is NOT — it remains `manage:project-reference`-gated, and it
 * carries period-of-performance dates, health links, and vehicle detail this page
 * has no reason to publish. Serving whole project records here would widen a
 * second dataset by side effect, which no decision authorized.
 */
const PROJECT_FIELDS = [
  'project_code',
  // The Confluence space key. The detail page links the project name to its space,
  // so without this in the projection the link points at /wiki/spaces/undefined.
  'project_index_code',
  'project_name',
  'portfolio',
  'agency',
  'program_manager',
  'nava_contract_pp',
  'archetype_primary',
  'archetype_additional',
];

const project_summary = (project) =>
  Object.fromEntries(PROJECT_FIELDS.map((f) => [f, project[f] ?? '']));

const initiative_payload = (initiative) =>
  Object.fromEntries(
    INITIATIVE_FIELDS.filter((f) => initiative[f] !== undefined).map((f) => [f, initiative[f]]),
  );

/** Read one partition in full, paging until exhausted. */
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
 * Three states, mirroring describePopulation in contracts.mjs. Absent metadata
 * means never populated; an in-progress marker means a run wrote initiatives and
 * then died, so the table is mid-flight. Reporting that as complete would vouch
 * for a half-written table.
 */
function describePopulation(item) {
  if (!item) {
    return { state: SEED_NEVER, captured_at: null, row_count: null };
  }
  return {
    state: item.status === SEED_IN_PROGRESS ? SEED_IN_PROGRESS : SEED_COMPLETE,
    captured_at: item.last_run_at ?? null,
    row_count: item.row_count ?? null,
  };
}

export function initiativesRoutes(app) {
  // One endpoint rather than three. 37 records is far below a payload where
  // splitting buys anything, and a single response means the grid, the detail view,
  // and the capture date cannot disagree about how fresh the data is.
  app.get('/api/initiatives', async (c) => {
    try {
      return await serveInitiatives(c);
    } catch (err) {
      // Deliberately different from the projects route, which degrades to empty
      // findings because initiatives are incidental there. Here the page IS the
      // initiatives, so an empty success would be a lie — fail visibly and let the
      // page render its error state.
      console.error('initiatives read failed', err);
      return c.json({ error: 'Initiatives could not be read' }, 500);
    }
  });
}

async function serveInitiatives(c) {
  const table = tables.initiatives();
  const projectsTable = tables.projects();

  // Both are checked, not just the initiatives table. A partial config rollout
  // would otherwise degrade a deliberate 503 into an opaque SDK 500 from
  // `TableName: undefined`.
  if (!table || !projectsTable) {
    return c.json({ error: 'Initiatives are not configured' }, 503);
  }

  const metaResult = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { record_type: RECORD_SEED_META, initiative_id: SEED_META_KEY },
    }),
  );

  const initiatives = await queryPartition(table, 'record_type', RECORD_INITIATIVE);

  // Resolved on read, not stored: fixing a project name in the sheet changes the
  // page on the next load rather than waiting for the next sync run.
  const projects = await queryPartition(projectsTable, 'record_type', RECORD_PROJECT);

  const resolved = initiatives.map((initiative) => {
    const project = resolveProject(initiative, projects);
    return {
      ...initiative_payload(initiative),
      // NOT `project`: the sheet could gain a column of that name, and spreading a
      // resolved object over it would replace a card's field with an object.
      // contracts.mjs learned this the hard way; the naming should not depend on
      // the sheet's current shape.
      resolved_project: project ? project_summary(project) : null,
    };
  });

  return c.json({
    initiatives: resolved,
    population: describePopulation(metaResult.Item),
  });
}
