import { describe, it, expect } from 'vitest';
import { buildSkillRecord, parseFrontmatter, analyzeSkillFile } from '../src/lib/parse-skill.mjs';

const SAMPLE = `---
name: test-exec-summary
description: >
  Converts raw work input into executive summary bullets for leadership
version: "1.0"
author: dianaolympia@navapbc.com
author_name: Diana Olympia
team: Business Development
sensitive_data: false
problem: Spend 45-60 minutes aggregating and formulating summary
estimated_impact: Saves 45-60 minutes per summary
usage_frequency: A few times per week
expected_audience: 6-15 people
impact_type: [Time saved per use]
compatibility: [claude-chat, claude-cowork]
tags: [writing, meeting-prep]
---

# Exec Summary Bullets

Converts raw work input into executive summary bullets for VP+ audiences.`;

describe('buildSkillRecord — context-free (validator) mode', () => {
  it('maps the sample frontmatter into a record', () => {
    const { meta, body } = parseFrontmatter(SAMPLE);
    const rec = buildSkillRecord({ meta, body, content: SAMPLE });

    expect(rec.name).toBe('test-exec-summary');
    expect(rec.slug).toBe('test-exec-summary');
    expect(rec.description).toBe('Converts raw work input into executive summary bullets for leadership');
    expect(rec.version).toBe('1.0');
    expect(rec.author).toBe('dianaolympia@navapbc.com');
    expect(rec.author_name).toBe('Diana Olympia');
    expect(rec.team).toBe('Business Development');
    expect(rec.problem).toBe('Spend 45-60 minutes aggregating and formulating summary');
    expect(rec.estimated_impact).toBe('Saves 45-60 minutes per summary');
    expect(rec.usage_frequency).toBe('A few times per week');
    expect(rec.expected_audience).toBe('6-15 people');
    expect(rec.impact_type).toEqual(['Time saved per use']);
    expect(rec.compatibility).toEqual(['claude-chat', 'claude-cowork']);
    expect(rec.tags).toEqual(['writing', 'meeting-prep']);
    expect(rec.sensitive_data).toBe(false);
    expect(rec.type).toBe('skill');
    expect(rec.content).toBe(SAMPLE);
  });

  it('uses placeholders for pipeline-only fields when no context given', () => {
    const { meta, body } = parseFrontmatter(SAMPLE);
    const rec = buildSkillRecord({ meta, body, content: SAMPLE });
    expect(rec.repo).toBe('org/repo');
    expect(rec.path).toBe('SKILL.md');
    expect(rec.plugin).toBe('preview');
    expect(rec.committer).toBe(null);
    expect(rec.last_updated).toBe(null);
  });

  it('derives description from body when frontmatter omits it', () => {
    const src = `---\nname: x\n---\n\n# Title\n\nThe first real line.`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({ meta, body, content: src });
    expect(rec.description).toBe('The first real line.');
  });

  it('defaults version, type, and infers compatibility when omitted', () => {
    const src = `---\nname: x\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({ meta, body, content: src });
    expect(rec.version).toBe('1.0.0');
    expect(rec.type).toBe('skill');
    expect(rec.compatibility).toEqual(['claude-code']);
  });

  it('omits optional fields entirely when absent', () => {
    const src = `---\nname: x\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({ meta, body, content: src });
    expect('team' in rec).toBe(false);
    expect('tags' in rec).toBe(false);
    expect('author_name' in rec).toBe(false);
  });

  it('normalizes scalar impact_type/tags to arrays', () => {
    const src = `---\nname: x\nimpact_type: Time saved per use\ntags: writing\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({ meta, body, content: src });
    expect(rec.impact_type).toEqual(['Time saved per use']);
    expect(rec.tags).toEqual(['writing']);
  });

  it('adds agent-only fields when type is agent', () => {
    const src = `---\nname: a\ntype: agent\ntools_used: [Read, Bash]\nhuman_in_loop: review\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({ meta, body, content: src, type: 'agent' });
    expect(rec.type).toBe('agent');
    expect(rec.tools_used).toEqual(['Read', 'Bash']);
    expect(rec.human_in_loop).toBe('review');
  });
});

describe('buildSkillRecord — pipeline (sync) mode', () => {
  const repo = { name: 'my-repo', owner: { login: 'someone' }, pushed_at: '2026-01-01T00:00:00Z' };

  it('uses repo/path/committer context when provided', () => {
    const src = `---\nname: My Skill\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const committer = { login: 'd', name: 'D', avatar_url: null, date: '2026-02-02T00:00:00Z' };
    const rec = buildSkillRecord({
      meta, body, content: src,
      repo, path: '.claude/skills/foo/SKILL.md', committer, type: 'skill', org: 'navapbc',
    });
    expect(rec.repo).toBe('navapbc/my-repo');
    expect(rec.plugin).toBe('my-repo');
    expect(rec.path).toBe('.claude/skills/foo/SKILL.md');
    expect(rec.committer).toEqual(committer);
    expect(rec.last_updated).toBe('2026-02-02T00:00:00Z');
  });

  it('derives name from parent dir for generic filenames', () => {
    const src = `---\ndescription: no name here\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({
      meta, body, content: src, repo, path: '.claude/skills/cool-thing/SKILL.md', org: 'navapbc',
    });
    expect(rec.name).toBe('cool-thing');
  });

  it('marks enterprise/ paths with source=enterprise', () => {
    const src = `---\nname: ent\ncategory: ops\n---\n\nbody`;
    const { meta, body } = parseFrontmatter(src);
    const rec = buildSkillRecord({
      meta, body, content: src, repo, path: 'enterprise/ops/ent/SKILL.md', org: 'navapbc',
    });
    expect(rec.source).toBe('enterprise');
    expect(rec.category).toBe('ops');
  });
});

