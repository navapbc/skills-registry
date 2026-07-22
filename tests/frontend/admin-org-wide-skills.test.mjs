import { describe, it, expect } from 'vitest';
import { orgWideOnly } from '../../src/scripts/admin/org-wide-skills.mjs';

const mixed = [
  { slug: 'a', source: 'enterprise' },
  { slug: 'b', source: 'github' },
  { slug: 'c', source: 'enterprise' },
  { slug: 'd', source: 'anthropic-enterprise' },
  { slug: 'e', source: 'anthropic-builtin' },
  { slug: 'f' }, // no source field
];

describe('orgWideOnly', () => {
  it('returns only source === "enterprise" records, preserving order', () => {
    expect(orgWideOnly(mixed).map(s => s.slug)).toEqual(['a', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(orgWideOnly([])).toEqual([]);
  });

  it('returns an empty array when no enterprise records are present', () => {
    const community = [{ slug: 'x', source: 'github' }, { slug: 'y' }];
    expect(orgWideOnly(community)).toEqual([]);
  });

  it('excludes records missing a source field', () => {
    expect(orgWideOnly([{ slug: 'f' }])).toEqual([]);
  });

  it('excludes anthropic-enterprise and anthropic-builtin (narrower than the Enterprise Skills tab)', () => {
    const anthropic = [
      { slug: 'd', source: 'anthropic-enterprise' },
      { slug: 'e', source: 'anthropic-builtin' },
    ];
    expect(orgWideOnly(anthropic)).toEqual([]);
  });

  it('tolerates null/undefined input', () => {
    expect(orgWideOnly(undefined)).toEqual([]);
    expect(orgWideOnly(null)).toEqual([]);
  });
});
