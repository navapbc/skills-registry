import { describe, it, expect } from 'vitest';
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups } from '../../src/lib/render.mjs';

const baseSkill = {
  slug: 'test-skill',
  name: 'Test Skill',
  description: 'Does something useful',
  plugin: 'my-plugin',
  author: 'author@navapbc.com',
  committer: null,
  type: 'skill',
  sensitive_data: false,
  compatibility: ['claude-code'],
  last_updated: '2026-01-15T00:00:00Z',
  repo: 'navapbc/my-plugin',
  path: 'skills/test-skill/SKILL.md',
  content: '# Test\nThis is the skill content.',
  tools_used: [],
  human_in_loop: null,
};

describe('escapeHtml', () => {
  it('escapes & < > " and single quote', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('returns non-string values as strings', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
});

describe('renderSkillCard', () => {
  it('produces an anchor to the skill detail page', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('href="/skills/test-skill"');
  });

  it('includes the skill name', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('Test Skill');
  });

  it('truncates description to 110 characters', () => {
    const long = { ...baseSkill, description: 'x'.repeat(120) };
    const html = renderSkillCard(long);
    expect(html).toContain('x'.repeat(110) + '...');
  });

  it('shows plugin badge by default', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('my-plugin');
  });

  it('hides plugin badge when showPlugin=false', () => {
    const html = renderSkillCard(baseSkill, false);
    expect(html).not.toContain('bg-plum-50 text-plum-700 rounded');
  });

  it('shows agent badge for agent type', () => {
    const agent = { ...baseSkill, type: 'agent' };
    const html = renderSkillCard(agent);
    expect(html).toContain('agent');
    expect(html).toContain('bg-blue-50');
  });

  it('shows sensitive badge when sensitive_data=true', () => {
    const sensitive = { ...baseSkill, sensitive_data: true };
    const html = renderSkillCard(sensitive);
    expect(html).toContain('⚠');
  });

  it('shows committer avatar when committer has avatar_url', () => {
    const withCommitter = {
      ...baseSkill,
      committer: { login: 'cory', name: 'Cory', avatar_url: 'https://avatars.example.com/cory' },
    };
    const html = renderSkillCard(withCommitter);
    expect(html).toContain('https://avatars.example.com/cory');
    expect(html).toContain('data-github-url="https://github.com/cory"');
  });

  it('escapes XSS in name', () => {
    const xss = { ...baseSkill, name: '<script>alert(1)</script>' };
    const html = renderSkillCard(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSkillDetail', () => {
  it('includes the skill name in an h1', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Test Skill');
  });

  it('includes the skill description', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Does something useful');
  });

  it('includes the SKILL.md content in a pre block', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('This is the skill content.');
    expect(html).toContain('<pre');
  });

  it('shows Install in Claude Code card for claude-code compatible skill', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('Install in Claude Code');
    expect(html).toContain(`claude mcp add test-skill --from-github navapbc/my-plugin`);
  });

  it('does not show Claude Code install card when not compatible', () => {
    const noCC = { ...baseSkill, compatibility: ['claude-chat'] };
    const html = renderSkillDetail(noCC);
    expect(html).not.toContain('Install in Claude Code');
  });

  it('includes data-skill-json for localStorage', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('data-skill-json');
    expect(html).toContain('"slug":"test-skill"');
  });

  it('links back to the plugin page', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('href="/plugins/my-plugin"');
  });
});

describe('renderPluginDetail', () => {
  const plugin = {
    slug: 'my-plugin',
    name: 'My Plugin',
    description: 'A plugin for testing',
    repo: 'navapbc/my-plugin',
    author: 'navapbc',
  };
  const skills = [baseSkill];
  const agents = [];

  it('includes the plugin name', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('My Plugin');
  });

  it('includes a skill card for each skill', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('href="/skills/test-skill"');
  });

  it('shows skills count in tab', () => {
    const html = renderPluginDetail(plugin, skills, agents);
    expect(html).toContain('Skills (1)');
  });
});

describe('renderWhatsNewGroups', () => {
  const recentSkill = {
    ...baseSkill,
    slug: 'recent',
    name: 'Recent Skill',
    last_updated: new Date().toISOString(),
  };

  it('renders a skill in the this-week group', () => {
    const html = renderWhatsNewGroups([recentSkill]);
    expect(html).toContain('This week');
    expect(html).toContain('Recent Skill');
  });

  it('renders empty state when no skills', () => {
    const html = renderWhatsNewGroups([]);
    expect(html).toContain('No skills');
  });
});
