import { ddb, tables, GetCommand, PutCommand, DeleteCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

const REQUIRED_FIELDS = ['slug', 'name', 'description', 'repo', 'author'];

export function pluginsRoutes(app) {
  app.get('/api/plugins', async (c) => {
    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.plugins(),
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    return c.json({ plugins: items });
  });

  app.get('/api/plugins/:slug', async (c) => {
    const { slug } = c.req.param();
    const result = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!result.Item) return c.json({ error: 'Not found' }, 404);
    return c.json(result.Item);
  });

  app.post('/api/plugins', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length) return c.json({ error: `Missing fields: ${missing.join(', ')}` }, 400);

    const now = new Date().toISOString();
    const plugin = {
      ...body,
      status: 'approved',
      visibility: body.visibility ?? 'public',
      source: 'user-submitted',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      skills_count: 0,
    };

    await ddb.send(new PutCommand({ TableName: tables.plugins(), Item: plugin }));
    await writeAudit(user, 'created', 'plugin', plugin.slug);
    return c.json(plugin, 201);
  });

  app.put('/api/plugins/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const updated = { ...existing.Item, ...body, slug, updated_at: new Date().toISOString(), updated_by: user.user_id };
    await ddb.send(new PutCommand({ TableName: tables.plugins(), Item: updated }));
    await writeAudit(user, 'updated', 'plugin', slug);
    return c.json(updated);
  });

  app.delete('/api/plugins/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:plugins')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.plugins(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    await ddb.send(new DeleteCommand({ TableName: tables.plugins(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'plugin', slug);
    return c.json({ deleted: slug });
  });
}
