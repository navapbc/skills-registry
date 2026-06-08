# Hub Expansion Design — In Progress

> **Status:** Brainstorming paused, production work prioritized. Resume here.

## What We're Building

Expand the current Skills Marketplace into a broader hub with multiple pillars. Three confirmed pillars, one deferred:

| Pillar | Status |
|---|---|
| Skills Marketplace (existing) | Live |
| Automation Request Board | Design in progress |
| Templates (Backstage-inspired) | Placeholder for now |
| Learning / AI basics | Deferred — design with it in mind, don't build yet |

---

## Key Decisions Made

**Audience:** Everyone at Nava — new folks and power users alike. No delineation or "where are you starting from?" selector. Content should work for both.

**Automation Request Board (the "quests" concept):**
- People submit requests for help with automation (currently Google Form → Google Sheet)
- Ops team actively prioritizes — NOT a grab-bag. Highest-priority items get owned and staffed (solution may be automation, AI workflow, or engineering work)
- Items the ops team hasn't resourced yet are open for others to self-select into
- Visual treatment inspired by delight.ai's Quest Board: status and ownership legible at a glance, not a Jira blackhole
- Do NOT call them "quests"

**Templates:**
- Inspired by Backstage.io — browse and potentially deploy starter repos
- For now: placeholder section only. Full implementation deferred.

**Pipeline for Request Board:**
- Keep Google Form → Google Sheet as the ops management tool
- Add a sync step (Zapier or GitHub Action) that exports sheet data to a JSON file in the repo
- Hub renders from that JSON — mirrors the existing `registry/index.json` pattern
- Ops curates in the sheet; changes propagate to the hub automatically

**Structural approach (not yet decided — 3 options on the table):**
- **A: Evolutionary expansion** — add sections below existing content, keep current brand/nav
- **B: Hub rebrand with new nav** *(recommended)* — rename product, add sidebar nav with Skills / Request Board / Templates / Learning pillars
- **C: Top-level tabs** — horizontal tab bar, minimal structural change

Decision on A/B/C is pending. Lean toward B.

---

## Open Questions

- What do we call the expanded hub? ("Nava AI Hub", something else?)
- What do we call the Automation Request Board section? (not "quests")
- For the request board: what fields from the Google Sheet should be public-facing vs. internal?
- Structural approach: confirm A, B, or C

---

## Resume Point

Pick up at: propose layout mockups for the chosen structural approach (B recommended), then move into the request board card design (status/ownership visual treatment).
