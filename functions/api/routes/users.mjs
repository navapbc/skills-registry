import { ddb, tables, UpdateCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';

const VALID_ROLES = new Set(['user', 'admin']);

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

  app.put('/api/users/:id/role', async (c) => {
    const user = c.get('user');
    if (!can(user, 'set:role')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body?.role || !VALID_ROLES.has(body.role)) {
      return c.json({ error: 'role must be "user" or "admin"' }, 400);
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

    return c.json(result.Attributes);
  });
}
