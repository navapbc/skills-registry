import { sanitizeEvent, writeEvent } from '../lib/analytics.mjs';

export function eventsRoutes(app) {
  // Behavioral analytics ingest. authMiddleware has already populated c.get('user'),
  // so identity is taken from the JWT — the client body carries only event + props.
  app.post('/api/events', async (c) => {
    const user = c.get('user');

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.event !== 'string') {
      return c.json({ error: 'event is required' }, 400);
    }

    const sanitized = sanitizeEvent(body.event, body.props);
    if (!sanitized) return c.json({ error: 'Unknown event' }, 400);

    await writeEvent(user, sanitized.event, sanitized.props);
    return c.body(null, 204);
  });
}
