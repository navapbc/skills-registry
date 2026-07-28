---
title: "refactor: Make category & tags admin-owned (DynamoDB), not author-owned (frontmatter)"
type: refactor
status: active
date: 2026-07-28
---

# refactor: Make category & tags admin-owned (DynamoDB), not author-owned (frontmatter)

## Summary

Move `category` and `tags` from author-owned SKILL.md frontmatter to admin-owned DynamoDB, mirroring how `visibility` already works. The 4-hourly registry sync will stop writing these two fields, the admin panel becomes their sole source of truth, and the existing frontmatter declarations are removed. Existing DynamoDB values are preserved by sequencing (sync stops touching the fields before the frontmatter is stripped), so no backfill is required.

---

## Problem Frame

Today every org-wide skill's `category`/`tags` live in two places — the SKILL.md frontmatter (author-owned, in the `enterprise/` folder) and the DynamoDB row (what the site reads and what the admin panel writes). The 4-hourly sync silently copies frontmatter over DynamoDB whenever a skill's file changes, so admin edits to category/tags disappear unpredictably. This established the ownership boundary we now want to make real: **GitHub/frontmatter owns what a skill *is* (name, description, content, compatibility, version); DynamoDB/admin owns how it's *surfaced* (visibility, category, tags).** Category and tags are discovery concerns, so they should be admin-owned like visibility.

---

## Requirements

- R1. The registry sync must never write `category` or `tags` to DynamoDB (neither on create, update, nor `--force` backfill).
- R2. Admin-panel edits to `category` and `tags` must persist indefinitely — no sync or backfill overwrites them.
- R3. Existing category/tags values must be preserved through the change (no wipe).
- R4. `category` and `tags` are removed from all `enterprise/*/SKILL.md` frontmatter.
- R5. Compatibility, name, description, content, and version remain author-owned and continue to sync from frontmatter unchanged.
- R6. The admin Org-wide tab's guidance copy accurately reflects the new ownership boundary.
- R7. A leftover/re-added `category:` or `tags:` frontmatter key is handled predictably (ignored, clearly labelled as admin-managed — not mis-flagged as a typo).
- R8. Before any frontmatter is stripped (U2), every enterprise skill's `category`/`tags` are **verified present and correct in DynamoDB**, with any gaps reconciled. Frontmatter removal is gated on a clean verification report.

---

## Scope Boundaries

- Not changing `visibility` behavior — it already works this way and is the reference model.
- Not changing `compatibility` — it stays author-owned in frontmatter and continues to sync.
- Not adding category/tags editing for community/GitHub (non-enterprise) skills — the Org-wide tab remains enterprise-only.
- Not adding server-side validation that a submitted `category` is a known `CATEGORIES` id — the admin dropdown already constrains input; broader validation is out of scope.
- Not introducing a `featured` field — mentioned in the ownership rationale but not part of this change.

### Deferred to Follow-Up Work

- Removing the now-unused `tags` length/format warning in `src/lib/form-constraints.mjs` (lines ~103-110): harmless dead-ish code once tags leave frontmatter; clean up opportunistically in a later PR.
- Removing `tags` from `SkillSchema` in `src/lib/registry-schema.mjs`: optional (`z.array(...).optional()`) so it stays valid when absent; drop later for tidiness.

---

## Context & Research

### Relevant Code and Patterns

- `scripts/sync-ddb.mjs` — `buildSkillUpdateParams`. `category = :category` is an **unconditional** SET clause (line ~31, value line ~58). `tags` is written via the `OPTIONAL_SYNC_FIELDS` array (line ~13), only when present on the record.
- **Reference model — `visibility`:** written as `visibility = if_not_exists(visibility, :public)` (sync-ddb.mjs line ~38). Seeded once at record creation, never overwritten. It is *not* a frontmatter field and *not* in `OPTIONAL_SYNC_FIELDS`. This is exactly the end-state we want for category/tags — except category/tags need no default seed (absent = falsy = fine for rendering).
- `src/lib/parse-skill.mjs` — `record.category = meta.category ?? ''` (line ~91) and `if (meta.tags) record.tags = normalizeArray(meta.tags)` (line ~95) read the fields from frontmatter. `RECOGNIZED_KEYS` (line ~111) lists valid frontmatter keys; `nearestKey`/`fieldSource`/`analyzeSkillFile` (lines ~132-188) power the admin validator view.
- `functions/api/routes/skills.mjs` — `PUT /api/skills/:slug` (lines ~94-125) already persists `category`/`tags` from the request body to DynamoDB (via `...body` and explicit `tags` line). **No API change needed** — this is why the effort is nominal.
- `src/scripts/admin/org-wide.mjs` — the Org-wide tab. Already renders category/tags editors (dropdown + input) and saves via `apiPut`. The amber "Sync note" (lines ~112-113) is now inaccurate.
- `src/lib/admin/format.mjs` — `SKILL_CATEGORIES`, `catLabel`, `catSelectOptions`, `tagChips`. Unchanged.
- Rendering tolerates a missing category: `render.mjs` does `skill.category ? CATEGORY_BY_ID.get(...) : <plugin fallback>`.

