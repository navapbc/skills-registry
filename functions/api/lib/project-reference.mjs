// Shared constants for Contract Explorer reference data — delivery archetypes and
// AI-posture policy guidance. Both live in one DynamoDB table partitioned by
// entity type (see terraform/dynamodb.tf for why they share it).

// Partition-key values. An unrecognised entity type must be rejected before it
// reaches DynamoDB, or a typo silently creates a new partition that no tab reads.
export const ENTITY_ARCHETYPE = 'archetype';
export const ENTITY_POSTURE = 'posture';
export const ENTITY_TYPES = [ENTITY_ARCHETYPE, ENTITY_POSTURE];

// Mirror of ARCHETYPE_ICON_NAMES in src/lib/icons.mjs.
//
// This duplication is forced, not chosen: the API Lambda zip is built with
// `cd functions/api && zip -r ../../api.zip .` (see .github/workflows/deploy.yml),
// so nothing here can import from src/ at runtime. The same constraint produced
// the two copies of CATEGORIES, and the fix is the same — a parity test.
// tests/project-icons-parity.test.mjs fails if these lists drift, and also fails
// if a name here has no renderable markup in the frontend icon map.
export const ARCHETYPE_ICON_NAMES = [
  'users',
  'server',
  'database',
  'settings',
  'bulb',
  'building',
  'shield-check',
  'chart-bar',
  'world',
  'briefcase',
  'rocket',
  'puzzle',
];

export const STATUSES = ['active', 'inactive'];

// Ids double as DOM and style keys in the Contract Explorer, so they must be
// slug-safe. Colors are applied as inline styles — interpolated utility classes
// emit no CSS — so a non-hex value would render as nothing.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isTextList = (v) => Array.isArray(v) && v.every(isText);

/**
 * Validates a reference record. Returns an error message, or null when valid.
 *
 * Shared by the API routes and the one-time seed so the seed cannot introduce a
 * record the API would have rejected.
 */
export function validateRecord(entityType, body) {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object';
  if (!ENTITY_TYPES.includes(entityType)) {
    return `Unknown entity type "${entityType}" — expected one of: ${ENTITY_TYPES.join(', ')}`;
  }

  if (!isText(body.id)) return 'id is required';
  if (!SLUG.test(body.id)) return 'id must be lowercase alphanumeric words separated by hyphens';
  if (!isText(body.label)) return 'label is required';
  if (!isText(body.color)) return 'color is required';
  if (!HEX.test(body.color)) return 'color must be a six-digit hex value, e.g. #651A94';

  if (entityType === ENTITY_ARCHETYPE) {
    if (!isText(body.icon)) return 'icon is required';
    if (!ARCHETYPE_ICON_NAMES.includes(body.icon)) {
      return `icon must be one of: ${ARCHETYPE_ICON_NAMES.join(', ')}`;
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
      return 'description must be a string';
    }
    for (const field of ['characteristics', 'ai_opportunities']) {
      if (body[field] !== undefined && !isTextList(body[field])) {
        return `${field} must be a list of non-empty strings`;
      }
    }
    return null;
  }

  // Posture. Position carries display order only — no severity semantics.
  if (!Number.isInteger(body.position)) return 'position must be an integer';
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return 'steps must be a non-empty list';
  }
  // An empty step renders as a blank instruction in guidance a team follows.
  if (!isTextList(body.steps)) return 'every step must be a non-empty string';
  return null;
}

/** Builds the stored shape. Absent lists become empty arrays, never null entries. */
export function normalizeRecord(entityType, body, { id } = {}) {
  const base = {
    entity_type: entityType,
    id: id ?? body.id,
    label: body.label.trim(),
    color: body.color,
    status: STATUSES.includes(body.status) ? body.status : 'active',
  };

  if (entityType === ENTITY_ARCHETYPE) {
    return {
      ...base,
      description: body.description ?? '',
      icon: body.icon,
      characteristics: body.characteristics ?? [],
      ai_opportunities: body.ai_opportunities ?? [],
    };
  }

  return { ...base, position: body.position, steps: body.steps };
}
