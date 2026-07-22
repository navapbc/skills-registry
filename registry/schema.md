# Registry Schema

Skills and agents are stored in DynamoDB (`skills-registry-skills-{env}`) and served via the API Lambda. The shape of each record is defined by `src/lib/registry-schema.mjs` (Zod) and built by `src/lib/parse-skill.mjs`.

## Skill / Agent record

```typescript
{
  // --- Core (always present) ---
  slug:           string;         // URL-safe identifier, e.g. "snap-eligibility-checker"
  name:           string;         // Display name
  description:    string;         // Trigger description — when should Claude load this?
  type:           "skill" | "agent";
  plugin:         string;         // Parent plugin slug (slugified repo name)
  repo:           string;         // "org/repo-name"
  path:           string;         // Path to the SKILL.md within the repo
  author:         string;         // GitHub handle or submitter email
  version:        string;         // Semver string
  compatibility:  string[];       // Platforms: see compatibility values below
  sensitive_data: boolean;        // true = skill accesses PII or regulated data
  content:        string;         // Raw SKILL.md file content (stored verbatim)
  last_updated:   string | null;  // ISO timestamp (from commit date or repo push date)
  category:       string;         // Admin-assigned grouping (empty string if unset)
  source:         string;         // How the record entered the registry (see source values)
  status:         "pending" | "approved" | "rejected";
  visibility:     "public" | "internal" | "private" | "hidden";

  // --- Agents only ---
  tools_used?:    string[];  // Skill slugs this agent composes
  human_in_loop?: string;    // Where human review gates the loop

  // --- GitHub sync (present for GitHub-sourced skills) ---
  committer?: {
    login:      string;
    name:       string;
    avatar_url: string;
    date:       string;   // ISO timestamp of last commit to this file
  };

  // --- Optional display metadata ---
  tags?: string[];  // Filtering tags (slug format)
  author_name?: string;  // Display name override for form submissions

  // --- Submission metadata (set by Google Form workflow, stored but not displayed) ---
  team?:             string;
  problem?:          string;
  impact_type?:      string[];
  estimated_impact?: string;
  usage_frequency?:  string;
  expected_audience?: string;
  data_sources?:     string;

  // --- Audit fields (set by API, never by frontmatter) ---
  created_by?:       string;  // user_id (email) of creator
  created_at?:       string;  // ISO timestamp
  updated_at?:       string;  // ISO timestamp of last update
  updated_by?:       string;
  approved_by?:      string;
  rejected_by?:      string;
  rejection_reason?: string;
}
```

### `source` values

| Value | Set by | Meaning |
|---|---|---|
| `"github"` | Sync script | Sourced from a GitHub repo via code search |
| `"enterprise"` | Sync script | From the `enterprise/` folder in this repo |
| `"user-submitted"` | API (`POST /api/skills`) | Submitted via the `/submit` form |
| `"anthropic-builtin"` | Anthropic sync script | Anthropic's official built-in skills |

### `compatibility` values

| Value | Platform |
|---|---|
| `claude-code` | Claude Code (CLI + IDE) |
| `claude-chat` | Claude.ai chat interface |
| `claude-cowork` | Claude for Work (team plan) |
| `cursor` | Cursor IDE (inferred from `.cursor/` path) |
| `github-copilot` | GitHub Copilot (inferred from `copilot-instructions` path) |

---

## Plugin record

A plugin represents a GitHub repo that contains one or more skills.

```typescript
{
  slug:        string;
  name:        string;
  description: string;
  repo:        string;   // "org/repo-name"
  author:      string;
  status:      "pending" | "approved" | "rejected";
  visibility:  "public" | "internal" | "private" | "hidden";
}
```

---

## SKILL.md frontmatter reference

The sync pipeline parses YAML frontmatter from `SKILL.md`, `AGENT.md`, and `.claude/skills/*.md` files. Most fields are optional — the pipeline derives or defaults anything that's absent.

### Core fields

