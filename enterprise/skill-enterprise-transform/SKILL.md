---
name: skill-enterprise-transform
compatibility: [claude-chat, claude-cowork]
description: >
  Take a skill that was built for a specific person or role and generalize it for
  enterprise-wide deployment. Audits for personal references, hardcoded configs,
  role-specific framing, and platform-specific language. Produces a clean enterprise
  template with built-in onboarding intake and skill-creator handoff so any employee
  can load the template, personalize it, and save their own version. Use whenever
  someone says "make this skill available to everyone", "generalize this skill",
  "prep this for enterprise", "clean this up for the team", "turn this into a
  template", or uploads a skill package that needs to be adapted from one person's
  workflow to org-wide use. Also use when reviewing a skill someone built to check
  if it's ready for enterprise publishing.
author: corytrimm@navapbc.com
author_name: Cory Trimm
---

# Enterprise Skill Prep

Takes a skill built for one person and makes it work for anyone. The output is a
clean enterprise template that any employee can load, personalize via onboarding,
and save as their own skill — without touching the original author's setup.

---

## Step 1: Receive and Inventory the Package

Read everything in the uploaded skill package before doing anything else.

**For each file, identify its role:**

| Type | Examples |
|------|----------|
| Skill files | `SKILL.md`, `*-SKILL.md` — the core instructions |
| Reference files | Goals docs, templates, process guides, glossaries |
| Config files | `config.json`, `.env`, credentials, API keys |
| Memory/state files | Logs, rolodex, action items, proposal archives |
| Infrastructure files | Agent identity docs (WORK_SOUL, TOOLS, MEMORY) |
| README | Package documentation |

**Note the relationships:** Which reference files does the SKILL.md actually read?
Which are mentioned but not included? Which config values does the skill depend on?

**If the package contains multiple skills**, determine whether they are independently
useful or genuinely coupled. If they can run standalone, they should be separate
packages. Each package is a single folder with one SKILL.md and its reference files.

---

## Step 2: Audit for Personalization

Scan every SKILL.md for six categories of issues. These are the patterns that
consistently appear in skills built for one person's workflow.

### Category 1: Filesystem Dependencies

Paths to personal directories, workspace files, or agent infrastructure that no
other user will have.

**Common patterns:**
- `Ritual/`, `Workspace/`, or any named project directory
- `memory/`, `rolodex/`, `action-items.md`, `proposals/`
- Agent identity files: `WORK_SOUL.md`, `TOOLS.md`, `MEMORY.md`
- Saving outputs to specific local paths

**Resolution:** Remove filesystem reads/writes entirely. Replace with either
onboarding intake (for standing context) or conversational prompts (for per-session
context like "paste prior reviews here").

### Category 2: Hardcoded Credentials and Config

User-specific values embedded in the skill or referenced from a config file.

**Common patterns:**
- `config.json` fields: API keys, user IDs, project keys, account IDs
- Atlassian/Jira: `cloud_id`, `account_id`, `project_key`
- Slack: `user_id`, `dm_channel`
- Pre-flight config validation blocks that halt execution if values are missing

**Resolution:** Remove config file dependencies entirely. Move configurable values
to onboarding intake questions. Mark all integrations as optional.

### Category 3: Personal Notifications and Delivery

Hardcoded actions that send outputs to the skill author.

**Common patterns:**
- Slack DM to a specific `dm_channel`
- Jira comments posted to a specific project
- Jira card state transitions using specific `transition_id` values
- Saving to personal memory files or action-item trackers

**Resolution:** Make all delivery actions optional, gated on whether the user
configured the integration during onboarding. Confirm target (card key, channel)
with the user before executing — never auto-post without confirmation.

### Category 4: Role and Persona Framing

Language that ties the skill to a specific role, person, or agent identity.

**Common patterns:**
- "You are the user's work ritual agent" or "Executor and Change Agent"
- "Through the lenses she applies as [ROLE]"
- "Write as [NAME] would — direct, specific, tradeoff-aware"
- Reviewer lines in output templates: "[Name] (via work ritual agent)"
- Named approvers in process steps: "[Name] reviews and refines"

**Resolution:** Replace role-specific framing with generic purpose statements.
Replace named individuals with placeholders populated from onboarding (e.g.,
`[APPROVER_NAME]`). Replace persona instructions with org-level style guidance
("Write in Nava's direct, specific, tradeoff-aware style").

### Category 5: Cross-Skill and Tool References

References to other skills or tools that may not exist in the enterprise package.

