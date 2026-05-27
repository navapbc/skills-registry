# Registry Schema

`registry/index.json` is the single source of truth for the skills marketplace UI. It is rebuilt by `scripts/sync-registry.mjs` on every sync run.

## Top-level shape

```typescript
{
  generated_at: string;   // ISO timestamp of last sync
  org: string;            // GitHub org that was scanned
  plugins: Plugin[];      // Grouped collections (one per repo that contains skills)
  skills: Skill[];        // All skills and agents, flat list
}
```

## Plugin

A plugin represents a GitHub repo that contains one or more skills.

```typescript
{
  slug: string;           // URL-safe name, e.g. "nava-labs-ai-tools"
  name: string;           // Repo name
  description: string;   // repo.description from GitHub
  repo: string;           // "org/repo-name"
  author: string;         // GitHub handle of repo owner
  skill_count: number;
  agent_count: number;
  skills: string[];       // skill slugs
  agents: string[];       // agent slugs
}
```

## Skill / Agent

```typescript
{
  slug: string;           // URL-safe name
  name: string;           // From SKILL.md frontmatter `name`
  description: string;   // From frontmatter `description` — used for search and Claude trigger
  plugin: string;         // Parent plugin slug (repo name)
  repo: string;           // "org/repo-name"
  path: string;           // Path to the SKILL.md within the repo
  author: string;         // From frontmatter `author`
  version: string;        // Semver
  compatibility: string[]; // One or more: claude-code, claude-ai, cowork, claude-desktop, api
  sensitive_data: boolean; // true = skill accesses PII or regulated data
  type: "skill" | "agent";
  content: string;        // Raw SKILL.md file content
  last_updated: string;   // ISO timestamp (repo pushed_at)

  // Agents only:
  tools_used?: string[];      // Skill slugs this agent composes
  human_in_loop?: string;     // Description of where human review gates the loop
}
```

## SKILL.md frontmatter spec

```yaml
---
name:           # slug, e.g. "snap-eligibility-checker"
description:    # trigger description — when should Claude load this?
author:         # GitHub handle
version:        # semver, e.g. "1.0.0"
compatibility:  # [claude-code, claude-ai, cowork, claude-desktop, api]
sensitive_data: # true | false
---
```

## AGENT.md frontmatter spec (extends SKILL.md)

```yaml
---
# ...all SKILL.md fields, plus:
tools_used:    # [skill-slug-one, skill-slug-two]
human_in_loop: # "Where does a human review outputs before they're used?"
---
```

If `sensitive_data: true` and the type is `agent`, `human_in_loop` is required by convention (enforced by the governance reviewer skill).
