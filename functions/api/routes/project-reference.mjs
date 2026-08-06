import { ddb, tables, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';
import { ENTITY_TYPES, STATUSES, validateRecord, normalizeRecord } from '../lib/project-reference.mjs';

// One capability covers both entity types: the role is all-or-nothing across the
// two admin tabs, so per-entity actions would be unused surface.
const CAPABILITY = 'manage:project-reference';

// NOTE: unlike plugins.mjs, whose list/get routes are intentionally open to any
// signed-in user, *every* route here is gated. This data is admin-owned and the
// whole point of the projects-admin role is that other roles cannot reach it.
// Copying the plugins pattern literally would leave the reads open.
const forbidden = (c) => c.json({ error: 'Forbidden' }, 403);

function badEntityType(c, entityType) {
  if (ENTITY_TYPES.includes(entityType)) return null;
  // Rejected before touching DynamoDB — a typo would otherwise create a partition
  // no tab ever reads.
  return c.json(
    { error: `Unknown entity type "${entityType}" — expected one of: ${ENTITY_TYPES.join(', ')}` },
    400
  );
}

export function projectReferenceRoutes(app) {
  app.get('/api/project-reference/:entityType', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const { entityType } = c.req.param();
    const bad = badEntityType(c, entityType);
    if (bad) return bad;

    const records = [];
    let lastKey;
    do {
      const page = await ddb.send(new QueryCommand({
        TableName: tables.projectReference(),
        KeyConditionExpression: 'entity_type = :t',
        ExpressionAttributeValues: { ':t': entityType },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      records.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    return c.json({ records });
  });

  app.get('/api/project-reference/:entityType/:id', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const { entityType, id } = c.req.param();
    const bad = badEntityType(c, entityType);
    if (bad) return bad;

    const result = await ddb.send(new GetCommand({
      TableName: tables.projectReference(),
      Key: { entity_type: entityType, id: decodeURIComponent(id) },
    }));
    if (!result.Item) return c.json({ error: 'Not found' }, 404);
    return c.json(result.Item);
  });

  app.post('/api/project-reference/:entityType', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const { entityType } = c.req.param();
    const bad = badEntityType(c, entityType);
    if (bad) return bad;

    const body = await c.req.json().catch(() => null);
    const error = validateRecord(entityType, body);
    if (error) return c.json({ error }, 400);

    const record = normalizeRecord(entityType, body);
    const now = new Date().toISOString();
    const item = { ...record, created_by: user.user_id, created_at: now, updated_at: now };

    try {
      await ddb.send(new PutCommand({
        TableName: tables.projectReference(),
        Item: item,
        // Creating over an existing id would silently discard the current record.
        ConditionExpression: 'attribute_not_exists(id)',
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return c.json({ error: `A ${entityType} with id "${item.id}" already exists` }, 409);
      }
      throw err;
    }

    await writeAudit(user, 'created', entityType, item.id);
    return c.json(item, 201);
  });

  app.put('/api/project-reference/:entityType/:id', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const { entityType } = c.req.param();
    const bad = badEntityType(c, entityType);
    if (bad) return bad;
    const id = decodeURIComponent(c.req.param('id'));

    const existing = await ddb.send(new GetCommand({
      TableName: tables.projectReference(),
      Key: { entity_type: entityType, id },
    }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => null);
    // The path owns the id; a body id is ignored rather than honoured, so an edit
    // form cannot move a record by renaming it.
    const error = validateRecord(entityType, { ...body, id });
    if (error) return c.json({ error }, 400);

    // Whole-record write. Safe here because this data is low-churn with a handful
    // of editors — reordering a list is one write, and no optimistic-concurrency
    // machinery is warranted. Last writer wins; the audit trail records both.
    const updated = {
      ...normalizeRecord(entityType, { ...body, id }, { id }),
      status: existing.Item.status ?? 'active',
      created_by: existing.Item.created_by,
      created_at: existing.Item.created_at,
      updated_at: new Date().toISOString(),
      updated_by: user.user_id,
    };

    await ddb.send(new PutCommand({ TableName: tables.projectReference(), Item: updated }));
    await writeAudit(user, 'updated', entityType, id);
    return c.json(updated);
  });

  // Status is its own operation rather than a general field update so the audit
  // trail names the intent. There is no delete route: a referenced record must
  // not be removable, and omitting the route is simpler than guarding one.
  app.put('/api/project-reference/:entityType/:id/status', async (c) => {
    const user = c.get('user');
    if (!can(user, CAPABILITY)) return forbidden(c);

    const { entityType } = c.req.param();
    const bad = badEntityType(c, entityType);
    if (bad) return bad;
    const id = decodeURIComponent(c.req.param('id'));

    const body = await c.req.json().catch(() => null);
    if (!body?.status || !STATUSES.includes(body.status)) {
      return c.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, 400);
    }

    const existing = await ddb.send(new GetCommand({
      TableName: tables.projectReference(),
      Key: { entity_type: entityType, id },
    }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const result = await ddb.send(new UpdateCommand({
      TableName: tables.projectReference(),
      Key: { entity_type: entityType, id },
      UpdateExpression: 'SET #status = :status, updated_at = :now, updated_by = :by',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': body.status,
        ':now': new Date().toISOString(),
        ':by': user.user_id,
      },
      ReturnValues: 'ALL_NEW',
    }));

    await writeAudit(user, body.status === 'inactive' ? 'deactivated' : 'reactivated', entityType, id);
    return c.json(result.Attributes);
  });
}
