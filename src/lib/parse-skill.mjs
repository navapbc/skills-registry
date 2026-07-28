// Single source of truth for turning SKILL.md frontmatter + body into a record.
// Pure and dependency-light so it runs in both Node (sync scripts) and the browser
// (admin validator). Low-level string helpers live in scripts/utils.mjs and are
// re-exported here so consumers have one import.

import { parseFrontmatter, getDescription, slugify } from '../../scripts/utils.mjs';
import { SkillSchema } from './registry-schema.mjs';
import { checkFormConstraints } from './form-constraints.mjs';

export { parseFrontmatter, getDescription, slugify };

const DEFAULT_ORG = 'navapbc';

// Filenames that are generic containers — use the parent directory name instead.
const GENERIC_FILENAMES = new Set([
  'SKILL.md', 'skill.md', 'CLAUDE.md', 'claude.md',
  'AGENTS.md', 'agents.md', 'AGENT.md', 'agent.md',
  'GEMINI.md', 'gemini.md', 'APPEND_SYSTEM.md', 'append_system.md',
]);

// Infer compatibility from path when frontmatter doesn't specify it.
export function inferCompatibility(path, type) {
  if (type === 'skill') return ['claude-code'];
  if (!path) return ['claude-code'];
  if (path.includes('.cursor/') || path.endsWith('.mdc') || path.includes('.cursorrules')) return ['cursor'];
  if (path.includes('copilot-instructions')) return ['github-copilot'];
  return ['claude-code'];
}

// Normalize a value to an array (or undefined when empty/absent).
export function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return undefined;
  return [value];
}

// Derive the skill name from frontmatter, else path, else repo name.
export function deriveName(meta, path, repoName) {
  if (meta.name) return meta.name;
  if (path) {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    const dirName = parts.slice(-2, -1)[0] || '';
    const stem = (GENERIC_FILENAMES.has(filename) || filename.startsWith('.'))
      ? dirName
      : filename.replace(/\.[^.]+$/, '');
    if (stem && stem !== repoName) return stem;
  }
  return repoName || 'untitled';
}

/**
 * Build a skill/agent record from parsed frontmatter + body.
 * @param {object} opts
 * @param {object} opts.meta      parsed frontmatter
 * @param {string} opts.body      markdown body (frontmatter stripped)
 * @param {string} opts.content   full raw file (stored verbatim)
 * @param {object|null} [opts.repo]      { name, owner?, pushed_at? } — omit in validator
 * @param {string|null} [opts.path]      file path in repo — omit in validator
 * @param {object|null} [opts.committer] committer object — omit in validator
 * @param {'skill'|'agent'} [opts.type='skill']
 * @param {string} [opts.org]
 */
export function buildSkillRecord({ meta = {}, body = '', content = '', repo = null, path = null, committer = null, type = 'skill', org = DEFAULT_ORG } = {}) {
  const repoName = repo?.name ?? null;
  const name = deriveName(meta, path, repoName);

  const record = {
    slug: slugify(meta.slug || name),
    name,
    description: meta.description || getDescription(body),
    plugin: repoName ? slugify(repoName) : 'preview',
    repo: repoName ? `${org}/${repoName}` : 'org/repo',
    path: path || 'SKILL.md',
    author: meta.author || repo?.owner?.login || org,
    committer: committer || null,
    version: meta.version || '1.0.0',
    compatibility: normalizeArray(meta.compatibility) || inferCompatibility(path, type),
    sensitive_data: meta.sensitive_data === true || meta.sensitive_data === 'true',
    type,
    content,
    last_updated: committer?.date || repo?.pushed_at || null,
  };

  if (type === 'agent') {
    record.tools_used = normalizeArray(meta.tools_used) || [];
    record.human_in_loop = meta.human_in_loop || '';
  }

  if (path && path.startsWith('enterprise/')) record.source = 'enterprise';

  // `category` and `tags` are intentionally NOT read from frontmatter. They are
  // admin-owned fields managed in the admin panel and stored only in DynamoDB
  // (same model as `visibility`). A `category:`/`tags:` key in frontmatter is
  // ignored here and surfaced as admin-managed by the validator (see
  // ADMIN_MANAGED_KEYS and analyzeSkillFile).

  // Optional submission metadata + author name — included only when present.
  if (meta.author_name) record.author_name = meta.author_name;
  if (meta.team) record.team = meta.team;
  if (meta.problem) record.problem = meta.problem;
  if (meta.impact_type) record.impact_type = normalizeArray(meta.impact_type);
  if (meta.estimated_impact) record.estimated_impact = meta.estimated_impact;
  if (meta.usage_frequency) record.usage_frequency = meta.usage_frequency;
  if (meta.expected_audience) record.expected_audience = meta.expected_audience;
  if (meta.data_sources) record.data_sources = meta.data_sources;

  return record;
}

