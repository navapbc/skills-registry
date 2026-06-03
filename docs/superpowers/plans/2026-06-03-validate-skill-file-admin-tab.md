# Validate Skill File — `/admin` Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Validate" tab to `/admin` that turns pasted `SKILL.md` content into a live preview of the extracted record (captured fields, defaults, pipeline-only fields, ignored keys) plus a schema pass/fail — backed by a shared parse/record module so it can never drift from the real sync pipeline.

**Architecture:** Extract the frontmatter→record mapping (currently inlined in both sync scripts) into one browser- and node-safe module `src/lib/parse-skill.mjs`. Both sync scripts and the new validator call it. The validator runs entirely client-side in the existing vanilla-JS admin page. Alongside this, the seven `nava_*` schema fields are renamed to unprefixed canonical names and two new frontmatter fields (`author_name`, `tags`) are captured.

**Tech Stack:** Astro (vanilla-JS islands), Zod, Vitest, Node ESM.

**Spec:** `docs/superpowers/specs/2026-06-03-validate-skill-file-admin-tab-design.md`

---

## File Structure

**Create:**
- `src/lib/parse-skill.mjs` — single source of truth for frontmatter→record mapping (`buildSkillRecord`), the validator analysis (`analyzeSkillFile`), and supporting pure helpers (`inferCompatibility`, `deriveName`, `normalizeArray`, `nearestKey`). Re-exports `parseFrontmatter`/`getDescription`/`slugify` from `scripts/utils.mjs`.
- `tests/parse-skill.test.mjs` — unit tests for `buildSkillRecord` and `analyzeSkillFile`.

**Modify:**
- `src/lib/registry-schema.mjs` — rename `nava_*` → unprefixed; add `author_name`, `tags`.
- `scripts/sync-registry-v2.mjs` — delegate `buildRecord` to shared `buildSkillRecord`; drop local `inferCompatibility` / `GENERIC_FILENAMES` / `buildRecord`.
- `scripts/sync-registry.mjs` — delegate `buildSkillRecord` / `buildAgentRecord` to shared builder.
- `src/lib/render.mjs` — rename `nava_*` reads in `renderNavaMetaSection`.
- `src/pages/admin/index.astro` — add Validate tab (button, panel, `loadValidate`, wiring).
- `tests/registry.test.mjs` — rename `nava_*` fixtures; add `author_name`/`tags` cases.
- `tests/api/routes/skills.test.mjs` — rename `nava_*` round-trip fields.

**Field rename map (canonical = unprefixed):**

| Old | New |
|---|---|
| `nava_team` | `team` |
| `nava_problem` | `problem` |
| `nava_impact_type` | `impact_type` |
| `nava_estimated_impact` | `estimated_impact` |
| `nava_usage_frequency` | `usage_frequency` |
| `nava_expected_audience` | `expected_audience` |
| `nava_data_sources` | `data_sources` |

---

## Task 1: Schema rename + new optional fields

**Files:**
- Modify: `src/lib/registry-schema.mjs:28-35`
- Test: `tests/registry.test.mjs:91-127`

- [ ] **Step 1: Update the schema test fixtures to the new field names**

In `tests/registry.test.mjs`, replace the entire `describe('SkillSchema — nava_ optional fields', …)` block (lines 91-127) with:

