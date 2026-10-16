---
name: skills-marketplace-troubleshoot
description: >
  Diagnoses stuck or missing submissions in the Nava AI Skills Marketplace
  pipeline. Walks the pipeline layer by layer, isolates the break with ruled-
  out alternatives, and produces a standardized incident report (Root cause →
  Ruled out → Also investigated → Next steps).
version: "1.0"
author: nava-workflows@navapbc.com
author_name: Operations and Automation
team: Operations and Automation
sensitive_data: false
problem: Pipeline incidents are investigated inconsistently and should live as a centralized diagnostic process. This skill codifies the investigation protocol into a repeatable 5-step process, catalogs 18 known failure modes with signatures and remediations, and enforces a standard report format so any incident can be handed off, escalated, or compared without the next investigator starting from zero.
estimated_impact: Cuts incident investigation from ~45–60 min to ~15–20 min
usage_frequency: A few times per month
expected_audience: 2-5 people
impact_type: [Reduced error rate or rework, Faster turnaround / cycle time]
compatibility: [claude-chat, claude-cowork]
tags: [troubleshooting, operations]
data_sources: No client or PHI data; all references are internal; Google Sheets or Apps Script
---

# Skills Marketplace -- troubleshoot

Fixed protocol for diagnosing stuck or failed submissions. Output is always the report format in `references/report-template.md`. Do not freeform.

## Step 1 -- Capture symptom

Record before touching anything:
- Skill slug and submitter email
- Submission timestamp
- What the submitter observed
- A comparison case that worked within 24h (most valuable artifact)

If any is missing, ask once in one message. Do not start checking layers blind.

Use the symptom table in `references/pipeline-layers.md` to route to first-suspect layers. The match is a hint, not a shortcut.

## Step 2 -- Walk layers in order

Open `references/pipeline-layers.md` and check each layer in sequence. At each one record one of: **passed**, **failed**, **no evidence**. Do not skip ahead based on a theory.

For any failure matching a cataloged pattern, consult `references/known-failure-modes.md` for the exact remediation.

## Step 3 -- Classify

- Failed layer that explains the symptom = **root cause**
- No-evidence layer that could have explained it = **"Also investigated"**
- Passed layer that was suspected = **"Ruled out"** with the evidence
- Nothing provable = **"Root cause: Not found"**. This is valid and often correct. Say it. Do not invent a cause to seem productive.

## Step 4 -- Report

Fill `references/report-template.md` exactly. Four sections, in order: Root cause, Ruled out, Also investigated, Next steps.

Owner conventions:
- [KELLY] -- escalation routing, cross-team assignment, policy or process decisions
- [IT / ABROO] -- CE publish, Zapier/Apps Script platform ownership, manual pipeline reprocessing
- [ENGINEERING] -- GitHub, Hub, DynamoDB sync (route via Kelly; no active owner)

## Step 5 -- Reprocess (only if required)

See `references/reprocessing-playbook.md`. Order matters. Wrong order creates duplicates or orphans.

## Guardrails

- Never edit a sheet row in place to retrigger -- row ID is cached as seen
- Never restart a Zap mid-run -- use Replay from Zap History
- Never rotate the Anthropic API key without updating the Zapier input variable in the same session
- Never propose a fix without evidence from Step 2. "I think it was X" is not a root cause.
- 7-day Apps Script log retention is a hard limit. For older incidents, record "no evidence (log retention)" and move on.
- Never reproduce the pipeline's error sentinel token in prose anywhere in this skill's files -- it will trigger self-rejection. Reference it indirectly ("the sentinel token defined in Apps Script `checkSkillSize`") instead.
