# Daily Briefing — Enterprise Template

A fast daily orientation skill for any Nava employee. Pulls calendar and Slack signals in parallel and delivers a tight, 1–2 minute summary covering meeting density, prep needs, and urgent messages.

## What's in this package

- `SKILL.md` — the daily briefing skill, with built-in scan-and-run onboarding
- `README.md` — this file

No reference files are bundled. Personalization is captured per-user via onboarding and saved into the user's own personalized skill.

## Naming convention

- **Enterprise template:** `daily-briefing-template` (this package — published org-wide, do not modify)
- **Personalized version:** `daily-briefing-[your initials]` (e.g. `daily-briefing-jds`)

## How to use

1. Load the skill. Trigger it by saying "morning briefing", "daily briefing", "good morning", "what's on my plate today", or "start my day".
2. The skill scans your project instructions, connected tools (Calendar, Slack), and any sibling personalized skills to assemble a config.
3. It shows you the config inline ("Pulled from your project instructions and connected tools — say 'fix' if anything's off") and runs immediately. No confirmation gate.
4. After the first run, the skill offers to save a personalized version that locks in your priority people, standing context files, and any briefing rules you want enforced.

### What's required vs. optional

| Item | Required | Auto-detected from |
|------|----------|---------------------|
| Role | Optional | Project instructions, memory |
| Timezone | Optional | System local time as fallback |
| Calendar | Optional | Connected Google Calendar / Outlook |
| Slack | Optional | Connected Slack workspace |
| Priority people | Optional | Asked in personalization step |
| Standing context files | Optional | Asked in personalization step |

All integrations are optional. If Slack isn't connected, the briefing skips the Slack section and notes it. Same for Calendar.

## Saving your personalized skill

After the first briefing, the skill offers to save a personalized version. If you say yes, it asks 2–3 quick questions (priority people, briefing rules, standing context files) and generates a `daily-briefing-[your initials]` skill via skill-creator. You'll see it in your skills list immediately — no other setup needed.

## What it produces

A three-section briefing:

- **Day shape** — 1–2 sentences on meeting density and where open windows fall
- **Heads up** — meetings today with a concrete prep need or action
- **Slack** — urgent flags only, or "Nothing urgent"

Followed by: "Anything you want to prep for or tackle before your day starts?"

The briefing intentionally omits a tasks section (you manage your own task list) and a suggested-focus section (you decide what to do with open time).

## Pairing

Works well alongside any weekly planning skill — the daily briefing handles "what's today" while a weekly planning skill handles "what's this week." If you use both, the daily briefing can read your weekly plan for situational awareness (configure via the standing context files question in personalization).
