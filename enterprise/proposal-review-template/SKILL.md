---
name: proposal-review-template
version: "2.0"
category: writing-comms
compatibility: [claude-desktop]
description: >
  Review a proposal, strategic initiative, roadmap, project plan, press release, or
  document through three core lenses: alignment with company goals, cross-org
  opportunities, and execution risks. Supports five modes: (1) Default proposal review
  for internal documents, (2) Press Release / External Comms mode with completeness
  checklist and quote quality assessment, (3) Go/No-Go Decision mode with decision
  readiness assessment and blocking dependency tracking, (4) Strategic Transformation
  mode for org restructuring and multi-workstream initiatives, (5) Training Material
  mode for training decks, workshops, and learning programs. Use whenever someone says
  "review this proposal", "what do you think of this plan", "review this doc", "give
  me feedback on this initiative", or references a document that needs strategic evaluation.
---

# Proposal Review — Strategic Evaluation Skill

This skill helps you consistently evaluate proposals, strategic initiatives, roadmaps,
budget requests, and project plans through three core lenses: alignment, opportunities,
and risks. The value is consistency — asking the same foundational questions of every
proposal so nothing falls through the cracks.

---

## ONBOARDING — Scan, Confirm, Run

### Step 1: Check for Personalized Skill

Check `/mnt/skills/user/` for a personalized proposal-review skill (any folder
matching `proposal-review-*` that is NOT `proposal-review-template`).

- **If found:** Use the personalized skill's config. Say:
  > "Proposal review loaded — using your `proposal-review-[initials]` config
  > (reviewer: [role], [team] · approver: [name] · goals: Nava 2026). Share a
  > document — Google Doc link, paste, or upload — and I'll run the three-lens
  > evaluation."
  Then proceed to Step 0 (Detect Review Mode).

- **If not found:** Continue to Step 2.

### Step 2: Scan and Run

Scan all available context — project instructions, user preferences, memory,
connected integrations (Jira, Google Drive, etc.), and any sibling
personalized skills at `/mnt/skills/user/` (e.g., `change-mgmt-*`). Assemble
a config and present it — no confirmation gate, just show what you're using
and invite the user to start:

