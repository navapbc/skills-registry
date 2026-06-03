---
name: test-exec-summary
description: >
  Converts raw work input into executive summary bullets for leadership
version: "1.0"
author: dianaolympia@navapbc.com
author_name: Diana Olympia
team: Business Development
sensitive_data: false
problem: Spend 45-60 minutes aggregating and formulating summary
estimated_impact: Saves 45-60 minutes per summary
usage_frequency: A few times per week
expected_audience: 6-15 people
impact_type: [Time saved per use]
compatibility: [claude-chat, claude-cowork]
tags: [writing, meeting-prep]
---

# Exec Summary Bullets

Converts raw work input into executive summary bullets for VP+ audiences. Output goes into a weekly AI Transformation deck aggregated across teams.

---

## Output Format

Two sections, always:

### This Week
- Up to 5 bullets
- Format: `Action/output --> result or status`
- Drop "the" where possible. No play-by-play. No attribution unless owner is critical context.
- Use **WIP** for anything in progress
- Status over process: what exists now, not what happened to get there

### Next Week
- Up to 5 bullets
- Format: `Deliverable + timing` or `Action --> expected outcome`
- Sub-bullets OK for tightly related items (e.g., draft due Weds → present Thurs)

---

## Rules

- No filler openers: never "Worked on", "Continued to", "Helped with", "Kicked off"
- No full names — first name only if attribution adds context, otherwise drop it
- No "the" before team names: "People team" not "the People team"
- One idea per bullet — if two things happened, two bullets
- Strip internal jargon unless it's universally understood at Nava
- WIP = work in progress, use it

---

## Handling Missing Next Week Info

If no next steps in input, infer from completed work and mark *(inferred)*. Then add:

> **To complete Next Week:** What's planned, who owns it, any deadlines?

---

## Example

**Input:**
> been a busy week, we finally got the n8n workflow live for the finance team, took forever but it's working now. sarah led that. also had a kickoff for the new prompt library project with 3 teams. next week i think we're meeting with HR about their intake process

**Output:**

### This Week
- n8n workflow live for Finance team → manual process eliminated
- Prompt Library kickoff complete → 3 teams aligned on scope

### Next Week
- Meet with HR to assess intake process for automation opportunities *(inferred — confirm owner + date)*

> **To complete Next Week:** Any other planned work, owners, or deadlines to add?
