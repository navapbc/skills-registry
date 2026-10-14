name: boat-crew-update
description: >
  How it works (This part is written by Claude)  Give Claude your source material — paste
  notes, drop a link to a thread, or just talk through the week It drafts the
  update in the standard template, matched to your boat/crew’s usual depth
  (narrative / demo-driven / light-touch) You get two previews — a Slack
  digest and the full Confluence page — nothing goes anywhere until you
  approve both Once approved: the digest posts to your public channel, and
  the full version publishes to Confluence as a new page under your boat’s
  index — auto-labeled and auto-linked, no manual cleanup What it won’t do
  Post or publish without your explicit OK, every time — approving one week
  doesn’t carry over to the next Make something up if it’s missing from your
  notes — it’ll ask or leave it blank instead
version: "1.0"
author: ryan@navapbc.com
author_name: Ryan Sibley
team: Practice - Design
sensitive_data: false
problem: This helps Boat and Crew captains create uniform updates and publish them in a uniform and findable way.
estimated_impact: Saves 30 minutes to 1 hour per use by compiling notes, formatting updates, and auto-posting to Slack and Confluence.  Helps people find what they’re looking for in Confluence through automatic, consistent tagging.
usage_frequency: Weekly
expected_audience: 6-15 people
impact_type: [Time saved per use, Increased output volume or consistency, Other]
compatibility: [claude-chat, claude-cowork]
tags: [boat-crew-update]
---

# Boat / Crew Update Workflow

This skill turns raw material — notes, a Slack thread, a quick conversation — into a properly formatted AI Transformation weekly update, gets human approval, and then publishes it to the right places. It exists because captains were spending real time reformatting the same information by hand every week; the goal is to remove that tax without removing the judgment call of what should actually go out publicly.

## The template

Read `assets/boat-weekly-update-template.md` before drafting anything — it's the canonical structure (Captain's Summary, What Happened, What's Next, Crew Updates, Blockers, Cross-Functional Touchpoints, Key Learnings, Supporting Artifacts, optional Goals Tracker) and includes usage notes on the three depth styles boats use in practice:

