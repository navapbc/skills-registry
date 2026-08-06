import { describe, it, expect } from 'vitest';
import {
  sortPostures,
  repositioned,
  renderPostureBadge,
  renderPostureRow,
  renderPostureList,
  renderPostureForm,
  BADGE_FOREGROUND,
} from '../../src/scripts/projects-admin/postures.mjs';

const P = (id, position, extra = {}) => ({
  id,
  label: id.toUpperCase(),
  color: '#fff8e1',
  position,
  status: 'active',
  steps: ['Read the terms.', 'Never input PII.'],
  ...extra,
});

// The four seeded postures, least to most restrictive.
const SEEDED = [P('allowed', 1), P('restricted', 2), P('silent', 3), P('prohibited', 4)];

describe('sortPostures', () => {
  it('orders by position, not by the order the API returned', () => {
    const shuffled = [SEEDED[3], SEEDED[0], SEEDED[2], SEEDED[1]];
    expect(sortPostures(shuffled).map((p) => p.id)).toEqual([
      'allowed', 'restricted', 'silent', 'prohibited',
    ]);
  });

  it('breaks ties deterministically so the list never reshuffles', () => {
    const tied = [P('zulu', 2), P('alpha', 2), P('mike', 2)];
    const once = sortPostures(tied).map((p) => p.id);
    const twice = sortPostures([...tied].reverse()).map((p) => p.id);
    expect(once).toEqual(['alpha', 'mike', 'zulu']);
    expect(twice).toEqual(once);
  });

  it('treats a missing position as first rather than dropping the record', () => {
    const withMissing = [P('second', 1), { ...P('first', undefined), position: undefined }];
    expect(sortPostures(withMissing).map((p) => p.id)).toEqual(['first', 'second']);
  });

  it('does not mutate the input', () => {
    const input = [SEEDED[2], SEEDED[0]];
    const snapshot = input.map((p) => p.id);
    sortPostures(input);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });
});

describe('repositioned', () => {
  it('renumbers to 1..n from the list order', () => {
    const moved = [SEEDED[1], SEEDED[0], SEEDED[2], SEEDED[3]];
    const changed = repositioned(moved);
    expect(changed.map((p) => [p.id, p.position])).toEqual([
      ['restricted', 1],
      ['allowed', 2],
    ]);
  });

  it('writes only the records whose position actually changed', () => {
    expect(repositioned(SEEDED)).toEqual([]);
  });

  it('handles a newly appended posture with no position', () => {
    const withNew = [...SEEDED, { ...P('conditional', undefined), position: undefined }];
    expect(repositioned(withNew).map((p) => p.id)).toEqual(['conditional']);
  });
});

describe('renderPostureBadge', () => {
  it('uses the stored color as the background, not as a blended hue', () => {
    const html = renderPostureBadge(P('restricted', 2));
    expect(html).toContain('background:#fff8e1');
  });

  it('pairs it with a fixed dark foreground so a pale color stays readable', () => {
    // The four seeded colors are all near-white; deriving text from them the way
    // archetype badges do would render a near-white badge with invisible text.
    for (const color of ['#e0f5f0', '#fff8e1', '#faf0f7', '#fce8e8']) {
      const html = renderPostureBadge({ ...P('x', 1), color });
      expect(html).toContain(`background:${color}`);
      expect(html).toContain(`color:${BADGE_FOREGROUND}`);
    }
  });

  it('escapes the label', () => {
    const html = renderPostureBadge({ ...P('x', 1), label: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderPostureList', () => {
  it('renders postures in display-position order', () => {
    const html = renderPostureList([SEEDED[3], SEEDED[0]]);
    expect(html.indexOf('ALLOWED')).toBeLessThan(html.indexOf('PROHIBITED'));
  });

  it('disables move-up on the first row and move-down on the last', () => {
    const html = renderPostureList(SEEDED);
    expect(html).toMatch(/data-posture-up="0" disabled/);
    expect(html).toMatch(/data-posture-down="3" disabled/);
  });

  it('shows an empty state rather than an empty list', () => {
    expect(renderPostureList([])).toContain('No postures yet');
  });

  it('renders each step as text, escaped', () => {
    const html = renderPostureList([P('x', 1, { steps: ['<b>bold</b>'] })]);
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('preserves step order as authored', () => {
    const html = renderPostureList([P('x', 1, { steps: ['zebra', 'apple'] })]);
    expect(html.indexOf('zebra')).toBeLessThan(html.indexOf('apple'));
  });

  it('renders a posture with no steps without erroring', () => {
    const html = renderPostureList([P('x', 1, { steps: [] })]);
    expect(html).toContain('No steps yet');
    expect(html).toContain('0 steps');
  });

  it('offers Edit only — deletion is not exposed anywhere', () => {
    const html = renderPostureList(SEEDED);
    expect(html).toContain('edit-posture-btn');
    expect(html.toLowerCase()).not.toContain('delete');
  });
});

describe('renderPostureForm', () => {
  // Position is set by moving the row, never by typing an integer — a raw field
  // would invite the position collisions sortPostures has to defend against.
  it('exposes no position input', () => {
    const html = renderPostureForm(P('restricted', 2));
    expect(html).not.toContain('id="posture-position"');
    expect(html).not.toMatch(/type="number"/);
  });

  it('renders a live badge preview so the author sees the contrast they create', () => {
    expect(renderPostureForm(P('restricted', 2))).toContain('posture-badge-preview');
  });

  it('locks the id when editing', () => {
    expect(renderPostureForm(P('restricted', 2))).toMatch(/id="posture-id"[^>]*\sdisabled(?!:)/);
  });

  it('leaves the id editable when adding a posture that did not exist', () => {
    expect(renderPostureForm()).not.toMatch(/id="posture-id"[^>]*\sdisabled(?!:)/);
  });

  it('renders the step editor with an add control even when empty', () => {
    const html = renderPostureForm();
    expect(html).toContain('data-le-root="steps"');
    expect(html).toContain('data-le-add');
  });

  it('pre-fills existing steps in order', () => {
    const html = renderPostureForm(P('restricted', 2));
    expect(html.indexOf('Read the terms.')).toBeLessThan(html.indexOf('Never input PII.'));
  });

  it('offers deactivation only for a posture that exists', () => {
    expect(renderPostureForm(P('restricted', 2))).toContain('Deactivate');
    expect(renderPostureForm()).not.toContain('Deactivate');
  });
});
