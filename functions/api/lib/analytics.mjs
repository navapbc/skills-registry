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

// Aggregate raw events into content-analytics summaries for the admin dashboard.
// Pure: caller supplies the already-windowed event list. `topN` caps the skill
// and search lists; filter usage is small (bounded by distinct filter values).
export function aggregateAnalytics(events = [], { topN = 10 } = {}) {
  const skillCounts = new Map();
  const searchCounts = new Map();
  const filterCounts = new Map();

  for (const e of events) {
    const p = e.props ?? {};
    if (e.event === 'skill_view' && p.skill_slug) {
      skillCounts.set(p.skill_slug, (skillCounts.get(p.skill_slug) ?? 0) + 1);
    } else if (e.event === 'search_query' && p.query) {
      const key = String(p.query).trim().toLowerCase();
      if (!key) continue;
      const cur = searchCounts.get(key) ?? { query: key, count: 0, result_count: p.result_count };
      cur.count += 1;
      cur.result_count = p.result_count; // representative (most recent)
      searchCounts.set(key, cur);
    } else if (e.event === 'filter_applied' && p.filter_value != null) {
      filterCounts.set(p.filter_value, (filterCounts.get(p.filter_value) ?? 0) + 1);
    }
  }

  const topSkills = [...skillCounts.entries()]
    .map(([skill_slug, count]) => ({ skill_slug, count }))
    .sort((a, b) => b.count - a.count || a.skill_slug.localeCompare(b.skill_slug))
    .slice(0, topN);

  const topSearches = [...searchCounts.values()]
    .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query))
    .slice(0, topN);

  const filterUsage = [...filterCounts.entries()]
    .map(([filter_value, count]) => ({ filter_value, count }))
    .sort((a, b) => b.count - a.count || String(a.filter_value).localeCompare(String(b.filter_value)));

  return { topSkills, topSearches, filterUsage };
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
