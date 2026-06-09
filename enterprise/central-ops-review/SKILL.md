---
name: central-ops-review
description: Nava employees can submit workflows to Central Ops backlog; Central Ops then reviews for automation / AI readiness before prioritizing, resourcing solutions.  This provides first-pass review at workflows submitted to the Central Ops team. Claude scores against criteria we have set; then humans (Central Ops team) reviews Claude's assessment and adjusts as necessary.
---

# Central Ops Workflow Review

You are running the Central Ops intake review. Your job: find unreviewed submissions, score them rigorously using the team's rubric, write the results to the Claude Review tab, update statuses, and notify the team. Do this thoroughly — these scores directly shape how the team allocates engineering and ops capacity.

## Resources

**Google Sheet ID**: `1u1NEfNhyt2Ydc7tYhYNznBnsfbdaAayLUn1n79keg7s`

| Tab | Purpose | Your role |
|-----|---------|-----------|
| Scoring Guide | Rubric definitions — source of truth | Read first, every time |
| Intake | Submissions from the form | Read rows; update Status only |
| Claude Review | Scored output | Append rows only — NEVER delete |

**Slack**: Send final summary to **#central-ops-workflow-review**

---

## Step 1: Read the Scoring Guide (always, every run)

Read the **Scoring Guide tab** before scoring anything. It defines what each level of Impact, Effort, and Readiness means, plus the Solution Type thresholds and Priority Score formula. Kelly may update this tab over time — always pull the current version so your scoring reflects the team's latest thinking, not a stale snapshot.

---

## Step 2: Find unreviewed submissions

Read the **Intake tab**. A row is eligible for review if and only if the **Status column is empty**. Do not process rows that have any value in Status (including "Claude Reviewed", "In Progress", etc.).

Tell the user how many unreviewed rows you found. If there are none, say so and stop.

---

## Step 3: Score each submission

Work through each unreviewed row one at a time.

### Gather context first

Collect everything available before scoring:
- All form fields: submitter name, category, initiative name, problem statement, desired outcome, impact description, success metric, dependencies, etc.
- Fetch URLs from **Links / Supporting Documents** and **Additional Context Links** — these may be Confluence pages, Granola transcripts, Google Drive files, Slack threads, or meeting notes. Read what you can access; note what you couldn't reach.

The more context you have, the more useful your scores are. Make a genuine attempt to read linked sources before scoring.

### Score Impact, Effort, and Readiness

Using the rubric from the Scoring Guide tab, assign a score (1–5) to each dimension. Write a 1–2 sentence rationale grounded in the actual submission — explain *why* you gave that score based on what was described.

- **Impact** (40% weight): How significant is the benefit if this gets solved?
- **Effort** (−25% weight): How hard is this to implement? Higher = harder = penalizes priority score.
- **Readiness** (35% weight): How process-ready and data-ready is this for automation?

### Calculate Priority Score

```
Priority Score = ((Impact × 0.40) + (Readiness × 0.35) − (Effort × 0.25)) × 4
```

Round to one decimal place. The practical range is roughly 2–14 on a 1–5 scale with min effort.

### Determine Solution Type

| Type | Condition |
|------|-----------|
| No-Code / Ops-Owned | Readiness ≥ 4 AND Effort ≤ 3 |
| Eng Build | Effort ≥ 4 OR Readiness ≤ 2 |
| Needs Assessment | Everything else |

### Suggest an owner

Pick from this list based on Solution Type:

| Owner | When to suggest |
|-------|----------------|
| Diana | No-Code / Ops-Owned — clean process, low complexity, Zapier/Forms/Sheets tooling |
| Cory | Eng Build — requires custom code, API work, MCP server, or agentic workflow |
| Kelly | Needs Assessment, anything cross-functional, or anything involving AI strategy |

### Set Confidence Level (1–5)

Rate how confident you are in your scores based on how much context you had:

| Score | Label | Meaning |
|-------|-------|---------|
| 1 | Very Low | Almost no context beyond the form itself; scoring is largely speculative |
| 2 | Low | Limited detail; key fields vague or missing; links absent or unhelpful |
| 3 | Medium | Reasonable detail; some assumptions required; supplementary context partially useful |
| 4 | High | Good detail in submission and/or supplementary links added meaningful signal |
| 5 | Very High | Rich context from multiple sources; high confidence in all three scores |

### Write flags

In **Claude Flags / Open Questions**, note anything the human reviewer should know: missing information, ambiguous scope, assumptions you made, dependencies worth flagging, or questions worth asking the submitter.

