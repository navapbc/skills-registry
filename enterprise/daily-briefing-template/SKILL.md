---
name: daily-briefing-template
category: ops-automation
compatibility: [claude-desktop]
description: Run a fast daily briefing to orient any Nava employee to their day. Pulls calendar and Slack signals in parallel and delivers a tight, 1–2 minute summary — meeting density, prep needs, urgent Slack items. Triggers when the user says "morning briefing", "daily briefing", "good morning", "what's on my plate today", "start my day", or opens a session with a short, open-ended, greeting-like first message. Invoke proactively at the start of a workday session when no specific task is given.
---
 
# Daily Briefing
 
Runs a fast daily briefing to orient the user to their day. Pull data sources in parallel, then deliver a concise summary. Goal: 1–2 minutes of reading, not a report.
 
---
 
## ONBOARDING — Scan, Confirm, Run
 
### Step 1: Check for Personalized Skill
 
Check `/mnt/skills/user/` for a personalized daily-briefing skill (any folder matching `daily-briefing-*` that is NOT `daily-briefing-template`).
 
- **If found:** Use the personalized skill's config. Say:
  > "Daily briefing loaded — using your `daily-briefing-[initials]` config (role: [role], timezone: [tz], priority people: [count or list]). Pulling your calendar and Slack now."
  Then proceed to Step 1 of the briefing flow. Name the actual skill file so the user knows where the config is coming from.
- **If not found:** Continue to Step 2.
### Step 2: Scan and Run
 
Scan all available context — project instructions, user preferences, memory, connected integrations (Google Calendar, Slack, Jira, Outlook, etc.), and any sibling personalized skills at `/mnt/skills/user/`. Assemble a config and present it inline — no confirmation gate.
 
Present like this:
 
