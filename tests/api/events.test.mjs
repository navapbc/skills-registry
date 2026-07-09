import { vi, describe, it, expect, beforeEach } from 'vitest';

// analytics.mjs imports dynamo.mjs (AWS SDK) — mock it so the module resolves
// and we can assert on the persisted item shape. Mirrors tests/api/middleware.test.mjs.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../functions/api/lib/dynamo.mjs', () => ({
  ddb: { send },
  tables: { analyticsEvents: () => 'analytics-table' },
  PutCommand: vi.fn(function (input) {
    this.input = input;
  }),
}));

import { sanitizeEvent, writeEvent, EVENT_PROPS } from '../../functions/api/lib/analytics.mjs';
import { eventsRoutes } from '../../functions/api/routes/events.mjs';

const USER = { user_id: 'alice@navapbc.com', role: 'user' };

// Capture the POST handler the route registers, then invoke it with a fake ctx —
// avoids depending on Hono resolution in the root test env.
function buildHandler() {
  let handler;
  eventsRoutes({ post: (_path, h) => { handler = h; } });
  return handler;
}

function fakeCtx(body, user = USER) {
  return {
    get: () => user,
    req: { json: async () => body },
    json: (obj, status = 200) => ({ kind: 'json', obj, status }),
    body: (b, status = 200) => ({ kind: 'body', body: b, status }),
  };
}

beforeEach(() => {
  send.mockReset();
});

describe('sanitizeEvent', () => {
  it('accepts all four allowlisted events', () => {
    for (const event of Object.keys(EVENT_PROPS)) {
      expect(sanitizeEvent(event, {})).not.toBeNull();
    }
  });

  it('returns null for an unknown event', () => {
    expect(sanitizeEvent('login', { path: '/' })).toBeNull();
    expect(sanitizeEvent('session_start', {})).toBeNull();
  });

  it('keeps only whitelisted props and drops extras (including identity keys)', () => {
    const { props } = sanitizeEvent('skill_view', {
      skill_id: 's1',
      skill_slug: 'my-skill',
      referrer: 'browse',
      user_email: 'attacker@evil.com',
      timestamp: '1999-01-01',
      extra: 'nope',
    });
    expect(props).toEqual({ skill_id: 's1', skill_slug: 'my-skill', referrer: 'browse' });
  });

  it('coerces result_count to a number and drops it when non-numeric', () => {
    expect(sanitizeEvent('search_query', { query: 'x', result_count: '5' }).props.result_count).toBe(5);
    expect('result_count' in sanitizeEvent('search_query', { query: 'x', result_count: 'abc' }).props).toBe(false);
  });

  it('drops object/array-valued props (bounds storage, prevents type errors)', () => {
    const { props } = sanitizeEvent('search_query', { query: { $ne: null }, result_count: 1 });
    expect('query' in props).toBe(false);
    expect(props.result_count).toBe(1);
  });

  it('caps string prop length', () => {
    const { props } = sanitizeEvent('search_query', { query: 'x'.repeat(1000) });
    expect(props.query.length).toBe(256);
  });
});

describe('writeEvent', () => {
  it('stamps user_email and timestamp server-side and targets the analytics table', async () => {
    await writeEvent(USER, 'page_view', { path: '/skills' });
    expect(send).toHaveBeenCalledOnce();
    const item = send.mock.calls[0][0].input.Item;
    expect(item.TableName ?? send.mock.calls[0][0].input.TableName).toBe('analytics-table');
    expect(item.user_id).toBe('alice@navapbc.com');
    expect(item.user_email).toBe('alice@navapbc.com');
    expect(item.event).toBe('page_view');
    expect(item.props).toEqual({ path: '/skills' });
    expect(item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.event_key.startsWith(item.timestamp)).toBe(true);
  });

  it('prefers user.email over user.user_id for user_email', async () => {
    await writeEvent({ user_id: 'guid-123', email: 'bob@navapbc.com' }, 'page_view', { path: '/' });
    const item = send.mock.calls[0][0].input.Item;
    expect(item.user_id).toBe('guid-123');
    expect(item.user_email).toBe('bob@navapbc.com');
  });
});

describe('POST /api/events handler', () => {
  it('writes a valid event and returns 204', async () => {
    const handler = buildHandler();
    const res = await handler(fakeCtx({ event: 'filter_applied', props: { filter_name: 'source', filter_value: 'org-wide' } }));
    expect(res.status).toBe(204);
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects an unknown event with 400 and writes nothing', async () => {
    const handler = buildHandler();
    const res = await handler(fakeCtx({ event: 'nope', props: {} }));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a body missing event with 400', async () => {
    const handler = buildHandler();
    const res = await handler(fakeCtx({ props: { path: '/' } }));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('treats malformed JSON (null body) as 400', async () => {
    const handler = buildHandler();
    const res = await handler(fakeCtx(null));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows a write failure and still returns 204 (best-effort ingest)', async () => {
    send.mockRejectedValueOnce(new Error('ResourceNotFoundException'));
    const handler = buildHandler();
    const res = await handler(fakeCtx({ event: 'page_view', props: { path: '/' } }));
    expect(res.status).toBe(204);
  });

  it('ignores client-supplied identity — server user wins', async () => {
    const handler = buildHandler();
    await handler(fakeCtx({ event: 'page_view', props: { path: '/', user_email: 'spoof@evil.com' } }));
    const item = send.mock.calls[0][0].input.Item;
    expect(item.user_email).toBe('alice@navapbc.com');
    expect(item.props.user_email).toBeUndefined();
  });
});