- **Narrative** — deep, stats-heavy, timeline-driven (e.g. AI Workforce Transformation's style)
- **Demo-driven** — organized per initiative with a Driver/Contributors tag and a linked demo (e.g. AI-Enabled Delivery's style)
- **Light-touch** — a couple of highlight bullets, detail lives in a linked deck or doc (e.g. Internal Ops' style)

Match whichever style fits the source material rather than defaulting to the deepest one — a light-touch crew's update forced into narrative style will look padded, and a narrative boat's update compressed into light-touch will lose the stats and timeline context that make it useful.

## Step 1: Gather the source material

Ask what the source is if it isn't already clear:
- Raw notes or bullets pasted directly into chat
- A link to a Slack thread or async-update post (read it with the Slack connector rather than asking the person to copy-paste it themselves)
- A live conversation where you're drafting the update together in chat

Don't invent content to fill gaps. If a section has nothing to put in it (no blockers this week, no crew changes), say so plainly or omit the section — never fabricate a name, a stat, a link, or an accomplishment that isn't in the source material. If something is ambiguous (e.g., who owns a next step), ask rather than guessing.

## Step 2: Fill in the template

Determine (from context or by asking):
- Boat or crew name
- Captain/crew lead
- Week number or date
- Depth style (see above)

Fill in every section the source material supports. It's fine to leave a section brief or mark it not applicable — the template is a checklist of what's *commonly* included, not a requirement that every update fill every field every week.

## Step 3: Review with the person — always, no exceptions

Present exactly two blocks for approval, clearly labeled — not one combined draft, and not more than these two:

- **Slack digest preview:** Captain's Summary in full, 3–6 highlight bullets drawn from What Happened / What's Next, an optional line for an urgent blocker, crew change, or milestone met, and a link to the full Confluence page.
- **Confluence page preview:** the full template with every supported section filled in, in the matched depth style.

Since Step 4 produces genuinely different-length outputs for the two destinations, approving one doesn't tell you the other is right — showing only the master notes they were drafted from would hide exactly the kind of problem a captain needs to catch (e.g., a Slack version that's still too long, or a Confluence version missing something the Slack draft had). This is a hard gate, not a formality: nothing goes to a public Slack channel or Confluence without explicit approval of both previews, in the exact form they'll post in. Approval from an earlier week, or "just handle this every week," doesn't cover a specific week's content — confirm the content itself, not just the intent to publish.

## Step 4: Publish (only after approval)

Once approved, there are two destinations:

**Public Slack channel** — post a condensed digest, not the full update. This applies regardless of depth style: depth style controls how much detail goes into the *Confluence* version, not how long the Slack post is. A real run posted a Narrative-style boat's entire template — every sub-section, every Driver/Contributor tag, the full Goals Tracker — straight to Slack, and the captain flagged it as too long. A narrative boat's Slack post should end up roughly as short as a light-touch boat's; the extra depth shows up in what gets linked, not what gets pasted. Concretely:
- Keep the Captain's Summary in full — it's already short by design (3 to 5 sentences).
- Compress What Happened and What's Next into 3–6 highlight bullets covering the most important items, not one sub-section per initiative. Drop Driver/Contributor tags from the Slack version unless a specific name is essential to the headline — full attribution belongs in Confluence.
- Always include crew changes and milestones met — these are exactly what a skim reader shouldn't miss. Include a blocker line only if it needs immediate visibility. Leave Key Learnings, the Goals Tracker, and Cross-Functional Touchpoints for Confluence entirely.
- Close with a link to the full Confluence page instead of trying to fit everything into Slack.
- Self-check before posting: if the Slack draft is approaching the length of the full version, ask the person whether to condense further rather than deciding unilaterally — they may have a reason for wanting more detail in a given week.

Confirm which channel to post to if it isn't obvious — boats and crews don't all post in the same place (e.g., a crew-level async update may live in its own channel rather than the boat's main channel). Before posting, be aware that:
- The connected Slack identity needs `chat:write` scope, and either membership in the target channel or `chat:write.public` scope. If posting fails, surface the actual error rather than retrying blindly or guessing at a fix.
- Slack's message format is picky about nested markdown — avoid wrapping italics/underscores around text that also contains a raw URL and parentheses, since that's caused `invalid_blocks` errors in practice. Keep links and italic wrapping in separate lines when in doubt.
- **Named links need exactly one pair of angle brackets each, with the full display text inside.** A real run produced a Supporting Artifacts line where multi-word display text got split across two brackets, leaving raw `%7C` and duplicated URL fragments visible in the posted message — unreadable, not just cosmetically off. The pattern to follow:
  - Right: `<https://docs.google.com/document/d/XXXX/edit|Champion Guidebook>` — one URL, one pipe, the *entire* display phrase, one closing bracket.
  - Wrong: `<<https://docs.google.com/document/d/XXXX/edit%7CChampion|...|Champion> Guidebook>` — text split across brackets, a URL-encoded pipe (`%7C`) instead of a literal `|`, or an extra outer `<...>` wrapped around an already-complete link.
  - Same rule for channel mentions with trailing words: write `<#C0123456> follow-up`, not `<<#C0123456|follow-up> note>`. If a channel mention needs custom display text, put it inside that one link's own `|text`, don't bolt extra words on outside a second pair of brackets.
  - When a section has several links (e.g. Supporting Artifacts), the simplest reliable pattern is one link per line, or plain `Label: https://raw-url` pairs separated by ` · ` — Slack auto-links bare URLs, so skipping the bracket syntax entirely for a list of links is often safer than constructing named links by hand.

**Confluence** — publish the full version as a **new child page** under the boat/crew's running index page. Never edit the index page's own body in place to insert the week's content — in-place edits to that page have hit permission and version-conflict issues in practice.
- **Title the new page clearly**: `<Boat/Crew Name> Update — Week <N>, <date range> <year>`, e.g. "AI Delivery Enablement Crew Update — Week 34, Aug 18–22 2026".
- **Create it as a child of the index page** so it's discoverable in the page tree, not a loose page floating in the space.
- **Update the running index page's list of updates** with a link to the new child page, if the index maintains such a list *and* that list isn't already automatic. Check first: some index pages embed a live Confluence "Children pages" macro, which auto-lists every child page with no edit required — in that case, correctly placing the new page as a child is sufficient, and attempting a manual list edit is unnecessary extra work with its own failure risk. Only fall back to editing the index's list by hand if there's no such macro and the list is genuinely static. If no list of any kind exists yet, say so rather than silently skipping it — that's a one-time setup gap, not a reason to skip linking this week's page. If the index needs a manual edit and can't be edited (see below), give the person the link to add manually instead.
- **Don't assume the index's own stated conventions match actual practice.** If the index documents a title format or process, check whether existing child pages actually follow it — real usage can drift from documented guidance. If they disagree, flag the mismatch and ask which convention to follow rather than picking one silently.
- **Check write access before assuming any of this works — and check for both kinds of gap.** A Confluence connection can be read-only (can't create or edit anything), or it can allow creating new pages without allowing edits to existing ones — which would block updating the index page's list even though creating the child page works fine. Test for each separately rather than assuming one implies the other. **If the primary Atlassian connector is read-only, check whether a Zapier connection to Confluence Cloud is available as a fallback** — confirmed working in testing: Zapier's Confluence "Create Page" action takes `parent_id` directly (placing the page correctly with no separate hierarchy step), and its raw "Make API Mutating Request" action can set labels via Confluence's label endpoint even when no dedicated labels field exists. One gotcha: that raw request must go through `https://api.atlassian.com/ex/confluence/<cloudId>/wiki/rest/api/...` — hitting the tenant's own `https://<tenant>.atlassian.net/wiki/rest/api/...` URL directly returned a permission error despite a valid, working connection. If neither path can create pages, offer the fully-formatted page content for manual paste, and say exactly what's missing.
- **Apply labels to the new page** as part of the same publish step:
  - Category labels — `ai-boat-crew-update` and `ai-transformation` — always applied, no exceptions.
  - Owner label — derived from the Captain/crew-lead name captured in Step 2, formatted as `owner-<name>` (lowercase, hyphenated — e.g. `owner-senongo-akpem`). If that field is missing or ambiguous, ask rather than guess whose name it should be.
  - Status label — defaults to `current`.
  - If a prior week's page exists for this boat/crew, ask "Should I flip last week's page label to `superseded`?" and act on whatever the person says — never flip an existing page's label without asking first, even though the answer will usually be yes.
- If neither the Atlassian connector nor a Zapier connection can set labels, list the intended labels in the output so the person can apply them manually rather than dropping them silently.

## Step 5: Confirm what happened

After publishing, tell the person what actually went out and where — link to the Slack message and the new Confluence child page. Confluence publishing now has several independently-failable parts (page creation, the index page's list update, and labels) — report each one specifically rather than a single pass/fail for "Confluence." If only some succeeded (e.g., the page was created but labels couldn't be applied, or Slack posted but Confluence failed on permissions), say exactly which parts worked and which didn't rather than reporting a generic success.

## Testing / dry runs

If someone wants to test this workflow rather than run it for real, treat it exactly the same way but:
- Confirm the destination is a DM (to them, or to a specific named person) rather than the public channel, and don't post to the public channel or a real Confluence page unless they've said this is a real update.
- Label the message clearly as a test at the top, and if it's going to someone other than the requester, briefly explain why they're receiving it (they may not have context on why a "boat update" landed in their DMs).
