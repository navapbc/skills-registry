import { describe, it, expect } from 'vitest';
import { escapeHtml, renderSkillCard, renderSkillDetail, renderPluginDetail, renderWhatsNewGroups, renderCategoryTiles, renderNewThisWeek, renderCategoryDetail } from '../../src/lib/render.mjs';
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

  it('links to /agents/:slug for agent type', () => {
    const agent = { ...baseSkill, type: 'agent' };
    const html = renderSkillCard(agent);
    expect(html).toContain('href="/agents/test-skill"');
    expect(html).not.toContain('href="/skills/test-skill"');
  });

  it('links to /skills/:slug for skill type', () => {
    const html = renderSkillCard(baseSkill);
    expect(html).toContain('href="/skills/test-skill"');
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
    // After HTML-escaping, double quotes become &quot; to prevent XSS
    expect(html).toContain('&quot;slug&quot;:&quot;test-skill&quot;');
  });

  it('links back to the plugin page for a regular skill', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).toContain('href="/plugins/my-plugin"');
    expect(html).toContain('← Back to my-plugin');
  });

  it('links back to /agents for an agent type', () => {
    const agent = { ...baseSkill, type: 'agent' };
    const html = renderSkillDetail(agent);
    expect(html).toContain('href="/agents"');
    expect(html).toContain('← All agents');
  });

  it('links back to hub for an enterprise skill', () => {
    const enterprise = { ...baseSkill, source: 'enterprise', plugin: 'skills-registry' };
    const html = renderSkillDetail(enterprise);
    expect(html).toContain('href="/"');
    expect(html).toContain('← Back to hub');
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
    sensitive_data: false, compatibility: ['claude-code'], category: 'write-and-review',
    last_updated: new Date().toISOString(),
    repo: 'navapbc/labs-tir-prototyping', path: 'skills/nava-labs-style/SKILL.md', content: '',
  },
  {
    slug: 'diagram', name: 'Diagram', description: 'Draw diagrams',
    plugin: 'digital-service-orchestra', author: 'navapbc', committer: null, type: 'skill',
    sensitive_data: false, compatibility: ['claude-code'], category: 'research-and-analyze',
    last_updated: '2025-01-01T00:00:00Z',
    repo: 'navapbc/digital-service-orchestra', path: 'SKILL.md', content: '',
  },
];

