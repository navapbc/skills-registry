#!/usr/bin/env node
// scripts/sync-registry.mjs
// Scans the navapbc GitHub org for SKILL.md, AGENT.md, and agents/* files.
// Builds registry/index.json from the discovered frontmatter.
//
// Requires: GITHUB_TOKEN env var with read:org and read:contents scopes
// Usage: node scripts/sync-registry.mjs [--org navapbc] [--output registry/index.json]

import { Octokit } from '@octokit/rest';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const ORG = args[args.indexOf('--org') + 1] || process.env.GITHUB_ORG || 'navapbc';
const OUTPUT = args[args.indexOf('--output') + 1] || 'public/registry/index.json';

if (!process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// --- Frontmatter parser (no dependencies needed) ---
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Simple YAML array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/["']/g, ''));
    } else {
      value = value.replace(/["']/g, '');
      if (value === 'true') value = true;
      if (value === 'false') value = false;
    }

    meta[key] = value;
  }

  return { meta, body: content.slice(match[0].length).trim() };
}

function getDescription(body) {
  // Use first non-empty line after frontmatter as description fallback
  const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines[0]?.trim() || '';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- GitHub API helpers ---
async function listOrgRepos() {
  const repos = [];
  for await (const page of octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
    org: ORG,
    type: 'all',
    per_page: 100,
  })) {
    repos.push(...page.data.filter(r => !r.archived && !r.disabled));
  }
  return repos;
}

async function searchFile(repo, path) {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: ORG,
      repo: repo.name,
      path,
    });
    if (res.data.type === 'file') {
      return Buffer.from(res.data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

async function listDirectory(repo, path) {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: ORG,
      repo: repo.name,
      path,
    });
    if (Array.isArray(res.data)) return res.data;
    return [];
  } catch {
    return [];
  }
}

// Exact paths treated as agent configs regardless of extension (including extension-less)
const AGENT_FULL_PATHS = [
  '.github/copilot-instructions.md',
  '.cursorrules',       // Cursor legacy
  '.windsurfrules',     // Windsurf
  '.pi/SYSTEM.md',      // Pi
];

// Skill directories: any *.md or *.mdc child is a skill
const SKILL_DIR_LIST = [
  '.claude/commands', '.claude/skills',
  '.agents/skills', '.opencode/skills',
  '.agent/skills',
  'skills',
];

// Agent directories: any *.md or *.mdc child is an agent/rules file
const AGENT_DIR_LIST = [
  '.claude/agents',
  '.cursor/rules',      // Cursor (.mdc files)
  '.clinerules',        // Cline
  '.opencode/agents',   // OpenCode
  '.agent/rules',       // Antigravity
  'agents',
];

function buildSkillRecord(content, path, repo, meta, body) {
  const name = meta.name || path.split('/').slice(-2, -1)[0] || repo.name;
  return {
    slug: slugify(name),
    name,
    description: meta.description || getDescription(body),
    plugin: slugify(repo.name),
    repo: `${ORG}/${repo.name}`,
    path,
    author: meta.author || repo.owner?.login || ORG,
    version: meta.version || '1.0.0',
    compatibility: Array.isArray(meta.compatibility)
      ? meta.compatibility
      : meta.compatibility ? [meta.compatibility] : [],
    sensitive_data: meta.sensitive_data === true || meta.sensitive_data === 'true',
    type: 'skill',
    content,
    last_updated: repo.pushed_at,
  };
}

function buildAgentRecord(content, path, repo, meta, body) {
  const name = meta.name || path.split('/').slice(-2, -1)[0] || repo.name;
  return {
    slug: slugify(name),
    name,
    description: meta.description || getDescription(body),
    plugin: slugify(repo.name),
    repo: `${ORG}/${repo.name}`,
    path,
    author: meta.author || repo.owner?.login || ORG,
    version: meta.version || '1.0.0',
    compatibility: Array.isArray(meta.compatibility)
      ? meta.compatibility
      : meta.compatibility ? [meta.compatibility] : [],
    sensitive_data: meta.sensitive_data === true || meta.sensitive_data === 'true',
    type: 'agent',
    tools_used: Array.isArray(meta.tools_used)
      ? meta.tools_used
      : meta.tools_used ? [meta.tools_used] : [],
    human_in_loop: meta.human_in_loop || '',
    content,
    last_updated: repo.pushed_at,
  };
}

