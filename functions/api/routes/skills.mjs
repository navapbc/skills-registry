import { randomUUID } from 'crypto';
import { ddb, tables, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

const REQUIRED_FIELDS = ['slug', 'name', 'description', 'plugin', 'repo', 'path', 'author', 'compatibility', 'type'];

export function skillsRoutes(app) {
  app.get('/api/skills', async (c) => {
    const user = c.get('user');
    const { type, plugin } = c.req.query();

    const result = await ddb.send(new ScanCommand({ TableName: tables.skills() }));
    let items = result.Items ?? [];

    if (type) items = items.filter((s) => s.type === type);
    if (plugin) items = items.filter((s) => s.plugin === plugin);

    const visible = items.filter((s) => can(user, 'read:skill', s));
    return c.json({ skills: visible });
  });

  app.get('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const result = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!result.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'read:skill', result.Item)) return c.json({ error: 'Forbidden' }, 403);

    return c.json(result.Item);
  });

  app.post('/api/skills', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const missing = REQUIRED_FIELDS.filter((f) => body[f] === undefined || body[f] === '');
    if (missing.length) return c.json({ error: `Missing fields: ${missing.join(', ')}` }, 400);

    const now = new Date().toISOString();
    const skill = {
      ...body,
      status: user.role === 'admin' ? 'approved' : 'pending',
      visibility: body.visibility ?? 'public',
      source: 'user-submitted',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      version: body.version ?? '1.0.0',
      sensitive_data: body.sensitive_data ?? false,
      content: body.content ?? '',
      last_updated: now,
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: skill }));
    await writeAudit(user, 'created', 'skill', skill.slug);
    return c.json(skill, 201);
  });

  app.put('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'update:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const now = new Date().toISOString();
    const updated = {
      ...existing.Item,
      ...body,
      slug,
      updated_at: now,
      updated_by: user.user_id,
      status: user.role === 'admin' ? (body.status ?? existing.Item.status) : 'pending',
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: updated }));
    await writeAudit(user, 'updated', 'skill', slug);
    return c.json(updated);
  });

  app.delete('/api/skills/:slug', async (c) => {
    const user = c.get('user');
    const { slug } = c.req.param();

    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (!can(user, 'delete:skill', existing.Item)) return c.json({ error: 'Forbidden' }, 403);

    await ddb.send(new DeleteCommand({ TableName: tables.skills(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'skill', slug);
    return c.json({ deleted: slug });
  });

  app.post('/api/skills/:slug/approve', async (c) => {
    const user = c.get('user');
    if (!can(user, 'approve:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.skills(),
        Key: { slug },
        UpdateExpression: 'SET #status = :approved, visibility = :vis, updated_at = :now, approved_by = :by',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'approved',
          ':vis': body.visibility ?? existing.Item.visibility ?? 'public',
          ':now': now,
          ':by': user.user_id,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    await writeAudit(user, 'approved', 'skill', slug);
    return c.json(result.Attributes);
  });

  app.post('/api/skills/:slug/reject', async (c) => {
    const user = c.get('user');
    if (!can(user, 'reject:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.skills(),
        Key: { slug },
        UpdateExpression: 'SET #status = :rejected, rejection_reason = :reason, updated_at = :now, rejected_by = :by',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':rejected': 'rejected',
          ':reason': body.reason ?? '',
          ':now': now,
          ':by': user.user_id,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    await writeAudit(user, 'rejected', 'skill', slug, { reason: body.reason });
    return c.json(result.Attributes);
  });
}
