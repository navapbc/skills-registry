// Pure transforms for the one-time project-reference seed.
//
// Kept separate from the CLI so they can be tested without AWS credentials or a
// DynamoDB client. The CLI in scripts/seed-project-reference.mjs owns the I/O.

import {
  ENTITY_ARCHETYPE,
  ENTITY_POSTURE,
  validateRecord,
} from '../../functions/api/lib/project-reference.mjs';

/**
 * The prototype's archetype icons are Material Symbols names. This repo renders
 * Tabler, so every name needs an explicit equivalent — carrying a source name
 * through unmapped would store an archetype whose icon renders as nothing.
 */
export const ICON_MAP = {
  groups: 'users',
  dns: 'server',
  storage: 'database',
  settings: 'settings',
  lightbulb: 'bulb',
};

/**
 * The source policy file carries no color: each guidance entry holds only a label
 * and its steps. These are the prototype's posture background tokens, resolved to
 * literals from its stylesheet. Without them every seeded posture fails validation.
 */
export const POSTURE_COLORS = {
  allowed: '#e0f5f0',
  restricted: '#fff8e1',
  silent: '#faf0f7',
  prohibited: '#fce8e8',
};

/**
 * The lightest text the Contract Explorer places on a posture color.
 *
 * The badge in `renderPostureBadge` uses gray-900 and the panel in
 * `renderPostureSection` uses gray-800 for its guidance steps — both hardcoded,
 * because a posture color arrives as an inline style and no class can adapt to
 * it. gray-800 is therefore the binding constraint, and a posture color dark
 * enough to swallow it makes the guidance unreadable.
 */
const POSTURE_TEXT_COLOR = '#1f2937';

/** WCAG 2.1 AA for normal-size text. The guidance steps render at text-sm. */
const MIN_CONTRAST = 4.5;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance of a six-digit hex color. */
function relativeLuminance(hex) {
  const linear = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Contrast ratio between two six-digit hex colors, 1:1 to 21:1. */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Rejects a posture color that the Explorer's hardcoded text cannot sit on.
 *
 * The format check is not redundant with the contrast check: a malformed hex
 * parses to NaN, and every comparison against NaN is false, so an unguarded
 * ratio test would wave a broken color through as compliant.
 */
function assertLegibleColor(id, color) {
  if (!HEX_COLOR.test(color)) {
    throw new SeedError(
      `posture "${id}" has color "${color}", which is not a six-digit hex color. ` +
        `It is written into an inline style, so a malformed value renders no background.`
    );
  }
  const ratio = contrastRatio(color, POSTURE_TEXT_COLOR);
  if (ratio < MIN_CONTRAST) {
    throw new SeedError(
      `posture "${id}" has color ${color}, which gives only ${ratio.toFixed(2)}:1 against ` +
        `the ${POSTURE_TEXT_COLOR} text the Contract Explorer draws on it — under the ` +
        `${MIN_CONTRAST}:1 WCAG AA floor. Posture colors must be light tints.`
    );
  }
}

/** Top-level policy fields the migration deliberately does not carry. */
export const SKIPPED_POLICY_FIELDS = [
  'effectiveDate',
  'reviewDate',
  'approver',
  'sourceDoc',
  'checklist',
  'standardClientResponse',
  'hardLimits',
];

export class SeedError extends Error {}

/**
 * Maps the prototype's archetypes.json into stored records.
 *
 * Note the key rename: the source uses `aiOpportunities`, the stored shape uses
 * `ai_opportunities`. Passing the source object through verbatim would persist
 * the camelCase key and the tab would render an empty list for every record,
 * with nothing anywhere reporting an error.
 */
export function archetypesFromSource(source) {
  if (!Array.isArray(source)) {
    throw new SeedError('archetypes source must be a JSON array');
  }

  return source.map((raw) => {
    if (!raw?.id) throw new SeedError('every archetype needs an id');

    const icon = ICON_MAP[raw.icon];
    if (!icon) {
      throw new SeedError(
        `archetype "${raw.id}" has icon "${raw.icon}", which has no mapping to the ` +
          `curated menu. Add one to ICON_MAP, or add the icon to src/lib/icons.mjs first.`
      );
    }

    return {
      entity_type: ENTITY_ARCHETYPE,
      id: raw.id,
      label: raw.label,
      description: raw.description ?? '',
      color: raw.color,
      icon,
      characteristics: raw.characteristics ?? [],
      ai_opportunities: raw.aiOpportunities ?? [],
      status: 'active',
    };
  });
}

/**
 * Maps the `guidance` block of the prototype's policy.json into posture records.
 *
 * Only `guidance` is carried. Display positions follow the object's own key
 * insertion order, which runs least- to most-restrictive in the source and is
 * therefore the intended reading order.
 */
export function posturesFromSource(source) {
  const guidance = source?.guidance;
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) {
    throw new SeedError('policy source must have a `guidance` object');
  }

  return Object.entries(guidance).map(([id, entry], index) => {
    const color = POSTURE_COLORS[id];
    if (!color) {
      throw new SeedError(
        `posture "${id}" has no mapped color. The source file carries none, so add ` +
          `one to POSTURE_COLORS before seeding.`
      );
    }
    assertLegibleColor(id, color);
    if (!Array.isArray(entry?.steps) || entry.steps.length === 0) {
      throw new SeedError(`posture "${id}" has no guidance steps`);
    }

    return {
      entity_type: ENTITY_POSTURE,
      id,
      label: entry.label,
      color,
      position: index + 1,
      steps: entry.steps,
      status: 'active',
    };
  });
}

/** Which top-level policy fields were present and dropped, for the run log. */
export function skippedPolicyFields(source) {
  return SKIPPED_POLICY_FIELDS.filter((field) => source?.[field] !== undefined);
}

/**
 * Runs every record through the same validation the API uses, so the seed cannot
 * introduce a record the API would have rejected. Throws on the first failure —
 * a partially-valid batch should not be written.
 */
export function assertValid(records) {
  for (const record of records) {
    const error = validateRecord(record.entity_type, record);
    if (error) {
      throw new SeedError(`${record.entity_type} "${record.id}" is invalid: ${error}`);
    }
  }
  return records;
}

/** Builds every record for a seed run, validated. */
export function buildRecords({ archetypes, policy }) {
  return assertValid([...archetypesFromSource(archetypes), ...posturesFromSource(policy)]);
}

export { ENTITY_ARCHETYPE, ENTITY_POSTURE };
