#!/usr/bin/env node
// scripts/sync-registry-v2.mjs
// Uses GitHub Code Search to find skill/agent files across the org at any directory depth.
// Handles deep paths like plugins/dso/skills/*/SKILL.md that v1 misses.
//
// Requires: GITHUB_TOKEN (classic PAT, SSO-authorized for org)
// Usage: node scripts/sync-registry-v2.mjs [--org navapbc] [--output public/registry/index.json]

import { Octokit } from '@octokit/rest';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter, getDescription, slugify } from './utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const ORG = getArg('--org') || process.env.GITHUB_ORG || 'navapbc';
const OUTPUT = getArg('--output') || 'public/registry/index.json';
const VERBOSE = args.includes('--verbose');

if (!process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  request: { headers: { 'X-GitHub-Api-Version': '2026-03-10' } },
});


// Filenames that are generic containers — use parent directory name as the skill name instead.
const GENERIC_FILENAMES = new Set([
  'SKILL.md', 'skill.md', 'CLAUDE.md', 'claude.md',
  'AGENTS.md', 'agents.md', 'AGENT.md', 'agent.md',
  'GEMINI.md', 'gemini.md', 'APPEND_SYSTEM.md', 'append_system.md',
]);

function buildRecord(content, path, repo, meta, body, type, committer) {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const dirName = parts.slice(-2, -1)[0] || '';
  // For generic filenames use the parent dir; for specific filenames (e.g. reference.md) use the stem.
  const stem = (GENERIC_FILENAMES.has(filename) || filename.startsWith('.'))
    ? dirName
    : filename.replace(/\.[^.]+$/, '');
  const name = meta.name || (stem && stem !== repo.name ? stem : repo.name);
  const record = {
    slug: slugify(name),
    name,
    description: meta.description || getDescription(body),
    plugin: slugify(repo.name),
    repo: `${ORG}/${repo.name}`,
    path,
    author: meta.author || repo.owner?.login || ORG,
    committer: committer || null,
    version: meta.version || '1.0.0',
    compatibility: Array.isArray(meta.compatibility) ? meta.compatibility
      : meta.compatibility ? [meta.compatibility] : [],
    sensitive_data: meta.sensitive_data === true || meta.sensitive_data === 'true',
    type,
    content,
    last_updated: repo.pushed_at || committer?.date || null,
  };
  if (type === 'agent') {
    record.tools_used = Array.isArray(meta.tools_used) ? meta.tools_used
      : meta.tools_used ? [meta.tools_used] : [];
    record.human_in_loop = meta.human_in_loop || '';
  }
  return record;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchContent(repoName, path) {
  try {
    const res = await octokit.rest.repos.getContent({ owner: ORG, repo: repoName, path });
    if (res.data.type === 'file') {
      return Buffer.from(res.data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLastCommitter(repoName, path) {
  try {
    const { data } = await octokit.rest.repos.listCommits({ owner: ORG, repo: repoName, path, per_page: 1 });
    if (!data.length) return null;
    const c = data[0];
    return {
      login: c.author?.login || null,
      name: c.commit.author.name,
      avatar_url: c.author?.avatar_url || null,
      date: c.commit.author.date || null,
    };
  } catch {
    return null;
  }
}

async function searchCode(query) {
  const q = `${query} org:${ORG}`;
  const hits = [];
  try {
    for await (const page of octokit.paginate.iterator(octokit.rest.search.code, { q, per_page: 100 })) {
      hits.push(...page.data);
      if (page.data.length === 100) await sleep(2000);
    }
  } catch (err) {
    if (VERBOSE) console.error(`  Search error for "${q}": ${err.message}`);
  }
  return hits;
}

// filename: finds files at any depth; path: narrows to a specific directory
const SKILL_QUERIES = [
  'filename:SKILL.md',
  'filename:skill.md',
  'path:.claude/commands extension:md',
  'path:.claude/skills extension:md',
  'path:.agents/skills extension:md',
  'path:.opencode/skills extension:md',
  'path:.agent/skills extension:md',
  'path:plugins filename:SKILL.md',  // covers DSO: plugins/dso/skills/*/SKILL.md
];

const AGENT_QUERIES = [
  'filename:CLAUDE.md',
  'filename:claude.md',
  'filename:AGENTS.md',
  'filename:agents.md',
  'filename:AGENT.md',
  'filename:agent.md',
  'filename:GEMINI.md',
  'filename:gemini.md',
  'filename:APPEND_SYSTEM.md',
  'filename:append_system.md',
  'filename:.cursorrules',
  'filename:.windsurfrules',
  'filename:copilot-instructions.md path:.github',
  'path:.claude/agents extension:md',
  'path:.cursor/rules',
  'path:.clinerules extension:md',
  'path:.opencode/agents extension:md',
  'path:.agent/rules extension:md',
];

async function main() {
  console.log(`Searching ${ORG} org via GitHub Code Search...`);

  const outputPath = join(ROOT, OUTPUT);
  let existing = { plugins: [], skills: [] };
  try {
    existing = JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch { /* first run */ }

  const skillHits = new Map(); // full_name::path -> hit
  const agentHits = new Map();

  for (const query of SKILL_QUERIES) {
    console.log(`  skills: ${query}`);
    const hits = await searchCode(query);
    for (const hit of hits) skillHits.set(`${hit.repository.full_name}::${hit.path}`, hit);
    if (hits.length) console.log(`    → ${hits.length} hits`);
    await sleep(2000);
  }

  for (const query of AGENT_QUERIES) {
    console.log(`  agents: ${query}`);
    const hits = await searchCode(query);
    for (const hit of hits) agentHits.set(`${hit.repository.full_name}::${hit.path}`, hit);
    if (hits.length) console.log(`    → ${hits.length} hits`);
    await sleep(2000);
  }

  const totalHits = skillHits.size + agentHits.size;
  console.log(`\nFound ${skillHits.size} skill files, ${agentHits.size} agent files — fetching content...\n`);

  const skillMap = new Map(existing.skills.map(s => [`${s.repo}::${s.path}`, s]));
  const pluginMap = new Map(existing.plugins.map(p => [p.repo, p]));
  const updatedPlugins = new Set();
  let fetched = 0;

  async function processHit(hit, type) {
    fetched++;
    const { repository: repo, path } = hit;
    process.stdout.write(`\r[${fetched}/${totalHits}] ${(`${repo.name}/${path}`).slice(0, 76).padEnd(76)}`);

    const content = await fetchContent(repo.name, path);
    if (!content) return;

    const { meta, body } = parseFrontmatter(content);
    const committer = await fetchLastCommitter(repo.name, path);
    const record = buildRecord(content, path, repo, meta, body, type, committer);
    skillMap.set(`${ORG}/${repo.name}::${path}`, record);

    const pluginKey = `${ORG}/${repo.name}`;
    updatedPlugins.add(pluginKey);
    if (!pluginMap.has(pluginKey)) {
      pluginMap.set(pluginKey, {
        slug: slugify(repo.name),
        name: repo.name,
        description: repo.description || '',
        repo: pluginKey,
        author: repo.owner?.login || ORG,
        skill_count: 0,
        agent_count: 0,
        skills: [],
        agents: [],
      });
    }
  }

  for (const hit of skillHits.values()) await processHit(hit, 'skill');
  for (const hit of agentHits.values()) await processHit(hit, 'agent');

  // Recompute counts for repos that gained new entries
  for (const pluginKey of updatedPlugins) {
    const plugin = pluginMap.get(pluginKey);
    if (!plugin) continue;
    const repoSkills = [...skillMap.values()].filter(s => s.repo === pluginKey && s.type === 'skill');
    const repoAgents = [...skillMap.values()].filter(s => s.repo === pluginKey && s.type === 'agent');
    plugin.skill_count = repoSkills.length;
    plugin.agent_count = repoAgents.length;
    plugin.skills = repoSkills.map(s => s.slug);
    plugin.agents = repoAgents.map(a => a.slug);
  }

  const registry = {
    generated_at: new Date().toISOString(),
    org: ORG,
    plugins: [...pluginMap.values()],
    skills: [...skillMap.values()],
  };

  writeFileSync(outputPath, JSON.stringify(registry, null, 2));
  process.stdout.write('\n');
  console.log(`\nRegistry: ${registry.plugins.length} plugins, ${registry.skills.length} skills/agents`);
  console.log(`Wrote ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
