// A short-lived, in-container cache in front of the full-partition reads that the
// projects, contracts, and initiatives routes perform on every request.
//
// Those three endpoints re-read whole partitions and re-join them per request —
// five DynamoDB operations for /api/projects, four for /api/contracts. The tables
// are mirrors of hand-maintained sheets, written only by a scheduled or dispatched
// sync, so re-reading them on every page load buys freshness nobody asked for.
//
// WHY THE CACHE LIVES HERE AND NOT AT CLOUDFRONT
//
// /api/skills and /api/plugins are cached at the edge (see terraform/cloudfront.tf).
// That is not a pattern these three endpoints can copy. A CloudFront cache HIT is
// served without invoking this Lambda at all, which means the auth middleware never
// runs and the response is reachable without a session. Worse for /api/projects,
// which answers 403 or 200 depending on `manage:project-reference`: a shared cache
// key would store whichever response arrived first and serve it to everyone.
//
// Caching here instead keeps every request behind the auth middleware and behind
// each route's own gate. Nothing about who may read what changes.
//
// WHY PARTITION READS AND NOT WHOLE RESPONSES
//
// Three reasons, in order of weight:
//
//   1. /api/initiatives varies by `?id=` — the related-contracts join is computed
//      for one initiative. Caching responses would need a correct per-id key.
//      Caching the reads underneath is correct for every id by construction.
//   2. The three endpoints overlap: the projects partition is read by all three,
//      the contracts partition by all three, the postures partition by two. One
//      cached read serves all of its callers.
//   3. The joins those routes perform stay per-request, which preserves the
//      resolve-on-read behavior each of them deliberately documents. Over 119
//      records that work is free.

import { ddb, QueryCommand } from './dynamo.mjs';

// Not an environment variable. Nothing operationally tunes this, and plumbing a
// var through terraform for a value no one changes is surface without a use.
//
// The bound this sets: an admin editing a posture or archetype, or a sync run
// landing new rows, becomes visible within a minute rather than immediately.
const TTL_MS = 60_000;

// Keyed by table + partition + projection. Never evicted by size: the key space is
// the set of distinct reads this codebase performs, which is five.
const cache = new Map();

// The projection is part of the identity, not decoration. The contracts partition
// is read unprojected by /api/contracts and six-field-projected by
// /api/initiatives; collapsing those into one entry would hand a caller records
// missing most of their columns.
const cacheKey = (table, keyName, keyValue, fields) =>
  JSON.stringify([table, keyName, keyValue, fields]);

/** Read one partition in full, paging until exhausted. */
async function queryPartition(table, keyName, keyValue, fields) {
  const items = [];
  let lastKey;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: `${keyName} = :t`,
        ExpressionAttributeValues: { ':t': keyValue },
        ...(fields && {
          // Every name is aliased, not just the reserved ones (`project`, `vehicle`,
          // and `customer` are reserved today). Aliasing selectively means a field
          // added to the list later fails at runtime the first time someone picks a
          // word DynamoDB happens to reserve, which is not a list anyone remembers.
          ProjectionExpression: fields.map((_, i) => `#f${i}`).join(', '),
          ExpressionAttributeNames: Object.fromEntries(fields.map((f, i) => [`#f${i}`, f])),
        }),
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * Read one partition in full, reusing a recent read when there is one.
 *
 * Replaces the three near-identical `queryPartition` helpers the routes each kept.
 * The signature is the widest of the three — the optional `fields` projection came
 * from the initiatives route, and the other two simply pass nothing.
 *
 * The PROMISE is cached, not the resolved value, so two requests that miss at the
 * same moment issue one query between them rather than two.
 *
 * A rejection is never cached. Caching one would pin a transient DynamoDB fault for
 * the full minute, and the projects route reads its contracts partition inside a
 * catch that degrades the drift summary to `read_failed` — a sticky rejection would
 * hold that degraded state long after the fault cleared.
 */
export function cachedQueryPartition(table, keyName, keyValue, fields = null) {
  const key = cacheKey(table, keyName, keyValue, fields);

  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.promise;

  const promise = queryPartition(table, keyName, keyValue, fields);

  // Attaching the handler also marks the rejection as observed, so a read whose
  // caller has already given up does not surface as an unhandled rejection.
  //
  // The identity check matters: by the time this runs the entry may have been
  // replaced by a later read, and deleting that one would throw away a live result.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });

  cache.set(key, { promise, expiresAt: Date.now() + TTL_MS });
  return promise;
}

/**
 * Drop every cached read. FOR TESTS ONLY.
 *
 * Not an invalidation seam — no route should call this. It exists because the route
 * suites drive handlers through sequenced `mockResolvedValueOnce` chains and reset
 * only the mock between cases; module state surviving into the next test would let
 * one case answer from another's fixtures and desynchronize the whole sequence.
 */
export function __resetPartitionCache() {
  cache.clear();
}
