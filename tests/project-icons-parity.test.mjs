import { describe, it, expect } from 'vitest';
import { ARCHETYPE_ICON_NAMES as FRONTEND, renderIcon } from '../src/lib/icons.mjs';
import { ARCHETYPE_ICON_NAMES as API } from '../functions/api/lib/project-reference.mjs';
import { CATEGORIES } from '../src/lib/categories.mjs';

// The archetype icon allowlist is duplicated between the frontend icon module and
// the API lib because the API Lambda zip only bundles functions/api/ — they cannot
// share a module at runtime (see .github/workflows/deploy.yml). This test is the
// guard against drift, mirroring tests/categories-parity.test.mjs.
//
// Drift here is not cosmetic: a name the picker offers but the API rejects makes a
// valid selection unsaveable, and a name the API accepts but the icon map lacks
// stores an archetype whose icon silently renders as nothing.
describe('archetype icon allowlist parity', () => {
  it('frontend and API list the same icon names', () => {
    expect([...API].sort()).toEqual([...FRONTEND].sort());
  });

  it('frontend and API list them in the same order, so the picker matches', () => {
    expect(API).toEqual(FRONTEND);
  });

  it('every allowlisted name renders non-empty markup', () => {
    for (const name of FRONTEND) {
      expect(renderIcon(name), `icon "${name}" is allowlisted but renders nothing`).not.toBe('');
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(FRONTEND).size).toBe(FRONTEND.length);
  });

  it('covers the five seeded archetypes', () => {
    // Equivalents for the prototype's Material Symbols names: groups, dns,
    // storage, settings, lightbulb. The seed maps onto these.
    for (const name of ['users', 'server', 'database', 'settings', 'bulb']) {
      expect(FRONTEND).toContain(name);
    }
  });
});

describe('icon map extension stayed additive', () => {
  it('every category icon still renders', () => {
    for (const category of CATEGORIES) {
      expect(renderIcon(category.icon), `category icon "${category.icon}" broke`).not.toBe('');
    }
  });

  // Documents the silent-failure behaviour the allowlist exists to prevent
  // reaching: renderIcon never throws, it just produces nothing.
  it('an unknown name still renders as an empty string rather than throwing', () => {
    expect(renderIcon('groups')).toBe('');
    expect(renderIcon('definitely-not-an-icon')).toBe('');
  });
});