> "This skill evaluates proposals, initiatives, and strategic documents through
> three lenses: goal alignment, cross-org opportunities, and execution risks.
>
> Reviewing as [role], [team] against Nava 2026 company goals. Approver:
> [name or 'not set']. Integrations: [list or 'none detected'].
> *(Pulled from your project instructions and connected tools — say 'fix' if
> anything's off.)*
>
> Share a document — Google Doc link, paste, or upload — and I'll run the review."

If the user shares a document: proceed to Step 0 with this config.
If the user says "fix" or corrects something: absorb the correction and proceed.

For any field that couldn't be detected, note it as "not set" and use defaults
(company goals only, no approver, no integrations). Do NOT block the review to
ask — run with what you have.

### Step 3: Optional Enrichment (After First Review)

After delivering the first review — not before — offer optional personalization:

> "Want to sharpen future reviews? I can save a personalized version that locks
> in your config and adds team-specific goals or standing strategic context.
> Takes 2 minutes — or skip it, the template works fine as-is."

If yes, ask only the fields that add value beyond what was auto-detected:

**Team goals** *(optional)*
> "Do you have team-level goals for 2026 I should reference alongside company
> goals? Paste them or share a Confluence link."

→ Store as: `TEAM_GOALS_CONTEXT`

**Standing strategic context** *(optional)*
> "Any ongoing initiatives, org changes, or constraints I should factor into
> every review? (e.g., 'Active RFP in progress,' 'Headcount freeze through Q3')"

→ Store as: `STRATEGIC_CONTEXT`

Then generate the personalized skill:
> "Two quick things:
> - **Name:** Convention is `proposal-review-[your initials]` (e.g. `proposal-review-dpo`)
> - **Trigger phrase:** What should activate it? (default: 'review this proposal')"

→ Call skill-creator in lightweight mode — generate personalized SKILL.md with
config block baked in. The personalized skill must include a Reference Files section
that points to the enterprise template package for shared reference files (see
"Reference Files" section at end of this skill). Skip evals; the template is already
tested. Save the skill, and confirm: "Here's your personalized skill. Save it and
you should see it in your skills list — no other setup needed."

→ If no: proceed. The template works without personalization.

---

## Step 0: Detect Review Mode

Before proceeding, determine the review mode based on the document type.

### Mode 1: Default — Proposal Review
Use for internal proposals, strategic initiatives, roadmaps, budget requests, project
plans, policy documents, and similar internal documents. Default if type is unclear.

### Mode 2: Press Release / External Comms
Activate when the document is a press release, public announcement, blog post draft,
or any content intended for external audiences. Signals: "for immediate release,"
"media contact," "boilerplate," document is about a hire announcement, partnership
launch, contract win, or product release.

### Mode 3: Go/No-Go Decision
Activate when the document is a go/no-go recommendation, investment decision memo, or
business case requesting a binary or conditional decision. Signals: "go/no-go,"
"recommendation," "decision brief," pros/cons framing with an explicit decision ask.

### Mode 4: Strategic Transformation
Activate when the document describes an organizational restructuring, multi-workstream
strategic initiative, or operating model change. Signals: multiple named workstreams,
structural changes to org design or reporting lines, parallel initiatives.

### Mode 5: Training Material
Activate when the document is a training deck, facilitation guide, workshop curriculum,
or eLearning module. Signals: learning objectives, scenarios, exercises, assessments,
"onboarding," "course," "facilitation guide."

---

## Step 1: Identify the Document Under Review

### 1A. Google Doc URL
If the request includes a Google Doc link, fetch it using the Google Drive tool.
If fetch fails (Sheets, Slides, permission issue), note the limitation and ask the
user to paste the content or provide an alternative.

### 1B. Pasted Text or Attached File
Use the provided content as-is. If it's a file, read it with the appropriate tool.

### 1C. Described Initiative
If the user describes an initiative verbally without a document, ask: "Can you share
the document or paste the key details? I can review from a description, but a written
document gives more to work with."

### 1D. Document Readiness Assessment

Before evaluating, assess the document's maturity level.

**Scan for:**
- **Draft indicators:** "DRAFT" in title/header, [TBD]/[placeholder]/[TODO] markers,
  v0.x version numbers, tracked changes
- **Mid-edit indicators:** Inconsistent formatting, incomplete sections with "..."
- **Final indicators:** Clean formatting throughout, version ≥ 1.0, "FINAL" or "FOR REVIEW"

**Classify as:**
1. **Early draft** — Focus on directional feedback (framing, missing structure) rather
   than line-level critique. Flag draft status prominently.
2. **Mid-edit** — Review normally; note which sections appear unfinished.
3. **Final / near-final** — Review at full depth, hold to highest standard.

Include in review header:
```
**Document maturity:** [Early draft / Mid-edit / Final] — [one-line evidence]
```

---

## Step 2: Gather Context for Evaluation

### 2A. Goals Reference

Use the following in order of availability:

1. **`2026-company-goals.md`** (included in this package) — the 6 company-level goals.
   Primary alignment reference for all reviews.
2. **`TEAM_GOALS_CONTEXT`** — if the user provided team goals during onboarding, apply
   them as the secondary alignment layer for the relevant capability area.
3. **`STRATEGIC_CONTEXT`** — if the user provided standing strategic context during
   onboarding, factor it into the evaluation.

If neither team goals nor strategic context were provided and the proposal relates to
a specific capability area, ask: "Do you have team-level goals for [REVIEWER_TEAM]
I should reference for this review?"

### 2B. Related Documents (Optional — if integrations are available)

If Google Drive access is enabled in this session:
```
Search: "[proposal topic keywords]" in Google Drive
```

If Confluence access is enabled:
```
Search Confluence for: text ~ "[topic keyword]"
```

If neither is available, ask: "Are there related documents or prior decisions I should
know about before reviewing this? Paste links or key context here."

### 2C. Prior Reviews — Cross-Proposal Pattern Detection

If you have reviewed related proposals in this or prior sessions, cross-reference for
recurring patterns. If the user wants to enable longitudinal tracking:

> "If you've reviewed this document or related proposals before, paste your prior
> review findings here and I'll compare against them for patterns and evolution."

Look for:
- **Recurring gaps:** Same issue appearing across 2+ reviews (e.g., missing cost models,
  unclear role ownership, no change management plan). Call out as a **systemic pattern**.
- **Contradictions:** Current proposal conflicts with a prior review's recommendation.
- **Compounding opportunities:** Current proposal can build on a prior reviewed initiative.

If no prior reviews are provided, note "No prior reviews provided for comparison" and proceed.

---

## Step 2B: Press Release Pre-Check (Press Release Mode Only)

Skip if in Default mode. Run BEFORE the three-lens evaluation.

### Completeness Checklist

| Component | Required? |
|-----------|-----------|
| Headline | Yes |
| Subhead / dateline | Yes |
| Lead paragraph (who/what/when) | Yes |
| Subject quote (for hire/appointment announcements) | Conditional |
| Executive quote | Yes |
| Context paragraph (why this matters) | Yes |
| "About Nava" boilerplate | Yes |
| Media contact | Yes |

### Quote Quality Assessment

For every executive quote in the draft:

1. **Flag generic filler.** Phrases like "so excited," "thrilled to welcome," "passionate
   about," or "look forward to" are first-draft signals that waste the quote's strategic
   real estate.
2. **Suggest a sharpening direction.** Don't rewrite the quote — name what's missing:
   "This quote says we're excited but doesn't say *why now* — consider referencing
   [specific strategic context]."

### Timeline-Aware Urgency Flagging

1. **Publication date.** Search for the target publish date in the document. If found,
   calculate days remaining and flag prominently.
2. **Dependent actions.** Identify anything that must happen before publication: getting
   a quote, legal review, executive sign-off. Flag any unresolved items with timeline.
3. **Personnel availability.** Flag if anyone critical to the release appears unavailable
   during the publication window.

---

## Step 3: Apply the Three Lenses

Core of the review. For each lens, work through every applicable question. Skip
questions that genuinely don't apply and note why.

### Lens 1: Alignment

1. **Company goals alignment** — Which of Nava's 2026 goals does this advance? Which
   does it not address? (Reference `2026-company-goals.md` and team goals if available.)
2. **Differentiation** — Does this continue to differentiate Nava, or does it revert to
   the mean? What makes this distinctly "Nava" vs. what any government contractor would do?
3. **Industry best practices** — Is it missing key facets from industry best practices?
   If it diverges from standard approaches, is that divergence strategic or an oversight?
4. **Scale readiness** — Are there compounding advantages as Nava grows? Will this still
   work at 2x current scale, or does it create future bottlenecks?

### Lens 2: Opportunities

1. **Cross-org synergies** — Does this overlap with another team's strategic initiatives?
   Who should be connected to create leverage?
2. **Resource availability** — Does it have the right resources? Is there existing budget
   that could be repurposed to support this?
3. **External milestones** — Are there external milestones (conferences, client launches,
   press moments) that align with this timeline?
4. **Multi-dimensional upside** — What's the growth, delivery, talent, marketing, ops,
   or finance upside? How measurable is each dimension?
5. **Market timing window** — Are there time-bounded external windows that affect urgency?
   Consider: competitive moves, legislative/regulatory deadlines (H.R. 1, budget cycles),
   client procurement windows, partnership opportunities with expiry.
   Name the window explicitly with a date and quantify the consequence of missing it.

   Also look for BD / client advocacy material worth capturing: strong client quotes,
   unexpected praise, or relationship signals that should be routed to the BD team or
   catalogued in the past-performance library.

### Lens 3: Risks

1. **Execution risks** — What's most likely to cause this to fail or stall?
2. **Change management consultation** — Have the right people been consulted? For
   delivery-impacting changes, have delivery leaders been involved? If it touches
   Contracts, Finance, or Pricing, have those functions been consulted?
3. **Role clarity** — Are roles and responsibilities clear? Is there ambiguity about
   who owns what?
4. **Milestone clarity** — Are milestones clear and incremental? Can progress be measured
   at intermediate points, or is it all-or-nothing?
5. **Communication / CM readiness** — Is there an adequate communication or change
   management plan? If not, flag and recommend running the change-mgmt skill.
6. **Strategic risks** — What needs to be deprioritized to make room for this? What
   happens if this succeeds but at the cost of something else important?
7. **Cost model completeness** — **Is there a total cost estimate?** If a proposal
   requests resources, headcount, tools, or any investment, it MUST include a cost
   model. If missing, flag as **HIGH** severity. The model should cover: direct costs
   (budget, tools, vendor fees), indirect costs (participant time valued against
   billable capacity), and opportunity costs. Flag: what blocking decisions haven't
   been made yet?
8. **Budget impact** — What's the EBITDA and cost structure impact? Does this need
   CFO/CEO visibility?
9. **Resolution / decision path completeness** — **Does the document end with a clear
   path to decision?** Flag documents that diagnose problems or present options without
   naming: (a) who makes the decision, (b) what information is needed, and (c) a
   timeline or forcing function. If missing, flag as **HIGH**.
10. **Dependency timeline tracking** — Scan for blocking decisions, approvals, or
    deliverables that must happen before this proposal can proceed. For each: named
    owner? Committed date? Tracked anywhere? Flag any undated blocking dependency
    as **MEDIUM–HIGH** severity.

---

## Step 3B: External Comms Supplemental Lenses (Press Release Mode Only)

Run AFTER the standard three lenses.

### Lens 4: External Audience Impact

1. **Media perspective** — Would a reporter find this newsworthy? What's the hook?
   If not, the release needs a strategic framing paragraph explaining why it matters.
2. **Prospect/client perspective** — How does this read to a state CIO or agency
   director evaluating Nava? Does it reinforce Nava's positioning as a modern
   government technology partner?
3. **Competitor perspective** — What signal does this send to competitors (Vimo,
   Deloitte, Gainwell, Accenture)? Is there anything a competitor could use against
   Nava? Conversely, does it make a statement they can't easily match?
4. **Talent perspective** — How does this read to a potential hire? Does it make Nava
   look like a place top talent would want to work?

### Lens 5: Distribution & Promotion Planning

1. **Timing alignment** — Does the publication date align with any external milestone?
2. **Social amplification** — Who should share this? Is anyone critical unavailable
   on publish day?
3. **Channel strategy** — Industry newsletters, partner organizations, Slack communities,
   Confluence announcements?
4. **Follow-on content** — Blog post, podcast mention, BD talking points?

---

## Step 3C: Go/No-Go Supplemental Framework (Go/No-Go Mode Only)

Run AFTER the standard three lenses.

### Decision Readiness Assessment

1. **What has been proven?** Confirmed, tested, or validated facts.
2. **What has not been proven?** Specific unknowns that remain open.
3. **Is there a blocking dependency that makes the decision premature?**
4. **What is the consequence of waiting?** Name the cost of delay and quantify it.

### Blocking Dependency Inventory

For each blocking dependency:

| Dependency | Owner | Status | Timeline | Consequence if unresolved |
|------------|-------|--------|----------|--------------------------|
| [Name] | [Person] | [status] | [date or "🚨 none"] | [impact] |

Flag any row where Timeline = "none" as **HIGH** priority.

### Risk-Weighted Recommendation

- **Go** — Evidence is sufficient, blocking dependencies have committed timelines.
- **Conditional Go** — Ready to proceed, but a named condition must be resolved first.
  Name the condition, owner, and deadline.
- **No-Go (for now)** — Name what must change for this to become a Go.

Also produce a **Floor Outcome assessment**: if the proposal goes forward and primary
risks materialize, what is the minimum viable outcome?

### Moat Durability (Product Proposals)

1. **What is the core defensible advantage?** (Network effect, data asset, regulatory
   positioning, relationships, proprietary process — be specific.)
2. **How durable is that advantage?** What would a well-resourced competitor (Vimo, KPMG,
   ChatGPT native integration) need to do to replicate it, and how long would it take?
3. **Is there a convergence risk?** General-purpose AI models are rapidly closing the gap
   on specialized applications. If the proposal's core value proposition is AI-assisted
   task performance (eligibility screening, document review, intake processing), is there
   a scenario where ChatGPT/Claude/Gemini commoditizes that capability within the decision
   horizon?

---

## Step 3D: Strategic Transformation Supplemental Framework (Strategic Transformation Mode Only)

Run AFTER the standard three lenses.

### Workstream Dependency and Interaction Mapping

For each named workstream:
1. Does this workstream depend on another workstream's output to start or complete?
2. Are there resource conflicts between workstreams?
3. What is the sequencing risk? If workstreams are parallel but one must complete first,
   the parallel timeline is misleading.
4. Which workstream is the critical path?

Format:
```
Workstream A → requires output of Workstream B before proceeding
Workstream C → parallel but competes with A for [resource/person]
Workstream D → critical path: if this slips, [consequence]
```

### Transformation-Level Governance Assessment

1. **Transformation-level governance:** Named driver for the whole initiative? Decision
   body? Shared OKRs across all workstreams? Review cadence?
2. **Workstream-level governance:** Named driver and committed milestones per workstream?
3. **Gap between levels:** Strong workstream governance but absent transformation
   governance (or vice versa) is a common failure mode — flag it.

### Scope Calibration Check

1. **Under-scoped elements:** Parts scoped too narrowly, leaving known gaps.
2. **Over-aggressive elements:** Parts where ambition exceeds organizational capacity.
3. **Missing linkages:** Parallel initiatives that this transformation should absorb,
   supersede, or connect to — but doesn't mention.

---

## Step 3E: Training Material Supplemental Framework (Training Material Mode Only)

Run AFTER the standard three lenses.

### Pedagogical Effectiveness Check

1. **Are learning objectives stated?** Without them, training has no accountability mechanism.
2. **Is the content scenario-grounded?** Abstract principles without concrete scenarios
   are harder to apply.
3. **Is the audience calibration right?** Too basic or too advanced both cause disengagement.
4. **Is there a mechanism to verify learning?** Knowledge checks, exercises, application
   assignments. Completion ≠ learning without verification.

### Generalizability Risk Flag

1. Does the training reference program-specific constraints not applicable elsewhere?
2. Are the scenarios generalizable, or do they depend on context that won't exist in
   other programs?
3. Is the training being deployed program-specific or org-wide? If it was built for one
   context but used broadly, flag the risk.

### Flywheel Impact Assessment

1. Does the training tell people what *not* to do without telling them what *to* do?
   This creates learned helplessness, not capability.
2. **Counterweight check:** Does the training include positive guidance alongside
   protective guidance? Absence of counterweight = chilling effect risk.
3. Is the escalation framework proportionate?

---

## Step 4: Write the Review

Tone: direct, constructive, specific. Not a rubber stamp, not a takedown — an honest
evaluation that helps the proposal get better.

### Default Mode Template

```markdown
# Proposal Review: [Proposal Title]

**Reviewer:** [REVIEWER_ROLE], [REVIEWER_TEAM]
**Date:** [YYYY-MM-DD]
**Source:** [Google Doc title + link / "provided directly"]
**Document maturity:** [Early draft / Mid-edit / Final] — [one-line evidence]
**Review type:** [First review / Longitudinal review — prior review dated YYYY-MM-DD]

---

## Summary Assessment

[2-3 sentences: overall impression. Is this ready to move forward, needs significant
rework, or is it directionally right but missing key elements? Name the strongest
aspect and the biggest gap. For longitudinal reviews: "This has improved materially
since [date] — X is resolved. The original blocking issue Y remains."]

---

## Evolution Since Prior Review (Longitudinal Reviews Only)

*Omit for first reviews.*

**Improvements made:** [What prior review flagged that this version now addresses]
**Gaps remaining:** [What prior review flagged that this version still doesn't address]
**New issues introduced:** [Anything that has gotten worse or is new]
**New external context:** [Market, org, or competitive changes since the prior review]

---

## Alignment with Company Goals

[For each alignment question that applies, provide a finding. Reference which 2026
goals are advanced or missed. If the proposal diverges from best practices, say
whether that's strategic or accidental.]

**Alignment verdict:** [Strong / Moderate / Weak / Unclear]

---

## Opportunities Identified

[For each opportunity, be specific about who to connect with, what budget line to
look at, or what external milestone to target. These should be actionable.

Include Market Timing Windows: any time-bounded external opportunity or threat.
Name the window, its date, and the consequence of missing it.

Include BD / client advocacy material worth capturing (strong client quotes,
unexpected praise) and route them explicitly: "This quote should be sent to BD
/ added to past performance library."]

---

## Risk Assessment

[For each risk, name it clearly and assess severity (high/medium/low). For high
risks, suggest a specific mitigation.

Include Dependency Timeline Tracking: for each blocking dependency, name the owner
and committed timeline. Flag any undated blocking dependencies explicitly.]

**Top risks:**
1. [Highest risk — one sentence]
2. [Second risk — one sentence]
3. [Third risk — one sentence]

**Blocking dependencies:**
| Dependency | Owner | Timeline | Status |
|------------|-------|----------|--------|
| [Name] | [Person] | [date or "🚨 none — flag"] | [status] |

---

## Open Questions

[Numbered list of the most important unresolved questions. Put blocking questions
first. Always include: (1) missing cost model if absent, (2) decision path/owner/
timeline if absent, (3) undated blocking dependencies.]

1. [Most critical open question]
2. [Second most critical]
...

---

## Cross-Proposal Patterns

[If prior reviews were provided in this session or this conversation, document
recurring themes here. If none provided, write "No prior reviews provided for
comparison."

If this proposal implicitly depends on or could unlock another initiative, name
the connection explicitly.]

---

## Related Reviews

[If prior reviews of related proposals were shared in this conversation, link or
summarize them here so there is an audit trail of how thinking has evolved.
If none were provided, write "No prior reviews provided for comparison."]

---

## Recommended Next Steps

[2-4 concrete actions. Examples: "Ask [Name] about [specific thing]",
"Request a revised version addressing [gap]", "Approve with the condition that
[X] is resolved by [date]", "Connect [Author] with [Person] about [overlap]".
If APPROVER_NAME is set, include a handoff step to them.]
```

### Press Release Mode Template

Use this template when in Press Release / External Comms mode.

```markdown
# Press Release Review: [Release Title]

**Reviewer:** [REVIEWER_ROLE], [REVIEWER_TEAM]
**Date:** [YYYY-MM-DD]
**Source:** [Google Doc title + link / "provided directly"]
**Document maturity:** [Early draft / Mid-edit / Final] — [one-line evidence]
**Review mode:** Press Release / External Comms

---

## Timeline & Urgency

**Draft deadline:** [date or "not found"]
**Target publish date:** [date or "not found"]
**Days remaining:** [N days to draft / N days to publish]
**Personnel flags:** [anyone critical OOO during this window, or "none identified"]

---

## Completeness Check

| Component | Status | Notes |
|-----------|--------|-------|
| Headline | ✅/❌ | [notes] |
| Subhead / dateline | ✅/❌ | [notes] |
| Lead paragraph (who/what/when) | ✅/❌ | [notes] |
| Subject quote | ✅/❌ | [notes] |
| Executive quote | ✅/❌ | [notes — include quote quality finding] |
| Context paragraph (why this matters) | ✅/❌ | [notes] |
| "About Nava" boilerplate | ✅/❌ | [notes] |
| Media contact | ✅/❌ | [notes] |

**Publish-readiness:** [Ready / Not ready — N components missing]

---

## Quote Quality

[For each quote, assess: specific or generic? What's missing?]

**[Person 1] quote:**
- Generic filler detected: [yes/no — list phrases if yes]
- Sharpening suggestion: [one concrete direction]

---

## Summary Assessment

[2-3 sentences on overall impression.]

---

## Alignment with Company Goals

[Same structure as default mode.]

**Alignment verdict:** [Strong / Moderate / Weak / Unclear]

---

## External Audience Impact

[How does this read to media, prospects, competitors, and potential hires?]

---

## Opportunities Identified

[Same structure as default mode, plus:]

### Distribution & Promotion
- **Timing alignment:** [any external milestones that coincide]
- **Social amplification:** [who should share, any availability gaps]
- **Follow-on content:** [blog, talking points, BD opportunities]

---

## Risk Assessment

[Same structure as default mode, including Blocking Dependencies table.]

**Top risks:**
1. [Highest risk — one sentence]
2. [Second risk — one sentence]
3. [Third risk — one sentence]

---

## Specific Edit Recommendations

[Concrete, actionable edits. For quotes, provide a "suggested direction" and
note that comms team owns the final language.]

---

## Open Questions

[Same structure as default mode.]

---

## Related Reviews

[Prior press release reviews shared in this conversation, if any.]

---

## Recommended Next Steps

[Same structure as default mode, but include timeline-aware actions
(e.g., "Confirm [Name] quote by [draft deadline]").]
```

### Go/No-Go Mode Template

Use this template when in Go/No-Go Decision mode.

```markdown
# Go/No-Go Review: [Initiative Title]

**Reviewer:** [REVIEWER_ROLE], [REVIEWER_TEAM]
**Date:** [YYYY-MM-DD]
**Source:** [Google Doc title + link / "provided directly"]
**Document maturity:** [Early draft / Mid-edit / Final] — [one-line evidence]
**Review mode:** Go/No-Go Decision
**Review type:** [First review / Longitudinal review — prior review dated YYYY-MM-DD]

---

## Decision Recommendation

**Recommendation:** [Go / Conditional Go / No-Go (for now)]

[2-3 sentences: the recommendation and the primary reason. Be direct.]

**Floor outcome (if risks materialize):** [Minimum viable outcome if primary
risks come true. The decision should be defensible even against the downside.]

**Cost of delay:** [What is lost by waiting? Quantify if possible.]

---

## Decision Readiness Assessment

**What has been proven:**
- [Validated fact 1]

**What has not been proven:**
- [Open unknown 1]

**Is the decision premature?** [Yes — because [specific blocking dependency] /
No — sufficient evidence exists to decide now]

---

## Blocking Dependency Inventory

| Dependency | Owner | Status | Timeline | Consequence if unresolved |
|------------|-------|--------|----------|--------------------------|
| [Name] | [Person] | [status] | [date or "🚨 none"] | [impact] |

---

## Market Timing Window

[Time-bounded external windows affecting this decision's urgency. Name the
window, the date, and the consequence of missing it.]

---

## Summary Assessment

[2-3 sentences on overall quality of the proposal.]

---

## Alignment with Company Goals

[Same structure as default mode.]

**Alignment verdict:** [Strong / Moderate / Weak / Unclear]

---

## Opportunities Identified

[Same structure as default mode.]

---

## Risk Assessment

[Same structure as default mode. Emphasize risks relevant to the go/no-go decision.]

**Top risks:**
1. [Highest risk — one sentence]
2. [Second risk — one sentence]
3. [Third risk — one sentence]

---

## Moat Durability (if product proposal)

**Core defensible advantage:** [one sentence]
**Durability assessment:** [how long before a well-resourced competitor replicates it]
**Convergence risk:** [general-purpose AI scenario that could commoditize the core
value proposition — name the scenario and time horizon]

---

## Open Questions

[Same structure as default mode.]

---

## Related Reviews

[Prior reviews shared in this conversation, if any.]

---

## Recommended Next Steps

[Lead with: what needs to happen to convert a Conditional Go to Go,
or what triggers a No-Go reversal.]
```

---

## Step 5: Deliver the Review

### Save or share
Deliver the review as a markdown document in this conversation. If the user wants
to save it, suggest pasting it into their preferred storage (Google Doc, Confluence,
Notion, etc.).

### If Jira is configured (JIRA_PROJECT_KEY set)
Offer to post the review as a Jira comment on a specified card. Confirm the card key
with the user before posting — never post to a Jira card that wasn't specified.

---

## Guardrails

- **No fabrication.** If you cannot access a document, say so. If you don't have
  the goals document, note what context you used instead. Never invent findings —
  if a lens doesn't have enough information, write "[Insufficient information to
  assess — need: X]".
