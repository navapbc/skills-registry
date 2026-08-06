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