// Keys that the pipeline (sync/API), not the author's file, populates.
const PIPELINE_KEYS = new Set(['repo', 'path', 'plugin', 'committer', 'last_updated', 'source', 'content']);

// Frontmatter keys the registry understands. Anything else is ignored.
// `category` and `tags` stay listed here so a stray key is NOT mis-flagged as a
// typo (see nearestKey) — but they are admin-managed, not read into the record
// (see ADMIN_MANAGED_KEYS and buildSkillRecord).
export const RECOGNIZED_KEYS = new Set([
  'name', 'slug', 'description', 'version', 'author', 'author_name',
  'compatibility', 'sensitive_data', 'type', 'tags', 'category',
  'tools_used', 'human_in_loop',
  'team', 'problem', 'impact_type', 'estimated_impact',
  'usage_frequency', 'expected_audience', 'data_sources',
]);

// Fields that are owned and edited in the admin panel (stored only in DynamoDB),
// not authored in SKILL.md frontmatter. A frontmatter key here is recognized but
// ignored — the validator surfaces it as admin-managed rather than dropping it
// silently or suggesting a typo correction.
export const ADMIN_MANAGED_KEYS = new Set(['category', 'tags']);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

// Nearest recognized key for an unrecognized one, or null if nothing close.
export function nearestKey(key) {
  // Legacy nava_* keys map straight to their stripped name.
  if (key.startsWith('nava_') && RECOGNIZED_KEYS.has(key.slice(5))) return key.slice(5);
  let best = null, bestDist = Infinity;
  for (const candidate of RECOGNIZED_KEYS) {
    const dist = levenshtein(key, candidate);
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return bestDist <= 3 ? best : null;
}

function fieldSource(key, meta) {
  if (PIPELINE_KEYS.has(key)) return 'pipeline';
  switch (key) {
    case 'slug': return meta.slug ? 'frontmatter' : 'derived';
    case 'name': return meta.name ? 'frontmatter' : 'derived';
    case 'description': return meta.description ? 'frontmatter' : 'derived';
    case 'author': return meta.author ? 'frontmatter' : 'defaulted';
    case 'version': return meta.version ? 'frontmatter' : 'defaulted';
    case 'type': return meta.type ? 'frontmatter' : 'defaulted';
    case 'compatibility': return meta.compatibility ? 'frontmatter' : 'defaulted';
    case 'sensitive_data': return meta.sensitive_data !== undefined ? 'frontmatter' : 'defaulted';
    default: return 'frontmatter'; // optional fields only exist when present in meta
  }
}

/**
 * Analyze raw SKILL.md text for the validator UI.
 * @returns {{ meta, body, record, fields, ignored, validation, warnings }}
 */
export function analyzeSkillFile(rawContent) {
  const { meta, body } = parseFrontmatter(rawContent || '');
  const type = meta.type === 'agent' ? 'agent' : 'skill';
  const record = buildSkillRecord({ meta, body, content: rawContent || '', type });

  const fields = Object.entries(record).map(([key, value]) => ({
    key, value, source: fieldSource(key, meta),
  }));

  const ignored = Object.keys(meta)
    .filter(k => !RECOGNIZED_KEYS.has(k))
    .map(k => ({ key: k, suggestion: nearestKey(k) }));

  // Recognized-but-ignored admin-owned keys present in the frontmatter. Surfaced
  // separately so the validator can explain they are managed in the admin panel.
  const adminManaged = Object.keys(meta).filter(k => ADMIN_MANAGED_KEYS.has(k));

  const parsed = SkillSchema.safeParse(record);
  const validation = parsed.success
    ? { valid: true, errors: [] }
    : {
        valid: false,
        errors: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      };

  const warnings = checkFormConstraints(record, meta);

  return { meta, body, record, fields, ignored, adminManaged, validation, warnings };
}
