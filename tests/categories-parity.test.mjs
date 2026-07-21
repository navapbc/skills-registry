import { describe, it, expect } from 'vitest';
import { CATEGORIES as FRONTEND } from '../src/lib/categories.mjs';
import { CATEGORIES as API } from '../functions/api/lib/categories.mjs';
import { SKILL_CATEGORIES } from '../src/lib/admin/format.mjs';

// The frontend config (src/lib/categories.mjs) and the API config
// (functions/api/lib/categories.mjs) are duplicated because the API Lambda zip
// only bundles functions/api/ — they cannot share a module at runtime. This
// test is the guard against drift. It also checks the admin skill-editor
// dropdown (src/lib/admin/format.mjs) uses the same id/label set.
const METADATA_FIELDS = ['label', 'subtitle', 'heroDescription', 'accentColor', 'icon'];

describe('category id/label/metadata parity across sources', () => {
  it('frontend and API define the same category ids', () => {
    expect([...API.map(c => c.id)].sort()).toEqual([...FRONTEND.map(c => c.id)].sort());
  });

  it('frontend and API agree on label and metadata for every category', () => {
    const apiById = new Map(API.map(c => [c.id, c]));
    for (const fe of FRONTEND) {
      const api = apiById.get(fe.id);
      expect(api, `API missing category ${fe.id}`).toBeDefined();
      for (const field of METADATA_FIELDS) {
        expect(fe[field], `frontend ${fe.id}.${field} missing`).toBeDefined();
        expect(api[field], `${fe.id}.${field} mismatch`).toBe(fe[field]);
      }
    }
  });

  it('accent colors are 6-digit hex', () => {
    for (const cat of API) {
      expect(cat.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('admin skill-category dropdown matches the canonical id/label set', () => {
    const dropdown = SKILL_CATEGORIES.filter(c => c.id !== ''); // drop the "— none —" entry
    const canonical = new Map(FRONTEND.map(c => [c.id, c.label]));
    expect(dropdown.length).toBe(canonical.size);
    for (const entry of dropdown) {
      expect(canonical.get(entry.id), `dropdown id ${entry.id} not canonical`).toBe(entry.label);
    }
  });
});
