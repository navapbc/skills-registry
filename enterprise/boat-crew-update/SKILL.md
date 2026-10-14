name: boat-crew-update
description: >
  Use the Claude skill /boat-crew-update to automatically publish your updates to your crew's page in Confluence and in #ai-transformation on Slack. The skill applies the correct labels to your update in Confluence to help with Nava's broader knowledge management efforts. Finally, the skill can help you draft your update; Claude will draw from whatever source you point it to (a doc, a Slack channel, slides), apply formatting, and then post both with your approval. To let Claude post updates to Confluence directly, connect it via Zapier with write access — submit an Eden ticket if you don't have Nava's Zapier instance set up yet.
version: "1.1"
author: ryan@navapbc.com
author_name: Ryan Sibley
team: Practice - Design
sensitive_data: false
problem: This helps Boat and Crew captains create uniform updates and publish them in a uniform and findable way.
estimated_impact: Saves 30 minutes to 1 hour per use by compiling notes, formatting updates, and auto-posting to Slack and Confluence. Helps people find what they're looking for in Confluence through automatic, consistent tagging. Contributes to sustainable knowledge management and knowledge retrieval.
usage_frequency: Weekly
expected_audience: 6-15 people
impact_type: [Time saved per use, Increased output volume or consistency, Other]
compatibility: [claude-chat, claude-cowork]
tags: [boat-crew-update]
---

# Boat / Crew Update Workflow

This skill turns raw material — notes, a Slack thread, a quick conversation — into a properly formatted AI Transformation weekly update, gets human approval, and then publishes it to the right places.

## The template

Read `assets/boat-weekly-update-template.md` before drafting anything — it's the canonical structure (Captain's Summary, What Happened, What's Next, Crew Updates, Blockers, Cross-Functional Touchpoints, Key Learnings, Supporting Artifacts, and optional Goals Tracker).

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
- The date range this entry covers (e.g. Aug 18–22, 2026\) — this is what the entry heading leads with, so get it as a clean range rather than a week number

Fill in every section the source material supports. It's fine to leave a section brief or mark it not applicable — the template is a checklist of what's *commonly* included, not a requirement that every update fill every field every week.

## Step 3: Review with the person — always, no exceptions

Present exactly two blocks for approval, clearly labeled — not one combined draft, and not more than these two:

- **Slack digest preview:** Captain's Summary in full, 3–6 highlight bullets drawn from What Happened / What's Next, an optional line for an urgent blocker, crew change, or milestone met, and a link to the full update on Confluence.  
- **Confluence page preview:** Confluence preview should show just the new entry being added (its title and full body) plus a one-line note of where it's landing — e.g. "goes to the top of the Internal Ops Boat Updates log." It should not re-render the entire accumulated log every time; the captain only needs to approve what's new.

Since Step 4 produces genuinely different-length outputs for the two destinations, approving one doesn't tell you the other is right — showing only the master notes they were drafted from would hide exactly the kind of problem a captain needs to catch (e.g., a Slack version that's still too long, or a Confluence version missing something the Slack draft had). This is a hard gate, not a formality: nothing goes to a public Slack channel or Confluence without explicit approval of both previews, in the exact form they'll post in. Approval from an earlier week, or "just handle this every week," doesn't cover a specific week's content — confirm the content itself, not just the intent to publish.

## Step 4: Publish (only after approval)

Once approved, there are two destinations:

**Public Slack channel** — post a condensed digest, not the full update. Concretely:

- Keep the Captain's Summary in full — it's already short by design (3 to 5 sentences).  
- Compress What Happened and What's Next into 3–6 highlight bullets covering the most important items, not one sub-section per initiative. Drop Driver/Contributor tags from the Slack version unless a specific name is essential to the headline — full attribution belongs in Confluence.  
- Always include crew changes and milestones met — these are exactly what a skim reader shouldn't miss. Include a blocker line only if it needs immediate visibility. Leave Key Learnings, the Goals Tracker, and Cross-Functional Touchpoints for Confluence entirely.  
- Close with a link to the full update on Confluence instead of trying to fit everything into Slack.  
- Self-check before posting: if the Slack draft is approaching the length of the full version, ask the person whether to condense further rather than deciding unilaterally — they may have a reason for wanting more detail in a given week.

The default Slack channel to post to is \#ai-transformation. Confirm this and ask whether there are other channels to post to as well, such as a crew's own channel. Before posting, be aware that:

- The connected Slack identity needs `chat:write` scope, and either membership in the target channel or `chat:write.public` scope. If posting fails, surface the actual error rather than retrying blindly or guessing at a fix.  
- Slack's message format is picky about nested markdown — avoid wrapping italics/underscores around text that also contains a raw URL and parentheses, since that's caused `invalid_blocks` errors in practice. Keep links and italic wrapping in separate lines when in doubt.  
- **Named links need exactly one pair of angle brackets each, with the full display text inside.** A real run produced a Supporting Artifacts line where multi-word display text got split across two brackets, leaving raw `%7C` and duplicated URL fragments visible in the posted message — unreadable, not just cosmetically off. The pattern to follow:  
  - Right: `<https://docs.google.com/document/d/XXXX/edit|Champion Guidebook>` — one URL, one pipe, the *entire* display phrase, one closing bracket.  
  - Wrong: `<<https://docs.google.com/document/d/XXXX/edit%7CChampion|...|Champion> Guidebook>` — text split across brackets, a URL-encoded pipe (`%7C`) instead of a literal `|`, or an extra outer `<...>` wrapped around an already-complete link.  
  - Same rule for channel mentions with trailing words: write `<#C0123456> follow-up`, not `<<#C0123456|follow-up> note>`. If a channel mention needs custom display text, put it inside that one link's own `|text`, don't bolt extra words on outside a second pair of brackets.  
  - When a section has several links (e.g. Supporting Artifacts), the simplest reliable pattern is one link per line, or plain `Label: https://raw-url` pairs separated by `·` — Slack auto-links bare URLs, so skipping the bracket syntax entirely for a list of links is often safer than constructing named links by hand.

