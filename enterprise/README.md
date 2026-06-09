# Enterprise Skills

Org-wide skills managed by the Nava ops team. These skills appear automatically in Claude Desktop for all Nava staff — no installation needed.

## Adding a skill

Create a folder and file: `enterprise/your-skill-name/SKILL.md`

> **The file must be named exactly `SKILL.md`** (case-sensitive). Any other filename (e.g. `skill.md`, `Skill-yourname.md`) will be ignored by the sync.

---

## Frontmatter fields

### Required

| Field | Description |
|---|---|
| `name` | Display name shown in the hub (e.g. `Daily Briefing`) |
| `description` | 1–3 sentences shown on the skill card. Used by Claude to decide when to invoke the skill, so be specific about trigger phrases. |

### Recommended

| Field | Default if omitted | Notes |
|---|---|---|
| `category` | *(empty — skill won't appear in homepage grids)* | One of: `writing-comms`, `research-analysis`, `planning`, `dev-code`, `ops-automation`. Set this or the skill is invisible on the homepage. |
| `compatibility` | `[claude-code]` | **Must set this for enterprise skills.** The default `claude-code` is wrong for tools meant for Claude Desktop/Chat. Use `[claude-chat, claude-cowork]` for most enterprise skills. |

### Optional

| Field | Default | Description |
|---|---|---|
| `version` | `1.0.0` | Semantic version. Increment on major changes. |
| `author` | `navapbc` | GitHub handle, email, or team name of the maintainer. |
| `author_name` | *(none)* | Full display name (e.g. `Kelly Feeney`). Shown on the card if present. |
| `sensitive_data` | `false` | Set to `true` if the skill touches client or internal data. Shows an amber ⚠ badge in the hub. |
| `tags` | *(none)* | Array of tags for filtering (e.g. `[writing, policy, slack]`). |
| `slug` | Derived from `name` | Override the auto-generated URL slug if needed. |
| `type` | `skill` | Set to `agent` for multi-skill agent compositions. |

### Agent-only (when `type: agent`)

| Field | Description |
|---|---|
| `tools_used` | Array of skill slugs this agent composes (e.g. `[daily-briefing, week-kickoff-template]`). |
| `human_in_loop` | Description of where human review happens in the workflow. |

### Impact metadata (optional, shown in hub detail view)

These fields surface in the skill detail page and help other staff understand value before installing.

| Field | Example |
|---|---|
| `team` | `Operations and Automation` |
| `problem` | `Saves time needed to review policy documents` |
| `estimated_impact` | `Saves ~10 min per use` |
| `usage_frequency` | `Daily` / `Weekly` / `A few times per week` |
| `expected_audience` | `6-15 people` / `16+ people` |
| `impact_type` | `[Time saved per use, Reduced error rate or rework]` |
| `data_sources` | `Confluence (Sage), Jira` |

---

## Full example

```yaml
---
name: daily-briefing-template
description: >
  Run a fast daily briefing to orient any Nava employee to their day. Pulls
  calendar and Slack signals in parallel and delivers a tight summary —
  meeting density, prep needs, urgent Slack items. Triggers when the user
  says "morning briefing", "daily briefing", "good morning", or "what's on
  my plate today".
category: ops-automation
compatibility:
  - claude-chat
  - claude-cowork
sensitive_data: false
author: nava-ops
author_name: Nava Ops
version: "1.0"
tags: [planning, daily, briefing]
team: Operations and Automation
estimated_impact: Saves ~10 min per day
usage_frequency: Daily
expected_audience: 16+ people
impact_type: [Time saved per use]
---

Your skill content here...
```

---

## How the sync works

- The sync workflow runs every 4 hours and after every push to `main`.
- It reads `enterprise/*/SKILL.md` directly from the repo via the Git Trees API — no search indexing delay.
- Records are upserted into DynamoDB with `source: enterprise` and `status: approved` automatically. You do not need to set these fields.
- Fields that the pipeline sets (and you should **not** put in frontmatter): `source`, `status`, `repo`, `path`, `plugin`, `content`, `last_updated`.

## Notes

- The ops team reviews all changes via standard GitHub PR process before they go live.
- To trigger an immediate sync after merging, go to Actions → **Sync Registry** → Run workflow.
- Skills without a `category` are stored in DynamoDB but won't appear in any homepage category section. Add one if you want the skill featured.