```javascript
describe('SkillSchema — optional submission + author/tags fields', () => {
  const baseValid = {
    slug: 'test', name: 'Test', description: 'desc',
    plugin: 'p', repo: 'org/repo', path: 'SKILL.md',
    author: 'a', version: '1.0.0', compatibility: [],
    sensitive_data: false, type: 'skill', content: '',
    last_updated: null,
  };

  it('passes with no optional fields present', () => {
    expect(SkillSchema.safeParse(baseValid).success).toBe(true);
  });

  it('passes with all optional fields present', () => {
    const full = {
      ...baseValid,
      author_name: 'Diana Olympia',
      tags: ['writing', 'meeting-prep'],
      team: 'Business Development',
      problem: 'Manual reporting took 2 hours',
      impact_type: ['Time saved per use', 'Reduced error rate or rework'],
      estimated_impact: 'Saves ~45 min per use',
      usage_frequency: 'A few times per week',
      expected_audience: '6-15 people',
      data_sources: 'Google Docs, Jira',
    };
    expect(SkillSchema.safeParse(full).success).toBe(true);
  });

  it('passes with some optional fields present', () => {
    const partial = { ...baseValid, team: 'Design', estimated_impact: 'Saves 1 hour' };
    expect(SkillSchema.safeParse(partial).success).toBe(true);
  });

  it('fails when impact_type is not an array', () => {
    const bad = { ...baseValid, impact_type: 42 };
    expect(SkillSchema.safeParse(bad).success).toBe(false);
  });

  it('fails when tags is not an array', () => {
    const bad = { ...baseValid, tags: 'writing' };
    expect(SkillSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/registry.test.mjs -t "optional submission"`
Expected: FAIL — the "all optional fields present" case fails because the schema still defines `nava_*` (unknown keys are stripped, so it actually passes) and the "fails when tags is not an array" case fails because `tags` isn't in the schema yet (unknown key stripped → parse succeeds → `toBe(false)` fails).

- [ ] **Step 3: Rename the fields in the schema and add `author_name` + `tags`**

In `src/lib/registry-schema.mjs`, replace lines 28-35 (the `// nava submission metadata …` comment through `nava_data_sources`) with:

```javascript
  // author display name + tags — optional, read from SKILL.md frontmatter
  author_name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // submission metadata — optional, from SKILL.md frontmatter (Google Form → Zapier)
  team: z.string().optional(),
  problem: z.string().optional(),
  impact_type: z.array(z.string()).optional(),
  estimated_impact: z.string().optional(),
  usage_frequency: z.string().optional(),
  expected_audience: z.string().optional(),
  data_sources: z.string().optional(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/registry.test.mjs`
Expected: PASS (all describe blocks in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/registry-schema.mjs tests/registry.test.mjs
git commit -m "feat(schema): rename nava_ fields to unprefixed; add author_name + tags"
```

---

## Task 2: Shared `buildSkillRecord` module

Create the shared builder with a single options-object signature so it works both at sync time (full GitHub context) and in the validator (no context). This task only covers `buildSkillRecord` + pure helpers; `analyzeSkillFile` comes in Task 3.

**Files:**
- Create: `src/lib/parse-skill.mjs`
- Test: `tests/parse-skill.test.mjs`

- [ ] **Step 1: Write the failing tests for `buildSkillRecord`**

Create `tests/parse-skill.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildSkillRecord, parseFrontmatter } from '../src/lib/parse-skill.mjs';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/parse-skill.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/parse-skill.mjs'`.

- [ ] **Step 3: Create the shared module**

Create `src/lib/parse-skill.mjs`:

```javascript
// Single source of truth for turning SKILL.md frontmatter + body into a record.
// Pure and dependency-light so it runs in both Node (sync scripts) and the browser
// (admin validator). Low-level string helpers live in scripts/utils.mjs and are
// re-exported here so consumers have one import.

import { parseFrontmatter, getDescription, slugify } from '../../scripts/utils.mjs';

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
  record.category = meta.category ?? '';

  // Optional submission metadata + author/tags — included only when present.
  if (meta.author_name) record.author_name = meta.author_name;
  if (meta.tags) record.tags = normalizeArray(meta.tags);
  if (meta.team) record.team = meta.team;
  if (meta.problem) record.problem = meta.problem;
  if (meta.impact_type) record.impact_type = normalizeArray(meta.impact_type);
  if (meta.estimated_impact) record.estimated_impact = meta.estimated_impact;
  if (meta.usage_frequency) record.usage_frequency = meta.usage_frequency;
  if (meta.expected_audience) record.expected_audience = meta.expected_audience;
  if (meta.data_sources) record.data_sources = meta.data_sources;

  return record;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/parse-skill.test.mjs`