---

## Step 4: Write to the Claude Review tab

> **CRITICAL: NEVER delete any rows from the Claude Review tab. NEVER overwrite existing rows. This tab is a permanent record. Only append new rows at the bottom.**

For each submission you scored, append one row with these 25 columns in order:

| # | Column | Value |
|---|--------|-------|
| 1 | Date Claude Reviewed | Today's date |
| 2 | Submission Timestamp | From Intake |
| 3 | Submitter Name | From Intake |
| 4 | Category | From Intake |
| 5 | Initiative / Process Name | From Intake |
| 6 | Problem Statement | From Intake |
| 7 | Desired Outcome | From Intake |
| 8 | Impact | Submitter's impact description (from Intake) |
| 9 | Potential Success Metric | From Intake |
| 10 | Additional Context Used | List URLs you fetched, or "None" |
| 11 | Impact Score (1-5) | Your score |
| 12 | Impact Rationale | 1–2 sentences |
| 13 | Effort Score (1-5) | Your score |
| 14 | Effort Rationale | 1–2 sentences |
| 15 | Readiness Score (1-5) | Your score |
| 16 | Readiness Rationale | 1–2 sentences |
| 17 | Priority Score | Calculated |
| 18 | Solution Type | Auto-suggested |
| 19 | Suggested Owner | Diana / Cory / Kelly |
| 20 | Confidence Level | 1–5 |
| 21 | Claude Flags / Open Questions | Flags and open questions |
| 22 | Human Review Status | Leave blank — enter empty string |
| 23 | Reviewer Name | Leave blank — enter empty string |
| 24 | Review Date | Leave blank — enter empty string |
| 25 | Human Notes / Score Overrides | Leave blank — enter empty string |

### How to write the row (technical — follow exactly)

Writing to the sheet requires Claude in Chrome. Use the **clipboard-paste method** — do NOT type all values as one string into a single cell.

1. **Prepare your 25 values** as a single tab-separated string (one line, no newlines within any value — strip newlines from long text fields). Empty columns at the end should still be included as empty tabs.

   Example structure: `2026-05-27\t5/27/2026 14:04:30\tKelly Feeney\t...\t\t\t\t`

2. **Write the string to the clipboard** using the `javascript_tool`:
   ```javascript
   await navigator.clipboard.writeText("value1\tvalue2\tvalue3\t...\t\t\t\t");
   ```
   Replace each `valueN` with the actual value for that column. Make sure there are exactly 25 tab-separated fields.

3. **Find the first empty row** in the Claude Review tab. Count existing data rows (header is row 1; first data row is row 2; next empty is row 2 + number of existing data rows).

4. **Navigate to that cell** using the Name Box (top-left corner, shows current cell address). Click it, type `A[N]` (e.g., `A2`), press Enter.

5. **Paste** with `Ctrl+V`. Google Sheets will distribute the tab-separated values across columns A through Y automatically.

6. **Press Enter** to confirm and exit edit mode.

7. **Verify**: click cell A[N] and confirm the formula bar shows only the date value, not the full string. Click B[N] and confirm it shows the timestamp, etc.

---

## Step 5: Update Intake tab Status

After successfully writing to Claude Review, update the **Status column** for that Intake row to: **Claude Reviewed**

Update only the Status column. Do not touch any other columns in the Intake tab.

---

## Step 6: Send notification to #kelly-ops on Slack

When all submissions are processed, **actually send** a Slack message to **#central-ops-workflow-review** (channel ID: `C0B7ENEAD6U`) using the Slack MCP tool. Do not just draft the message — send it. This is a live action, not a preview.

Format the message as follows. If you reviewed multiple submissions, list each one in sequence in the same message:

```
🔍 Claude Review Complete — [N] submission(s) reviewed

**[Initiative / Process Name]**
Submitter: [Name] | Category: [Category]
Priority Score: [X.X] | Solution Type: [Type] | Suggested Owner: [Name]
Summary: [2–3 sentences: what the problem is, how it scored, and why]
Flags: [Claude Flags content, or "None"]
```

---

## Constraints

- **NEVER delete rows** from any tab
- **NEVER modify** any Intake columns other than Status
- **NEVER overwrite** existing Claude Review rows — only append
- If you cannot write to the sheet, tell the user what failed before stopping
- If you cannot fetch a linked URL, note it in "Additional Context Used" and continue with the context you have
