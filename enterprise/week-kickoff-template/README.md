# week-kickoff-template

An enterprise template for Nava managers and leaders to run a Monday-morning weekly planning ritual. Produces a focused, action-oriented goals + tasks document grounded in your strategic priorities, real data from Slack/Jira/Calendar, and your own input on what matters most.

## What's in this package

- `SKILL.md` — the full skill: onboarding flow, 6-step weekly planning ritual, output format
- `README.md` — this file

## Who this is for

Any Nava employee whose week benefits from a structured planning ritual — Directors, ICs, BD leads, designers, engineers, program managers, policy strategists. The template assumes Nava-wide tools (Atlassian, Slack, Google Calendar) but does not impose role-specific goal categories — those come from your own workstreams.

## How to use

### First run (zero setup)

Install the skill. Trigger it by saying "week kickoff", "weekly planning", "start of week", or "plan out the week". On the first run, the skill scans your project instructions, memory, and connected integrations to assemble a working config, then starts immediately with the brain dump.

No multi-question interview. If something's wrong, say "fix" and correct it inline.

### After your first weekly plan

You'll be offered an optional 2-minute personalization. If you accept, the skill saves a personalized version named `week-kickoff-[your initials]` (e.g., `week-kickoff-mt`) that:

- Locks in your role, team, manager, leadership peer list, planning board project key, and weekly plans output folder
- Stores your standing strategic priorities (quarter/year-level goals)
- Stores your typical goal categories / workstreams for the week (3–6 categories specific to your role)
- Cross-references this template for the workflow steps — so when the workflow improves, your personalized version inherits the change

If you skip personalization, the template still works fine — it just re-scans for context each time.

## What gets auto-detected vs. asked

| Field | Source |
|---|---|
| Role / team | Project instructions, memory, profile metadata |
| Manager name | Sibling skills, memory, Slack profile |
| Leadership peer DM filter | Sibling skills, memory, org chart context |
| Planning board (Jira project key) | Connected Atlassian; recent activity |
| Weekly plans output folder | Memory; defaults to asking |
| Department (for SO staffing board filter) | Project instructions, memory |
| Standing strategic priorities | Asked during optional enrichment after first use |
| Goal categories / workstreams | Inferred from your brain dump on first run; asked + saved during optional enrichment |

## What it produces

A markdown file in your weekly plans folder, named `Goals and tasks for week of [Mon Month Day] [Year].md`, with:

- **Goals for This Week** — 1–2 bullets per active category, in your voice, reflecting what you said you want to accomplish
- **Per-day sections** (Mon–Fri) — short day shape note + tasks grouped by goal category

The plan deliberately excludes calendar agendas, RSVPs, meeting prescriptions, "items to review" sections, or carryover dumps. Those live in your other systems.

## Design principles

- **The brain dump comes first.** What's in your head from last week is the highest-signal source for the week's priorities. Always.
- **Goals come from you, not the data.** Slack/Jira/Calendar surface tasks; you set the goals.
- **Tasks must be real work.** Drafting, sending, deciding, producing a deliverable. Not "attend meeting" or "discuss X with Y".
- **Never prescribe meeting agendas.** The skill does not have enough context about what happens in your meetings.

## Pairing

Works well with a corresponding mid-week or end-of-week progress check-in skill (not included in this package).
