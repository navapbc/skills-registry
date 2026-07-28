// Pure diff/reconcile logic for the category/tags migration verification
// (docs/plans/2026-07-28-001-refactor-admin-owned-category-tags-plan.md, U5).
//
// Extracted from verify-category-tags-ddb.mjs so the classification is unit-
// testable without AWS/DynamoDB access — the script itself is a thin I/O shell
// around classifyCategoryTags().
//
// Ownership context: `category` and `tags` are moving from author-owned
// frontmatter to admin-owned DynamoDB. Before the frontmatter is stripped (U2),
// every enterprise skill's category/tags must be proven present in DynamoDB.
// Until that strip happens, frontmatter is the SOURCE OF RECORD, so on a
// mismatch we reconcile DynamoDB TO the frontmatter value.

import { normalizeArray } from '../../src/lib/parse-skill.mjs';

// Normalize a tags value (scalar | array | undefined) to a comparable array.
function tagsArray(value) {
  return value === undefined || value === null ? [] : (normalizeArray(value) ?? []);
}

function tagsEqual(a, b) {
  const x = tagsArray(a);
  const y = tagsArray(b);
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

function categoryEqual(a, b) {
  return (a ?? '') === (b ?? '');
}

/**
 * Classify each enterprise skill's category/tags against what DynamoDB holds,
 * and produce a reconcile plan for anything not already safely stored.
 *
 * @param {Array<{slug: string, category?: string, tags?: any}>} frontmatterEntries
 *        One entry per enterprise SKILL.md, with its frontmatter category/tags.
 * @param {Map<string, {category?: string, tags?: any}>|Object} ddbBySlug
 *        DynamoDB records keyed by slug (Map or plain object).
 * @returns {Array<{slug, status, frontmatter, ddb, reconcile}>}
 *        status ∈ 'match' | 'ddb-missing-record' | 'ddb-missing-field' | 'mismatch'.
 *        `reconcile` is null when nothing needs writing, else the {category?, tags?}
 *        fields to write into DynamoDB (only the fields the frontmatter declares).
 */
export function classifyCategoryTags(frontmatterEntries, ddbBySlug) {
  const get = (slug) => (ddbBySlug instanceof Map ? ddbBySlug.get(slug) : ddbBySlug[slug]);

  return frontmatterEntries.map((fm) => {
    const rec = get(fm.slug);
    const fmHasCategory = fm.category !== undefined && fm.category !== '';
    const fmHasTags = tagsArray(fm.tags).length > 0;

    // Nothing declared in frontmatter → nothing to preserve.
    if (!fmHasCategory && !fmHasTags) {
      return { slug: fm.slug, status: 'match', frontmatter: fm, ddb: rec ?? null, reconcile: null };
    }

    // Frontmatter declares something, but there is no DynamoDB record at all.
    if (!rec) {
      const reconcile = {};
      if (fmHasCategory) reconcile.category = fm.category;
      if (fmHasTags) reconcile.tags = tagsArray(fm.tags);
      return { slug: fm.slug, status: 'ddb-missing-record', frontmatter: fm, ddb: null, reconcile };
    }

    // Record exists — compare the declared fields.
    const reconcile = {};
    let missingField = false;
    let mismatch = false;

    if (fmHasCategory) {
      const ddbHasCategory = rec.category !== undefined && rec.category !== '';
      if (!ddbHasCategory) { reconcile.category = fm.category; missingField = true; }
      else if (!categoryEqual(fm.category, rec.category)) { reconcile.category = fm.category; mismatch = true; }
    }

    if (fmHasTags) {
      const ddbHasTags = tagsArray(rec.tags).length > 0;
      if (!ddbHasTags) { reconcile.tags = tagsArray(fm.tags); missingField = true; }
      else if (!tagsEqual(fm.tags, rec.tags)) { reconcile.tags = tagsArray(fm.tags); mismatch = true; }
    }

    if (Object.keys(reconcile).length === 0) {
      return { slug: fm.slug, status: 'match', frontmatter: fm, ddb: rec, reconcile: null };
    }
    // Mismatch is the more serious signal; report it when any field differs.
    const status = mismatch ? 'mismatch' : (missingField ? 'ddb-missing-field' : 'mismatch');
    return { slug: fm.slug, status, frontmatter: fm, ddb: rec, reconcile };
  });
}

// True when every entry is safely stored (no reconcile needed) — the gate for U2.
export function isClean(classification) {
  return classification.every((c) => c.reconcile === null);
}
