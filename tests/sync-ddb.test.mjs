import { describe, it, expect } from 'vitest';
import { buildSkillUpdateParams } from '../scripts/sync-ddb.mjs';
import { buildSkillRecord, parseFrontmatter } from '../src/lib/parse-skill.mjs';

const NOW = '2026-06-04T00:00:00Z';
const ctx = { table: 'skills-x', now: NOW };
const paramsFor = (skill) => buildSkillUpdateParams(skill, ctx);

const coreSkill = {
  slug: 's', name: 'S', description: 'd', plugin: 'p', repo: 'navapbc/r',
  path: 'SKILL.md', author: 'a@navapbc.com', committer: null, version: '1.0.0',
  compatibility: ['claude-code'], sensitive_data: false, type: 'skill',
  content: 'x', last_updated: null, category: '',
};

// DynamoDB rejects any ExpressionAttributeValue / -Name that the expression
// does not reference, so these guards catch a whole class of real write bugs.
function assertNoUnusedValues(p) {
  const expr = `${p.UpdateExpression} ${p.ConditionExpression}`;
  for (const key of Object.keys(p.ExpressionAttributeValues)) {
    expect(expr.includes(key), `unused value ${key}`).toBe(true);
  }
}
function assertNoUnusedNames(p) {
  const expr = `${p.UpdateExpression} ${p.ConditionExpression}`;
  for (const key of Object.keys(p.ExpressionAttributeNames)) {
    expect(expr.includes(key), `unused name ${key}`).toBe(true);
  }
}

describe('buildSkillUpdateParams — core fields', () => {
  it('targets the skills table keyed by slug', () => {
    const p = paramsFor(coreSkill);
    expect(p.TableName).toBe('skills-x');
    expect(p.Key).toEqual({ slug: 's' });
  });

  it('writes the core attributes', () => {
    const p = paramsFor(coreSkill);
    expect(p.UpdateExpression).toContain('#name = :name');
    expect(p.UpdateExpression).toContain('author = :author');
    expect(p.UpdateExpression).toContain('compatibility = :compat');
    expect(p.ExpressionAttributeValues[':author']).toBe('a@navapbc.com');
  });

  it('omits optional fields entirely when absent', () => {
    const p = paramsFor(coreSkill);
    expect(p.UpdateExpression).not.toContain(':team');
    expect(p.UpdateExpression).not.toContain(':tags');
    expect(p.UpdateExpression).not.toContain(':author_name');
    expect(':team' in p.ExpressionAttributeValues).toBe(false);
    expect('#team' in p.ExpressionAttributeNames).toBe(false);
  });

  it('never writes category or tags — they are admin-owned in DynamoDB, not synced', () => {
    // Even when the record carries category/tags, sync must leave them untouched
    // so admin-panel edits are not clobbered
    // (docs/plans/2026-07-28-001-refactor-admin-owned-category-tags-plan.md).
    const p = paramsFor({ ...coreSkill, category: 'team-automations', tags: ['a', 'b'] });
    expect(p.UpdateExpression).not.toContain('category');
    expect(p.UpdateExpression).not.toContain('tags');
    expect(':category' in p.ExpressionAttributeValues).toBe(false);
    expect(':tags' in p.ExpressionAttributeValues).toBe(false);
    expect('#tags' in p.ExpressionAttributeNames).toBe(false);
    assertNoUnusedValues(p);
    assertNoUnusedNames(p);
  });

  it('keeps the content-unchanged condition guard', () => {
    const p = paramsFor(coreSkill);
    expect(p.ConditionExpression).toContain('attribute_not_exists(slug)');
    expect(p.ConditionExpression).toContain('last_updated <> :updated');
  });

  it('has no unused expression values or names', () => {
    const p = paramsFor(coreSkill);
    assertNoUnusedValues(p);
    assertNoUnusedNames(p);
  });
});