describe('renderCategoryTiles', () => {
  it('renders a tile for each browsable category', () => {
    const html = renderCategoryTiles(CATEGORIES, catSkills);
    expect(html).toContain('Write &amp; Review');
    expect(html).toContain('Research &amp; Analyze');
    expect(html).toContain('Personal Productivity');
    expect(html).toContain('Build &amp; Ship');
    expect(html).toContain('Team Automations');
  });

  it('links each tile to its category detail page and renders an icon + accent bar', () => {
    const html = renderCategoryTiles(CATEGORIES, catSkills);
    expect(html).toContain('href="/category/write-and-review"');
    expect(html).toContain('<svg');
    expect(html).toContain('border-top:3px solid #D4537E'); // write-and-review accent
  });

  it('counts skills by s.category === cat.id', () => {
    const html = renderCategoryTiles(CATEGORIES, catSkills);
    // one skill each in write-and-review and research-and-analyze
    const writeTile = html.split('Research &amp; Analyze')[0];
    expect(writeTile).toContain('1 skill');
    // build-and-ship has no matching skills
    const buildTile = html.split('Build &amp; Ship')[1].split('Team Automations')[0];
    expect(buildTile).toContain('0 skills');
  });

  it('does not count uncategorized skills', () => {
    const withUncategorized = [...catSkills, { ...baseSkill, slug: 'x', category: '' }];
    const html = renderCategoryTiles(CATEGORIES, withUncategorized);
    // write-and-review still shows exactly 1 skill (the empty-category skill is excluded)
    const writeTile = html.split('Research &amp; Analyze')[0];
    expect(writeTile).toContain('1 skill');
  });

  it('omits categories that are not browsable', () => {
    const cats = [{ ...CATEGORIES[0], browsable: false }, CATEGORIES[1]];
    const html = renderCategoryTiles(cats, catSkills);
    expect(html).not.toContain('Write &amp; Review');
    expect(html).toContain('Research &amp; Analyze');
  });

  it('escapes category label/subtitle', () => {
    const cats = [{ ...CATEGORIES[0], label: '<x>', subtitle: '"s"', browsable: true }];
    const html = renderCategoryTiles(cats, []);
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('<x>');
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
  const cat = CATEGORIES[0]; // write-and-review, has nava-labs-style in slugs

  it('renders the category label', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain('Write &amp; Review');
  });

  it('renders the hero description and applies the accent color', () => {
    const html = renderCategoryDetail(cat, catSkills);
    expect(html).toContain(escapeHtml(cat.hero_description));
    expect(html).toContain(cat.accent_color);
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

describe('renderSkillCard — org-wide badge', () => {
  const enterprise = {
    slug: 'daily-briefing', name: 'Daily Briefing', description: 'Briefing skill',
    plugin: 'skills-registry', author: 'Nava Ops', compatibility: ['claude-desktop'],
    type: 'skill', source: 'enterprise', tags: [], category: 'team-automations',
  };
  it('shows Org-wide badge for enterprise source', () => {
    const html = renderSkillCard(enterprise);
    expect(html).toContain('Org-wide');
    expect(html).toContain('violet');
  });
  it('does not show Org-wide badge for github source', () => {
    const html = renderSkillCard({ ...enterprise, source: 'github' });
    expect(html).not.toContain('Org-wide');
  });
});

describe('renderCategoryTiles — membership counting', () => {
  const cats = [{ id: 'team-automations', label: 'Team Automations', subtitle: 'Automations', accent_color: '#BA7517', icon: 'repeat', browsable: true }];
  const retro = { slug: 'retro', name: 'Retro', description: 'Retro skill', source: 'github', type: 'skill', category: '' };
  const orgSkill = { slug: 'daily-briefing', name: 'Daily Briefing', description: 'Briefing', source: 'enterprise', type: 'skill', category: 'team-automations' };

  it('counts org-wide (enterprise) skills that match the category', () => {
    const html = renderCategoryTiles(cats, [retro, orgSkill]);
    expect(html).toContain('1 skill');
  });

  it('excludes skills whose category does not match (incl. empty category)', () => {
    const wrongCat = [{ id: 'personal-productivity', label: 'Personal Productivity', subtitle: 'x', accent_color: '#7F77DD', icon: 'calendar-check', browsable: true }];
    const html = renderCategoryTiles(wrongCat, [orgSkill, retro]);
    expect(html).toContain('0 skills');
  });
});

describe('renderSkillDetail — tools_used and human_in_loop', () => {
  const agentSkill = {
    slug: 'my-agent', name: 'My Agent', description: 'An agent',
    plugin: 'my-plugin', author: 'author', compatibility: ['claude-code'],
    type: 'agent', source: 'github', tags: [],
    tools_used: ['fix-bug', 'test'],
    human_in_loop: 'Requires approval before deploying',
  };

  it('renders tools_used section when present', () => {
    const html = renderSkillDetail(agentSkill);
    expect(html).toContain('Composed Skills');
    expect(html).toContain('fix-bug');
  });

  it('renders human_in_loop warning when set', () => {
    const html = renderSkillDetail(agentSkill);
    expect(html).toContain('Human in the loop');
    expect(html).toContain('Requires approval before deploying');
  });

  it('renders no tools_used section when empty', () => {
    const html = renderSkillDetail({ ...agentSkill, tools_used: [] });
    expect(html).not.toContain('Composed Skills');
  });
});

describe('renderSkillDetail — empty compatibility', () => {
  it('omits Works-with section when compatibility is empty', () => {
    const skill = {
      slug: 'test', name: 'Test', description: 'desc',
      plugin: 'p', author: 'a', compatibility: [],
      type: 'skill', source: 'github', tags: [],
    };
    const html = renderSkillDetail(skill);
    expect(html).not.toContain('Works with');
  });
});

describe('submitter identity precedence over GitHub committer', () => {
  const committer = { login: 'gh-bot', name: 'GH Bot', avatar_url: null, date: '2026-01-01T00:00:00Z' };

  it('detail: shows author_name + email and an "Author" card, not the GitHub handle', () => {
    const skill = { ...baseSkill, committer, author: 'diana@navapbc.com', author_name: 'Diana Olympia' };
    const html = renderSkillDetail(skill);
    expect(html).toContain('Diana Olympia');
    expect(html).toContain('diana@navapbc.com');
    expect(html).toContain('>Author<');
    expect(html).not.toContain('@gh-bot');
    expect(html).not.toContain('Last Committer');
  });

  it('detail: falls back to "Last Committer" + GitHub handle when no author_name', () => {
    const skill = { ...baseSkill, committer, author: 'navapbc' };
    const html = renderSkillDetail(skill);
    expect(html).toContain('Last Committer');
    expect(html).toContain('@gh-bot');
  });

  it('card: uses author_name over the committer login', () => {
    const skill = { ...baseSkill, committer, author: 'diana@navapbc.com', author_name: 'Diana Olympia' };
    const html = renderSkillCard(skill);
    expect(html).toContain('Diana Olympia');
    expect(html).not.toContain('gh-bot');
  });

  it('card: still shows the committer login when no author_name', () => {
    const skill = { ...baseSkill, committer, author: 'navapbc' };
    const html = renderSkillCard(skill);
    expect(html).toContain('gh-bot');
  });
});

describe('renderSkillDetail — optional submission fields', () => {
  const navaSkill = {
    ...baseSkill,
    team: 'Engineering',
    problem: 'Spent 2 hours formatting reports manually',
    impact_type: ['Time saved per use', 'Reduced error rate or rework'],
    estimated_impact: 'Saves ~45 min per deliverable',
    usage_frequency: 'Daily',
    expected_audience: '16+ people / org-wide',
    data_sources: 'Google Docs, Jira',
  };

  it('renders team when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Engineering');
  });

  it('renders problem when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Spent 2 hours formatting reports manually');
  });

  it('renders each impact_type chip', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Time saved per use');
    expect(html).toContain('Reduced error rate or rework');
  });

  it('renders estimated_impact when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Saves ~45 min per deliverable');
  });

  it('renders usage_frequency when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Daily');
  });

  it('renders expected_audience when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('16+ people / org-wide');
  });

  it('renders data_sources when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Google Docs, Jira');
  });

  it('omits the section entirely when no submission fields present', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).not.toContain('nava-detail-section');
    expect(html).not.toContain('Submission Details');
  });

  it('escapes XSS in submission field values', () => {
    const xss = { ...baseSkill, team: '<script>alert(1)</script>' };
    const html = renderSkillDetail(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
