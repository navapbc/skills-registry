import { vi, describe, it, expect, beforeEach } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../functions/api/lib/dynamo.mjs', () => {
  const cmd = (name) => vi.fn(function (input) { this._cmd = name; this.input = input; });
  return {
    ddb: { send },
    tables: { analyticsEvents: () => 'analytics-table' },
    GetCommand: cmd('Get'),
    PutCommand: cmd('Put'),
    UpdateCommand: cmd('Update'),
    DeleteCommand: cmd('Delete'),
    ScanCommand: cmd('Scan'),
    BatchGetCommand: cmd('BatchGet'),
  };
});

import { aggregateAnalytics } from '../../functions/api/lib/analytics.mjs';
import { adminRoutes } from '../../functions/api/routes/admin.mjs';

// Capture registered route handlers by "METHOD path" so we can invoke one directly.
function buildRoutes() {
  const handlers = {};
  const reg = (m) => (path, h) => { handlers[`${m} ${path}`] = h; };
  adminRoutes({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE') });
  return handlers['GET /api/admin/analytics'];
}

function fakeCtx(user) {
  return {
    get: () => user,
    req: { query: () => undefined, param: () => ({}) },
    json: (obj, status = 200) => ({ obj, status }),
  };
}

const ADMIN = { user_id: 'admin@navapbc.com', role: 'admin' };
const USER = { user_id: 'u@navapbc.com', role: 'user' };

beforeEach(() => send.mockReset());

describe('aggregateAnalytics', () => {
  const events = [
    { event: 'skill_view', props: { skill_slug: 'a' } },
    { event: 'skill_view', props: { skill_slug: 'a' } },
    { event: 'skill_view', props: { skill_slug: 'b' } },
    { event: 'search_query', props: { query: 'Hello', result_count: 3 } },
    { event: 'search_query', props: { query: 'hello', result_count: 5 } },
    { event: 'filter_applied', props: { filter_value: 'org-wide' } },
    { event: 'filter_applied', props: { filter_value: 'org-wide' } },
    { event: 'filter_applied', props: { filter_value: 'community' } },
    { event: 'page_view', props: { path: '/' } },
  ];

  it('counts and ranks top skills', () => {
    const { topSkills } = aggregateAnalytics(events);
    expect(topSkills).toEqual([
      { skill_slug: 'a', count: 2 },
      { skill_slug: 'b', count: 1 },
    ]);
  });

  it('normalizes search query case and merges counts', () => {
    const { topSearches } = aggregateAnalytics(events);
    expect(topSearches).toEqual([{ query: 'hello', count: 2, result_count: 5 }]);
  });

  it('counts filter usage', () => {
    const { filterUsage } = aggregateAnalytics(events);
    expect(filterUsage).toEqual([
      { filter_value: 'org-wide', count: 2 },
      { filter_value: 'community', count: 1 },
    ]);
  });

  it('returns empty arrays for no events', () => {
    expect(aggregateAnalytics([])).toEqual({ topSkills: [], topSearches: [], filterUsage: [] });
  });

  it('honors topN for skills, searches, and filters', () => {
    const many = Array.from({ length: 15 }, (_, i) => [
      { event: 'skill_view', props: { skill_slug: `s${i}` } },
      { event: 'filter_applied', props: { filter_value: `f${i}` } },
    ]).flat();
    const agg = aggregateAnalytics(many, { topN: 5 });
    expect(agg.topSkills).toHaveLength(5);
    expect(agg.filterUsage).toHaveLength(5);
  });

  it('does not crash on a non-string skill_slug tie-break (adversarial input)', () => {
    const poisoned = [
      { event: 'skill_view', props: { skill_slug: 1 } },
      { event: 'skill_view', props: { skill_slug: 2 } },
    ];
    expect(() => aggregateAnalytics(poisoned)).not.toThrow();
  });
});

describe('GET /api/admin/analytics', () => {
  it('returns 403 for a non-admin', async () => {
    const handler = buildRoutes();
    const res = await handler(fakeCtx(USER));
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('scans with a timestamp cutoff filter and returns aggregated counts', async () => {
    send.mockResolvedValueOnce({
      Items: [
        { event: 'skill_view', props: { skill_slug: 'a' } },
        { event: 'skill_view', props: { skill_slug: 'a' } },
      ],
    });
    const handler = buildRoutes();
    const res = await handler(fakeCtx(ADMIN));
    expect(res.status).toBe(200);
    expect(res.obj.window_days).toBe(28);
    expect(res.obj.topSkills).toEqual([{ skill_slug: 'a', count: 2 }]);
    // cutoff filter applied on the reserved `timestamp` attribute
    const scanInput = send.mock.calls[0][0].input;
    expect(scanInput.FilterExpression).toContain('#ts');
    expect(scanInput.ExpressionAttributeNames['#ts']).toBe('timestamp');
    expect(scanInput.ExpressionAttributeValues[':cutoff']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('paginates across LastEvaluatedKey', async () => {
    send
      .mockResolvedValueOnce({ Items: [{ event: 'filter_applied', props: { filter_value: 'all' } }], LastEvaluatedKey: { user_id: 'x' } })
      .mockResolvedValueOnce({ Items: [{ event: 'filter_applied', props: { filter_value: 'all' } }] });
    const handler = buildRoutes();
    const res = await handler(fakeCtx(ADMIN));
    expect(send).toHaveBeenCalledTimes(2);
    expect(res.obj.filterUsage).toEqual([{ filter_value: 'all', count: 2 }]);
  });
});