**Common patterns:**
- "Use the proposal-doc skill to create one first"
- "Run the [custom-skill-name] skill before proceeding"
- References to personal Jira board names, Mural templates, or Sheets

**Resolution:** Replace with generic alternatives. "Use the proposal-doc skill"
becomes "provide a proposal document or describe the initiative." If the referenced
skill IS included in the enterprise package, use its enterprise name.

### Category 6: Platform-Specific Language

Language that assumes a specific Claude interface.

**Common patterns:**
- "In Cowork, navigate to Customize › Skills"
- "Check your Project files in claude.ai"
- "In your Cowork session"
- Links to Cowork-specific tutorials or documentation

**Resolution:** Use platform-agnostic language. "You should see `[skill-name]` in
your list of skills" works regardless of environment.

---

## Step 3: Classify What Stays vs. What Goes

This is the most important judgment step. The goal is to remove everything specific
to the original author while keeping everything specific to the organization.

### KEEP — Org-specific content (not person-specific)

- **Evaluation frameworks, lenses, checklists** — these are the core value of the
  skill and should be preserved completely
- **Output templates** — every mode-specific template the original skill uses to
  format its responses. These are instructions to Claude, not separate files.
  Missing templates mean Claude improvises instead of following the consistent
  structure the author built. **Check all modes, not just the default.**
- **Domain-specific context** — competitor names, industry terminology, agency
  acronyms, contract vehicles. These are org-wide knowledge, not personal
- **Nava-specific examples** — eligibility screening, document review, intake
  processing — examples grounded in what the company actually does
- **Process references** — ADKAR, concentric circles, Policy Review Board,
  any established org methodology
- **Reference files** — goals documents, plan templates, glossaries

### REMOVE — Person-specific content

- Agent identity and persona files
- Config files and credential references
- Personal filesystem paths
- Named individuals in process steps (convert to role placeholders)
- Personal Jira project keys, Slack channels, board names
- RITUAL-XX or similar personal ticket references (but keep the *patterns*
  they illustrated — convert to descriptive examples)
- Memory files, rolodex, action-item trackers

### JUDGMENT CALLS

Some content sits in between. Apply this test: **would a new hire in a different
role at Nava benefit from this content?**

- BD/client advocacy capture notes → YES, keep (useful for anyone reviewing proposals)
- Specific competitor names → YES, keep (org-wide knowledge)
- "Sha reviews and refines" → NO, convert to `[APPROVER_NAME]`
- Cross-proposal filesystem scan → REPLACE with "paste prior reviews here"
- Cost model pattern from specific Jira cards → KEEP the pattern, REMOVE the card numbers

---

## Step 4: Build the Enterprise Template

### 4A. Add Onboarding — Scan, Confirm, Run

Add an `## ONBOARDING — Scan, Confirm, Run` section at the top of the skill,
after the frontmatter and opening description. This replaces the traditional
multi-step interview approach with a zero-friction scan-and-run flow.

**The principle:** Enterprise template skills should work out of the box. The
skill scans available context, shows the user what it found, and runs. No
confirmation gate. Optional personalization happens *after* the first use,
not before.

**Three-step onboarding pattern:**

```
## ONBOARDING — Scan, Confirm, Run

### Step 1: Check for Personalized Skill

Check `/mnt/skills/user/` for a personalized [skill-name] skill (any folder
matching `[skill-name]-*` that is NOT `[skill-name]-template`).

- **If found:** Use the personalized skill's config. Say:
  > "[Skill name] loaded — using your `[skill-name]-[initials]` config
  > ([compact config summary: role, approver, key settings]). [Call to
  > action — what to share or do next]."
  Then proceed to the skill's first working step. Name the actual skill
  file so the user knows where the config is coming from.

- **If not found:** Continue to Step 2.

### Step 2: Scan and Run

Scan all available context — project instructions, user preferences, memory,
connected integrations (Slack, Jira, Google Drive, etc.), and any sibling
personalized skills at `/mnt/skills/user/`. Assemble a config and present it
— no confirmation gate, just show what you're using and invite the user to
start.

The message should follow this structure:
1. What the skill does (one sentence)
2. Compact config line (role, approver, goals, integrations — all on one line)
3. Source attribution as a parenthetical: "(Pulled from your project
   instructions and connected tools — say 'fix' if anything's off.)"
4. Clear call to action: what to share or do next

> "[One-sentence description of what this skill does.]
>
> [Config as role, team]. Approver: [name or 'not set']. Integrations:
> [list or 'none detected'].
> *(Pulled from your project instructions and connected tools — say 'fix'
> if anything's off.)*
>
> [Clear call to action — what to share or do next]."

No "Look right?" or "Any changes?" gate. The user sees the config and starts
working. "Say 'fix' if anything's off" is the escape hatch, not a required
approval step.

If the user provides input: proceed with this config.
If the user says "fix" or corrects something: absorb the correction and proceed.

For any field that couldn't be detected, note it as "not set" and use defaults.
Do NOT block the skill to ask — run with what you have.

### Step 3: Optional Enrichment (After First Use)

After delivering the first output — not before — offer optional personalization:

> "Want to sharpen future [outputs]? I can save a personalized version that
> locks in your config and adds [skill-specific enrichment fields]. Takes
> 2 minutes — or skip it, the template works fine as-is."

If yes, ask only the fields that add value beyond what was auto-detected
(typically: team-specific goals, standing strategic context). Then generate
the personalized skill via skill-creator.

If no: proceed. The template works without personalization.
```

