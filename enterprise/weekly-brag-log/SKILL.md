---
name: weekly-brag-log
description: End-of-week brag-doc capture for any Nava employee pursuing a level-up. Pulls Jira and Slack from the last 7 days, ranks candidate entries against the Nava competency gaps the user is targeting, and writes confirmed entries directly into a .docx brag log on the user's computer. Use when the user says "weekly brag log", "Friday brag log", "log my wins", "update my brag doc", "promotion prep", or when scheduled to run at end-of-week.
---

You are running a weekly brag-doc capture for a Nava employee working toward a promotion. Goal: surface candidate entries from this week's work so they can log them before details fade. Keep replies tight — it's Friday afternoon and the user is tired.

## ONBOARDING — Scan, Confirm, Run

### Step 1: Check for personalized skill

Check `/mnt/skills/user/` for a personalized brag-log skill (any folder matching `weekly-brag-log-*` that is NOT `weekly-brag-log-template`).

- **If found:** Use the personalized skill's config. Say:
  > "Brag log loaded — using your `weekly-brag-log-[initials]` config (`[current level] → [target level]`, team `[team]`, doc `[filename]`). Pulling this week's Jira + Slack now."

  Proceed straight to Step 2 of the workflow below.

- **If not found:** Continue to Step 2.

### Step 2: Scan and run

Auto-detect:
- **Name and email** — from user identity (system context).
- **Current and target level** — from project instructions, memory, or prior conversation. If unknown, mark `not set` and skip level-specific ranking.
- **Team / project** — from project instructions, recent Slack channels, or Jira project assignment.
- **Brag doc location** — scan the user's mounted CoworkProjects folder (or any mounted folder) for a file matching `Brag-Doc-*.docx` or `*-brag-doc.docx`. If none exists, offer to generate one (see "Generating a new brag doc" below).
- **Nava cloudId for Jira** — `57ab368f-88d0-463b-86dd-cae652846975` (Nava-wide, hardcoded).
- **User's Slack ID** — derive from their email via `mcp__4e6649a1-6a47-46fc-acbd-e4ad93e7455b__slack_search_users` if not in memory.

Present a one-line config and start working — no approval gate.

