# Enterprise Skills

Org-wide skills managed by the Nava ops team. These skills appear automatically in Claude Desktop for all Nava staff — no installation needed.

## Adding a skill

Create a folder: `enterprise/your-skill-name/SKILL.md`

### Required frontmatter

```yaml
---
name: your-skill-name
description: What this skill does (shown in the hub registry)
category: ops-automation
---
```

### All frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | yes | Slug-friendly name (lowercase, hyphens) |
| `description` | yes | 1–2 sentences shown in the hub |
| `category` | yes | One of: `writing-comms`, `research-analysis`, `planning`, `dev-code`, `ops-automation` |
| `sensitive_data` | no | `true` if the skill touches client or internal data — shows an amber ⚠ badge |
| `compatibility` | no | Defaults to `[claude-desktop]` |
| `author` | no | Your name or team |

### Example

```yaml
---
name: daily-briefing
description: Generates a personalized daily briefing summary from your calendar and recent activity.
category: ops-automation
compatibility:
  - claude-desktop
sensitive_data: false
author: Nava Ops
---

This skill appears automatically in Claude Desktop. No install step needed.
```

## Notes

- Skills in this folder are auto-approved and set to `source: enterprise` in the registry.
- The ops team reviews all changes via standard GitHub PR process.
- To flag a skill as touching sensitive/client data, set `sensitive_data: true` in the frontmatter — an amber ⚠ badge will appear in the hub.