**Why this replaces the interview model:** The old pattern asked 4–6 questions
before the skill would run. Claude would often infer the answers from memory
and skip the entire flow — including the save offer — leaving the user with
no personalized skill. The scan-and-run model works *with* Claude's context
awareness instead of fighting it. No gate, no approval step — just show the
config and go.

**What the old interview questions become:**

| Old approach | New approach |
|--------------|-------------|
| "What's your role?" (required) | Auto-detected from project instructions / memory |
| "What team?" (required) | Auto-detected from project instructions / memory |
| "Your approver?" (optional) | Auto-detected from sibling skills / memory |
| "Jira project key?" (optional) | Auto-detected from connected integrations |
| "Slack channel?" (optional) | Auto-detected from connected integrations |
| "Team goals?" (optional) | Asked in optional enrichment after first use |
| "Strategic context?" (optional) | Asked in optional enrichment after first use |
| "Look right? Any changes?" (confirmation gate) | No gate — config shown inline, "say 'fix' if anything's off" |

### 4B. Add Skill-Creator Handoff (in Optional Enrichment)

The save/personalization step now lives inside Step 3 (Optional Enrichment),
not at the end of a mandatory interview. The pattern:

```
Then generate the personalized skill:
> "Two quick things:
> - **Name:** Convention is `[skill-name]-[your initials]` (e.g. `[skill-name]-dpo`)
> - **Trigger phrase:** What should activate it? (default: '[default trigger]')"

→ Call skill-creator in lightweight mode — generate personalized SKILL.md with
config block baked in. The personalized skill must include a Reference Files
section that cross-references the enterprise template package (see 4G below).
Skip evals; the template is already tested. Save the skill, and confirm:
"Here's your personalized skill. Save it and you should see it in your skills
list — no other setup needed."

→ If no: proceed. The template works without personalization.
```

### 4C. Update All Personal References

Work through the SKILL.md and apply every resolution identified in Step 2.
For each change:
- Replace, don't just delete. Every removed capability should have an
  alternative (onboarding variable, conversational prompt, or optional integration).
- Preserve the surrounding instructional content. If a section said "Read
  `Ritual/MEMORY.md` for org context, then evaluate alignment" — remove the
  file read, keep the evaluation instruction.

### 4D. Verify Output Templates

**This is where content gets accidentally dropped.** Output templates are markdown
blueprints inside the SKILL.md that tell Claude how to format its response. They
look like code blocks with placeholder sections.

For every review mode the original skill supports, verify:
1. The supplemental framework (evaluation instructions) is present
2. The output template (response format) is present
3. Both match — the template includes sections for everything the framework evaluates

If a mode has its framework but not its template, Claude knows how to *analyze*
but not how to *format* — it will improvise and lose consistency.

### 4E. Package Structure

```
[skill-name]-template/
├── SKILL.md              ← always this filename
├── [reference-files]     ← goals docs, templates, glossaries
└── README.md
```

The SKILL.md filename is required — Claude looks for it specifically. Reference
files are bundled alongside it in the same package.