> "Weekly brag-log scan for `[name]`. Targeting `[current level] → [target level]` on `[team]`. Doc: `[filename]`.
> *(Pulled from your project instructions and connected tools — say 'fix' if anything's off.)*
> Scanning Jira + Slack for the last 7 days…"

For any field that couldn't be detected, mark `not set` and continue. Do NOT block to ask. If level is unknown, rank candidates by general impact instead of level-specific gaps.

### Step 3: Optional enrichment (offer AFTER first delivery)

After delivering the first weekly summary — never before — offer:

> "Want me to lock this in? I can save a personalized `weekly-brag-log-[initials]` that remembers your level, team, target competency gaps (so candidates get ranked against the ones you care most about), and brag-doc filename. Two minutes — or skip it, the template works as-is."

If yes, collect:
- Target competency gaps in priority order (which Nava competencies are weakest for the user's target level — see `nava-competencies.md`)
- Brag-doc filename if non-default
- Preferred trigger phrases

Then hand off to `skill-creator` to generate `weekly-brag-log-[initials]` with the config baked in. The personalized skill should cross-reference this template's files at `/mnt/skills/user/weekly-brag-log-template/` rather than duplicating them.

If no: proceed — the template works without personalization.

---

## Workflow

### Step 1: Mount the user's project folder if needed

If no folder is mounted, call `mcp__cowork__request_cowork_directory` with the path the user has indicated (default `~/Desktop/CoworkProjects`). The brag doc should live at `<mount>/Brag-Doc-*.docx`.

### Step 2: Pull the user's Jira work from the last 7 days

Use `mcp__01fd8586-e417-4e54-ae66-45006d1e08b1__searchJiraIssuesUsingJql` with:
- `cloudId`: `57ab368f-88d0-463b-86dd-cae652846975`
- `jql`: `assignee = currentUser() AND updated >= -7d ORDER BY updated DESC`
- `maxResults`: `50`

Group results by status: Done / Ready for Production / In Progress / To Do. If the response exceeds the token budget, read it from the saved file path the tool returns.

### Step 3: Scan Slack from the last 7 days

Use `mcp__4e6649a1-6a47-46fc-acbd-e4ad93e7455b__slack_search_public_and_private` with these query patterns (substitute the user's Slack ID and name):

- `from:<@USER_ID> after:YYYY-MM-DD` — what they posted
- `to:<@USER_ID> after:YYYY-MM-DD` — replies/mentions to them
- `[FirstName] after:YYYY-MM-DD` — mentions of them by name

Surface anything that looks like positive feedback, kudos, substantive decision-making, cross-team coordination, or threads where they unblocked someone.

### Step 4: Read the brag doc to dedupe

Use the `docx` skill — `extract-text` script or `pandoc` — to read the current brag doc. Note which entries are already logged for the current month so you don't re-suggest them.

If the file does not exist, offer to generate one using `generate-brag-doc.js` (see Reference Files below).

### Step 5: Present the weekly summary in chat

Use this exact structure. Keep total length under 400 words.

```
**This week at a glance**
- One line on volume (e.g. "8 Jira issues moved, 2 closed, 3 PRs touched, 2 Slack kudos").

**Candidate brag entries — ranked by competency gap impact**
For each candidate (target 3–5), give:
- One sentence: what they did
- The Nava competency it maps to (be specific — call out the user's priority gaps if known)
- A draft entry text ready to paste: Category / What I did / Impact-outcome / Competency area

**Possible feedback to log**
- Any Slack kudos or peer compliments, with permalink and date.

**Quick prompt**
- End with: "Want me to add any of these to your [current month] row in the brag doc? Just say which numbers."
```

Categories to choose from (from the brag doc itself):
Technical delivery · Architecture & design · Knowledge sharing · Mentorship & coaching · Cross-team collaboration · Stakeholder & client · Process improvement · Company building · Growth & learning

### Step 6: On confirmation, write to the .docx

When the user picks entries to log, edit the brag doc directly using the `docx` skill's unpack → edit → repack flow:

1. Invoke the `docx` skill to load the unpack/pack scripts.
2. `python scripts/office/unpack.py Brag-Doc-*.docx unpacked/`
3. Locate the heading for the current month (e.g. `May 2026`, `June 2026`) in `unpacked/word/document.xml` and the table immediately after it.
4. Insert new `<w:tr>` rows BEFORE the trailing empty row, mirroring the 4-cell pattern (Category / What I did / Impact / Competency). Preserve the existing borders/shading/widths from sibling rows. Use `<w:hyperlink>` with relationships added to `word/_rels/document.xml.rels` for ticket and PR links. Use smart-quote XML entities (`&#x2018;` / `&#x2019;` / `&#x201C;` / `&#x201D;`).
5. **Beware the regex group-numbering gotcha:** named groups (`?P<name>`) count as numbered groups too. If you write a regex with both a named group AND a closing-tags group, the closing-tags group is `group(3)`, not `group(2)`. Use non-capturing groups (`?:`) for width markers to keep numbering clean.
6. If the user gives you feedback to log (Slack kudos, peer compliments), also append a row to the "Feedback received" table near the bottom (Date / From / What they said).
7. `python scripts/office/pack.py unpacked/ Brag-Doc-*.docx --original Brag-Doc-*.docx` — overwrite in place.
8. Confirm to the user: row count appended, current month, and a one-line summary of what landed.

---

## Generating a new brag doc

If the user has no brag doc yet, offer to generate one. Use the bundled `generate-brag-doc.js` (see Reference Files). It produces a `.docx` with:

- Header table: Name, Current Level, Team / Project
- "How to fill this in" + category guide
- L1–L7 competency reference for Nava
- Monthly tables (Jan–Dec) with the 4-column Category / What I did / Impact / Competency structure
- Feedback received section
- End-of-year reflection prompts

The script requires `npm install docx` in the working directory. Customize the header values via CLI args or by editing the constants at the top of the script before running.

---

## Style and tone notes

- Don't lecture about competencies — the user knows what level they're targeting.
- Don't pad with reassurance. They want evidence in front of them.
- Bullet points are fine; this is a working document, not prose.
- If a candidate is borderline (e.g. routine ticket close), say so — don't inflate.
- Map every candidate to a specific Nava competency, not a vague "shows leadership."

---

## Reference Files (Included in This Package)

- `brag-doc-structure.md` — The .docx schema: header table, monthly entry tables, feedback table, and the 4-column row format Claude must produce.
- `nava-competencies.md` — The Nava engineering competency categories used in the "Competency area" column, with the typical level-up gap order for L4→L5, L5→L6, and L3→L4 transitions.
- `generate-brag-doc.js` — Node.js script that builds a fresh `Brag-Doc-[Name].docx` using the `docx` npm package. Run when the user doesn't have a brag doc yet.

### Cross-Reference for Personalized Skills

Personalized skills generated from this template do NOT duplicate these reference files. They read them from this enterprise template package at:

```
/mnt/skills/user/weekly-brag-log-template/
```

When generating a personalized skill via skill-creator, include this section in the personalized SKILL.md:

```markdown
## Reference Files
Read reference files from the enterprise template package at
`/mnt/skills/user/weekly-brag-log-template/`:
- `brag-doc-structure.md` — .docx schema
- `nava-competencies.md` — Nava competency framework
- `generate-brag-doc.js` — script to bootstrap a new brag doc
```

If reference files are not found at the expected path, note "Reference files unavailable — install `weekly-brag-log-template` or describe your brag doc structure directly" and proceed with available context.
