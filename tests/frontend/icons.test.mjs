import { describe, it, expect } from 'vitest';
import { renderIcon } from '../../src/lib/icons.mjs';
import { CATEGORIES } from '../../src/lib/categories.mjs';

describe('renderIcon', () => {
  it('returns an SVG string containing a path for a known icon', () => {
    const svg = renderIcon('search');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('returns an empty string for an unknown icon (no throw)', () => {
    expect(renderIcon('does-not-exist')).toBe('');
  });

  it('resolves every canonical category icon to non-empty SVG', () => {
    for (const cat of CATEGORIES) {
      expect(renderIcon(cat.icon), `icon ${cat.icon} for ${cat.id}`).toContain('<svg');
    }
  });

  it('applies size and className options', () => {
    const svg = renderIcon('code', { size: 48, className: 'text-plum-600' });
    expect(svg).toContain('width="48"');
    expect(svg).toContain('height="48"');
    expect(svg).toContain('class="text-plum-600"');
  });
});
