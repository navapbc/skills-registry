import { ddb, tables, QueryCommand, ScanCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';

export function auditRoutes(app) {
  app.get('/api/audit', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:audit')) return c.json({ error: 'Forbidden' }, 403);

    const result = await ddb.send(new ScanCommand({ TableName: tables.audit() }));
    return c.json({ events: result.Items ?? [] });
  });

  app.get('/api/audit/me', async (c) => {
    const user = c.get('user');

    const result = await ddb.send(
      new QueryCommand({
        TableName: tables.audit(),
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': user.user_id },
        ScanIndexForward: false,
        Limit: 100,
      })
    );

    return c.json({ events: result.Items ?? [] });
  });
}