**Confluence** Identify the correct Update Log page for this boat/crew. Which pattern applies varies by boat, so check rather than assume: AI-Enabled Delivery's three crews (AI Delivery Systems, AI Delivery Enablement, AI Cross-Functional Collaboration) each keep their own crew-level log; AI Workforce Transformation, Internal Ops, and Frontier Solutions each keep a single boat-level log covering every crew under that boat. If more than one page looks plausible, ask rather than guess. Fetch the full current body of that page before writing anything. Never draft the new version from a cached or remembered copy of the page — always re-read it live, immediately before the write. Build the new entry as an HTML block titled with the date leading: `<date range>, <year> — <Boat/Crew Name> Update` "(e.g. "Oct 5–9, 2026 — Internal Ops Boat Update"), as an in-page heading — not a page title, and with no week number. Insert that new entry immediately after any introductory text at the top of the page and before the first existing entry. Newest is always first — never append at the bottom. Write the full page back — intro, the new entry, and every existing entry untouched — with the version number incremented by exactly one over the version just read. If the write is rejected for a version conflict, re-fetch and reapply; never force an overwrite. Never drop, truncate, or silently reword an existing entry while doing this. The same no-fabrication rule that governs the update's content also governs the page mechanics — this is an append operation in disguise, not a rewrite. 
Rule of thumb: if adding the new entry would push the log page's storage-format HTML past roughly 20,000–24,000 characters, don't force it onto the same page. Instead, start a new sibling page (close out the current page as "Part N," start a fresh "Part N+1" for new entries) and keep both linked from the boat/crew page. Whichever page is currently active, always point the boat/crew page's "What we're delivering" link at the newest/active part, and keep older parts cross-linked from it so the full history stays reachable.

- **Apply labels to the log page.** These only need confirming once, when the log page is first set up — not reapplied or reconfirmed on every weekly entry:  
  - Category labels — `ai-boat-crew-update` and `ai-transformation` — always applied, no exceptions.  
  - Crew label — derived from the boat/crew name, formatted as `ai-<name>-crew` (or `ai-<name>-boat` for a boat), lowercase and hyphenated — e.g. "AI Delivery Enablement Crew" becomes `ai-delivery-enablement-crew`. If the log page already uses a slightly different label (different word order, abbreviation, etc.), match that existing convention instead of deriving a fresh one, and ask if it's unclear which to use.  
  - Owner label — derived from the Captain/crew-lead name, formatted as `owner-<name>` (lowercase, hyphenated — e.g. `owner-senongo-akpem`). If that field is missing or ambiguous, ask rather than guess whose name it should be.  
  - If neither the Atlassian connector nor a Zapier connection can set labels, list the intended labels in the output so the person can apply them manually rather than dropping them silently.  
- **Check write access before assuming any of this works — and check for both kinds of gap.** A Confluence connection can be read-only (can't create or edit anything), or it can allow creating new pages without allowing edits to existing ones — which would block updating the update log's content even though creating child pages works fine. Test for each separately rather than assuming one implies the other. **If the primary Atlassian connector is read-only, check whether a Zapier connection to Confluence Cloud is available as a fallback** — confirmed working in testing: Zapier's Confluence "Create Page" action takes `parent_id` directly (placing the page correctly with no separate hierarchy step), and its raw "Make API Mutating Request" action can set labels via Confluence's label endpoint even when no dedicated labels field exists. One gotcha: that raw request must go through `https://api.atlassian.com/ex/confluence/<cloudId>/wiki/rest/api/...` — hitting the tenant's own `https://<tenant>.atlassian.net/wiki/rest/api/...` URL directly returned a permission error despite a valid, working connection. If neither path can create pages, offer the fully-formatted page content for manual paste, and say exactly what's missing.

## Step 5: Confirm what happened

After publishing, tell the person what actually went out and where — link to the Slack message and report which log page the entry was written to, confirmation it landed at the top rather than the bottom, and the resulting version number. Report each of these specifically rather than a single pass/fail for "Confluence." If only some succeeded (e.g., Slack posted but Confluence failed on permissions), say exactly which parts worked and which didn't rather than reporting a generic success.

## Testing / dry runs

If someone wants to test this workflow rather than run it for real, treat it exactly the same way but:

- Confirm the destination is a DM (to them, or to a specific named person) rather than the public channel, and don't post to the public channel or a real Confluence page unless they've said this is a real update.  
- Label the message clearly as a test at the top, and if it's going to someone other than the requester, briefly explain why they're receiving it (they may not have context on why a "boat update" landed in their DMs).
