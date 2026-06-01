# Change Management Skill

**Version:** 2.0 — Enterprise Edition

Takes a proposal or initiative description and produces a complete CM plan following
Nava's framework: ADKAR stakeholder analysis, concentric circles communication,
and the Policy Review Board process.

---

## What's in This Package

```
change-mgmt-template/
├── SKILL.md                      The skill
├── change-mgmt-plan-template.md  Fillable CM plan template
└── README.md                     This file
```

---

## Naming Convention

This package (`change-mgmt-template`) is the shared enterprise starting point.
When a user personalizes the skill via onboarding, their version is saved with their
initials in the name (e.g. `change-mgmt-dpo`). The enterprise template stays
installed — personalized skills cross-reference its reference files.

---

## How to Use

### First run — onboarding

The skill includes a built-in intake that runs on first load. It interviews you to
configure the skill for your role and preferences (~2 minutes).

**What you'll be asked:**

| Question | Required? |
|----------|-----------|
| Your role | Yes |
| Your approver or CoS equivalent | Optional |
| Your team or area | Optional |
| Jira project key | Optional |
| Slack user ID or DM channel | Optional |

**Why each integration is offered:**
- **Google Drive** — so the skill can search for related CM plans and initiative
  documentation, without you having to manually surface them
- **Confluence** — so the skill can find current policies and processes the change
  will affect
- **Jira** — so the CM plan can be tracked as a card in your project
- **Slack** — so you get a DM when the plan is ready with the next steps surfaced

All integrations are optional. The skill works fully without any of them.

### Saving your personalized skill

At the end of onboarding, the skill offers to generate a personalized version with
your settings baked in — so you never answer the intake questions again.

The skill generates a configured SKILL.md with your settings pre-loaded. Save it
and you should see it in your skills list — no other setup needed. The personalized
skill reads reference files (CM plan template) from the enterprise template package,
so there's nothing extra to install.

You'll be asked to confirm:
- **Name** — convention is `change-mgmt-[your initials]` (e.g. `change-mgmt-dpo`)
- **Trigger phrase** — what activates it (default: 'create a change management plan')

---

## What You Need to Run It

Either a proposal document (ideally reviewed by the **proposal-review** skill first)
or a plain description of:
1. What's changing and who it affects
2. Whether the change is reversible or irreversible

**To run it:**
> "Use the change-mgmt skill to create a CM plan for [initiative]."

**What it produces:** A complete CM plan using `change-mgmt-plan-template.md` as the
structural foundation, including ADKAR stakeholder analysis, risk matrix,
communication plan with draft messages, change management team structure, and
success metrics.

---

## Pairing with Proposal Review

The change-mgmt skill works best when the initiative has already been reviewed.
The proposal-review skill is a separate package — run it first if you have a proposal
document, then hand the output to this skill.

Typical workflow:
1. Run **proposal-review** → alignment/risk analysis
2. Run **change-mgmt** → CM plan grounded in the reviewed proposal
3. Share the CM plan with affected teams before announcement