> "Quick daily briefing — meeting density, prep needs, urgent Slack.
>
> Role: [role or 'not set']. Timezone: [tz or system default]. Priority people: [list or 'not set']. Integrations: [Calendar / Slack / Jira detected or 'none detected'].
> *(Pulled from your project instructions and connected tools — say 'fix' if anything's off.)*
>
> Pulling now."
 
Then proceed immediately to Step 1 of the briefing flow. Do NOT wait for confirmation. "Say 'fix' if anything's off" is the escape hatch, not a gate.
 
For any field that couldn't be detected, note "not set" and use sensible defaults:
- **Role:** generic professional context
- **Timezone:** system local time
- **Priority people:** treat all sender signals as equal weight
- **Integrations:** skip sections for missing integrations and note them in the briefing footer
### Step 3: Optional Enrichment (After First Use)
 
After delivering the first briefing — not before — offer optional personalization:
 
> "Want sharper briefings tomorrow? I can save a personalized version that locks in your config and adds priority people, recurring meetings to skip, and any briefing rules you want enforced (e.g., 'never list calendar', 'always flag DMs from my manager'). Takes 2 minutes — or skip it, the template works fine as-is."
 
If yes, ask only fields that add value beyond what was auto-detected. Suggested questions:
 
1. **Priority people** — whose Slack messages should always surface? (names or roles)
2. **Briefing rules** — anything specific to call out or always suppress? (e.g., skip routine 1:1s, never recite full calendar, always show open windows)
3. **Recurring context files** — any standing files in your workspace I should read for context each morning? (e.g., a weekly plan folder, a priorities doc)
4. **Optional sections** — the template's three core sections are Day shape, Heads up, and Slack. Want any of these optional sections added?
   - **Today's tasks** — pull a daily task list from your weekly plan, Jira, or another source? (default: off)
   - **Suggested focus** — get a recommendation for how to use open windows? (default: off)
   - **Jira / project board snapshot** — include a quick board check each morning? (default: off)
Then generate the personalized skill:
 
> "Two quick things:
> - **Name:** Convention is `daily-briefing-[your initials]` (e.g. `daily-briefing-jds`)
> - **Trigger phrase:** What should activate it? (default: 'morning briefing')"
 
→ Call skill-creator in lightweight mode — generate personalized SKILL.md with config block baked in. Skip evals; the template is already tested. Confirm:
> "Saved. You should see `daily-briefing-[initials]` in your skills list — no other setup needed."
 
→ If no: proceed. The template works without personalization.
 
---
 
## Step 0: Check the time
 
Always check current time via bash `date` at the start. Do not assume time of day from context alone. If it's evening or late afternoon, ask whether the user wants a briefing for today (mostly behind them) or tomorrow.
 
## Step 1: Load standing context (optional)
 
If the user's personalized skill or onboarding identified standing context files (priorities doc, weekly plan, role context), read them now — for your own situational awareness only. Do NOT reproduce checklists or plans; the user already has them.
 
If no standing context files are configured, skip this step.
 
## Step 2: Pull data sources in parallel
 
### Calendar
 
- Pull today's events from the user's connected calendar (Google Calendar, Outlook, etc.)
- Display times in the user's configured timezone (or system local if not set)
- Ignore: working location events, focus/break blocks, all-day events, personal logistics
- Do NOT list the full calendar. The user can see it themselves. Synthesize into a 1–2 sentence day shape (meeting density, where any open windows fall)
- You may note where open windows exist, but do NOT prescribe what the user should do in that time. They have full context on their priorities; you do not
- Only call out a specific meeting if it has a concrete prep need or action tied to it today
### Slack (or equivalent messaging)
 
- Scan DMs, recent @mentions, and relevant channel activity from the past 12–16 hours
- Prioritize: messages from the user's configured priority people (if set) — typically their manager, peers, direct reports, and key cross-functional partners
- Do NOT list individual DMs or messages. Only surface items where someone is actively waiting on the user or something is time-sensitive
- If nothing is urgent, say "Nothing urgent in Slack"
### Jira / project boards
 
- Skip by default. Do not pull Jira or other project boards as part of the briefing
- Only check if the user explicitly asks for a board check
## Step 3: Deliver the briefing
 
Keep it tight. Three short sections only:
 
**Day shape:** 1–2 sentences on meeting density and where any open windows fall. No prescriptions about how to use the open time.
 
**Heads up:** Meetings today with a concrete prep need or action. Skip routine 1:1s and recurring standups unless something specific applies. If nothing needs prep, say so in one line.
 
**Slack:** Urgent flags only, or "Nothing urgent" if clear.
 
### Optional sections (off by default)
 
The following sections are OFF by default. Include them only if the user's personalized skill or onboarding config explicitly turned them on:
 
- **Today's tasks** — a pulled list of tasks from a task source (weekly plan file, Jira, etc.). Off unless `include_tasks_section: true`.
- **Suggested focus** — a recommendation for how to use open windows. Off unless `include_suggested_focus: true`.
- **Jira / project board** — a quick board snapshot. Off unless `include_jira_section: true`.
If a section is off, do not mention it. If on, place it after the three core sections (Day shape, Heads up, Slack).
 
If an integration is unavailable (e.g., no Slack connected), omit that section and note it briefly at the end: "(No Slack connected — set up the Slack integration to include messaging signals.)"
 
## Step 4: Ask if anything needs prep
 
Close with: "Anything you want to prep for or tackle next?"
 
---
 
## Reference Files (Included in This Package)
 
This template does not bundle reference files. All personalization is captured via onboarding (Step 3: Optional Enrichment) and saved into the user's personalized skill.
 
### Cross-Reference for Personalized Skills
 
When skill-creator generates a personalized version of this skill, the personalized SKILL.md should embed the user's config (role, timezone, priority people, standing context files, briefing rules) directly in its frontmatter or an early section — there are no shared reference files to cross-reference.
 
If the user adds team-wide reference materials later (e.g., a shared team-goals doc), those should live in a separate package that personalized skills can cross-reference at `/mnt/skills/user/[reference-package-name]/`.
 
