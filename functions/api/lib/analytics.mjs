import { randomUUID } from 'crypto';
import { ddb, tables, PutCommand } from './dynamo.mjs';

// Allowlisted analytics events → the property keys persisted for each.
// Any client-supplied key not listed here is dropped; identity and timestamp
// are always stamped server-side (see writeEvent), never taken from the client.
export const EVENT_PROPS = {
  page_view: ['path', 'referrer'],
  skill_view: ['skill_id', 'skill_slug', 'referrer'],
  search_query: ['query', 'result_count'],
  filter_applied: ['filter_name', 'filter_value'],
};

// Validate the event name against the allowlist and keep only whitelisted props.
// Returns null for an unknown event. `raw` is the client-supplied props object.
export function sanitizeEvent(event, raw = {}) {
  const allowed = EVENT_PROPS[event];
  if (!allowed) return null;

  const props = {};
  for (const key of allowed) {
    if (raw?.[key] !== undefined) props[key] = raw[key];
  }
  // result_count is a count — coerce to a finite number or drop it.
  if ('result_count' in props) {
    const n = Number(props.result_count);
    if (Number.isFinite(n)) props.result_count = n;
    else delete props.result_count;
  }
  return { event, props };
}

// Append one analytics event. Mirrors writeAudit's key scheme (user_id +
// ISO-timestamp#uuid) but targets the dedicated analytics-events table.
// user_email and timestamp are authoritative server values.
export async function writeEvent(user, event, props) {
  const now = new Date().toISOString();
  const eventKey = `${now}#${randomUUID()}`;

  await ddb.send(
    new PutCommand({
      TableName: tables.analyticsEvents(),
      Item: {
        user_id: user.user_id,
        event_key: eventKey,
        event,
        props,
        user_email: user.user_id,
        timestamp: now,
      },
    })
  );
}
