---
name: external-discussion-prep
description: >
  Builds a briefing on an external person before you meet them: a state CIO,
  an agency lead, a partner exec. Run it with the person's name and the
  meeting ("/external-discussion-prep Bry Pardoe for the NASCIO dinner") or
  just say "prep me for a meeting with X." It checks whether Nava already has
  a dossier on them, then researches Confluence territory plans and Project
  Indexes, Salesforce, Slack channels, the Knowledge Source Index, and the
  public web. Output is facts first with a source on every claim, then
  labeled interpretation, then three Nava delivery examples to have in your
  back pocket for that person. The shared version publishes to the Discussion
  Prep Dossier Hub in Confluence so the next person doesn't start from zero.
  Anything from your own email and calendar stays in a local file and never
  lands on the shared page.
version: "1.0"
author: mikecase@navapbc.com
author_name: Mike Case
team: Other
sensitive_data: false
problem: "Prepping for an external meeting means chasing the same trail every time: the territory plan, the Salesforce contact, three Slack channels, a news search. Call it one to two hours per meeting, and the result lives in someone's notes and dies there. Salesforce contacts are routinely a role or two stale, so the person walking in often has the wrong title in their head. This skill runs the whole trail in one pass, cites everything, and leaves a reviewed dossier in Confluence that the next person can reuse. Each run also flags where our records are stale, so the prep work compounds instead of evaporating."
estimated_impact: Replaces 1 to 2 hours of hand research per external meeting with a 20 to 30 minute unattended run. Each dossier also surfaces roughly 10 stale or missing records in Salesforce and Confluence for the owners to refresh.
usage_frequency: Weekly
expected_audience: 6-15 people
impact_type: [Time saved per use, Reduced error rate or rework, Increased output volume or consistency]
compatibility: [claude-chat, claude-cowork, claude-code]
tags: [meeting-prep, business-development, stakeholder-research]
data_sources: "Confluence (Business Development territory plans, Project Index spaces, Knowledge Source Index, and the Discussion Prep Dossier Hub in CENTKM, where it publishes). Salesforce (Contact, Account, Opportunity, contact roles, campaign membership, activities). Slack public and private channels only, never DMs. Public web search. Optional, requester-only: Gmail and Google Calendar, written to a local private file and never published. No LinkedIn. The skill never writes to Salesforce or any source system; it publishes one Confluence page and proposes record fixes in a machine-readable block for human approval."
---

# External discussion prep

Load and follow the routine at `routines/external-discussion-prep.md`. Page layout and the
property schema live in `references/page-template.md`.

Four rules travel with every run:

1. **Shared sources only in the shared dossier.** Email, calendar, and Slack
   DMs are the requester's private layer. They inform a local addendum and
   never appear on the Confluence page.
2. **Facts before synthesis, a citation per claim.** Anything without a
   resolvable source is labeled unverified or cut.
3. **Check the ledger first.** A prior dossier on the same person is offered
   for reuse or refresh before any new research starts.
4. **Every page carries a claims block.** Facts that touch a system of record
   are restated as machine-readable rows (value as read, value found, source,
   gate). The hub-wide custodian reads those rows, not the prose, to propose
   write-backs. The run itself never writes to a source.