| Field | Required? | Default | Description |
|---|---|---|---|
| `name` | optional | Derived from filename or directory name | Display name; also used to generate `slug` if `slug` is absent. |
| `slug` | optional | `slugify(name)` | URL-safe identifier. Lowercased, hyphens only. |
| `description` | optional | First non-heading line of the file body | Trigger description. This is what Claude reads to decide when to load the skill. Make it clear and specific. |
| `author` | optional | Repo owner GitHub login | GitHub handle or email of the skill author. |
| `version` | optional | `"1.0.0"` | Semver string, e.g. `"1.2.0"`. Not validated for format. |
| `compatibility` | optional | Inferred from file path, or `["claude-code"]` | Array of platform strings (see compatibility values above). Inline (`[claude-code, claude-chat]`) or YAML block sequence both work. |
| `sensitive_data` | optional | `false` | Set to `true` if the skill accesses PII, PHI, or regulated data. Triggers governance review. |
| `type` | optional | `"skill"` | `"skill"` or `"agent"`. Determines which section of the UI the record appears in and whether agent-only fields apply. |

### Optional display metadata

| Field | Required? | Default | Description |
|---|---|---|---|
| `category` | optional | `""` | Admin-assigned grouping for the UI category grid. Usually set via the admin panel after ingestion rather than in the file. |
| `tags` | optional | none | Array of filtering tags in slug format (`kebab-case`). 1–3 tags recommended. Example: `[productivity, writing, research]`. |
| `author_name` | optional | none | Human-readable display name for the author. Used when the `author` field holds an email or handle that shouldn't be shown. |

### Agent-only fields

| Field | Required? | Default | Description |
|---|---|---|---|
| `tools_used` | optional | `[]` | Array of skill slugs this agent composes. Example: `[snap-checker, plain-language]`. |
| `human_in_loop` | optional | `""` | Describe where a human should review outputs before they're used. Required by convention when `sensitive_data: true` (enforced during governance review, not by the schema). |

### Submission metadata

These fields are written by the Google Form submission workflow. They are stored in DynamoDB but not currently displayed in the skill detail UI. They are all optional and only present on user-submitted skills.

| Field | Description |
|---|---|
| `team` | Nava team that owns this skill (from the form picklist) |
| `problem` | Problem the skill solves |
| `impact_type` | Array — categories of impact, e.g. `[time-savings, quality-improvement]` |
| `estimated_impact` | Free-text impact estimate |
| `usage_frequency` | How often the submitter uses it (from the form picklist) |
| `expected_audience` | Size/type of intended audience (from the form picklist) |
| `data_sources` | What data sources the skill accesses |

### Fields set by the pipeline (not in frontmatter)

These fields are always populated by the sync script or API — authors do not set them in the file.

| Field | Set by | Value |
|---|---|---|
| `plugin` | Sync | Slugified repo name |
| `repo` | Sync | `"org/repo-name"` |
| `path` | Sync | File path within the repo |
| `committer` | Sync | GitHub commit metadata for the file |
| `last_updated` | Sync | Commit date or repo push date |
| `source` | Sync / API | See source values above |
| `status` | API | Starts as `"pending"` for user-submitted; `"approved"` for sync-ingested enterprise/github skills with a maintain+ role |
| `visibility` | API | Starts as `"public"` for new records; changed via admin panel |
| `content` | Sync | Full raw file content |

### Legacy `nava_*` prefix

Fields like `nava_tags`, `nava_team`, `nava_impact_type`, etc. are automatically mapped to their unprefixed equivalents (`tags`, `team`, `impact_type`). The `nava_` prefix was used in early skill files and is supported for backward compatibility.

---

## Minimal valid SKILL.md

```yaml
---
name: my-skill
description: When the user wants to... (this is the trigger Claude reads)
---

Skill content here — instructions, examples, slash command definitions, etc.
```

The pipeline fills in `author`, `version`, `compatibility`, `sensitive_data`, `type`, `slug`, and `plugin` automatically.

## Full SKILL.md example

```yaml
---
name: plain-language
description: When the user wants to rewrite government or technical content in plain language for a general audience.
author: brenda-velasquez
version: 1.1.0
compatibility: [claude-chat, claude-cowork, claude-code]
sensitive_data: false
category: writing
tags: [plain-language, writing, accessibility]
---

Skill content here...
```

## AGENT.md example

```yaml
---
name: snap-eligibility-agent
description: When the user wants to run a full SNAP eligibility review with human sign-off before submission.
author: jose-oyola
version: 1.0.0
compatibility: [claude-code]
sensitive_data: true
type: agent
tools_used: [snap-eligibility-checker, plain-language]
human_in_loop: Reviewer must approve the eligibility determination before it is submitted to the state system.
---

Agent content here...
```
