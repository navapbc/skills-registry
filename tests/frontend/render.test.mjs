import { describe, it, expect } from 'vitest';
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups, renderCategoryGrid, renderNewThisWeek, renderCategoryDetail } from '../../src/lib/render.mjs';
import { CATEGORIES } from '../../src/lib/categories.mjs';

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

const catSkills = [
  {
    slug: 'nava-labs-style', name: 'Nava Labs Style', description: 'Writing style guide',
    plugin: 'labs-tir-prototyping', author: 'navapbc', committer: null, type: 'skill',
    sensitive_data: false, compatibility: ['claude-code'],
    last_updated: new Date().toISOString(),
    repo: 'navapbc/labs-tir-prototyping', path: 'skills/nava-labs-style/SKILL.md', content: '',
  },
  {
    slug: 'diagram', name: 'Diagram', description: 'Draw diagrams',
    plugin: 'digital-service-orchestra', author: 'navapbc', committer: null, type: 'skill',
    sensitive_data: false, compatibility: ['claude-code'],
    last_updated: '2025-01-01T00:00:00Z',
    repo: 'navapbc/digital-service-orchestra', path: 'SKILL.md', content: '',
  },
];

describe('renderCategoryGrid', () => {
  it('renders a card for each category', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Writing &amp; Comms');
    expect(html).toContain('Research &amp; Analysis');
    expect(html).toContain('Planning');
    expect(html).toContain('Dev &amp; Code');
    expect(html).toContain('Ops &amp; Automation');
  });

  it('shows curated skill names in the correct card', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Nava Labs Style');
    expect(html).toContain('Diagram');
  });

  it('shows "new" badge on skills updated within the last 7 days', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    const writingSection = html.split('Research &amp;')[0];
    expect(writingSection).toContain('new');
  });

  it('does not show "new" badge on old skills', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    const researchSection = html.split('Research &amp; Analysis')[1]?.split('Planning')[0] || '';
    expect(researchSection).not.toContain('>new<');
  });

  it('renders the submit CTA cell', () => {
    const html = renderCategoryGrid(CATEGORIES, catSkills);
    expect(html).toContain('Submit a skill');
    expect(html).toContain('docs.google.com');
  });

  it('skips curated slugs not in allSkills without erroring', () => {
    const html = renderCategoryGrid(CATEGORIES, []);
    expect(html).toContain('Writing &amp; Comms');
    expect(html).not.toContain('undefined');
  });
});

describe('renderNewThisWeek', () => {
  it('returns empty string when no skills are new', () => {
    const old = [{ ...catSkills[1] }];
    expect(renderNewThisWeek(old, CATEGORIES)).toBe('');
  });

  it('renders new skills with name and link', () => {
    const html = renderNewThisWeek(catSkills, CATEGORIES);
    expect(html).toContain('Nava Labs Style');
    expect(html).toContain('/skills/nava-labs-style');
    expect(html).toContain("What's new");
  });

  it('caps output at 3 skills', () => {
    const manyNew = Array.from({ length: 10 }, (_, i) => ({
      ...catSkills[0], slug: `skill-${i}`, name: `Skill ${i}`,
    }));
    const html = renderNewThisWeek(manyNew, CATEGORIES);
    const linkCount = (html.match(/href="\/skills\//g) || []).length;
    expect(linkCount).toBeLessThanOrEqual(3);
  });
});

describe('renderCategoryDetail', () => {
  const cat = CATEGORIES[0]; // writing-comms, has nava-labs-style in slugs

  it('renders the category label', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain('Writing &amp; Comms');
  });

  it('renders a skill card for each skill in the category', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain('href="/skills/nava-labs-style"');
  });

  it('renders empty state when no skills match', () => {
    const html = renderCategoryDetail(cat, []);
    expect(html).toContain('No skills in this category yet');
  });

  it('renders featured section when featuredSlugs has entries', () => {
    const catWithFeatured = { ...cat, featuredSlugs: ['nava-labs-style'], slugs: ['nava-labs-style'] };
    const html = renderCategoryDetail(catWithFeatured, catSkills);
    expect(html).toContain('Featured');
  });

  it('does not render featured section when featuredSlugs is empty', () => {
    const catNoFeatured = { ...cat, featuredSlugs: [] };
    const html = renderCategoryDetail(catNoFeatured, catSkills);
    expect(html).not.toContain('Featured');
  });
});

describe('renderSkillCard — tags', () => {
  const base = {
    slug: 'test', name: 'Test Skill', description: 'A test skill',
    plugin: 'test-plugin', author: 'author', compatibility: ['claude-code'],
    type: 'skill', source: 'github', tags: ['testing', 'docs', 'security', 'extra'],
  };

  it('renders up to 3 tag chips', () => {
    const html = renderSkillCard(base);
    expect(html).toContain('#testing');
    expect(html).toContain('#docs');
    expect(html).toContain('#security');
    expect(html).not.toContain('#extra');
  });

  it('renders no tag section when tags is empty', () => {
    const html = renderSkillCard({ ...base, tags: [] });
    expect(html).not.toContain('data-tags');
  });

  it('renders no tag section when tags is absent', () => {
    const { tags: _, ...noTags } = base;
    const html = renderSkillCard(noTags);
    expect(html).not.toContain('data-tags');
  });
});

describe('renderSkillCard — anthropic-builtin badge', () => {
  const builtin = {
    slug: 'xlsx', name: 'xlsx', description: 'Excel tool',
    plugin: '', author: 'Anthropic', compatibility: [],
    type: 'tool', source: 'anthropic-builtin', tags: [],
  };

  it('shows Anthropic Tool badge for anthropic-builtin source', () => {
    const html = renderSkillCard(builtin);
    expect(html).toContain('Anthropic Tool');
  });
});