- **Constructive, not performative.** Skip questions that genuinely don't apply
  rather than forcing generic feedback. When something is strong, say so briefly
  and move on.
- **Draft, don't finalize.** Flag anything uncertain with clear placeholders:
  "[FILL IN: stakeholder / date / metric]".
- **Mode escalation.** If a document reveals characteristics of another mode, note
  the mode escalation and apply the relevant supplemental framework.
- **Integrations are optional.** If Jira is not configured, deliver
  the review in the conversation. Do not block on missing integrations.

---

## Reference Files (Included in This Package)

This package includes the following reference files:

- **`2026-company-goals.md`** — Nava's 6 company-level goals. Primary alignment
  reference for all reviews.
- **`2026-goals-database-reference.md`** — Goals database schema and links to team
  build goals and health metrics views in Confluence.
- **`change-mgmt-plan-template.md`** — CM plan template. Referenced by Lens 3 when
  recommending the change-mgmt skill.

For team-specific goals (e.g., Technology Solutions & Services, Policy Strategy,
Growth/BD), use the team goals provided during onboarding, or ask the user to paste
the relevant goals before running the alignment lens.

### Cross-Reference for Personalized Skills

Personalized skills generated from this template do NOT duplicate these reference
files. Instead, they read them from this enterprise template package at:

```
/mnt/skills/user/proposal-review-template/2026-company-goals.md
/mnt/skills/user/proposal-review-template/2026-goals-database-reference.md
/mnt/skills/user/proposal-review-template/change-mgmt-plan-template.md
```

When generating a personalized skill via skill-creator, include this section in
the personalized SKILL.md:

```
## Reference Files
Read reference files from the enterprise template package at
`/mnt/skills/user/proposal-review-template/`:
- `2026-company-goals.md` — primary alignment reference
- `2026-goals-database-reference.md` — goals database schema
- `change-mgmt-plan-template.md` — CM plan template for Lens 3 recommendations

If reference files are not found at the expected path, note "[Reference files
unavailable — install proposal-review-template or paste goals here]" and proceed
with available context.
```
