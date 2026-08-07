import { ddb, tables, GetCommand, QueryCommand } from '../lib/dynamo.mjs';
import { ENTITY_POSTURE } from '../lib/project-reference.mjs';
import { RECORD_PROJECT } from '../lib/projects.mjs';
import {
  RECORD_CONTRACT,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
  resolvePosture,
  resolveProject,
} from '../lib/contracts.mjs';

// NOTE: this read is deliberately NOT capability-gated, which makes it the odd one
// out among project-data reads — projects.mjs and project-reference.mjs both gate
// on `manage:project-reference`. That asymmetry is the origin document's decision,
// not an oversight: the Contract Explorer exists to answer "may I use AI on my
// contract?" for every delivery team member, and a capability role would be
// assigned to nobody. Senongo is the accountable owner for the exposure.
//
// It is still authenticated — the auth middleware 401s before any handler runs,
// matching how plugins.mjs leaves its GETs open to any signed-in user.
//
// There is deliberately NO create, update, or delete route. The population script
// is the only write surface, and the API Lambda's IAM grant on this table omits
// write actions (see terraform/lambda.tf, DynamoDBContractsRead), so a future write
// route fails against infrastructure rather than succeeding quietly.

/**
 * Fields carried from a resolved project onto a contract.
 *
 * A deliberate projection rather than the whole record. Contracts were widened to
 * every signed-in user; the projects table was NOT — it remains
 * `manage:project-reference`-gated, and it carries 36 columns including
 * period-of-performance dates, health links, and vehicle detail that the explorer
 * has no reason to publish. Serving whole project records here would widen a second
 * dataset by side effect, which no decision authorized.
 *
 * These six answer "which project is this, and what kind of team runs it" — the
 * archetype fields matter because archetypes carry the AI-opportunity guidance the
 * page is for.
 */
const PROJECT_FIELDS = [
  'project_code',
  'project_name',
  'portfolio',
  'agency',
  'archetype_primary',
  'archetype_additional',
];

const project_summary = (project) =>
  Object.fromEntries(PROJECT_FIELDS.map((f) => [f, project[f] ?? '']));

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
 * Describe the last population run.
 *
 * Three states, mirroring describeSync in projects.mjs. Absent metadata means never
 * populated; an in-progress marker means a run wrote contracts and then died, so the
 * table is mid-flight. Reporting that as complete would vouch for a half-written
 * table — which the reliability review flagged as invisible to readers, since the
 * marker previously reached only the operator's console.
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

export function contractsRoutes(app) {
  // One endpoint rather than three. 119 records is far below a payload where
  // splitting buys anything, and a single response means the grid, the detail view,
  // and the capture date cannot disagree about how fresh the data is.
  app.get('/api/contracts', async (c) => {
    const table = tables.contracts();
    if (!table) return c.json({ error: 'Contracts are not configured' }, 503);

    const metaResult = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { record_type: RECORD_SEED_META, contract_id: SEED_META_KEY },
      }),
    );

    const contracts = await queryPartition(table, 'record_type', RECORD_CONTRACT);

    // Resolved on read, not stored: editing a posture's guidance or fixing a
    // project name in the survey changes the page on the next load rather than
    // waiting for the next population run.
    const postures = await queryPartition(
      tables.projectReference(),
      'entity_type',
      ENTITY_POSTURE,
    );
    const projects = await queryPartition(tables.projects(), 'record_type', RECORD_PROJECT);

    const resolved = contracts.map((contract) => {
      const posture = resolvePosture(contract, postures);
      const project = resolveProject(contract, projects);
      return {
        ...contract,
        // null rather than omitted: the page distinguishes "no posture recorded"
        // from "posture names no record", and both from a resolved one.
        posture_id: posture?.id ?? null,
        // NOT `project`: the survey has its own `project` column holding the
        // engagement name, and spreading a resolved object over it would replace
        // every card's title with an object.
        resolved_project: project ? project_summary(project) : null,
      };
    });

    return c.json({
      contracts: resolved,
      // Authored display order — the explorer's posture filter and the detail
      // page's guidance both read ordering from the records, so adding or
      // reordering a posture needs no deploy.
      postures: [...postures].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      population: describePopulation(metaResult.Item),
    });
  });
}