### Institutional Learnings

- No `docs/solutions/` entry directly covers sync ownership. The prior plan `docs/plans/2026-07-22-002-refactor-admin-skills-tab-org-wide-only-plan.md` established the Org-wide tab as enterprise-only and is the direct predecessor to this change.

### Existing Tests (must be updated)

- `tests/sync-ddb.test.mjs` — `coreSkill` carries `category: ''`; the `OPTIONALS` list (line ~82) includes `'tags'` and asserts it IS written (lines ~87-93); the end-to-end test (lines ~150-177) asserts `:tags` flows from frontmatter into write params. All of these must flip.
- `tests/parse-skill.test.mjs` — asserts `rec.category === 'ops'` (lines ~131-137), `rec.tags` equals frontmatter tags (lines ~44, ~85-90), and covers `fieldSource`/unrecognized-key behavior. Must flip to "category/tags are not read from frontmatter."
- `tests/frontend/admin-org-wide.test.mjs` — check whether it asserts on the sync-note copy; update if so.
- `tests/categories-parity.test.mjs` — validates the `CATEGORIES` config, **not** skill frontmatter. Unaffected.

---

## Key Technical Decisions

- **Stop the sync write, don't invert it.** Rather than an "admin overrides win" merge layer (brainstorm Option C), we simply remove category/tags from the sync write expression. Cleaner, less code, no conflict-resolution logic. Frontmatter no longer contributes these fields at all.
- **No default seed for category (unlike visibility).** `visibility` seeds `:public` via `if_not_exists`; category has no sensible default and rendering already handles a missing category (plugin-badge fallback). New enterprise skills appear uncategorized until an admin sets a category — acceptable and expected under admin ownership.
- **Preserve existing values via sequencing + explicit verification (R3, R8).** Because sync stops *writing* category/tags, whatever is already in DynamoDB stays. But "DynamoDB already has the data" is treated as a claim to **verify, not assume** — U5 reads DynamoDB back and diffs it against frontmatter before U2 strips anything, reconciling any missing/stale values first. Frontmatter is the current source of record until that verification passes, so it must not be deleted before then. The ordering hazard remains (see Risks): the sync-write removal (U1) must ship before the strip (U2), or a sync in between writes `category = ''` over live data.
- **Keep `category`/`tags` recognized-but-ignored in the validator (R7).** Leaving them in a small "admin-managed" set (rather than deleting from `RECOGNIZED_KEYS`) avoids the typo detector mis-suggesting "did you mean `team`?" for a leftover `tags:` key, and lets the validator show a clear "managed in admin panel" note.
- **No API/schema change.** The PUT route already persists these fields; `SkillSchema` keeps `tags` as optional so records validate whether or not tags is present.

---

## Open Questions

### Resolved During Planning

- *Does removing frontmatter wipe existing categories?* No — provided the sync-write removal ships first (U1 before U2). Sync then never writes category/tags, so DynamoDB values persist.
- *Does the admin panel already persist category/tags?* Yes — `PUT /api/skills/:slug` writes them today; sync was the only overwriter.
- *Any API changes?* None.

### Deferred to Implementation

- Exact wording of the new admin Org-wide guidance copy (U4) — finalize during implementation; must convey "category, tags, visibility = admin-owned; compatibility & other fields = author-owned in frontmatter."

---

## Implementation Units

- U1. **Stop sync + parser from owning category and tags**

**Goal:** The registry sync never writes `category` or `tags`; the parser stops reading them into the record. This is the safety-critical change and must land/deploy before any frontmatter is stripped.

**Requirements:** R1, R2, R3, R5

