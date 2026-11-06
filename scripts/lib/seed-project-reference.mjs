// Pure transforms for the one-time project-reference seed.
//
// Kept separate from the CLI so they can be tested without AWS credentials or a
// DynamoDB client. The CLI in scripts/seed-project-reference.mjs owns the I/O.

import {
  ENTITY_ARCHETYPE,
  ENTITY_POSTURE,
  contrastRatio,
  validateRecord,
} from '../../functions/api/lib/project-reference.mjs';

export { contrastRatio };

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
 * and its steps. Without a color here every seeded posture fails validation.
 *
 * These literal pairs are stored on posture records and applied as inline styles.
 * The paired foreground is validated against its background for WCAG AA contrast.
 * Changing a value here requires --update-colors to reach existing records.
 */
export const POSTURE_COLORS = {
  allowed: '#004C31',
  restricted: '#FFBE2E',
  silent: '#0A0539',
  prohibited: '#fcdcd6',
};

export const POSTURE_TEXT_COLORS = {
  allowed: '#FFFFFF',
  restricted: '#0A0539',
  silent: '#FFFFFF',
  prohibited: '#1b1b1b',
};

/** WCAG 2.1 AA for normal-size text. The guidance steps render at text-sm. */
const MIN_CONTRAST = 4.5;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function assertLegibleColors(id, color, textColor) {
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(textColor ?? '')) {
    throw new SeedError(
      `posture "${id}" has a color or text color that is not a six-digit hex value.`
    );
  }
  const ratio = contrastRatio(color, textColor);
  if (ratio < MIN_CONTRAST) {
    throw new SeedError(
      `posture "${id}" has color ${color} and text color ${textColor}, which gives only ` +
        `${ratio.toFixed(2)}:1 contrast — under the ${MIN_CONTRAST}:1 WCAG AA floor.`
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
    const text_color = POSTURE_TEXT_COLORS[id];
    if (!text_color) {
      throw new SeedError(`posture "${id}" has no mapped text color. Add one to POSTURE_TEXT_COLORS.`);
    }
    assertLegibleColors(id, color, text_color);
    if (!Array.isArray(entry?.steps) || entry.steps.length === 0) {
      throw new SeedError(`posture "${id}" has no guidance steps`);
    }

    return {
      entity_type: ENTITY_POSTURE,
      id,
      label: entry.label,
      color,
      text_color,
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

/**
 * The posture colors alone, validated, for the `--update-colors` mode.
 *
 * That mode exists because the main seed writes create-if-absent — deliberately,
 * so a re-run cannot revert an admin's edit — which means a changed value in
 * POSTURE_COLORS can never reach a record that already exists. Restyling the
 * Contract Explorer's posture badges otherwise requires editing four records by
 * hand in every environment, and POSTURE_COLORS stops being the source of truth
 * the moment that happens.
 *
 * It deliberately does NOT read the policy file. A color is not in that file —
 * it is in this one — so requiring the operator to hold an out-of-repo policy
 * export just to push a hex would be a check that proves nothing.
 *
 * Every color runs through the same legibility gate as a full seed. A color
 * arriving by this path is written into the same inline style and read by the
 * same hardcoded gray-800, so it cannot be held to a looser bar.
 */
export function postureColorUpdates() {
  return Object.entries(POSTURE_COLORS).map(([id, color]) => {
    const text_color = POSTURE_TEXT_COLORS[id];
    if (!text_color) {
      throw new SeedError(`posture "${id}" has no mapped text color. Add one to POSTURE_TEXT_COLORS.`);
    }
    assertLegibleColors(id, color, text_color);
    return { entity_type: ENTITY_POSTURE, id, color, text_color };
  });
}

export { ENTITY_ARCHETYPE, ENTITY_POSTURE };