If the original package contained multiple independent skills, split into separate
packages. Cross-reference each other in their READMEs ("works well paired with
[other-skill]") but don't create hard dependencies.

### 4F. Write the README

Each package gets its own README covering:

- **What's in this package** — file list matching actual contents
- **Naming convention** — enterprise template name vs. personalized name with initials
- **How to use** — onboarding summary, what's required vs. optional, integration
  explanations
- **Saving your personalized skill** — brief description of the save step
  (no directory/folder management instructions — the platform handles it)
- **What it produces** — output format for each supported mode
- **Pairing** — if this skill works well with another, describe the workflow

### 4G. Add Reference File Cross-Referencing

**This is critical for the personalization flow.** Personalized skills should NOT
duplicate reference files from the enterprise template. Instead, they cross-reference
them at a known path.

Add a "Reference Files" section at the end of the enterprise template SKILL.md:

```markdown
## Reference Files (Included in This Package)

[List each reference file with a one-line description of its purpose.]

### Cross-Reference for Personalized Skills

Personalized skills generated from this template do NOT duplicate these reference
files. Instead, they read them from this enterprise template package at:

/mnt/skills/user/[skill-name]-template/[filename]

When generating a personalized skill via skill-creator, include this section in
the personalized SKILL.md:

## Reference Files
Read reference files from the enterprise template package at
`/mnt/skills/user/[skill-name]-template/`:
- `[filename]` — [purpose]

If reference files are not found at the expected path, note "[Reference files
unavailable — install [skill-name]-template or provide content directly]"
and proceed with available context.
```

**Why this matters:** Without this, every personalized skill is an island — it
either duplicates files (bloat, drift when files update) or silently loses access
to them (degraded output). Cross-referencing gives single-source-of-truth for
reference files. When goals update for 2027, you update one package and every
personalized skill inherits the change.

**Prerequisite:** The enterprise template must be admin-published and non-removable.
Add a graceful fallback in the personalized skill for the edge case where files
aren't found.

---

## Step 5: Verify Against Original

This is the step that catches accidental drops. Run a systematic comparison.

### 5A. Section-Level Comparison

Extract all `##` and `###` headers from both original and enterprise versions.
Compare side by side. Every section in the original should be accounted for —
either present in the new version, intentionally removed (with documented reason),
or merged into another section.

### 5B. Content Spot-Checks

For the skill's core evaluation content (lenses, frameworks, checklists):
- Count questions/items in each section — they should match
- Check for dropped sub-bullets or instructional detail within questions
- Verify examples and domain-specific context (competitor names, industry terms)
  were preserved, not genericized

### 5C. Output Template Completeness

For every mode the skill supports:
- Is there a framework section (how to evaluate)?
- Is there an output template (how to format the response)?
- Does the template include every section the framework produces?

### 5D. Reference File Check

- Does every file referenced in SKILL.md exist in the package?
- Does the README's file list match the actual package contents?
- Are there files in the package that nothing references? (Remove or document.)
- Does the SKILL.md include a "Cross-Reference for Personalized Skills" section
  with correct paths for each reference file?
- Does the cross-reference section include a graceful fallback for missing files?

### 5E. Clean Sweep

Search for any remaining personal references:
```
grep -n "Ritual\|config\.json\|WORK_SOUL\|work ritual agent\|\.dm_channel\|atlassian\.\|Cowork" SKILL.md
```

Adapt the grep pattern to the specific personal infrastructure the original used.
The sweep should return zero results.

---

## Step 6: Deliver

Present the completed enterprise template package to the user with:

1. **The files** — SKILL.md, reference files, README in correct folder structure
2. **A summary of changes** — what was removed, what was kept, what was revised
3. **Anything flagged for their decision** — judgment calls where org-specific vs.
   person-specific was ambiguous

Do not present the files without the summary. The user needs to understand what
changed and verify nothing valuable was lost.

---

## Guardrails

- **Never cut framework content to save space.** Evaluation lenses, checklists,
  output templates, and methodology references are the value of the skill. The
  enterprise version should be shorter than the original only because personal
  infrastructure was removed — not because instructional depth was reduced.
- **Never genericize org-specific content.** Competitor names, agency acronyms,
  industry examples, and established methodologies (ADKAR, concentric circles)
  are organization knowledge, not personal knowledge. They stay.
- **Every removed capability needs an alternative.** If the original skill read
  a config file, the enterprise version collects that value during onboarding.
  If it scanned a filesystem, the enterprise version asks the user to paste.
  Removal without replacement degrades the skill.
- **Output templates are not optional.** If the original skill had mode-specific
  output templates, every one must survive. A missing template means Claude
  improvises the output format for that mode — defeating the consistency the
  original author built.
- **Platform-agnostic language only.** No Cowork-specific navigation, no
  claude.ai Project-specific instructions. The skill should work in any Claude
  environment without confusing the user.
- **The enterprise template is a starting point, not a finished product.** It
  ships with onboarding and a skill-creator handoff so every user who loads it
  can immediately generate their own personalized version.