**Dependencies:** None (must deploy before U2)

**Files:**
- Modify: `scripts/sync-ddb.mjs`
- Modify: `src/lib/parse-skill.mjs`
- Test: `tests/sync-ddb.test.mjs`
- Test: `tests/parse-skill.test.mjs`

**Approach:**
- In `sync-ddb.mjs`: remove the `'category = :category'` SET clause and its `':category'` value; remove `'tags'` from `OPTIONAL_SYNC_FIELDS`. Verify no `ExpressionAttributeValues`/`-Names` become unused (the existing test guards this).
- In `parse-skill.mjs`: remove `record.category = meta.category ?? ''` and the `if (meta.tags) record.tags = …` assignment. Remove the now-dead `case 'category'` in `fieldSource`. Do **not** remove `category`/`tags` from `RECOGNIZED_KEYS` (handled in U3).
- Confirm `compatibility` and all other author fields still sync unchanged (R5).

**Patterns to follow:**
- `visibility` handling in `sync-ddb.mjs` (fields sync writes should not clobber are simply absent from the write expression / seeded via `if_not_exists`).

**Test scenarios:**
- Happy path: `buildSkillUpdateParams` output does **not** contain `category = :category`, `:category`, `#tags`, or `:tags` — even when the input record carries `category`/`tags` values. (Regression guard for the wipe hazard.)
- Happy path: `compatibility = :compat`, `#name = :name`, `description = :desc` are still present (author fields unaffected).
- Edge case: `--force` (backfill) mode also omits category/tags from the write expression.
- Edge case: no unused `ExpressionAttributeValues`/`-Names` remain (reuse `assertNoUnusedValues`/`assertNoUnusedNames`).
- Parser: `buildSkillRecord` on frontmatter containing `category:` and `tags:` yields a record with **no** `category` and **no** `tags` keys.
- Parser: end-to-end (`parseFrontmatter` → `buildSkillRecord` → `buildSkillUpdateParams`) — `:tags`/`:category` absent from write params; author fields (`:author`, `:team`) still flow.

**Verification:**
- Full test suite green with the updated assertions; a record with populated category/tags produces write params that touch neither field.

---

- U5. **Verify (and reconcile) category & tags into DynamoDB before any strip**

**Goal:** Prove — not assume — that every enterprise skill's `category`/`tags` are present and correct in DynamoDB, so the frontmatter (the current source of record) can be removed without data loss. Produce a clean report that gates U2.

**Requirements:** R3, R8

**Dependencies:** U1 (verification/reconcile must run after sync stops owning these fields, so nothing re-clobbers between reconcile and strip).

**Files:**
- Create: `scripts/verify-category-tags-ddb.mjs` (one-off verify + optional reconcile; may be removed after the migration)
- Test: `tests/verify-category-tags-ddb.test.mjs` (pure diff/reconcile logic only — see below)

**Approach:**
- For each `enterprise/*/SKILL.md`, parse the frontmatter `category`/`tags` and fetch the matching DynamoDB record (by slug).
- Diff: for every skill, report one of `match` / `ddb-missing` / `mismatch` / `frontmatter-empty`. A skill with no frontmatter category/tags and none in DynamoDB is fine (`match`, nothing to preserve).
- **Reconcile** any `ddb-missing`/`mismatch` by writing the frontmatter value into DynamoDB (targeted `UpdateCommand` on `category`/`tags` only — same field-write semantics the admin PUT uses, not a full sync). Support a `--dry-run` default that only reports, and an explicit `--apply` to write.
- Structure the script so the pure logic (given a frontmatter map + a DynamoDB map → classification + reconcile plan) is a separately exported, unit-testable function; the AWS I/O is a thin shell (mirrors why `sync-ddb.mjs` was split out for testability).
- **Alternative if a script is deemed overkill:** trigger a manual `--force` sync on pre-U1 code (which still writes category/tags) to guarantee DynamoDB == frontmatter, *then* land U1, *then* verify by spot-reading. The dedicated verify script is preferred because it produces an explicit per-skill report rather than trusting the force sync silently.

**Patterns to follow:**
- `scripts/sync-ddb.mjs` split (pure params builder + I/O caller) for testability.
- DynamoDB client usage in `functions/api/lib/dynamo.mjs` / existing `scripts/*.mjs`.

