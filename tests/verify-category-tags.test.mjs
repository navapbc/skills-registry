import { describe, it, expect } from 'vitest';
import { classifyCategoryTags, isClean } from '../scripts/lib/verify-category-tags.mjs';

const only = (classification, slug) => classification.find((c) => c.slug === slug);

describe('classifyCategoryTags — category', () => {
  it('match: frontmatter category equals DynamoDB category', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', category: 'team-automations' }],
      { s: { category: 'team-automations' } },
    );
    expect(only(c, 's').status).toBe('match');
    expect(only(c, 's').reconcile).toBeNull();
  });

  it('ddb-missing-field: DynamoDB record exists but has no category', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', category: 'team-automations' }],
      { s: { name: 'S' } },
    );
    expect(only(c, 's').status).toBe('ddb-missing-field');
    expect(only(c, 's').reconcile).toEqual({ category: 'team-automations' });
  });

  it('ddb-missing-field: DynamoDB category is empty string', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', category: 'team-automations' }],
      { s: { category: '' } },
    );
    expect(only(c, 's').status).toBe('ddb-missing-field');
    expect(only(c, 's').reconcile).toEqual({ category: 'team-automations' });
  });

  it('mismatch: frontmatter and DynamoDB categories differ', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', category: 'team-automations' }],
      { s: { category: 'write-and-review' } },
    );
    expect(only(c, 's').status).toBe('mismatch');
    expect(only(c, 's').reconcile).toEqual({ category: 'team-automations' });
  });
});

describe('classifyCategoryTags — tags', () => {
  it('match: same tags in same order', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', tags: ['a', 'b'] }],
      { s: { tags: ['a', 'b'] } },
    );
    expect(only(c, 's').status).toBe('match');
    expect(only(c, 's').reconcile).toBeNull();
  });

  it('normalizes a scalar frontmatter tag to an array before comparing', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', tags: 'writing' }],
      { s: { tags: ['writing'] } },
    );
    expect(only(c, 's').status).toBe('match');
  });

  it('ddb-missing-field: DynamoDB has no tags', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', tags: ['a', 'b'] }],
      { s: { category: 'x' } },
    );
    expect(only(c, 's').status).toBe('ddb-missing-field');
    expect(only(c, 's').reconcile).toEqual({ tags: ['a', 'b'] });
  });

  it('mismatch: tag sets differ', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', tags: ['a', 'b'] }],
      { s: { tags: ['a'] } },
    );
    expect(only(c, 's').status).toBe('mismatch');
    expect(only(c, 's').reconcile).toEqual({ tags: ['a', 'b'] });
  });
});

describe('classifyCategoryTags — nothing to preserve', () => {
  it('match with no reconcile when frontmatter declares neither field', () => {
    const c = classifyCategoryTags([{ slug: 's' }], { s: { name: 'S' } });
    expect(only(c, 's').status).toBe('match');
    expect(only(c, 's').reconcile).toBeNull();
  });

  it('match when frontmatter has empty category and no tags, even if no DynamoDB record', () => {
    const c = classifyCategoryTags([{ slug: 's', category: '' }], {});
    expect(only(c, 's').status).toBe('match');
    expect(only(c, 's').reconcile).toBeNull();
  });
});

describe('classifyCategoryTags — missing record', () => {
  it('ddb-missing-record: frontmatter declares fields but no DynamoDB record exists', () => {
    const c = classifyCategoryTags(
      [{ slug: 's', category: 'team-automations', tags: ['a'] }],
      {},
    );
    expect(only(c, 's').status).toBe('ddb-missing-record');
    expect(only(c, 's').reconcile).toEqual({ category: 'team-automations', tags: ['a'] });
  });

  it('reconciles only the declared fields when a record is missing', () => {
    const c = classifyCategoryTags([{ slug: 's', category: 'x' }], new Map());
    expect(only(c, 's').reconcile).toEqual({ category: 'x' });
  });
});

describe('classifyCategoryTags — combined + gate', () => {
  it('accepts a Map keyed by slug', () => {
    const map = new Map([['s', { category: 'x', tags: ['a'] }]]);
    const c = classifyCategoryTags([{ slug: 's', category: 'x', tags: ['a'] }], map);
    expect(only(c, 's').status).toBe('match');
  });

  it('isClean is true only when every entry needs no reconcile', () => {
    const clean = classifyCategoryTags(
      [{ slug: 's', category: 'x' }],
      { s: { category: 'x' } },
    );
    expect(isClean(clean)).toBe(true);

    const dirty = classifyCategoryTags(
      [{ slug: 's', category: 'x' }],
      { s: { category: 'y' } },
    );
    expect(isClean(dirty)).toBe(false);
  });
});
