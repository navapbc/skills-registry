# Validate Skill File — `/admin` Tab

**Date:** 2026-06-03
**Status:** Approved design, pending implementation plan

## Summary

Add a **Validate** tab to the `/admin` page where a maintainer pastes raw
`SKILL.md` content and instantly sees exactly what the registry would extract
from it — captured fields, auto-filled defaults, pipeline-populated fields,
ignored keys, and a pass/fail against the real `SkillSchema`. It is a pure,
read-only preview: nothing is submitted or written.

To keep the validator honest, the frontmatter→record mapping currently inlined
in the sync scripts is extracted into one shared module that both the sync
pipeline and the validator call, so they cannot drift.

This work also resolves a field-naming mismatch surfaced while designing the
feature (see "Data-model changes").

## Goals

- Make it trivially easy to answer "what metadata will the registry pull out of
  this skill file, and is it valid?" before a contributor submits.
- Surface defaults/derivations explicitly so authors understand auto-filled
  values.
- Reflect the **real** pipeline behavior 1:1 — no separate, drift-prone
  re-implementation of the parsing logic.

## Non-goals

- No submission, persistence, or network write from the validator.
- No new public-facing page; this lives inside the existing `/admin` tabs.
- No DynamoDB data migration (see "Migration").

## Background

- `/admin` (`src/pages/admin/index.astro`) is a vanilla-JS Astro page with an
  existing tab system (`data-tab` buttons + `#tab-*` panels wired through an
  `activateTab(tabId)` function). Adding a tab follows an established pattern.
- Frontmatter parsing lives in `scripts/utils.mjs`
  (`parseFrontmatter`, `getDescription`, `slugify`) — pure, dependency-free
  string logic.
- Record construction is inlined in the sync scripts:
  - `scripts/sync-registry.mjs` — `buildSkillRecord` / `buildAgentRecord`
    (reads the `nava_*` optional fields today).
  - `scripts/sync-registry-v2.mjs` — `buildRecord` (does **not** read any of the
    optional nava fields today).
- Validation schema is `SkillSchema` in `src/lib/registry-schema.mjs` (Zod).
- The `POST /api/skills` route accepts already-parsed JSON (not raw markdown) and
  passes unknown fields through via `...body`.

### The naming mismatch that motivated the data-model change

A representative sample `SKILL.md` (Google Form output / hand-authored) uses
**unprefixed** keys: `team`, `problem`, `estimated_impact`, `usage_frequency`,
`expected_audience`, `impact_type`, plus `author_name` and `tags`. The current
schema and sync recognize only **prefixed** `nava_*` keys. Run through the
pipeline today, the unprefixed metadata is silently dropped, and `author_name` /
`tags` are never read from frontmatter at all.

Decision: **drop the prefix** (make the unprefixed names canonical) and **also
capture** `author_name` and `tags` from frontmatter.

## Data-model changes

### Rename `nava_*` → unprefixed (canonical)

Rename across the schema, both sync record builders, the detail-page render, and
the tests:

| Old (`nava_*`)            | New (canonical)        | Type        |
|---------------------------|------------------------|-------------|
| `nava_team`               | `team`                 | `string`    |
| `nava_problem`            | `problem`              | `string`    |
| `nava_impact_type`        | `impact_type`          | `string[]`  |
| `nava_estimated_impact`   | `estimated_impact`     | `string`    |
| `nava_usage_frequency`    | `usage_frequency`      | `string`    |
| `nava_expected_audience`  | `expected_audience`    | `string`    |
| `nava_data_sources`       | `data_sources`         | `string`    |

Verified: none of the new names collide with existing core/record fields
(`slug`, `name`, `description`, `plugin`, `repo`, `path`, `author`, `committer`,
`version`, `compatibility`, `sensitive_data`, `type`, `content`, `last_updated`,
`tools_used`, `human_in_loop`, `category`, `source`, `status`, `visibility`).

### Add two newly-captured fields

| Field         | Schema                        | Source           |
|---------------|-------------------------------|------------------|
| `author_name` | `z.string().optional()`       | frontmatter      |
| `tags`        | `z.array(z.string()).optional()` | frontmatter (reconciles with existing API `tags` model) |

All optional fields keep the existing "only included when present" behavior:
absent frontmatter key ⇒ field omitted from the record (not set to null/empty),
and `impact_type` / `tags` / `compatibility` are normalized to arrays when given
as scalars.

### sync-registry-v2 parity

`sync-registry-v2.mjs` currently reads none of the optional fields. After the
shared refactor (below) it produces records identical to `sync-registry.mjs` for
the same input, including all optional fields.

## Anti-drift refactor: shared parsing/record module

Create **`src/lib/parse-skill.mjs`** — browser- and node-safe, dependency-free —
as the single source of truth for turning frontmatter + body into a record.

Exports:

- `parseFrontmatter(content)` — re-exported from `scripts/utils.mjs`.
- `getDescription(body)` — re-exported from `scripts/utils.mjs`.
- `slugify(name)` — re-exported from `scripts/utils.mjs`.
- `buildSkillRecord(meta, body, context)` — applies all defaults, derivations,
  normalizations, and optional-field inclusion. `context` carries the
  pipeline-supplied values and is optional:
  - `context` fields: `repo`, `path`, `committer`, `pushed_at`/`last_updated`,
    `type` (`'skill' | 'agent'`).
  - With full context (sync time): identical output to today's builders.
  - With no/partial context (validator): pipeline-only fields fall back to
    documented placeholders (see UI section) so author-controlled fields can be
    validated in isolation.

