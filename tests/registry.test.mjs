import { describe, it, expect } from 'vitest';
import { SkillSchema } from '../src/lib/registry-schema.mjs';

const baseValid = {
  slug: 'test', name: 'Test', description: 'desc',
  plugin: 'p', repo: 'org/repo', path: 'SKILL.md',
  author: 'a', version: '1.0.0', compatibility: [],
  sensitive_data: false, type: 'skill', content: '',
  last_updated: null,
};

describe('SkillSchema — required fields', () => {
  it('passes with all required fields present', () => {
    expect(SkillSchema.safeParse(baseValid).success).toBe(true);
  });

  it('fails when slug is missing', () => {
    const { slug: _, ...rest } = baseValid;
    expect(SkillSchema.safeParse(rest).success).toBe(false);
  });

  it('fails when repo format is wrong', () => {
    expect(SkillSchema.safeParse({ ...baseValid, repo: 'not-a-valid-repo' }).success).toBe(false);
  });

  it('fails when type is not skill or agent', () => {
    expect(SkillSchema.safeParse({ ...baseValid, type: 'plugin' }).success).toBe(false);
  });
});

describe('SkillSchema — optional submission + author/tags fields', () => {
  it('passes with no optional fields present', () => {
    expect(SkillSchema.safeParse(baseValid).success).toBe(true);
  });

  it('passes with all optional fields present', () => {
    const full = {
      ...baseValid,
      author_name: 'Diana Olympia',
      tags: ['writing', 'meeting-prep'],
      team: 'Business Development',
      problem: 'Manual reporting took 2 hours',
      impact_type: ['Time saved per use', 'Reduced error rate or rework'],
      estimated_impact: 'Saves ~45 min per use',
      usage_frequency: 'A few times per week',
      expected_audience: '6-15 people',
      data_sources: 'Google Docs, Jira',
    };
    expect(SkillSchema.safeParse(full).success).toBe(true);
  });

  it('passes with some optional fields present', () => {
    const partial = { ...baseValid, team: 'Design', estimated_impact: 'Saves 1 hour' };
    expect(SkillSchema.safeParse(partial).success).toBe(true);
  });

  it('fails when impact_type is not an array', () => {
    expect(SkillSchema.safeParse({ ...baseValid, impact_type: 42 }).success).toBe(false);
  });

  it('fails when tags is not an array', () => {
    expect(SkillSchema.safeParse({ ...baseValid, tags: 'writing' }).success).toBe(false);
  });
});
