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
 * `manage:project-reference`-gated, and it carries 38 columns including
 * period-of-performance dates, health links, and vehicle detail that the explorer
 * has no reason to publish. Serving whole project records here would widen a second
 * dataset by side effect, which no decision authorized.
 *
 * These answer "which project is this, and what kind of team runs it" — the
 * archetype fields matter because archetypes carry the AI-opportunity guidance the
 * page is for.
 *
 * `program_manager` and `nava_contract_pp` name individuals, which is why both were
 * excluded from the sync until now. They are included here on the same basis as
 * `nava_program_mgr`, which this response already carries: the page's reader needs
 * to know who to ask, and the contract-side manager alone leaves the project side
 * unattributed. `nava_contract_pp` is the contracts-side program manager and is
 * labelled that way on the page rather than by its sheet header.
 */
const CONTRACT_FIELDS = [
  // 'contract_id',
  'portfolio',
  'project',
  'agreement_type',
  'contract_num',
  'vehicle',
  'vehicle_fullname',
  'task_order',
  'customer',
  'nava_project_mgr',
  'nava_program_mgr',
  'subcontractors',
  'ai_posture',
  'ai_use_terms',
  'ai_use_terms_language',
  'terms_detail',
  'nava_policy',
  'tools',
  'project_name',

  'client_policy',
  'client_policy_summary',
  'client_policy_link',
  'ai_used',
  'usage',
  'review_process',
  'notes',

  'first_seen_at',
  'last_synced_at',
];

const PROJECT_FIELDS = [
  'project_code',
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

/**
 * Serve an allowlist rather than spreading the stored record.
 *
 * The population deliberately uses a DENYLIST — new survey columns are carried
 * into the table automatically so a column is never silently dropped. Composed
 * with a spread here, that means a new column added to the sheet would ship to
 * every signed-in user with no code change and no review. The renderer and the
 * project join both use allowlists; this was the one hop without one, and it is
 * the hop visible in any user's devtools.
 *
 * A column added to the survey is therefore invisible here until someone adds it
 * to this list, which is the review step the denylist upstream gives up.
 */
const contract_payload = (contract) =>
  Object.fromEntries(
    CONTRACT_FIELDS.filter((f) => contract[f] !== undefined).map((f) => [f, contract[f]]),
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
    try {
      return await serveContracts(c);
    } catch (err) {
      // Deliberately different from the projects route, which degrades to empty
      // findings because contracts are incidental there. Here the page IS the
      // contracts, so an empty success would be a lie — fail visibly and let the
      // page render its error state.
      console.error('contracts read failed', err);
      return c.json({ error: 'Contracts could not be read' }, 500);
    }
  });
}

async function serveContracts(c) {
  {
    const table = tables.contracts();
    const referenceTable = tables.projectReference();
    const projectsTable = tables.projects();

    // All three are checked, not just the contracts table. A partial config
    // rollout would otherwise degrade a deliberate 503 into an opaque SDK 500
    // from `TableName: undefined`.
    if (!table || !referenceTable || !projectsTable) {
      return c.json({ error: 'Contracts are not configured' }, 503);
    }

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
    const postures = await queryPartition(referenceTable, 'entity_type', ENTITY_POSTURE);
    const projects = await queryPartition(projectsTable, 'record_type', RECORD_PROJECT);

    const resolved = contracts.map((contract) => {
      const posture = resolvePosture(contract, postures);
      const project = resolveProject(contract, projects);
      return {
        ...contract_payload(contract),
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
  }
}
