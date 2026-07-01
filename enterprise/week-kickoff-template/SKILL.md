---
name: week-kickoff-template
version: "1.0"
author: michellethong@navapbc.com
author_name: Michelle Thong
team: Practice - Product Management
category: planning
compatibility: [claude-chat, claude-cowork]
description: >
  Run the start-of-week planning ritual for any Nava manager or leader. Produces a focused weekly goals and tasks document grounded in the user's strategic priorities, real data from Slack/Jira/Calendar, and their own input on what matters most this week. Triggers when the user says "week kickoff", "weekly planning", "start of week", "plan out the week", "let's set up my weekly goals", or similar. Invoke proactively at the start of any Monday work session where weekly goals haven't been set.

---

# Week Kickoff (Nava Enterprise Template)

Runs a weekly planning ritual that produces a concise, action-oriented goals and tasks document. Designed for Nava managers and leaders whose weeks span people management, hiring, delivery escalations, BD, and strategic initiatives.

This is an enterprise template. The first run auto-detects your context and runs immediately. After your first weekly plan, you'll be offered an optional 2-minute personalization to save a version that locks in your config.

---

## ONBOARDING — Scan, Confirm, Run

### Step 1: Check for a personalized version

Check `/mnt/skills/user/` for a personalized week-kickoff skill (any folder matching `week-kickoff-*` that is NOT `week-kickoff-template`).

- **If found:** Use the personalized skill's config. Say:
  > "Week kickoff loaded — using your `week-kickoff-[initials]` config ([role], [team]; approver: [name]; planning board: [project key]). Ready when you are — what's in your head from last week?"

  Then proceed directly to Step 1 (Brain Dump) of the working skill.

- **If not found:** Continue to Step 2.

### Step 2: Scan and Run

Scan all available context — project instructions, user preferences, memory, connected integrations (Slack, Jira, Google Calendar, Google Drive) — and assemble a working config. No confirmation gate. Present it inline and start.

Format:

> "Weekly planning ritual for Nava managers. Produces a focused goals + tasks doc for the week.
>
> Detected: [role/team]. Manager: [name or 'not set']. Slack DM filter: [list of leadership peers or 'not set']. Planning board: [Jira project key or 'not set']. Output folder: [path or 'not set'].
> *(Pulled from your project instructions and connected tools — say 'fix' if anything's off.)*
>
> What's in your head from last week? Conversations, decisions in progress, things you've been mulling over that I won't find in Slack, Jira, or your calendar?"

For any field that couldn't be detected, note it as "not set" and proceed with defaults. Do NOT block the skill to ask — run with what you have. If the user says "fix" or corrects a value, absorb the correction and continue.

### Step 3: Optional enrichment (offered AFTER first weekly plan is saved)

After delivering the first plan — not before — offer optional personalization:

> "Want to sharpen future week kickoffs? I can save a personalized version that locks in your config and adds your standing strategic priorities. Takes 2 minutes — or skip it, the template works fine as-is."

If yes, ask only the fields that add value beyond auto-detection:
- Standing strategic priorities (a few bullets about quarter/year-level goals)
- Your typical goal categories / workstreams for the week (3–6 categories that fit your role — e.g., a Product Director's categories differ from a Software Engineer's or a BD lead's)
- Any recurring all-week events to handle specially (like rotating duties or rotations)

Then call skill-creator in lightweight mode. Convention is `week-kickoff-[your initials]` (e.g., `week-kickoff-mt`). The personalized skill should include a Reference Files section that cross-references this template package (see "Reference Files" at the bottom).

If no: proceed. The template works without personalization.

---

## Step 1: Brain dump

Before pulling any data, ask the user for context that lives only in their head — conversations, decisions in progress, things they've been mulling over that aren't captured in Slack, Jira, or their calendar. This is often the single highest-signal source of context for the week.

Ask one open-ended prompt and let them respond freeform:

> "Before I pull anything from your systems — what's in your head from last week? Conversations, decisions in progress, things you've been mulling over that I won't find in Slack, Jira, or your calendar?"

Capture what they say verbatim in working notes. This input feeds directly into Step 3 (goals) and Step 4 (tasks). Do not skip this step. Do not paraphrase or interpret before the goal-setting conversation — bring the raw input forward.

## Step 2: Pull data from all sources in parallel

Not every data source applies to every role. If a source has no analog for this user (e.g., they don't use Jira, don't have a prior weekly plan, work in a non-Google calendar), skip it gracefully — do not fabricate or force-fit data. Pull only from sources that are actually configured or detectable. The brain dump (Step 1) is always the foundation; data sources fill in around it, not the other way around.

### Google Calendar
- Pull full week (Mon–Fri) from the user's primary calendar
- Always display times in the user's timezone (default: EDT for Nava unless onboarding indicated otherwise)
- Identify focus windows (solo blocks, Clockwise holds) and meeting density by day
- Ignore: working location events, Clockwise break blocks, all-day events, personal logistics
- Do NOT recite the full calendar — synthesize into a 1–2 sentence day shape per day
- Only flag meetings where there is specific prep needed, a concrete deliverable to action, or a noteworthy constraint on the day

### Slack
Run these searches in parallel and consolidate:
- `from:me` over the past 7 days — active threads, commitments made, follow-up items
- `@<your handle>` over the past 7 days — flag mentions where you have NOT replied in the thread
- DMs to you from your manager and named leadership peers (from onboarding config; if not set, surface DMs from anyone in your reporting line based on profile metadata)
- For each thread you participated in over the past 7 days, check whether someone else replied AFTER your most recent message — if so, flag it as "others waiting on you"
- Flag anything you committed to doing, anything others are waiting on you for, and any unanswered @mentions

### Previous week's plan
- Read the most recent file in the user's weekly plans folder (from onboarding config)
- Carry forward any `[ ]` incomplete items, clearly marking them as carryover
- Note what completed vs. what was explicitly deferred

### Jira boards
Nava Atlassian cloud ID: `7098e6a8-4012-415f-9d9e-b4b2e371b219` <!-- Hardcoded — check this value first if Jira calls return 403/404 -->

Boards are role-specific. A Product Director cares about staffing and onboarding boards; an engineer cares about their delivery contract's backlog; a BD lead cares about pursuit pipelines. There is no default set of boards.

How to pull Jira data:

1. **If a personalized skill is loaded**, use the list of boards stored there. Each board entry should include: project key, JQL query, and a short note on how to interpret results (which columns matter, what counts as actionable).
2. **If no personalized skill**, use connected Atlassian context to identify boards the user has recent activity on. Pull tickets assigned to the user with `assignee = currentUser() AND status not in (Done)` across those boards as a default.
3. **If no Jira boards are configured or detectable, or if the user doesn't use Jira at all**, skip this data source entirely. Some Nava roles have no Jira analog — that's fine. Do not fabricate boards or force-fit other tools into this section.

Apply the same filtering rule across all boards: only surface tickets that need attention this week — not the entire backlog. Tickets assigned to others are FYI only unless the user needs to weigh in.

**Common Nava board patterns** (examples; users should configure what's relevant to them):
- A personal or team planning board (e.g., a Product Leadership board, Design Practice board, Engineering Practice board)
- The Nava-wide Staffing Open Roles board (`SO`, with `cf[10065]` as the department filter) — relevant for hiring managers
- Department onboarding boards (e.g., PDMO for Product) — relevant for managers with new reports
- Delivery contract boards — relevant for ICs working on a specific contract
- Pursuit/BD boards — relevant for BD leads

## Step 3: Align on high-level goals with the user

Before drafting, align with the user on what they want to focus on this week. Their brain dump from Step 1 is the primary source for goals. The data from Step 2 provides supporting context — but goals come from the user's own sense of what matters, not be reverse-engineered from their calendar and task boards.

Present a brief summary combining (a) themes from the brain dump and (b) what the data surfaced, then ask:

> "Here's what I heard from your brain dump and what the data is surfacing: [brief summary]. **Given that, what are your top priorities this week — what do you most want to accomplish?**"

Let them respond freeform. Their input is the primary basis for the Goals section. If goals don't map to the standard categories below, that's fine — categories are a scaffold, not a straitjacket. If there are obvious gaps (e.g., a performance review on the calendar they didn't mention), ask a targeted follow-up — but keep it to one or two questions max.

Also use this moment to ask about areas the data can't surface:
- Active delivery escalations or contract issues
- BD activity (proposals, SME asks, growth conversations)
- Cross-functional initiatives needing this-week action
- Anything they've been deferring that should get addressed

## Step 4: Draft the weekly plan

### Goal categories
Categories are role-specific. There is no default list — what matters to a Product Director is different from what matters to a Software Engineer, a Designer, a Program Manager, or a BD lead.

How to derive categories:

1. **If a personalized skill is loaded**, use the categories stored there.
2. **If no personalized skill**, infer categories from the user's stated priorities in their brain dump (Step 1) and goal-setting conversation (Step 3). Group their stated goals into 3–6 categories that reflect their actual workstreams.
3. **If categories aren't obvious**, ask: "What are the 3–5 workstreams or categories you'd group your weekly goals under?" Use their answer as the scaffold.

Categories should be the user's own framing. Do not impose categories from another role.

### Goal writing rules
Strong goals are the most important part of the plan — they inform prioritization of everything else. Goals are high-level outcomes that answer "what am I trying to accomplish this week?" — not tasks. The user's freeform input from Step 3 is the primary source for goals.

- **1–2 bullets max per category.** Tasks belong in daily sections, not here.
- Write goals in the user's voice, reflecting what they said they want to accomplish.
- Example of a goal: "Complete performance review cycle: finalize narratives, manager prep, promotion comms by Mar 27"
- Example of what is NOT a goal: "Create manager checklist, schedule LP review slot" (these are tasks)

### Daily task rules
Daily task lists should be short and high-signal. Every item should represent real work that produces an output or requires meaningful preparation.

- **Include**: drafting, sending, deciding, completing a deliverable, or preparing a concrete artifact for a high-stakes meeting.
- **Do NOT include**: calendar hygiene (RSVPs, conflict resolution), routine meeting attendance, prep for recurring standups, or generic reminders like "check for DM response." The user manages their own calendar, agendas, and standup topics.
- **CRITICAL: Do not prescribe what the user will do at any meeting.** This includes 1:1s, recurring syncs, coworking time, office hours, and ad-hoc conversations. You do not have enough context about what's being discussed at their meetings. Examples of tasks to NEVER write:
  - "[Name] 1:1 — verify handoff progress"
  - "Use coworking time to align on X"
  - "Walk into 2:30 with a clear preferred outcome on Y"
  - "Drop in to Office Hours to socialize Z"
  - "Discuss X with [name] at 1:1"

  The only exception: a concrete deliverable that must exist BEFORE the meeting (e.g., "Finalize scope doc for 2pm welcome"). Even then, the task is about producing the deliverable, not what happens in the meeting.
- Group tasks by goal category using italic headers (e.g., _People management_).

### Calendar rules
- Write the **day shape** as a short italic note at the top of each day
- Put tasks in the day where they make most sense given focus windows and meeting anchors
- Do NOT include a Conflicts to Resolve section — the user manages their own calendar

### What NOT to include in the plan
- **No Notes/Carryover section.** These duplicate Jira boards and Slack threads.
- **No Active open roles section.** The SO board is the source of truth.
- **No "Items to review" section.** Surface ambiguous items in conversation during Step 5, not in the document.

### Output format

```
## Goals for This Week

- [Category]: [goal]
- [Category]: [goal]

---

## Mon, [Month Day]

_[Day shape: 1–2 sentences on focus time and meeting density]_

_[Category]_
- [ ] [task]

## Tue, [Month Day]
...
```

## Step 5: Add additional tasks and review with the user

Share the draft and explicitly prompt for tasks the data and brain dump may have missed. The first draft is a starting point, not the final answer — the user almost always knows about commitments, prep, or follow-ups that didn't surface in any system.

Ask:

> "Here's the first draft. **What else needs to be on here?** Anything you want to add, move to a different day, or remove?"

Capture additions in the appropriate day and goal category. If a new task doesn't fit existing goals, ask whether it warrants a new goal or sits under the closest category.

Iterate until the user is satisfied. Do not push back on additions — their judgment on what belongs is final.

## Step 6: Save the file

Save the completed plan to the user's weekly plans folder (from onboarding config) as:
`Goals and tasks for week of [Mon Month Day] [Year].md`

Default folder if not configured: ask the user where they want it saved.

---

## Reference Files (Included in This Package)

- `README.md` — installation guide, onboarding overview, what gets auto-detected vs. asked

### Cross-Reference for Personalized Skills

Personalized skills generated from this template do NOT duplicate this template's content. When generating a personalized skill via skill-creator (during the optional enrichment in Step 3 above), include this section in the personalized SKILL.md:

```markdown
## Reference Files
Read the enterprise template at `/mnt/skills/user/week-kickoff-template/` for the canonical workflow:
- `SKILL.md` — full week-kickoff procedure (Steps 1–6)

If the enterprise template is not found, note "[week-kickoff-template not installed — using personalized config only]" and proceed with the personalized skill's own steps.
```

The personalized skill stores only what's specific to one user (their config, standing priorities, custom goal categories, output folder path) and defers to the enterprise template for the workflow steps. When the workflow updates, every personalized skill inherits the change.
