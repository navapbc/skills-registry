// Pure planning for scripts/copy-postures.mjs, which copies AI posture records
// from one environment's project-reference table to another's.
//
// Kept separate from the CLI so the plan can be tested without AWS credentials or
// a DynamoDB client. The CLI owns the I/O.

// The fields an admin edits on the Policy Guidance tab. These are what a copy
// carries. Audit fields (created_at, created_by, updated_at, updated_by) stay with
// each environment's own history, so copying content never rewrites who made an
// edit on the target.
export const CONTENT_FIELDS = ['label', 'color', 'status', 'position', 'steps', 'definition'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Plan the writes that make the target's postures match the source's content.
 *
 * Returns one entry per source posture:
 *   - `create`: the target has no record with this id. The item is the source
 *     record whole, audit fields included, since the target has no history of it.
 *   - `update`: some content field differs. The item is the target record with the
 *     source's content fields laid over it and `updated_at` set to `now`.
 *   - `same`: nothing to write.
 *
 * A posture only the target holds is listed in `targetOnly` and never deleted:
 * the API has no delete for postures, and a copy must not invent one.
 */
export function planPostureCopy(source, target, now) {
  const targetById = new Map((target ?? []).map((p) => [p.id, p]));
  const sourceIds = new Set((source ?? []).map((p) => p.id));

  const entries = (source ?? []).map((record) => {
    const existing = targetById.get(record.id);
    if (!existing) return { action: 'create', id: record.id, changed: [], item: record };

    // A field the source lacks is not a change: writing it would erase the target's
    // value with nothing.
    const changed = CONTENT_FIELDS
      .filter((f) => record[f] !== undefined && !same(record[f], existing[f]));
    if (changed.length === 0) return { action: 'same', id: record.id, changed, item: null };

    const content = Object.fromEntries(changed.map((f) => [f, record[f]]));
    return {
      action: 'update',
      id: record.id,
      changed,
      item: { ...existing, ...content, updated_at: now },
    };
  });

  const targetOnly = [...targetById.keys()].filter((id) => !sourceIds.has(id));
  return { entries, targetOnly };
}
