import { sanitizeEvent, writeEvent } from '../lib/analytics.mjs';

export function eventsRoutes(app) {
  // Behavioral analytics ingest. authMiddleware has already populated c.get('user'),
  // so identity is taken from the JWT — the client body carries only event + props.
  app.post('/api/hub-log', async (c) => {
    const user = c.get('user');

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.event !== 'string') {
      return c.json({ error: 'event is required' }, 400);
    }

    const sanitized = sanitizeEvent(body.event, body.props);
    if (!sanitized) return c.json({ error: 'Unknown event' }, 400);

    // Analytics ingest is best-effort: a missing table (deploy-ordering window)
    // or a throttled/failed write must never surface as a 5xx. Log and 204.
    try {
      await writeEvent(user, sanitized.event, sanitized.props);
    } catch (err) {
      console.error('analytics writeEvent failed', err);
    }
    return c.body(null, 204);
  });
}
