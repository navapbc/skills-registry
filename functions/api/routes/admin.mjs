import { ddb, tables, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, BatchGetCommand } from '../lib/dynamo.mjs';
import { can } from '../lib/permissions.mjs';
import { writeAudit } from '../lib/audit.mjs';
import { aggregateAnalytics } from '../lib/analytics.mjs';

const ANALYTICS_WINDOW_DAYS = 28;

const CATEGORY_IDS = ['writing-comms', 'research-analysis', 'planning', 'dev-code', 'ops-automation'];
const CATEGORY_LABELS = {
  'writing-comms': 'Writing & Comms',
  'research-analysis': 'Research & Analysis',
  'planning': 'Planning',
  'dev-code': 'Dev & Code',
  'ops-automation': 'Ops & Automation',
};

async function getCategoryOverrides() {
  const result = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [tables.skills()]: {
        Keys: CATEGORY_IDS.map(id => ({ slug: `category::${id}` })),
      },
    },
  }));
  const overrides = {};
  for (const item of (result.Responses?.[tables.skills()] ?? [])) {
    overrides[item.slug.replace('category::', '')] = item.featuredSlugs ?? [];
  }
  return overrides;
}

export function adminRoutes(app) {
  // ── Public: used by homepage to get featuredSlugs ──────────────────────
  app.get('/api/categories', async (c) => {
    const overrides = await getCategoryOverrides();
    return c.json({
      categories: CATEGORY_IDS.map(id => ({
        id,
        label: CATEGORY_LABELS[id],
        featuredSlugs: overrides[id] ?? [],
      })),
    });
  });

  // ── All skills for admin panel (maintain+) — no visibility filtering ──
  app.get('/api/admin/skills', async (c) => {
    const user = c.get('user');
    if (!can(user, 'edit:any-skill')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.skills(),
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    return c.json({ skills: items.filter(s => s.source !== 'category-config') });
  });

  // ── Skills queue (maintain+) ───────────────────────────────────────────
  app.get('/api/admin/queue', async (c) => {
    const user = c.get('user');
    if (!can(user, 'approve:skill')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.skills(),
        FilterExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pending': 'pending' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    items.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
    return c.json({ skills: items });
  });

  // ── Enterprise skills (maintain+) ─────────────────────────────────────
  app.get('/api/admin/enterprise-skills', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.skills(),
        FilterExpression: '#src = :e OR #src = :e2 OR #src = :b',
        ExpressionAttributeNames: { '#src': 'source' },
        ExpressionAttributeValues: { ':e': 'anthropic-enterprise', ':e2': 'enterprise', ':b': 'anthropic-builtin' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    return c.json({ skills: items });
  });

  app.post('/api/admin/enterprise-skills', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    if (!body.slug || !body.name || !body.description) {
      return c.json({ error: 'slug, name, and description are required' }, 400);
    }

    const VALID_VIS = new Set(['public', 'private', 'hidden']);
    const now = new Date().toISOString();
    const skill = {
      slug: body.slug,
      name: body.name,
      description: body.description,
      tags: body.tags ?? [],
      docs_url: body.docs_url ?? '',
      source: 'anthropic-enterprise',
      type: 'skill',
      status: 'approved',
      visibility: VALID_VIS.has(body.visibility) ? body.visibility : 'public',
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      last_updated: now,
    };

    try {
      await ddb.send(new PutCommand({
        TableName: tables.skills(),
        Item: skill,
        ConditionExpression: 'attribute_not_exists(slug)',
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return c.json({ error: `Slug "${skill.slug}" already exists` }, 409);
      }
      throw err;
    }
    await writeAudit(user, 'created', 'enterprise-skill', skill.slug);
    return c.json(skill, 201);
  });

  app.put('/api/admin/enterprise-skills/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:enterprise')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);
    if (existing.Item.source === 'anthropic-builtin') {
      return c.json({ error: 'Anthropic built-in skills cannot be edited' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const VALID_VISIBILITY = new Set(['public', 'private', 'hidden']);
    const updated = {
      ...existing.Item,
      name: body.name ?? existing.Item.name,
      description: body.description ?? existing.Item.description,
      tags: body.tags ?? existing.Item.tags ?? [],
      docs_url: body.docs_url ?? existing.Item.docs_url ?? '',
      ...(body.visibility != null && VALID_VISIBILITY.has(body.visibility) && { visibility: body.visibility }),
      updated_at: new Date().toISOString(),
      updated_by: user.user_id,
    };

    await ddb.send(new PutCommand({ TableName: tables.skills(), Item: updated }));
    await writeAudit(user, 'updated', 'enterprise-skill', slug);
    return c.json(updated);
  });

  app.delete('/api/admin/enterprise-skills/:slug', async (c) => {
    const user = c.get('user');
    if (!can(user, 'delete:skill')) return c.json({ error: 'Forbidden' }, 403);

    const { slug } = c.req.param();
    const existing = await ddb.send(new GetCommand({ TableName: tables.skills(), Key: { slug } }));
    if (!existing.Item) return c.json({ error: 'Not found' }, 404);

    await ddb.send(new DeleteCommand({ TableName: tables.skills(), Key: { slug } }));
    await writeAudit(user, 'deleted', 'enterprise-skill', slug);
    return c.json({ deleted: slug });
  });

  // ── Categories (maintain+) ────────────────────────────────────────────
  app.get('/api/admin/categories', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:categories')) return c.json({ error: 'Forbidden' }, 403);

    const overrides = await getCategoryOverrides();
    return c.json({
      categories: CATEGORY_IDS.map(id => ({
        id,
        label: CATEGORY_LABELS[id],
        featuredSlugs: overrides[id] ?? [],
      })),
    });
  });

  app.put('/api/admin/categories/:id/featured', async (c) => {
    const user = c.get('user');
    if (!can(user, 'manage:categories')) return c.json({ error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    if (!CATEGORY_IDS.includes(id)) return c.json({ error: 'Unknown category' }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.featuredSlugs)) {
      return c.json({ error: 'featuredSlugs must be an array' }, 400);
    }

    await ddb.send(new PutCommand({
      TableName: tables.skills(),
      Item: {
        slug: `category::${id}`,
        source: 'category-config',
        featuredSlugs: body.featuredSlugs,
        updated_at: new Date().toISOString(),
      },
    }));

    await writeAudit(user, 'updated', 'category', id);
    return c.json({ id, featuredSlugs: body.featuredSlugs });
  });

  // ── Users (admin only) ────────────────────────────────────────────────
  app.get('/api/admin/users', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:users')) return c.json({ error: 'Forbidden' }, 403);

    const items = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.users(),
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    items.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
    return c.json({ users: items });
  });

  app.put('/api/admin/users/:id/role', async (c) => {
    const user = c.get('user');
    if (!can(user, 'set:role')) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => null);
    const VALID = new Set(['user', 'maintain', 'admin']);
    if (!body?.role || !VALID.has(body.role)) {
      return c.json({ error: 'role must be "user", "maintain", or "admin"' }, 400);
    }

    const targetId = decodeURIComponent(c.req.param('id'));
    const result = await ddb.send(new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id: targetId },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': body.role },
      ReturnValues: 'ALL_NEW',
    }));

    await writeAudit(user, 'role-changed', 'user', targetId);
    return c.json(result.Attributes);
  });

  // ── Audit log (admin only) ────────────────────────────────────────────
  app.get('/api/admin/audit', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:audit')) return c.json({ error: 'Forbidden' }, 403);

    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const result = await ddb.send(new ScanCommand({
      TableName: tables.audit(),
      Limit: limit,
    }));

    const events = (result.Items ?? []).sort((a, b) =>
      String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? ''))
    );
    return c.json({ events });
  });

  // ── Content analytics (admin only) ────────────────────────────────────
  app.get('/api/admin/analytics', async (c) => {
    const user = c.get('user');
    if (!can(user, 'read:audit')) return c.json({ error: 'Forbidden' }, 403);

    const cutoff = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const events = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: tables.analyticsEvents(),
        FilterExpression: '#ts >= :cutoff',
        ExpressionAttributeNames: { '#ts': 'timestamp' }, // `timestamp` is a DynamoDB reserved word
        ExpressionAttributeValues: { ':cutoff': cutoff },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      events.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    const agg = aggregateAnalytics(events);
    return c.json({ ...agg, window_days: ANALYTICS_WINDOW_DAYS });
  });
}