describe('buildSkillUpdateParams — optional submission fields', () => {
  const fullSkill = {
    ...coreSkill,
    author_name: 'Diana Olympia',
    tags: ['writing', 'meeting-prep'],
    team: 'Business Development',
    problem: 'manual work',
    impact_type: ['Time saved per use'],
    estimated_impact: 'Saves 45 min',
    usage_frequency: 'A few times per week',
    expected_audience: '6-15 people',
    data_sources: 'Google Docs',
  };

  // `tags` is intentionally NOT here — it is admin-owned and never synced.
  const OPTIONALS = [
    'author_name', 'team', 'problem', 'impact_type',
    'estimated_impact', 'usage_frequency', 'expected_audience', 'data_sources',
  ];

  it('writes every optional field present on the record', () => {
    const p = paramsFor(fullSkill);
    for (const f of OPTIONALS) {
      expect(p.UpdateExpression, f).toContain(`#${f} = :${f}`);
      expect(p.ExpressionAttributeNames[`#${f}`]).toBe(f);
      expect(p.ExpressionAttributeValues[`:${f}`]).toEqual(fullSkill[f]);
    }
  });

  it('writes only the optional fields that are present (partial record)', () => {
    const p = paramsFor({ ...coreSkill, team: 'Finance' });
    expect(p.UpdateExpression).toContain('#team = :team');
    expect(p.UpdateExpression).not.toContain(':problem');
    expect('#problem' in p.ExpressionAttributeNames).toBe(false);
  });

  it('still has no unused expression values or names with optionals present', () => {
    const p = paramsFor(fullSkill);
    assertNoUnusedValues(p);
    assertNoUnusedNames(p);
  });
});

describe('buildSkillUpdateParams — force (backfill) mode', () => {
  it('normal mode keeps the unchanged-content guard', () => {
    const p = buildSkillUpdateParams(coreSkill, { table: 'skills-x', now: NOW });
    expect(p.ConditionExpression).toContain('last_updated <> :updated');
  });

  it('force mode drops the last_updated guard but keeps the source guard', () => {
    const p = buildSkillUpdateParams(coreSkill, { table: 'skills-x', now: NOW, force: true });
    expect(p.ConditionExpression).not.toContain('last_updated <> :updated');
    expect(p.ConditionExpression).not.toContain('attribute_not_exists(last_updated)');
    // still only writes new records or github/enterprise — protects user-submitted
    expect(p.ConditionExpression).toContain('attribute_not_exists(slug)');
    expect(p.ConditionExpression).toContain('#source = :github');
    expect(p.ConditionExpression).toContain('#source = :enterprise');
  });

  it('force mode still writes optional fields and has no unused attributes', () => {
    const skill = { ...coreSkill, team: 'Finance', author_name: 'Jo' };
    const p = buildSkillUpdateParams(skill, { table: 'skills-x', now: NOW, force: true });
    expect(p.UpdateExpression).toContain('#team = :team');
    expect(p.ExpressionAttributeValues[':author_name']).toBe('Jo');
    assertNoUnusedValues(p);
    assertNoUnusedNames(p);
  });
});

describe('buildSkillUpdateParams — agent fields', () => {
  it('writes tools_used and human_in_loop for agents', () => {
    const agent = {
      ...coreSkill, slug: 'a', type: 'agent', path: 'AGENT.md',
      tools_used: ['Read', 'Bash'], human_in_loop: 'review',
    };
    const p = paramsFor(agent);
    expect(p.UpdateExpression).toContain('#tools_used = :tools_used');
    expect(p.ExpressionAttributeValues[':tools_used']).toEqual(['Read', 'Bash']);
    expect(p.ExpressionAttributeValues[':human_in_loop']).toBe('review');
    assertNoUnusedValues(p);
  });
});

describe('end-to-end: parsed SKILL.md → record → write params', () => {
  it('flows team / author_name / author from frontmatter but never category/tags', () => {
    const src = `---
name: test-exec-summary
description: Does a thing
author: diana@navapbc.com
author_name: Diana Olympia
team: Business Development
impact_type: [Time saved per use]
category: write-and-review
tags: [writing, meeting-prep]
---

# body`;
    const { meta, body } = parseFrontmatter(src);
    const record = buildSkillRecord({
      meta, body, content: src,
      repo: { name: 'r', owner: { login: 'navapbc' }, pushed_at: NOW },
      path: 'enterprise/x/SKILL.md', org: 'navapbc',
    });
    // category/tags are admin-owned — the parser must not read them into the record...
    expect('category' in record).toBe(false);
    expect('tags' in record).toBe(false);
    const p = paramsFor(record);
    expect(p.ExpressionAttributeValues[':team']).toBe('Business Development');
    expect(p.ExpressionAttributeValues[':author_name']).toBe('Diana Olympia');
    expect(p.ExpressionAttributeValues[':impact_type']).toEqual(['Time saved per use']);
    // ...and the write params must not carry them either
    expect(':category' in p.ExpressionAttributeValues).toBe(false);
    expect(':tags' in p.ExpressionAttributeValues).toBe(false);
    // frontmatter email wins over the GitHub repo owner
    expect(p.ExpressionAttributeValues[':author']).toBe('diana@navapbc.com');
    assertNoUnusedValues(p);
  });
});