Refactor both sync scripts to call `buildSkillRecord`:

- `scripts/sync-registry.mjs` — `buildSkillRecord`/`buildAgentRecord` delegate to
  the shared builder (passing full GitHub context and `type`).
- `scripts/sync-registry-v2.mjs` — `buildRecord` delegates to the shared builder.

`scripts/utils.mjs` remains the home of the low-level string helpers; the new
module re-exports them so consumers have one import. (If keeping `utils.mjs`
under `scripts/` causes any browser-bundling friction for the Astro client,
the helpers move into `src/lib/parse-skill.mjs` and `scripts/utils.mjs`
re-exports them instead — same public surface either way.)

## Validator UI

Follows the existing vanilla-JS tab pattern in `src/pages/admin/index.astro`.

### Wiring

- Add a `<button data-tab="validate" class="tab-btn …">Validate</button>` to the
  tab nav.
- Add a `<div id="tab-validate" class="tab-panel hidden">…</div>` panel.
- Hook into the existing `activateTab` flow; a `loadValidate()` initializer wires
  the textarea/button listeners (idempotent on repeated tab activation).

### Inputs

- A textarea: "Paste your SKILL.md here".
- A **Validate** button; also validate on a debounced `input`/`paste` event.

### Output sections

1. **Status banner** — ✅ "Valid skill file" / ❌ "Invalid" based on
   `SkillSchema.safeParse(derivedRecord)`. On failure, list errors phrased for
   the author (e.g., "`impact_type` must be a list", "missing `name`").
2. **Extracted fields** — table of every field that would be stored, its value,
   and a source tag: `from frontmatter` / `⚙️ derived` / `⚙️ defaulted`. Arrays
   render as chips.
3. **Auto-filled for you** — explicit derivation callout: `slug` from `name` via
   `slugify`; `description` from first body line (when absent); `version`
   defaulted to `1.0.0`; `type` defaulted to `skill`; `compatibility` inferred
   (when absent).
4. **Set by the pipeline, not your file** — muted group for `repo`, `path`,
   `plugin`, `committer`, `last_updated`, `source`, `status`, so authors
   understand why these aren't in their file.
5. **Ignored / unrecognized keys** — ⚠️ any frontmatter key not in the schema,
   with a *did-you-mean* suggestion (nearest schema field by edit distance) —
   e.g. pasting a legacy `nava_team` ⇒ "did you mean `team`?".
6. **Copy as JSON** — copies the derived record to the clipboard.

### Validation placeholders (client-side)

For schema validation the validator fills synthetic values for pipeline-only
required fields so reported errors are limited to what the author controls:

- `repo: 'org/repo'`, `path: 'SKILL.md'`, `plugin: 'preview'`,
  `content: <full pasted text>`, `last_updated: null`,
  `committer: null`, `type: 'skill'` (unless the file/context implies agent).

These placeholders are clearly attributed in the "Set by the pipeline" section so
the preview never implies they came from the file.

## Implementation approach

**Client-side, in-browser.** The admin page is already client-side vanilla JS;
`parse-skill.mjs` and `zod`/`SkillSchema` are pure JS that bundle for the
browser. The validator imports the shared module and runs entirely client-side:
instant feedback, no network round-trip, no new API route, no added auth
surface.

Alternative considered and rejected: a `POST /api/skills/validate` endpoint —
adds a route, auth, and latency for no accuracy gain once the mapping is shared.

## Testing

- **`buildSkillRecord` unit tests** (new): the representative sample file →
  expected record; defaulting/derivation cases (missing `description`, missing
  `version`, missing `slug`); array normalization (`impact_type`/`tags`/
  `compatibility` given as scalars); optional-field omission when absent;
  unrecognized-key reporting input/output.
- **Schema tests** (`tests/registry.test.mjs`): update fixtures to the renamed
  canonical fields; add `author_name` / `tags` cases.
- **API round-trip tests** (`tests/api/routes/skills.test.mjs`): update the
  `nava_*` round-trip to the renamed fields.
- **Sync parity test**: same input through the `sync-registry.mjs` and
  `sync-registry-v2.mjs` paths yields identical records via the shared builder.

## Migration

No DynamoDB migration is planned: the Google Form integration is not live, so no
production records are expected to carry `nava_*` keys. If any are later found, a
one-time rename of those seven keys on existing items would be required — out of
scope for this change unless confirmed necessary.

## Risks / open considerations

- **Browser bundling of `scripts/utils.mjs`:** mitigated by the
  re-export-or-relocate fallback noted in the shared-module section.
- **`tags` reconciliation:** frontmatter `tags` and the existing API-submitted
  `tags` use the same record field; the sync builder sets it from frontmatter,
  and the API continues to default it to `[]` when not supplied — no conflict,
  but tests should cover both entry points.
- **Scope:** this is "rename + capture-both + shared refactor + validator tab,"
  larger than the original tab-only ask, but the four are coupled by the data-model
  decisions made during design.
