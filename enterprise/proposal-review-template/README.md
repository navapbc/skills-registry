# Proposal Review Skill

**Version:** 2.0 — Enterprise Edition

Evaluates any proposal, strategic initiative, roadmap, budget request, or document
through three lenses: **Alignment, Opportunities, and Risks**.

---

## What's in This Package

```
proposal-review-template/
├── SKILL.md                          The skill
├── 2026-company-goals.md             Nava's 6 company-level goals — primary alignment reference
├── 2026-goals-database-reference.md  Goals database schema and Confluence view links
├── change-mgmt-plan-template.md      CM plan template — for use if review leads to a change initiative
└── README.md                         This file
```

---

## Naming Convention

This package (`proposal-review-template`) is the shared enterprise starting point.
When a user personalizes the skill via onboarding, their version is saved with their
initials in the name (e.g. `proposal-review-dpo`). The enterprise template stays
installed — personalized skills cross-reference its reference files.

---

## How to Use

### First run — onboarding

The skill includes a built-in intake that runs on first load. It interviews you to
configure the skill for your role, team, and preferences (~2 minutes).

**What you'll be asked:**

| Question | Required? |
|----------|-----------|
| Your role | Yes |
| Your team or capability area | Yes |
| Your team's 2026 goals | Optional — paste or link from Confluence |
| Your standing strategic context | Optional — active initiatives, constraints |
| Your approver or CoS equivalent | Optional |
| Jira project key | Optional |
| Slack user ID or DM channel | Optional |

**Why each integration is offered:**
- **Google Drive** — so the skill can search for related documents, past decisions, and
  overlapping initiatives, without you having to manually surface them
- **Confluence** — same purpose: relevant policies, org structure, prior decisions
- **Jira** — so completed reviews can be posted directly as card comments, tracked
  alongside the work without copy-pasting
- **Slack** — so you get a DM summary when a review is ready, with top open questions
  surfaced so you don't have to read the full output to triage

All integrations are optional. The skill works fully without any of them.

**For team goals:** This package includes Nava's 6 company-level goals, which cover
most alignment evaluations. For team-specific alignment, paste your team goals during
onboarding or at the start of a session. Find team goals in Confluence:
[2026 Goals Database](https://navasage.atlassian.net/wiki/spaces/NH/pages/2483814426).

### Saving your personalized skill

At the end of onboarding, the skill offers to generate a personalized version with
your settings baked in — so you never answer the intake questions again.

The skill generates a configured SKILL.md with your settings pre-loaded. Save it
and you should see it in your skills list — no other setup needed. The personalized
skill reads reference files (company goals, goals database, CM plan template) from
the enterprise template package, so there's nothing extra to install.

You'll be asked to confirm:
- **Name** — convention is `proposal-review-[your initials]` (e.g. `proposal-review-dpo`)
- **Trigger phrase** — what activates it (default: 'review this proposal')

---

## Supported Modes

1. **Default** — internal proposals, roadmaps, budget requests, policy docs
2. **Press Release / External Comms** — any document going external
3. **Go/No-Go Decision** — binary/conditional decision memos
4. **Strategic Transformation** — org restructuring, multi-workstream initiatives
5. **Training Material** — training decks, workshops, eLearning

**To run it:**
> "Use the proposal-review skill to review [document or link]."

**What it produces:** A structured markdown review covering Summary Assessment,
Alignment with Company Goals, Opportunities Identified (including market timing windows),
Risk Assessment (including blocking dependency tracking), Open Questions,
Cross-Proposal Patterns, and Recommended Next Steps. Output format varies by mode —
press release reviews include a completeness checklist and quote quality assessment;
Go/No-Go reviews lead with a decision recommendation and blocking dependency inventory.

---

## Pairing with Change Management

If a proposal is approved and moving into execution, run the **change-mgmt** skill
next to generate a full CM plan. The two skills are designed to work in sequence:

1. Run **proposal-review** → alignment/risk analysis
2. Run **change-mgmt** → CM plan grounded in the reviewed proposal
