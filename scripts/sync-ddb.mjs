// DynamoDB write-params for a synced skill/agent record.
//
// Extracted from sync-registry-v2 so the field-write logic is unit-testable
// (the sync script itself runs main() on import and needs GitHub/AWS creds).
//
// Optional fields are written ONLY when present on the record, so absent metadata
// is never persisted as null/empty noise — and DynamoDB never sees an unused
// ExpressionAttributeValue (which it rejects).

// Optional record fields produced by buildSkillRecord. Keep in sync with the
// optional fields in SkillSchema (src/lib/registry-schema.mjs).
// NOTE: `category` and `tags` are intentionally absent here (and from the SET
// clauses below). They are admin-owned fields living only in DynamoDB, managed
// via the admin panel — the same model as `visibility`. Sync must never write
// them, or it would clobber admin edits (see
// docs/plans/2026-07-28-001-refactor-admin-owned-category-tags-plan.md).
export const OPTIONAL_SYNC_FIELDS = [
  'author_name',
  'team', 'problem', 'impact_type', 'estimated_impact',
  'usage_frequency', 'expected_audience', 'data_sources',
  'tools_used', 'human_in_loop',
];

export function buildSkillUpdateParams(skill, { table, now, force = false }) {
  const setClauses = [
    '#name = :name',
    'description = :desc',
    'plugin = :plugin',
    'repo = :repo',
    '#path = :path',
    'author = :author',
    'committer = :committer',
    'version = :version',
    'compatibility = :compat',
    'sensitive_data = :sensitive',
    '#type = :type',
    'content = :content',
    'last_updated = :updated',
    'updated_at = :now',
    '#source = if_not_exists(#source, :src)',
    '#status = if_not_exists(#status, :approved)',
    'visibility = if_not_exists(visibility, :public)',
    'created_by = if_not_exists(created_by, :system)',
    'created_at = if_not_exists(created_at, :now)',
  ];

  const names = {
    '#name': 'name', '#path': 'path', '#type': 'type',
    '#status': 'status', '#source': 'source',
  };

  const values = {
    ':name': skill.name, ':desc': skill.description, ':plugin': skill.plugin,
    ':repo': skill.repo, ':path': skill.path, ':author': skill.author,
    ':committer': skill.committer || null, ':version': skill.version || '1.0.0',
    ':compat': skill.compatibility, ':sensitive': skill.sensitive_data ?? false,
    ':type': skill.type, ':content': skill.content,
    ':updated': skill.last_updated || now, ':now': now,
    ':github': 'github', ':approved': 'approved', ':public': 'public', ':system': 'system',
    ':src': skill.source ?? 'github',
    ':enterprise': 'enterprise',
  };

  // Append optional fields that are actually present on the record. Using
  // ExpressionAttributeNames placeholders for every optional field sidesteps any
  // DynamoDB reserved-word collisions.
  for (const field of OPTIONAL_SYNC_FIELDS) {
    if (skill[field] !== undefined) {
      names[`#${field}`] = field;
      values[`:${field}`] = skill[field];
      setClauses.push(`#${field} = :${field}`);
    }
  }

  // Normal mode: skip no-op writes — only update if the record is new, or it's a
  // github/enterprise record whose last_updated differs (content changed).
  // Force mode (backfill): rewrite every github/enterprise record regardless of
  // last_updated. Both modes keep the source guard so user-submitted records
  // (form/API) are never clobbered by a sync.
  const conditionExpression = force
    ? 'attribute_not_exists(slug) OR #source = :github OR #source = :enterprise'
    : 'attribute_not_exists(slug) OR ((#source = :github OR #source = :enterprise) AND (attribute_not_exists(last_updated) OR last_updated <> :updated))';

  return {
    TableName: table,
    Key: { slug: skill.slug },
    UpdateExpression: `SET ${setClauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: conditionExpression,
  };
}