// --- Main scan ---
async function scanRepo(repo) {
  const skills = [];
  const agents = [];

  async function trySkill(path) {
    const content = await searchFile(repo, path);
    if (!content) return;
    const { meta, body } = parseFrontmatter(content);
    skills.push(buildSkillRecord(content, path, repo, meta, body));
  }

  async function tryAgent(path) {
    const content = await searchFile(repo, path);
    if (!content) return;
    const { meta, body } = parseFrontmatter(content);
    agents.push(buildAgentRecord(content, path, repo, meta, body));
  }

  // Root-level skill files (common casings)
  for (const name of ['SKILL.md', 'skill.md', 'SKILLS.md', 'skills.md']) {
    await trySkill(name);
  }

  // Root-level agent files — Claude Code, Codex, Antigravity, Pi
  for (const name of [
    'AGENTS.md', 'agents.md',
    'AGENTS.override.md', 'agents.override.md',
    'AGENT.md', 'agent.md',
    'CLAUDE.md', 'claude.md',
    'GEMINI.md', 'gemini.md',
    'APPEND_SYSTEM.md', 'append_system.md',
  ]) {
    await tryAgent(name);
  }

  // Exact-path agent configs (extension-less or known fixed paths)
  for (const path of AGENT_FULL_PATHS) await tryAgent(path);

  // .claude/CLAUDE.md (hidden Claude Code config)
  await tryAgent('.claude/CLAUDE.md');

  // Skill directories — *.md and *.mdc children, subdirs try standard SKILL.md names
  for (const dir of SKILL_DIR_LIST) {
    const entries = await listDirectory(repo, dir);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        for (const name of ['SKILL.md', 'skill.md', 'SKILLS.md', 'skills.md']) {
          await trySkill(`${entry.path}/${name}`);
        }
      } else if (entry.type === 'file' && /\.(md|mdc)$/i.test(entry.name)) {
        await trySkill(entry.path);
      }
    }
  }

  // Agent directories — *.md and *.mdc children (includes Cursor .cursor/rules/*.mdc)
  for (const dir of AGENT_DIR_LIST) {
    const entries = await listDirectory(repo, dir);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        for (const name of ['AGENT.md', 'agent.md', 'AGENTS.md', 'agents.md']) {
          await tryAgent(`${entry.path}/${name}`);
        }
      } else if (entry.type === 'file' && /\.(md|mdc)$/i.test(entry.name)) {
        await tryAgent(entry.path);
      }
    }
  }

  // Deduplicate by path (multiple casing attempts may hit same file)
  const seenPaths = new Set();
  const uniqueSkills = skills.filter(s => !seenPaths.has(s.path) && seenPaths.add(s.path));
  seenPaths.clear();
  const uniqueAgents = agents.filter(a => !seenPaths.has(a.path) && seenPaths.add(a.path));

  return { skills: uniqueSkills, agents: uniqueAgents };
}

async function main() {
  console.log(`Scanning ${ORG} org...`);

  const repos = await listOrgRepos();
  console.log(`Found ${repos.length} active repos`);

  const allSkills = [];
  const allAgents = [];
  const plugins = [];

  for (const repo of repos) {
    process.stdout.write(`  Scanning ${repo.name}...`);
    const { skills, agents } = await scanRepo(repo);

    if (skills.length === 0 && agents.length === 0) {
      console.log(' skip');
      continue;
    }

    console.log(` ${skills.length} skill(s), ${agents.length} agent(s)`);

    allSkills.push(...skills);
    allAgents.push(...agents);

    if (skills.length > 0 || agents.length > 0) {
      plugins.push({
        slug: slugify(repo.name),
        name: repo.name,
        description: repo.description || '',
        repo: `${ORG}/${repo.name}`,
        author: repo.owner?.login || ORG,
        skill_count: skills.length,
        agent_count: agents.length,
        skills: skills.map(s => s.slug),
        agents: agents.map(a => a.slug),
      });
    }
  }

  const registry = {
    generated_at: new Date().toISOString(),
    org: ORG,
    plugins,
    skills: [...allSkills, ...allAgents],
  };

  const outputPath = join(ROOT, OUTPUT);
  writeFileSync(outputPath, JSON.stringify(registry, null, 2));
  console.log(`\nWrote ${plugins.length} plugins, ${allSkills.length} skills, ${allAgents.length} agents to ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
