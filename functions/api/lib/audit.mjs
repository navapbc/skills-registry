import { randomUUID } from 'crypto';
import { ddb, tables, PutCommand } from './dynamo.mjs';

export async function writeAudit(user, action, resourceType, resourceId, metadata = {}) {
  const now = new Date().toISOString();
  const eventKey = `${now}#${randomUUID()}`;

  await ddb.send(
    new PutCommand({
      TableName: tables.audit(),
      Item: {
        user_id: user.user_id,
        event_key: eventKey,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_key: `${resourceType}#${resourceId}`,
        metadata,
        timestamp: now,
      },
    })
  );
}