Expected: PASS (both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse-skill.mjs tests/parse-skill.test.mjs
git commit -m "feat(parse): shared buildSkillRecord for sync + validator"
```

---

## Task 3: `analyzeSkillFile` (validator analysis)

Adds the pure analysis function the validator UI consumes: field provenance, ignored-key detection with did-you-mean, and schema validation.

**Files:**
- Modify: `src/lib/parse-skill.mjs` (append)
- Test: `tests/parse-skill.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/parse-skill.test.mjs`:

```javascript
import { analyzeSkillFile } from '../src/lib/parse-skill.mjs';

describe('analyzeSkillFile', () => {
  it('reports a valid sample file as valid', () => {
    const out = analyzeSkillFile(SAMPLE);
    expect(out.validation.valid).toBe(true);
    expect(out.validation.errors).toEqual([]);
  });

  it('tags field sources: frontmatter vs derived vs defaulted vs pipeline', () => {
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

  it('reports schema errors for invalid input', () => {
    const out = analyzeSkillFile(`---\nname: x\nimpact_type: 42\n---\n\nbody`);
    // impact_type: 42 is a scalar → normalized to ['42'] so it stays valid;
    // instead assert a genuinely invalid case: missing name yields empty name.
    const bad = analyzeSkillFile(`---\ndescription: only desc\n---\n\nbody`);
    expect(bad.validation.valid).toBe(false);
    expect(bad.validation.errors.some(e => e.path === 'name')).toBe(true);
  });
});
```

Note: `name` becomes `'untitled'` only when there's no name AND no path/repo — but `deriveName` returns `'untitled'`, which is a non-empty string and passes `z.string().min(1)`. To make the "missing name" case fail validation, `analyzeSkillFile` must NOT substitute `'untitled'`; see Step 3 where the validator passes the raw derived name through and lets an empty frontmatter name surface. Adjust: in context-free analysis, when `meta.name` is absent and no path/repo, `deriveName` returns `'untitled'`. So the final assertion above would FAIL. Replace that last `it` block with the deterministic invalid case below instead:

```javascript
  it('reports schema errors for invalid input (impact_type as object)', () => {
    const bad = analyzeSkillFile(`---\nname: x\nimpact_type:\n  not: array\n---\n\nbody`);
    expect(bad.validation.valid).toBe(false);
    expect(bad.validation.errors.some(e => e.path === 'impact_type')).toBe(true);
  });
```

(`impact_type` parsed as an object/map is not an array and not a scalar string → `normalizeArray` returns it unchanged → Zod `z.array(z.string())` rejects it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/parse-skill.test.mjs -t analyzeSkillFile`
Expected: FAIL — `analyzeSkillFile is not a function` / not exported.

- [ ] **Step 3: Implement `analyzeSkillFile` and helpers**

Append to `src/lib/parse-skill.mjs`:

```javascript
import { SkillSchema } from './registry-schema.mjs';

// Keys that the pipeline (sync/API), not the author's file, populates.
const PIPELINE_KEYS = new Set(['repo', 'path', 'plugin', 'committer', 'last_updated', 'source', 'content']);

// Frontmatter keys the registry understands. Anything else is ignored.
export const RECOGNIZED_KEYS = new Set([
  'name', 'slug', 'description', 'version', 'author', 'author_name',
  'compatibility', 'sensitive_data', 'type', 'tags', 'category',
  'tools_used', 'human_in_loop',
  'team', 'problem', 'impact_type', 'estimated_impact',
  'usage_frequency', 'expected_audience', 'data_sources',
]);

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
    case 'category': return meta.category ? 'frontmatter' : 'defaulted';
    case 'sensitive_data': return meta.sensitive_data !== undefined ? 'frontmatter' : 'defaulted';
    default: return 'frontmatter'; // optional fields only exist when present in meta
  }
}

/**
 * Analyze raw SKILL.md text for the validator UI.
 * @returns {{ meta, body, record, fields, ignored, validation }}
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

  const parsed = SkillSchema.safeParse(record);
  const validation = parsed.success
    ? { valid: true, errors: [] }
    : {
        valid: false,
        errors: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      };

  return { meta, body, record, fields, ignored, validation };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/parse-skill.test.mjs`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse-skill.mjs tests/parse-skill.test.mjs
git commit -m "feat(parse): analyzeSkillFile with provenance, ignored-key + schema checks"
```

---

## Task 4: Refactor `sync-registry-v2.mjs` to use the shared builder

**Files:**
- Modify: `scripts/sync-registry-v2.mjs:18` (import), `:62-83` (delete local helpers), `:124-165` (delete `buildRecord`), `:288` and `:328` (call sites)

- [ ] **Step 1: Update the import line**

Replace line 18:

```javascript
import { parseFrontmatter, getDescription, slugify } from './utils.mjs';
```

with:

```javascript
import { parseFrontmatter, slugify } from './utils.mjs';
import { buildSkillRecord } from '../src/lib/parse-skill.mjs';
```

(`getDescription` is no longer used directly here — it's used inside the shared builder.)

- [ ] **Step 2: Delete the now-shared local helpers**

Delete `GENERIC_FILENAMES` (lines 62-67), `inferCompatibility` (lines 77-83), and the entire `buildRecord` function (lines 124-165). Leave `EXCLUDE_PATH_PATTERNS` and `deduplicateRecords` in place.

- [ ] **Step 3: Update the two `buildRecord` call sites**

At the former line 288 (inside `processHit`), replace:

```javascript
    const record = buildRecord(content, path, repo, meta, body, type, committer);
```

with:

```javascript
    const record = buildSkillRecord({ meta, body, content, repo, path, committer, type, org: ORG });
```

At the former line 328 (enterprise fetch loop), replace:

```javascript
      const record = buildRecord(content, file.path, repoData, meta, body, 'skill', committer);
```

with:

```javascript
      const record = buildSkillRecord({ meta, body, content, repo: repoData, path: file.path, committer, type: 'skill', org: ORG });
```

- [ ] **Step 4: Verify the script still parses (no runtime sync needed)**

Run: `node --check scripts/sync-registry-v2.mjs`
Expected: no output, exit 0 (syntax OK). The full sync requires GITHUB_TOKEN + AWS creds and is not run here.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-registry-v2.mjs
git commit -m "refactor(sync-v2): delegate record building to shared buildSkillRecord"
```

---

## Task 5: Refactor `sync-registry.mjs` to use the shared builder

This makes v1 and v2 produce identical records. Note two intentional behavior changes for v1, both improvements toward parity: missing `compatibility` is now inferred (was `[]`), and records gain a `committer: null` field. These match v2/the schema.

**Files:**
- Modify: `scripts/sync-registry.mjs` (imports near top; `buildSkillRecord`/`buildAgentRecord` at `:156-214`)

- [ ] **Step 1: Add the shared import**

Near the other imports at the top of `scripts/sync-registry.mjs`, add:

```javascript
import { buildSkillRecord as buildSharedRecord } from '../src/lib/parse-skill.mjs';
```

- [ ] **Step 2: Replace both builder bodies with thin delegating wrappers**

Replace the entire `buildSkillRecord` (lines 156-182) and `buildAgentRecord` (lines 184-214) with:

```javascript
function buildSkillRecord(content, path, repo, meta, body) {
  return buildSharedRecord({ meta, body, content, repo, path, type: 'skill', org: ORG });
}

function buildAgentRecord(content, path, repo, meta, body) {
  return buildSharedRecord({ meta, body, content, repo, path, type: 'agent', org: ORG });
}
```

- [ ] **Step 3: Verify the script still parses**

Run: `node --check scripts/sync-registry.mjs`
Expected: no output, exit 0.

- [ ] **Step 4: Run the full test suite (nothing should regress)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-registry.mjs
git commit -m "refactor(sync): delegate v1 builders to shared buildSkillRecord"
```

---

## Task 6: Rename `nava_*` reads in the detail-page render

**Files:**
- Modify: `src/lib/render.mjs:126-161` (`renderNavaMetaSection`)

- [ ] **Step 1: Rename the field reads**

In `src/lib/render.mjs`, replace the body of `renderNavaMetaSection` (lines 126-161) so every `skill.nava_X` becomes `skill.X`:

```javascript
function renderNavaMetaSection(skill) {
  const hasAny = skill.team || skill.problem || (Array.isArray(skill.impact_type) && skill.impact_type.length > 0)
    || skill.estimated_impact || skill.usage_frequency
    || skill.expected_audience || skill.data_sources;
  if (!hasAny) return '';

  const row = (label, value) => value
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">${label}</dt>
        <dd class="text-xs text-gray-700 m-0">${escapeHtml(value)}</dd>
      </div>`
    : '';

  const impactChips = Array.isArray(skill.impact_type) && skill.impact_type.length
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">Impact type</dt>
        <dd class="flex flex-wrap gap-1 m-0">
          ${skill.impact_type.map(t => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">${escapeHtml(t)}</span>`).join('')}
        </dd>
      </div>`
    : '';

  return `
    <div class="bg-white border border-gray-200 rounded-lg p-4" data-testid="nava-detail-section">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Submission Details</h3>
      <dl class="space-y-2 m-0">
        ${row('Team', skill.team)}
        ${row('Problem solved', skill.problem)}
        ${impactChips}
        ${row('Estimated impact', skill.estimated_impact)}
        ${row('Usage frequency', skill.usage_frequency)}
        ${row('Expected audience', skill.expected_audience)}
        ${row('Data sources', skill.data_sources)}
      </dl>
    </div>`;
}
```

- [ ] **Step 2: Confirm no other `nava_` references remain**

Run: `grep -rn "nava_" src/ scripts/ tests/`
Expected: no matches (all renamed). If any remain, rename them to the unprefixed form.

- [ ] **Step 3: Run the test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/render.mjs
git commit -m "refactor(render): read unprefixed submission metadata fields"
```

---

## Task 7: Update the API round-trip test field names

The API route passes unknown fields through via `...body`, so no route change is needed — only the test's field names change.

**Files:**
- Modify: `tests/api/routes/skills.test.mjs:517-549`

- [ ] **Step 1: Rename the fields in the round-trip test**

In the `describe('POST /api/skills — nava_ optional fields round-trip', …)` block, rename the describe title to `'POST /api/skills — optional submission fields round-trip'`, then in the POST body (lines ~532-538) and the assertions (lines ~543-548) replace each `nava_X` with `X`:

Body:
```javascript
          team: 'Engineering',
          problem: 'Manual reporting took hours',
          impact_type: ['Time saved per use'],
          estimated_impact: 'Saves ~45 min',
          usage_frequency: 'Daily',
          expected_audience: '16+ people / org-wide',
          data_sources: 'Google Docs',
```

Assertions:
```javascript
      expect(capturedItem?.team).toBe('Engineering');
      expect(capturedItem?.problem).toBe('Manual reporting took hours');
      expect(capturedItem?.impact_type).toEqual(['Time saved per use']);
      expect(capturedItem?.estimated_impact).toBe('Saves ~45 min');
      expect(capturedItem?.usage_frequency).toBe('Daily');
      expect(capturedItem?.expected_audience).toBe('16+ people / org-wide');
      expect(capturedItem?.data_sources).toBe('Google Docs');
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/api/routes/skills.test.mjs -t "round-trip"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/routes/skills.test.mjs
git commit -m "test(skills-api): rename round-trip fields to unprefixed names"
```

---

## Task 8: Add the Validate tab to `/admin`

Wire a new tab into the existing vanilla-JS tab system and render the analysis client-side.

**Files:**
- Modify: `src/pages/admin/index.astro` — nav (`:24-32`), panels (`:35-41`), `<script>` import (`:45-46`), `loadTab` (`:220-234`), and add `loadValidate` + a render helper.

- [ ] **Step 1: Add the tab button**

In the `<nav>` (after the `categories` button, line 29), add:

```html
      <button data-tab="validate"    class="tab-btn px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 transition-colors">Validate</button>
```

- [ ] **Step 2: Add the tab panel**

After the `categories` panel (line 39), add:

```html
  <div id="tab-validate"    class="tab-panel hidden"><p class="text-sm text-gray-400">Loading...</p></div>
```

- [ ] **Step 3: Import the analyzer in the script**

After line 46 (`import { escapeHtml } from '../../lib/render.mjs';`), add:

```javascript
import { analyzeSkillFile } from '../../lib/parse-skill.mjs';
```

- [ ] **Step 4: Wire the tab into `loadTab`**

In `loadTab` (around line 228, after the `categories` line), add:

```javascript
      if (tabId === 'validate')    await loadValidate(panel);
```

- [ ] **Step 5: Add `loadValidate` and the render helper**

Add these two functions inside the `<script>` (e.g. just after `loadCategories`):

```javascript
function renderValidationResults(analysis) {
  const { fields, ignored, validation } = analysis;

  const sourceLabel = {
    frontmatter: '<span class="text-green-700">from frontmatter</span>',
    derived: '<span class="text-blue-700">⚙️ derived</span>',
    defaulted: '<span class="text-amber-700">⚙️ defaulted</span>',
    pipeline: '<span class="text-gray-400">set by pipeline</span>',
  };
  const fmtValue = (v) => Array.isArray(v)
    ? (v.length ? v.map(x => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mr-1">${escapeHtml(String(x))}</span>`).join('') : '<span class="text-gray-300">[]</span>')
    : v === null ? '<span class="text-gray-300">null</span>'
    : v === '' ? '<span class="text-gray-300">(empty)</span>'
    : escapeHtml(String(v));

  const authored = fields.filter(f => f.source !== 'pipeline');
  const pipeline = fields.filter(f => f.source === 'pipeline');

  const banner = validation.valid
    ? `<div class="p-3 rounded bg-green-50 border border-green-200 text-sm text-green-800">✅ Valid skill file — passes SkillSchema.</div>`
    : `<div class="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
        ❌ Invalid — ${validation.errors.length} issue(s):
        <ul class="mt-1 ml-4 list-disc">
          ${validation.errors.map(e => `<li><code>${escapeHtml(e.path || '(root)')}</code>: ${escapeHtml(e.message)}</li>`).join('')}
        </ul>
      </div>`;

  const fieldRows = (list) => list.map(f => `
    <tr class="border-b border-gray-100">
      <td class="py-1 pr-3 font-mono text-xs text-gray-700 align-top">${escapeHtml(f.key)}</td>
      <td class="py-1 pr-3 text-xs align-top">${fmtValue(f.value)}</td>
      <td class="py-1 text-xs whitespace-nowrap align-top">${sourceLabel[f.source] || f.source}</td>
    </tr>`).join('');

  const ignoredBlock = ignored.length
    ? `<div class="mt-4">
        <h3 class="text-sm font-semibold text-gray-900 mb-2">⚠️ Ignored / unrecognized keys</h3>
        <ul class="text-xs text-amber-800 space-y-1">
          ${ignored.map(i => `<li><code>${escapeHtml(i.key)}</code> — not a recognized field; will be dropped${i.suggestion ? ` — did you mean <code>${escapeHtml(i.suggestion)}</code>?` : ''}</li>`).join('')}
        </ul>
      </div>`
    : '';

  return `
    ${banner}
    <div class="mt-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-2">Extracted fields</h3>
      <table class="w-full text-left"><tbody>${fieldRows(authored)}</tbody></table>
    </div>
    <div class="mt-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-2">Set by the pipeline, not your file</h3>
      <table class="w-full text-left opacity-70"><tbody>${fieldRows(pipeline)}</tbody></table>
    </div>
    ${ignoredBlock}
    <div class="mt-4">
      <button id="copy-record-btn" class="text-xs px-2 py-1 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Copy as JSON</button>
      <span id="copy-status" class="text-xs text-green-600 ml-2 hidden">Copied ✓</span>
    </div>`;
}

async function loadValidate(panel) {
  panel.innerHTML = `
    <p class="text-xs text-gray-500 mb-3">Paste a SKILL.md file below to preview exactly what the registry would extract — captured fields, defaults, ignored keys, and schema validation. Nothing is submitted.</p>
    <textarea id="validate-input" class="w-full h-64 text-xs font-mono border border-gray-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-plum-300" placeholder="---&#10;name: my-skill&#10;description: ...&#10;---&#10;&#10;# My Skill"></textarea>
    <div class="mt-2"><button id="validate-btn" class="text-sm px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Validate</button></div>
    <div id="validate-results" class="mt-4"></div>`;

  const input = panel.querySelector('#validate-input');
  const results = panel.querySelector('#validate-results');
  let lastAnalysis = null;

  const run = () => {
    const text = input.value.trim();
    if (!text) { results.innerHTML = ''; lastAnalysis = null; return; }
    try {
      lastAnalysis = analyzeSkillFile(text);
      results.innerHTML = renderValidationResults(lastAnalysis);
      const copyBtn = results.querySelector('#copy-record-btn');
      copyBtn?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(JSON.stringify(lastAnalysis.record, null, 2));
        const status = results.querySelector('#copy-status');
        status.classList.remove('hidden');
        setTimeout(() => status.classList.add('hidden'), 2000);
      });
    } catch (e) {
      results.innerHTML = `<p class="text-sm text-red-500">Could not parse: ${escapeHtml(e.message)}</p>`;
    }
  };

  let debounce;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 300); });
  panel.querySelector('#validate-btn').addEventListener('click', run);
}
```

- [ ] **Step 6: Verify the page builds**

Run: `npx astro check`
Expected: no errors introduced by the new code. (Pre-existing warnings unrelated to these files are acceptable; no new errors referencing `index.astro` or `parse-skill.mjs`.)

- [ ] **Step 7: Manual smoke check (build)**

Run: `npm run build`
Expected: build succeeds. Confirms `parse-skill.mjs` (and its `registry-schema.mjs` / `scripts/utils.mjs` imports) bundle for the client without Node-only-module errors. If bundling fails because `scripts/utils.mjs` can't be resolved into the client bundle, apply the spec fallback: move the three helper bodies (`parseFrontmatter`, `getDescription`, `slugify`) into `src/lib/parse-skill.mjs` and change `scripts/utils.mjs` to re-export them from there — public API unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat(admin): add Validate tab to preview SKILL.md extraction"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Confirm no stray `nava_` references**

Run: `grep -rn "nava_" src/ scripts/ tests/`
Expected: no matches.

- [ ] **Build once more**

Run: `npm run build`
Expected: success.

---

## Self-review notes

- **Spec coverage:** rename (Task 1, 6, 7) ✓; capture `author_name`/`tags` (Task 1 schema, Task 2 builder) ✓; shared anti-drift module (Task 2) ✓; sync refactor v1+v2 (Tasks 4, 5) ✓; validator analysis (Task 3) ✓; validator tab UI client-side (Task 8) ✓; tests incl. sample-file fixture, defaults, normalization, ignored keys (Tasks 2, 3) ✓; no migration (none planned, matches spec) ✓.
- **Type consistency:** `buildSkillRecord` uses one options-object signature everywhere it's called (Tasks 2, 4, 5, 3). `analyzeSkillFile` return shape `{ meta, body, record, fields, ignored, validation }` is produced in Task 3 and consumed identically in Task 8. `fields[].source` values (`frontmatter`/`derived`/`defaulted`/`pipeline`) match `sourceLabel` keys in the UI.
- **Behavior-change callouts:** v1 now infers missing `compatibility` and emits `committer: null` (Task 5) — intentional parity with v2/schema.