describe('analyzeSkillFile', () => {
  it('reports a valid sample file as valid', () => {
    const out = analyzeSkillFile(SAMPLE);
    expect(out.validation.valid).toBe(true);
    expect(out.validation.errors).toEqual([]);
  });

  it('tags field sources: frontmatter vs derived vs pipeline', () => {
    const out = analyzeSkillFile(SAMPLE);
    const by = Object.fromEntries(out.fields.map(f => [f.key, f.source]));
    expect(by.name).toBe('frontmatter');
    expect(by.team).toBe('frontmatter');
    expect(by.slug).toBe('derived');          // from name
    expect(by.repo).toBe('pipeline');
    expect(by.plugin).toBe('pipeline');
  });

  it('marks defaulted fields when frontmatter omits them', () => {
    const out = analyzeSkillFile(`---\nname: x\n---\n\nbody line`);
    const by = Object.fromEntries(out.fields.map(f => [f.key, f.source]));
    expect(by.version).toBe('defaulted');
    expect(by.type).toBe('defaulted');
    expect(by.compatibility).toBe('defaulted');
    expect(by.description).toBe('derived');
  });

  it('flags unrecognized keys with a did-you-mean suggestion for legacy nava_ keys', () => {
    const out = analyzeSkillFile(`---\nname: x\nnava_team: Eng\nbogusfield: 1\n---\n\nbody`);
    const ignored = Object.fromEntries(out.ignored.map(i => [i.key, i.suggestion]));
    expect(Object.keys(ignored)).toContain('nava_team');
    expect(ignored.nava_team).toBe('team');
    expect('bogusfield' in ignored).toBe(true);
  });

  it('coerces sparse input into a schema-valid record (linting lives in warnings)', () => {
    // buildSkillRecord fills defaults for every required field, so the derived
    // record is structurally schema-valid; missing author-required content is
    // surfaced through form-conformance warnings instead of schema errors.
    const out = analyzeSkillFile(`---\ndescription: only desc\n---\n\nbody`);
    expect(out.validation.valid).toBe(true);
    expect(out.warnings.some(w => w.field === 'name')).toBe(true);
  });
});

describe('analyzeSkillFile — form-conformance warnings', () => {
  const fieldsOf = (out) => out.warnings.map(w => w.field);

  it('a fully-conformant submission has no form warnings', () => {
    const src = `---
name: exec-summary
description: Does a thing
author: a@navapbc.com
author_name: Diana Olympia
team: Business Development
sensitive_data: false
problem: A real pain point
estimated_impact: Saves 45 min
usage_frequency: A few times per week
expected_audience: 6-15 people
impact_type: [Time saved per use]
compatibility: [claude-chat]
tags: [writing, meeting-prep]
---

body`;
    const out = analyzeSkillFile(src);
    expect(out.warnings).toEqual([]);
  });

  it('warns when required-by-form fields are missing', () => {
    const out = analyzeSkillFile(`---\nname: x\n---\n\nbody`);
    const f = fieldsOf(out);
    expect(f).toContain('team');
    expect(f).toContain('problem');
    expect(f).toContain('estimated_impact');
    expect(f).toContain('usage_frequency');
    expect(f).toContain('expected_audience');
    expect(f).toContain('author_name');
    expect(f).toContain('impact_type');
  });

  it('warns when team is not one of the form options', () => {
    const out = analyzeSkillFile(`---\nname: x\nteam: Engineering\n---\n\nbody`);
    expect(out.warnings.some(w => w.field === 'team' && /not one of/.test(w.message))).toBe(true);
  });

  it('warns when usage_frequency / expected_audience are off-list', () => {
    const out = analyzeSkillFile(`---\nname: x\nusage_frequency: All the time\nexpected_audience: lots\n---\n\nbody`);
    const f = fieldsOf(out);
    expect(f).toContain('usage_frequency');
    expect(f).toContain('expected_audience');
  });

  it('warns when impact_type contains an off-list value', () => {
    const out = analyzeSkillFile(`---\nname: x\nimpact_type: [Magic]\n---\n\nbody`);
    expect(out.warnings.some(w => w.field === 'impact_type')).toBe(true);
  });

  it('warns when skill name is not in skill-name format', () => {
    const out = analyzeSkillFile(`---\nname: Exec Summary\n---\n\nbody`);
    expect(out.warnings.some(w => w.field === 'name' && /skill-name format/.test(w.message))).toBe(true);
  });

  it('warns when there are more than 3 tags or bad tag format', () => {
    const out = analyzeSkillFile(`---\nname: x\ntags: [a, b, c, d]\n---\n\nbody`);
    expect(out.warnings.some(w => w.field === 'tags')).toBe(true);
  });

  it('warns when sensitive_data is not explicitly set', () => {
    const out = analyzeSkillFile(`---\nname: x\n---\n\nbody`);
    expect(out.warnings.some(w => w.field === 'sensitive_data')).toBe(true);
  });
});
