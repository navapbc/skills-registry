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

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const ORG = getArg('--org') || process.env.GITHUB_ORG || 'navapbc';
const OUTPUT = getArg('--output') || 'public/registry/index.json';
const LIMIT = parseInt(getArg('--limit') || '365', 10);
const SHALLOW = args.includes('--shallow'); // skip directory scans, root files only
const VERBOSE = args.includes('--verbose');  // print every dir lookup and file check

if (!process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  request: {
    headers: { 'X-GitHub-Api-Version': '2026-03-10' },
  },
});

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
    sort: 'pushed',
    direction: 'desc',
    per_page: 100,
  })) {
    repos.push(...page.data.filter(r => !r.archived && !r.disabled));
    if (repos.length >= LIMIT) break;
  }
  return repos.slice(0, LIMIT);
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
    if (Array.isArray(res.data)) {
      if (VERBOSE) console.log(`    DIR ${path} → [${res.data.map(e => e.name).join(', ')}]`);
      return res.data;
    }
    return [];
  } catch (e) {
    if (VERBOSE) console.log(`    DIR ${path} → ERROR ${e.status}`);
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
    if (VERBOSE) console.log(`    FILE ${path} → ${content ? 'found' : 'miss'}`);
    if (!content) return;
    const { meta, body } = parseFrontmatter(content);
    skills.push(buildSkillRecord(content, path, repo, meta, body));
  }

  async function tryAgent(path) {
    const content = await searchFile(repo, path);
    if (VERBOSE) console.log(`    FILE ${path} → ${content ? 'found' : 'miss'}`);
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

  if (!SHALLOW) {
    // Skill directories — list all *.md/*.mdc files; for subdirs, list their contents too
    for (const dir of SKILL_DIR_LIST) {
      const entries = await listDirectory(repo, dir);
      for (const entry of entries) {
        if (entry.type === 'dir') {
          const subEntries = await listDirectory(repo, entry.path);
          for (const sub of subEntries) {
            if (sub.type === 'file' && /\.(md|mdc)$/i.test(sub.name)) {
              await trySkill(sub.path);
            }
          }
        } else if (entry.type === 'file' && /\.(md|mdc)$/i.test(entry.name)) {
          await trySkill(entry.path);
        }
      }
    }

    // Agent directories — list all *.md/*.mdc files; for subdirs, list their contents too
    for (const dir of AGENT_DIR_LIST) {
      const entries = await listDirectory(repo, dir);
      for (const entry of entries) {
        if (entry.type === 'dir') {
          const subEntries = await listDirectory(repo, entry.path);
          for (const sub of subEntries) {
            if (sub.type === 'file' && /\.(md|mdc)$/i.test(sub.name)) {
              await tryAgent(sub.path);
            }
          }
        } else if (entry.type === 'file' && /\.(md|mdc)$/i.test(entry.name)) {
          await tryAgent(entry.path);
        }
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
  const mode = SHALLOW ? 'shallow (root files only)' : 'deep (root + directories)';
  console.log(`Scanning ${ORG} org — ${mode}, limit ${LIMIT} repos by last push...`);

  const repos = await listOrgRepos();
  const total = repos.length;
  console.log(`Found ${total} repos to scan\n`);

  const debugRepos = (process.env.DEBUG_REPOS || '').split(',').filter(Boolean);
  if (debugRepos.length) {
    const found = repos.filter(r => debugRepos.includes(r.name));
    console.log(`DEBUG: looking for [${debugRepos.join(', ')}] in repo list`);
    console.log(`DEBUG: found: [${found.map(r => r.name).join(', ') || 'NONE — outside limit or not in org'}]\n`);
  }

  const allSkills = [];
  const allAgents = [];
  const plugins = [];
  let scanned = 0;

  for (const repo of repos) {
    scanned++;
    process.stdout.write(`\r[${scanned}/${total}] ${repo.name.padEnd(40)}`);
    if (VERBOSE) process.stdout.write('\n');
    const { skills, agents } = await scanRepo(repo);

    if (skills.length === 0 && agents.length === 0) continue;

    process.stdout.write('\n');
    console.log(`  ✓ ${repo.name}`);
    for (const s of skills) console.log(`      skill  ${s.path}`);
    for (const a of agents) console.log(`      agent  ${a.path}`);

    allSkills.push(...skills);
    allAgents.push(...agents);
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

  const registry = {
    generated_at: new Date().toISOString(),
    org: ORG,
    plugins,
    skills: [...allSkills, ...allAgents],
  };

  const outputPath = join(ROOT, OUTPUT);
  writeFileSync(outputPath, JSON.stringify(registry, null, 2));
  process.stdout.write('\n');
  console.log(`\nScanned ${scanned} repos → ${plugins.length} plugins, ${allSkills.length} skills, ${allAgents.length} agents`);
  console.log(`Wrote ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