**Test scenarios:**
- Happy path: frontmatter `category: x`, DynamoDB `category: x` → classified `match`, no reconcile action.
- Edge case: frontmatter `category: x`, DynamoDB has no category → `ddb-missing`, reconcile plan writes `x`.
- Edge case: frontmatter `category: x`, DynamoDB `category: y` → `mismatch`, reconcile plan writes `x` (frontmatter is source of record pre-strip).
- Edge case: no frontmatter category/tags and none in DynamoDB → `match`, no action (nothing to lose).
- Edge case: tags as scalar vs array normalized consistently before diffing (mirror `normalizeArray`).
- Dry-run: default run performs no writes and lists the reconcile plan.

**Verification:**
- `--dry-run` report shows every enterprise skill as `match` (after any `--apply` reconcile). Zero `ddb-missing`/`mismatch` remaining. Only then is U2 unblocked.

---

- U2. **Remove category & tags from enterprise SKILL.md frontmatter**

**Goal:** Strip the now-ignored `category:` and `tags:` keys from enterprise skill frontmatter, completing the ownership move.

**Requirements:** R4

**Dependencies:** U1 and U5 (U1 merged **and deployed** first — otherwise the next 4-hour sync writes `category = ''` over live DynamoDB data; U5's verification must be clean — never strip frontmatter until DynamoDB is confirmed to hold the data).

**Files (frontmatter edits only — the `---` block near the top of each file):**
- `enterprise/central-ops-review/SKILL.md` (category L3, tags L28)
- `enterprise/change-mgmt-template/SKILL.md` (category L7)
- `enterprise/actionable-feedback/SKILL.md` (category L3, tags L37)
- `enterprise/finance-onboarding-check/SKILL.md` (category L3, tags L19)
- `enterprise/daily-briefing-template/SKILL.md` (category L7)
- `enterprise/policy-requirements-explorer/SKILL.md` (category L3, tags L26)
- `enterprise/confluence-editor/SKILL.md` (category L3)
- `enterprise/project-index-search/SKILL.md` (category L3)
- `enterprise/plain-language/SKILL.md` (category L3, tags L30)
- `enterprise/policy-document-analysis/SKILL.md` (**frontmatter** category L3, tags L22 — **DO NOT touch** the body-content `category:` at L123 and L365)
- `enterprise/skill-enterprise-transform/SKILL.md` (category L3)
- `enterprise/skill-governance-reviewer/SKILL.md` (tags L22)
- `enterprise/proposal-review-template/SKILL.md` (category L7)
- `enterprise/sage-bot/SKILL.md` (category L3, tags L18)
- `enterprise/week-kickoff-template/SKILL.md` (category L7)
- `enterprise/weekly-brag-log/SKILL.md` (category L3, tags L17)

**Approach:**
- Edit each frontmatter block by hand or with a frontmatter-scoped tool; never a blind global find/replace on `category:` (would corrupt `policy-document-analysis` body content).
- Re-grep after editing to confirm only intended lines changed.

**Execution note:** Do not start this unit until (a) U1 is deployed to the environment whose sync runs next, and (b) U5's verification report is clean (every enterprise skill `match`). Both gates are hard preconditions for this destructive edit.

**Patterns to follow:** n/a (content edit).

**Test scenarios:** Test expectation: none — content-only change to skill source files, no runtime behavior in this repo's code.

**Verification:**
- `grep -n "^category:\|^tags:" enterprise/*/SKILL.md` returns only the two body-content lines in `policy-document-analysis` (L123, L365).
- After the next sync (or a manual trigger), the site still shows each skill's existing category/tags (served from DynamoDB, not frontmatter).

---

- U3. **Surface category/tags as admin-managed in the SKILL.md validator**

**Goal:** A leftover or re-added `category:`/`tags:` frontmatter key is shown as "ignored — managed in the admin panel," not silently dropped and not mis-suggested as a typo.

**Requirements:** R7

**Dependencies:** U1

**Files:**
- Modify: `src/lib/parse-skill.mjs`
- Test: `tests/parse-skill.test.mjs`
- (Verify only) `src/scripts/admin/validate.mjs`

**Approach:**
- Introduce a small `ADMIN_MANAGED_KEYS = new Set(['category', 'tags'])`. In `analyzeSkillFile`, classify meta keys in this set into a distinct bucket (e.g. add to `ignored` with a fixed `note: 'managed in the admin panel'` rather than a `nearestKey` suggestion), so the validator UI can label them clearly.
- Keep `category`/`tags` in `RECOGNIZED_KEYS` so `nearestKey` never mis-suggests (e.g. "did you mean `team`?") for a stray `tags:` key.

**Patterns to follow:**
- Existing `ignored` / `nearestKey` handling in `analyzeSkillFile` (parse-skill.mjs ~173-175).

**Test scenarios:**
- Happy path: `analyzeSkillFile` on frontmatter with `category: x` and `tags: [a]` reports both as admin-managed/ignored with the fixed note, and `record` contains neither key.
- Edge case: a genuine typo key (e.g. `categoy:`) still gets a did-you-mean suggestion and is not swallowed by the admin-managed bucket.
- Edge case: a real legacy key (`nava_tags`) still resolves via the existing `nearestKey` legacy path.

**Verification:**
- Validator view shows category/tags as admin-managed rather than as errors, typos, or nothing.

---

- U4. **Correct the Org-wide tab sync-warning copy**

**Goal:** The admin guidance accurately states the new ownership boundary so curators stop expecting sync to overwrite category/tags (and stop being told, wrongly, that only tags are "safe").

**Requirements:** R6

**Dependencies:** U1

**Files:**
- Modify: `src/scripts/admin/org-wide.mjs`
- Test: `tests/frontend/admin-org-wide.test.mjs` (if it asserts on the note copy)

**Approach:**
- Replace the amber "Sync note" (org-wide.mjs ~112-113). New message conveys: **Category, tags, and visibility are admin-owned — edits here persist and are never overwritten by sync. Compatibility and other skill details come from the SKILL.md and are overwritten by sync; edit them in the source file.**

**Patterns to follow:** existing amber note block markup in `org-wide.mjs`.

**Test scenarios:**
- Happy path (only if the test asserts copy): the rendered panel contains the new ownership wording and no longer claims category/compatibility edits are overwritten or that tags are "safe" as a special case.

**Verification:**
- Rendered Org-wide tab shows the corrected note; `admin-org-wide` frontend test passes.

---

## System-Wide Impact

- **Interaction graph:** Sync pipeline (`sync-registry-v2.mjs` → `buildSkillUpdateParams`) stops writing two attributes; admin PUT path unchanged; render/browse paths read DynamoDB and are unaffected (missing category already handled).
- **State lifecycle risks:** The one real risk is the U1→U2 ordering (category wipe). Covered in Risks and via U2's execution note.
- **API surface parity:** None — `PUT /api/skills/:slug` already owns these writes.
- **Unchanged invariants:** `visibility` behavior, `compatibility` sync, all other frontmatter-sourced fields, category ids in `CATEGORIES` (both copies), and the categories-parity guard remain exactly as-is.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| **Category wipe:** stripping frontmatter (U2) before sync stops writing category (U1) → next sync writes `category = ''` over all DynamoDB categories. | Hard dependency U1-before-U2; U2 execution note requires confirming U1 is deployed before merging U2. |
| **Silent data loss:** a skill whose frontmatter category/tags were never synced to DynamoDB (failed run, skipped by the `last_updated` guard, recently added) is lost when frontmatter is stripped. | U5 verifies DynamoDB against frontmatter for every enterprise skill and reconciles gaps before U2; U2 is gated on a clean report. Frontmatter is treated as the source of record until verification passes. |
| Blind find/replace corrupts `policy-document-analysis` body content (`category:` at L123/L365). | U2 restricts edits to frontmatter lines; post-edit grep confirms only intended lines changed. |
| Existing tests assert the old behavior and will fail. | U1/U3/U4 explicitly update `tests/sync-ddb.test.mjs`, `tests/parse-skill.test.mjs`, and the admin-org-wide test in lockstep. |
| Leftover `tags:` frontmatter mis-flagged as a typo suggestion. | U3 keeps the keys recognized and routes them to an admin-managed bucket. |

---

## Sources & References

- Related code: `scripts/sync-ddb.mjs`, `src/lib/parse-skill.mjs`, `src/scripts/admin/org-wide.mjs`, `functions/api/routes/skills.mjs`
- Predecessor plan: `docs/plans/2026-07-22-002-refactor-admin-skills-tab-org-wide-only-plan.md`
- Sync schedule: `.github/workflows/sync.yml` (cron every 4 hours, staging → prod)
