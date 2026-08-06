// The single point of contact with program data.
//
// Program records carry an archetype and a posture value each, assigned upstream
// in the Google Sheet. Counting how many programs reference a given reference
// record — and spotting values that reference nothing — is what makes it safe to
// deactivate a record, and what surfaces drift between the sheet and this table.
//
// That data is not in this repository yet. The sheet extractor
// (scripts/export-sheet.mjs) writes a local snapshot; nothing loads it into
// DynamoDB, and loading it was explicitly out of scope for that work. Until it
// lands, this accessor reports unavailable.
//
// WHEN PROGRAM DATA ARRIVES, THIS FUNCTION IS THE ONLY THING THAT CHANGES.
// Return `{ available: true, programs: [...] }` where each program has an `id`,
// an `archetype` id and a `posture` id, and every caller below starts working.
//
// One caveat for whoever does that: the current sheet export carries
// "Archetype (Primary)" and "Archetype (Additional)" columns but no posture
// column at all, so posture counts need a source that does not exist yet.
export async function loadPrograms() {
  return { available: false, reason: 'Program data is not yet loaded into the hub.' };
}

/**
 * Counts how many programs reference each record, and which referenced values
 * match no record at all.
 *
 * Both directions matter. A count tells an admin whether deactivating a record
 * will strip a badge off live programs. The orphan list catches the inverse —
 * a value the upstream sheet emits that this table has never heard of — which is
 * the direction a naive implementation forgets.
 *
 * Returns `{ available: false }` rather than zeroes when there is no data. A zero
 * would read as "safe to remove" for a record that may have many references.
 */
export async function referenceUsage(entityType, records) {
  const programs = await loadPrograms();
  if (!programs.available) {
    return { available: false, reason: programs.reason };
  }

  const field = entityType === 'archetype' ? 'archetype' : 'posture';
  const counts = Object.fromEntries(records.map((r) => [r.id, 0]));
  const orphans = {};

  for (const program of programs.programs) {
    const value = program[field];
    if (!value) continue;
    if (value in counts) counts[value] += 1;
    else orphans[value] = (orphans[value] ?? 0) + 1;
  }

  return {
    available: true,
    counts,
    orphans: Object.entries(orphans).map(([value, count]) => ({ value, count })),
  };
}
