#!/usr/bin/env node
// scripts/sync-registry-v2.mjs
// Uses GitHub Code Search to find skill/agent files across the org at any directory depth.
// Writes results directly to DynamoDB (source of truth).
//
// Requires: GITHUB_TOKEN env var (classic PAT, SSO-authorized for org)
//           AWS credentials with DynamoDB write access
// Usage:
//   node scripts/sync-registry-v2.mjs --env staging
//   node scripts/sync-registry-v2.mjs --env prod
//   node scripts/sync-registry-v2.mjs --env staging --json-output public/registry/index.json

import { Octokit } from '@octokit/rest';
import { writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { parseFrontmatter, getDescription, slugify } from './utils.mjs';

// AWS SDK lives in functions/api/node_modules
const _req = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../functions/api/package.json'));
const { DynamoDBClient } = _req('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, PutCommand } = _req('@aws-sdk/lib-dynamodb');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const ORG = getArg('--org') || process.env.GITHUB_ORG || 'navapbc';
const JSON_OUTPUT = getArg('--json-output'); // optional local JSON backup
const VERBOSE = args.includes('--verbose');

const ENV = getArg('--env') || process.env.SYNC_ENV;
if (!ENV || !['staging', 'prod'].includes(ENV)) {
  console.error('Usage: node scripts/sync-registry-v2.mjs --env <staging|prod> [--json-output path]');
  process.exit(1);
}

const PROJECT = 'skills-registry';
const SKILLS_TABLE  = `${PROJECT}-skills-${ENV}`;
const PLUGINS_TABLE = `${PROJECT}-plugins-${ENV}`;

if (!process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

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

// Paths to exclude — plan documents, templates, and other non-skill files.
const EXCLUDE_PATH_PATTERNS = [
  /^docs\/plans\//,
  /^docs\/superpowers\/plans\//,
  /\.template$/,
  /\.example$/,
];

// Infer compatibility from path when frontmatter doesn't specify it.
function inferCompatibility(path, type) {
  if (type === 'skill') return ['claude-code'];
  if (path.includes('.cursor/') || path.endsWith('.mdc') || path.includes('.cursorrules')) return ['cursor'];
  if (path.includes('copilot-instructions')) return ['github-copilot'];
  return ['claude-code'];
}

// After all records are built, resolve slug collisions:
//  - Same slug, same plugin → merge (combine compatibility, keep richer content)
//  - Same slug, different plugins → prefix each with its plugin slug
function deduplicateRecords(records) {
  const bySlug = new Map();
  for (const r of records) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
    bySlug.get(r.slug).push(r);
  }

  const result = [];
  for (const [slug, group] of bySlug) {
    if (group.length === 1) { result.push(group[0]); continue; }

    // Partition by plugin
    const byPlugin = new Map();
    for (const r of group) {
      if (!byPlugin.has(r.plugin)) byPlugin.set(r.plugin, []);
      byPlugin.get(r.plugin).push(r);
    }

    for (const [plugin, pluginGroup] of byPlugin) {
      // Merge same-plugin duplicates (same skill, different tool dirs e.g. .claude/ vs .cursor/)
      const merged = { ...pluginGroup[0] };
      for (const r of pluginGroup.slice(1)) {
        merged.compatibility = [...new Set([...merged.compatibility, ...r.compatibility])];
        if (r.content.length > merged.content.length) merged.content = r.content;
      }

      // If multiple different plugins share this slug, prefix with plugin name
      if (byPlugin.size > 1) merged.slug = `${plugin}-${slug}`;

      result.push(merged);
    }
  }

  return result;
}

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
    compatibility: Array.isArray(meta.compatibility) && meta.compatibility.length
      ? meta.compatibility
      : meta.compatibility
        ? [meta.compatibility]
        : inferCompatibility(path, type),
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
  if (path.startsWith('enterprise/')) {
    record.source = 'enterprise';
    record.category = meta.category ?? '';
  } else {
    record.category = meta.category ?? '';
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

  const skillMap = new Map();
  const pluginMap = new Map();
  const updatedPlugins = new Set();
  let fetched = 0;

  async function processHit(hit, type) {
    fetched++;
    const { repository: repo, path } = hit;
    process.stdout.write(`\r[${fetched}/${totalHits}] ${(`${repo.name}/${path}`).slice(0, 76).padEnd(76)}`);

    if (EXCLUDE_PATH_PATTERNS.some(p => p.test(path))) return;

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

  // Fetch enterprise/ skills directly from skills-registry repo (bypasses search indexing delay)
  console.log('\nFetching enterprise/ skills directly from skills-registry...');
  try {
    const REGISTRY_REPO = 'skills-registry';
    const { data: repoData } = await octokit.rest.repos.get({ owner: ORG, repo: REGISTRY_REPO });
    const { data: tree } = await octokit.rest.git.getTree({
      owner: ORG, repo: REGISTRY_REPO, tree_sha: 'HEAD', recursive: 'true',
    });
    const enterpriseFiles = tree.tree.filter(
      f => f.type === 'blob' && f.path.startsWith('enterprise/') && f.path.endsWith('/SKILL.md')
    );
    console.log(`  Found ${enterpriseFiles.length} enterprise SKILL.md files`);
    for (const file of enterpriseFiles) {
      const content = await fetchContent(REGISTRY_REPO, file.path);
      if (!content) continue;
      const { meta, body } = parseFrontmatter(content);
      const committer = await fetchLastCommitter(REGISTRY_REPO, file.path);
      const record = buildRecord(content, file.path, repoData, meta, body, 'skill', committer);
      skillMap.set(`${ORG}/${REGISTRY_REPO}::${file.path}`, record);
      updatedPlugins.add(`${ORG}/${REGISTRY_REPO}`);
      console.log(`  ✓ ${record.slug} (source: ${record.source}, category: ${record.category || 'none'})`);
    }
  } catch (err) {
    console.error(`  Warning: could not fetch enterprise skills directly — ${err.message}`);
  }

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

  const skills = deduplicateRecords([...skillMap.values()]);
  const plugins = [...pluginMap.values()];

  process.stdout.write('\n');
  console.log(`\nRegistry: ${plugins.length} plugins, ${skills.length} skills/agents`);
  console.log(`Writing to DynamoDB (${ENV})...\n`);

  const now = new Date().toISOString();
  let skillOk = 0, skillSkipped = 0, skillErr = 0;

  for (const skill of skills) {
    try {
      // Update github-sourced fields; create new record if slug is unseen.
      // Records with source=user-submitted are skipped (ConditionalCheckFailed).
      await ddb.send(new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { slug: skill.slug },
        UpdateExpression: `SET
          #name        = :name,
          description  = :desc,
          plugin       = :plugin,
          repo         = :repo,
          #path        = :path,
          author       = :author,
          committer    = :committer,
          version      = :version,
          compatibility = :compat,
          sensitive_data = :sensitive,
          category     = :category,
          #type        = :type,
          content      = :content,
          last_updated = :updated,
          updated_at   = :now,
          #source      = if_not_exists(#source,      :src),
          #status      = if_not_exists(#status,      :approved),
          visibility   = if_not_exists(visibility,   :public),
          created_by   = if_not_exists(created_by,   :system),
          created_at   = if_not_exists(created_at,   :now)`,
        ExpressionAttributeNames: {
          '#name': 'name', '#path': 'path', '#type': 'type',
          '#status': 'status', '#source': 'source',
        },
        ExpressionAttributeValues: {
          ':name': skill.name, ':desc': skill.description, ':plugin': skill.plugin,
          ':repo': skill.repo, ':path': skill.path, ':author': skill.author,
          ':committer': skill.committer || null, ':version': skill.version || '1.0.0',
          ':compat': skill.compatibility, ':sensitive': skill.sensitive_data ?? false,
          ':type': skill.type, ':content': skill.content,
          ':updated': skill.last_updated || now, ':now': now,
          ':github': 'github', ':approved': 'approved', ':public': 'public', ':system': 'system',
          ':src': skill.source ?? 'github',
          ':enterprise': 'enterprise',
          ':category': skill.category ?? '',
        },
        // Only update existing records if they came from github or enterprise; always create new ones.
        ConditionExpression: 'attribute_not_exists(slug) OR #source = :github OR #source = :enterprise',
      }));
      skillOk++;
      process.stdout.write('.');
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        skillSkipped++; // user-submitted — leave it alone
        process.stdout.write('s');
      } else {
        console.error(`\nError writing skill ${skill.slug}: ${err.message}`);
        skillErr++;
      }
    }
  }

  console.log(`\nSkills: ${skillOk} updated, ${skillSkipped} skipped (user-submitted), ${skillErr} errors`);

  let pluginOk = 0, pluginErr = 0;
  for (const plugin of plugins) {
    try {
      await ddb.send(new PutCommand({
        TableName: PLUGINS_TABLE,
        Item: {
          ...plugin,
          source: 'github',
          status: 'approved',
          visibility: 'public',
          created_by: 'system',
          updated_at: now,
          created_at: now,
          skills_count: plugin.skill_count || 0,
          agents_count: plugin.agent_count || 0,
        },
      }));
      pluginOk++;
      process.stdout.write('.');
    } catch (err) {
      console.error(`\nError writing plugin ${plugin.slug}: ${err.message}`);
      pluginErr++;
    }
  }

  console.log(`\nPlugins: ${pluginOk} updated, ${pluginErr} errors`);

  if (JSON_OUTPUT) {
    const registry = { generated_at: now, org: ORG, plugins, skills };
    writeFileSync(JSON_OUTPUT, JSON.stringify(registry, null, 2));
    console.log(`\nJSON backup written to ${JSON_OUTPUT}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
