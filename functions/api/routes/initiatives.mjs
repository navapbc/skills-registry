import { ddb, tables, GetCommand, QueryCommand } from '../lib/dynamo.mjs';
import { RECORD_PROJECT } from '../lib/projects.mjs';
import { RECORD_CONTRACT } from '../lib/contracts.mjs';
import {
  RECORD_INITIATIVE,
  RECORD_SEED_META,
  SEED_META_KEY,
  SEED_IN_PROGRESS,
  SEED_COMPLETE,
  SEED_NEVER,
  resolveProject,
  contractsForProject,
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

/**
 * Fields carried from a contract that shares this initiative's project.
 *
 * An allowlist for the same reason PROJECT_FIELDS is one, and narrower than
 * CONTRACT_FIELDS in contracts.mjs on purpose: these entries are LINKS, not
 * records. Everything a reader needs here is enough to recognise which contract
 * they are about to open — the Contract Explorer answers the rest, including the
 * posture, which is why `ai_posture` is absent. Resolving a posture id to its
 * label needs the project-reference partition, which this route does not read,
 * and a bare id badge would be worse than no badge.
 *
 * No audience is widened: /api/contracts is already open to every signed-in user
 * on the same basis as this route.
 */
const CONTRACT_FIELDS = [
  // Required, not cosmetic: the href of every link this section renders.
  'contract_id',
  // The survey's own project string, which is the contract's display name on the
  // Contract Explorer's cards too.
  'project',
  'contract_num',
  'vehicle',
  'customer',
  'agreement_type',
];

const project_summary = (project) =>
  Object.fromEntries(PROJECT_FIELDS.map((f) => [f, project[f] ?? '']));

const contract_summary = (contract) =>
  Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, contract[f] ?? '']));

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

  // The project→contracts join, computed ONLY when the request names one
  // initiative. The grid renders no contracts, so doing this unconditionally would
  // read a whole extra partition on every hub load for data 36 of 37 records never
  // use. The client knows the id before it fetches, so it can ask.
  //
  // `related_contracts` is therefore absent on a list request and present — possibly
  // as `[]` — on the named record of a detail request. The distinction is the
  // renderer's cue: absent means "not asked for", empty means "asked, and this
  // project owns none".
  const requestedId = c.req.query('id');
  const target = requestedId
    ? initiatives.find((i) => i.initiative_id === requestedId)
    : undefined;
  // An id matching nothing, or naming an initiative with no project, skips the read
  // entirely: there is no join key, and the page renders no section either way.
  const targetProject = target ? resolveProject(target, projects) : null;

  let relatedContracts = null;
  if (targetProject) {
    const contractsTable = tables.contracts();
    // Checked only on this path. A missing CONTRACTS_TABLE must not 503 the grid
    // view, which never needed it — but on a detail request it is the same
    // partial-rollout case the guard above exists for, and an unconfigured table
    // would otherwise become an opaque SDK 500.
    if (!contractsTable) {
      return c.json({ error: 'Contracts are not configured' }, 503);
    }
    const contracts = await queryPartition(contractsTable, 'record_type', RECORD_CONTRACT);
    relatedContracts = contractsForProject(targetProject, contracts, projects).map(contract_summary);
  }

  const resolved = initiatives.map((initiative) => {
    const project = resolveProject(initiative, projects);
    return {
      ...initiative_payload(initiative),
      ...(relatedContracts && initiative === target
        ? { related_contracts: relatedContracts }
        : {}),
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
