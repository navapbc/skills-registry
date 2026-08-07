import { ddb, tables, UpdateCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can, ASSIGNABLE_ROLES } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';

export function usersRoutes(app) {
  app.get('/api/users/me', (c) => {
    return c.json(c.get('user'));
  });

  app.get('/api/users', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:users')) return c.json({ error: 'Forbidden' }, 403);

    const result = await ddb.send(new ScanCommand({ TableName: tables.users() }));
    return c.json({ users: result.Items ?? [] });
  });

  app.put('/api/users/me/favorites', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.favorites)) {
      return c.json({ error: 'favorites must be an array of slugs' }, 400);
    }
    const result = await ddb.send(new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id: user.user_id },
      UpdateExpression: 'SET favorites = :favs',
      ExpressionAttributeValues: { ':favs': body.favorites },
      ReturnValues: 'ALL_NEW',
    }));
    return c.json({ favorites: result.Attributes?.favorites ?? [] });
  });

  app.put('/api/users/me/installed', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.installed)) {
      return c.json({ error: 'installed must be an array' }, 400);
    }
    const result = await ddb.send(new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id: user.user_id },
      UpdateExpression: 'SET installed = :inst',
      ExpressionAttributeValues: { ':inst': body.installed },
      ReturnValues: 'ALL_NEW',
    }));
    return c.json({ installed: result.Attributes?.installed ?? [] });
  });

  app.put('/api/users/:id/role', async (c) => {
    const user = c.get('user');
    if (!can(user, 'set:role')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body?.role || !ASSIGNABLE_ROLES.includes(body.role)) {
      return c.json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` }, 400);
    }

    const targetId = decodeURIComponent(c.req.param('id'));
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tables.users(),
        Key: { user_id: targetId },
        UpdateExpression: 'SET #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': body.role },
        ReturnValues: 'ALL_NEW',
      })
    );

    await writeAudit(user, 'role-changed', 'user', targetId);
    return c.json(result.Attributes);
  });
}
