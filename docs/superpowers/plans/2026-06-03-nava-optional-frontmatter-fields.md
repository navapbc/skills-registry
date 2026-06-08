# Nava Optional Frontmatter Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass seven optional `nava_*` frontmatter fields from SKILL.md files through the sync script, registry schema, and skill detail page so form-submitted metadata (team, problem, impact, etc.) appears on Hub skill pages.

**Architecture:** The seven fields are read in `buildSkillRecord` / `buildAgentRecord`, validated as optional in the Zod schema, stored in DynamoDB automatically via the existing `...body` spread in the skills API, and conditionally rendered in `renderSkillDetail`. No API route changes required — the routes already pass through unknown fields.

**Tech Stack:** Node.js ESM, Zod, Vitest, Tailwind (inline HTML strings in render.mjs)

---

## Fields Being Added

All seven are optional (may be absent). Use `nava_` prefix to namespace Nava-specific metadata and avoid collision with future Claude Code frontmatter keys.

| Field | Type | Source form question |
|---|---|---|
| `nava_team` | `string` | "What Team are you on?" |
| `nava_problem` | `string` | "What problem does this skill solve?" |
| `nava_impact_type` | `string[]` | "What type of impact does this skill have?" (checkboxes) |
| `nava_estimated_impact` | `string` | "Estimated impact per use" |
| `nava_usage_frequency` | `string` | "How often do you expect this skill to be used?" |
| `nava_expected_audience` | `string` | "How many people do you expect will use this skill?" |
| `nava_data_sources` | `string` | "What data sources or systems does this skill reference?" |

---

## File Map

| File | Change |
|---|---|
| `scripts/sync-registry.mjs` | Read 7 `nava_*` fields in `buildSkillRecord` and `buildAgentRecord` |
| `src/lib/registry-schema.mjs` | Add 7 optional fields to `SkillSchema` |
| `src/lib/render.mjs` | Add "Submitted by" / "Impact" section to `renderSkillDetail` aside |
| `tests/registry.test.mjs` | Add test: skill with `nava_*` fields passes schema |
| `tests/frontend/render.test.mjs` | Add tests: detail shows/hides new section based on field presence |
| `tests/api/routes/skills.test.mjs` | Add test: POST /api/skills preserves `nava_*` fields |

---

## Task 1: Update sync script to read optional fields

**Files:**
- Modify: `scripts/sync-registry.mjs` (lines ~157–196, `buildSkillRecord` and `buildAgentRecord`)

- [ ] **Step 1: Write the failing test**

Add to `tests/registry.test.mjs`, inside a new `describe` block at the bottom:

```js
describe('SkillSchema — nava_ optional fields', () => {
  it('passes when all nava_ fields are present', () => {
    const { SkillSchema } = require('../../src/lib/registry-schema.mjs');
    // Use dynamic import since the file is ESM
  });
});
```

Actually the registry test validates against the live `public/registry/index.json` and doesn't test `buildSkillRecord` directly. The schema test is covered in Task 2. Skip to Step 2.

- [ ] **Step 2: Add `nava_*` fields to `buildSkillRecord`**

In `scripts/sync-registry.mjs`, replace the `buildSkillRecord` function body (currently returns an object with `slug` through `last_updated`) to add the 7 optional fields at the end:

```js
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
    ...(meta.nava_team            && { nava_team: meta.nava_team }),
    ...(meta.nava_problem         && { nava_problem: meta.nava_problem }),
    ...(meta.nava_impact_type     && { nava_impact_type: Array.isArray(meta.nava_impact_type) ? meta.nava_impact_type : [meta.nava_impact_type] }),
    ...(meta.nava_estimated_impact && { nava_estimated_impact: meta.nava_estimated_impact }),
    ...(meta.nava_usage_frequency  && { nava_usage_frequency: meta.nava_usage_frequency }),
    ...(meta.nava_expected_audience && { nava_expected_audience: meta.nava_expected_audience }),
    ...(meta.nava_data_sources     && { nava_data_sources: meta.nava_data_sources }),
  };
}
```

- [ ] **Step 3: Apply same changes to `buildAgentRecord`**

In `scripts/sync-registry.mjs`, replace the `buildAgentRecord` function body (currently ends with `human_in_loop`) to add the same 7 optional fields:

```js
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
    ...(meta.nava_team            && { nava_team: meta.nava_team }),
    ...(meta.nava_problem         && { nava_problem: meta.nava_problem }),
    ...(meta.nava_impact_type     && { nava_impact_type: Array.isArray(meta.nava_impact_type) ? meta.nava_impact_type : [meta.nava_impact_type] }),
    ...(meta.nava_estimated_impact && { nava_estimated_impact: meta.nava_estimated_impact }),
    ...(meta.nava_usage_frequency  && { nava_usage_frequency: meta.nava_usage_frequency }),
    ...(meta.nava_expected_audience && { nava_expected_audience: meta.nava_expected_audience }),
    ...(meta.nava_data_sources     && { nava_data_sources: meta.nava_data_sources }),
  };
}
```

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
cd /Users/cory/Documents/GitHub/skills-registry && pnpm test
```

Expected: all tests pass (no schema changes yet, so registry.test.mjs may fail — that's fixed in Task 2).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-registry.mjs
git commit -m "feat(sync): read optional nava_ frontmatter fields in buildSkillRecord and buildAgentRecord"
```

---

## Task 2: Update registry schema with optional nava_ fields

**Files:**
- Modify: `src/lib/registry-schema.mjs`
- Test: `tests/registry.test.mjs`

- [ ] **Step 1: Write a failing schema test**

Add to the bottom of `tests/registry.test.mjs`:

```js
import { SkillSchema } from '../src/lib/registry-schema.mjs';

describe('SkillSchema — nava_ optional fields', () => {
  const baseValid = {
    slug: 'test', name: 'Test', description: 'desc',
    plugin: 'p', repo: 'org/repo', path: 'SKILL.md',
    author: 'a', version: '1.0.0', compatibility: [],
    sensitive_data: false, type: 'skill', content: '',
    last_updated: null,
  };

  it('passes with no nava_ fields present', () => {
    expect(SkillSchema.safeParse(baseValid).success).toBe(true);
  });

  it('passes with all nava_ fields present', () => {
    const full = {
      ...baseValid,
      nava_team: 'Engineering',
      nava_problem: 'Manual reporting took 2 hours',
      nava_impact_type: ['Time saved per use', 'Reduced error rate or rework'],
      nava_estimated_impact: 'Saves ~45 min per use',
      nava_usage_frequency: 'Daily',
      nava_expected_audience: '16+ people / org-wide',
      nava_data_sources: 'Google Docs, Jira',
    };
    expect(SkillSchema.safeParse(full).success).toBe(true);
  });

  it('passes with some nava_ fields present', () => {
    const partial = { ...baseValid, nava_team: 'Design', nava_estimated_impact: 'Saves 1 hour' };
    expect(SkillSchema.safeParse(partial).success).toBe(true);
  });

  it('fails when nava_impact_type is not an array', () => {
    const bad = { ...baseValid, nava_impact_type: 42 };
    expect(SkillSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/registry.test.mjs
```

Expected: FAIL — `nava_impact_type: 42` test passes when it shouldn't (schema doesn't validate the field yet), or the field is stripped as unknown.

- [ ] **Step 3: Add optional fields to SkillSchema**

In `src/lib/registry-schema.mjs`, replace the `SkillSchema` definition:

```js
export const SkillSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  plugin: z.string().min(1),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'repo must be org/name format'),
  path: z.string().min(1),
  author: z.string(),
  committer: CommitterSchema.nullish(),
  version: z.string(),
  compatibility: z.array(z.string()),
  sensitive_data: z.boolean(),
  type: z.enum(['skill', 'agent']),
  content: z.string(),
  last_updated: z.string().nullable(),
  // agent-only optional fields
  tools_used: z.array(z.string()).optional(),
  human_in_loop: z.string().optional(),
  // nava submission metadata — optional, set by Google Form → Zapier → SKILL.md frontmatter
  nava_team: z.string().optional(),
  nava_problem: z.string().optional(),
  nava_impact_type: z.array(z.string()).optional(),
  nava_estimated_impact: z.string().optional(),
  nava_usage_frequency: z.string().optional(),
  nava_expected_audience: z.string().optional(),
  nava_data_sources: z.string().optional(),
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test tests/registry.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/registry-schema.mjs tests/registry.test.mjs
git commit -m "feat(schema): add optional nava_ fields to SkillSchema"
```

---

## Task 3: Display nava_ fields in skill detail page

**Files:**
- Modify: `src/lib/render.mjs` (`renderSkillDetail` function, the aside `Details` card)
- Test: `tests/frontend/render.test.mjs`

- [ ] **Step 1: Write failing render tests**

Add to the bottom of `tests/frontend/render.test.mjs`:

```js
describe('renderSkillDetail — nava_ optional fields', () => {
  const navaSkill = {
    ...baseSkill,
    nava_team: 'Engineering',
    nava_problem: 'Spent 2 hours formatting reports manually',
    nava_impact_type: ['Time saved per use', 'Reduced error rate or rework'],
    nava_estimated_impact: 'Saves ~45 min per deliverable',
    nava_usage_frequency: 'Daily',
    nava_expected_audience: '16+ people / org-wide',
    nava_data_sources: 'Google Docs, Jira',
  };

  it('renders nava_team when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Engineering');
  });

  it('renders nava_problem when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Spent 2 hours formatting reports manually');
  });

  it('renders each nava_impact_type chip', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Time saved per use');
    expect(html).toContain('Reduced error rate or rework');
  });

  it('renders nava_estimated_impact when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Saves ~45 min per deliverable');
  });

  it('renders nava_usage_frequency when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Daily');
  });

  it('renders nava_expected_audience when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('16+ people / org-wide');
  });

  it('renders nava_data_sources when present', () => {
    const html = renderSkillDetail(navaSkill);
    expect(html).toContain('Google Docs, Jira');
  });

  it('omits the impact section entirely when no nava_ fields present', () => {
    const html = renderSkillDetail(baseSkill);
    expect(html).not.toContain('Submitted by');
    expect(html).not.toContain('Impact');
    expect(html).not.toContain('nava-detail-section');
  });

  it('escapes XSS in nava_ field values', () => {
    const xss = { ...baseSkill, nava_team: '<script>alert(1)</script>' };
    const html = renderSkillDetail(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test tests/frontend/render.test.mjs
```

Expected: 9 new tests fail (fields not rendered yet).

- [ ] **Step 3: Add nava_ section to `renderSkillDetail`**

In `src/lib/render.mjs`, find the `renderSkillDetail` function. Locate the aside block — it currently ends with a `Details` card containing `Added` and `Repo`. Add a helper that builds the optional section, then insert it into the aside.

Add this helper function **before** `renderSkillDetail`:

```js
function renderNavaMetaSection(skill) {
  const hasAny = skill.nava_team || skill.nava_problem || skill.nava_impact_type?.length
    || skill.nava_estimated_impact || skill.nava_usage_frequency
    || skill.nava_expected_audience || skill.nava_data_sources;
  if (!hasAny) return '';

  const row = (label, value) => value
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">${label}</dt>
        <dd class="text-xs text-gray-700 m-0">${escapeHtml(value)}</dd>
      </div>`
    : '';

  const impactChips = skill.nava_impact_type?.length
    ? `<div class="flex flex-col gap-0.5">
        <dt class="text-xs text-gray-400">Impact type</dt>
        <dd class="flex flex-wrap gap-1 m-0">
          ${skill.nava_impact_type.map(t => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">${escapeHtml(t)}</span>`).join('')}
        </dd>
      </div>`
    : '';

  return `
    <div class="bg-white border border-gray-200 rounded-lg p-4" data-testid="nava-detail-section">
      <h3 class="text-sm font-semibold text-gray-900 mb-3">Submission Details</h3>
      <dl class="space-y-2 m-0">
        ${row('Team', skill.nava_team)}
        ${row('Problem solved', skill.nava_problem)}
        ${impactChips}
        ${row('Estimated impact', skill.nava_estimated_impact)}
        ${row('Usage frequency', skill.nava_usage_frequency)}
        ${row('Expected audience', skill.nava_expected_audience)}
        ${row('Data sources', skill.nava_data_sources)}
      </dl>
    </div>`;
}
```

Then in `renderSkillDetail`, find the aside section and add the new card. The aside currently looks like:

```js
      <aside class="w-64 flex-shrink-0 space-y-4">
        <div>${renderFavoriteButton(skill.slug)}</div>
        ${claudeCodeCard}
        ${claudeChatCard}
        ${committerCard}
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-gray-900 mb-3">Details</h3>
          ...
        </div>
      </aside>
```

Add `${renderNavaMetaSection(skill)}` after the existing Details card, so the aside becomes:

```js
      <aside class="w-64 flex-shrink-0 space-y-4">
        <div>${renderFavoriteButton(skill.slug)}</div>
        ${claudeCodeCard}
        ${claudeChatCard}
        ${committerCard}
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-gray-900 mb-3">Details</h3>
          <dl class="space-y-2 m-0">
            ${addedDate ? `<div class="flex justify-between gap-2"><dt class="text-xs text-gray-400">Added</dt><dd class="text-xs text-gray-700 m-0">${escapeHtml(addedDate)}</dd></div>` : ''}
            <div class="flex justify-between gap-2">
              <dt class="text-xs text-gray-400">Repo</dt>
              <dd class="text-xs m-0"><a href="https://github.com/${escapeHtml(skill.repo)}" target="_blank" rel="noopener" class="text-plum-600 hover:text-plum-700 no-underline truncate block max-w-32" title="${escapeHtml(skill.repo)}">${escapeHtml(skill.repo)}</a></dd>
            </div>
          </dl>
        </div>
        ${renderNavaMetaSection(skill)}
      </aside>
```

- [ ] **Step 4: Update the "omits section" test to match the correct sentinel**

The test checks `nava-detail-section` via `data-testid`. Confirm the helper uses `data-testid="nava-detail-section"` (it does in the code above — no change needed).

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm test tests/frontend/render.test.mjs
```

Expected: all tests pass, including the 9 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render.mjs tests/frontend/render.test.mjs
git commit -m "feat(render): show optional nava_ submission metadata on skill detail page"
```

---

## Task 4: Verify nava_ fields round-trip through the skills API

**Files:**
- Test: `tests/api/routes/skills.test.mjs`

The API routes already pass through unknown fields via `...body` (POST) and `...existing.Item, ...body` (PUT). This task adds a test to lock that behavior in.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `tests/api/routes/skills.test.mjs`:

```js
describe('POST /api/skills — nava_ optional fields round-trip', () => {
  it('stores nava_ fields when provided in submission', async () => {
    let capturedItem;
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockImplementationOnce((cmd) => { capturedItem = cmd.params?.Item; return {}; })
      .mockResolvedValueOnce({});

    await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'nava-skill', name: 'Nava Skill', description: 'desc',
        plugin: 'p', repo: 'org/repo', path: 'SKILL.md',
        author: 'user@navapbc.com', compatibility: ['claude-code'], type: 'skill',
        nava_team: 'Engineering',
        nava_problem: 'Manual reporting took hours',
        nava_impact_type: ['Time saved per use'],
        nava_estimated_impact: 'Saves ~45 min',
        nava_usage_frequency: 'Daily',
        nava_expected_audience: '16+ people / org-wide',
        nava_data_sources: 'Google Docs',
      }),
    });

    expect(capturedItem?.nava_team).toBe('Engineering');
    expect(capturedItem?.nava_problem).toBe('Manual reporting took hours');
    expect(capturedItem?.nava_impact_type).toEqual(['Time saved per use']);
    expect(capturedItem?.nava_estimated_impact).toBe('Saves ~45 min');
    expect(capturedItem?.nava_usage_frequency).toBe('Daily');
    expect(capturedItem?.nava_expected_audience).toBe('16+ people / org-wide');
    expect(capturedItem?.nava_data_sources).toBe('Google Docs');
  });

  it('succeeds without any nava_ fields (all optional)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: USER_RECORD })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: { Cookie: makeSessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'plain-skill', name: 'Plain Skill', description: 'desc',
        plugin: 'p', repo: 'org/repo', path: 'SKILL.md',
        author: 'user@navapbc.com', compatibility: [], type: 'skill',
      }),
    });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test tests/api/routes/skills.test.mjs
```

Expected: first test fails because `capturedItem?.nava_team` is undefined (the `...body` spread hasn't been verified yet).

Actually, the `...body` spread in the POST route **already** includes all fields. This test should pass immediately. If it does, that's the desired behavior — the test exists to lock it in and prevent a future refactor from accidentally stripping unknown fields.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/api/routes/skills.test.mjs
git commit -m "test(skills-api): verify nava_ optional fields round-trip through POST /api/skills"
```

---

## Self-Review

**Spec coverage:**
- [x] All 7 fields read in `buildSkillRecord` — Task 1
- [x] All 7 fields read in `buildAgentRecord` — Task 1
- [x] Schema accepts fields as optional — Task 2
- [x] Schema rejects wrong types (array field given non-array) — Task 2 test
- [x] Rendered in aside when present — Task 3
- [x] Entirely absent from DOM when no fields set — Task 3 test
- [x] XSS-safe rendering — Task 3 test
- [x] API round-trip preserves fields — Task 4
- [x] API still works with no nava_ fields — Task 4 test

**No placeholders:** All code blocks are complete and directly usable.

**Type consistency:** `nava_impact_type` is `string[]` everywhere — array in sync script, `z.array(z.string())` in schema, mapped with `.map()` in render helper.
