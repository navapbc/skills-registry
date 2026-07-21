---
name: central-ops-review
category: team-automations
description: >
  Run the Central Ops Workflow intake review. Reads all unreviewed
  submissions from the Intake tab (empty Status column), scores each
  one using the Scoring Guide rubric (Impact, Effort, Readiness),
  appends scored rows to the Claude Review tab, updates each Intake
  row Status to "Claude Reviewed", and sends a summary to
  #central-ops-workflow-review on Slack. Invoke whenever Kelly or
  Cory says "run the review", "score the intake submissions", "check
  for new submissions", "review the backlog", "what needs to be
  reviewed", or any variation of wanting Claude to process pending
  Central Ops workflow improvement requests. Also invoke proactively
  if the user asks what's in the backlog without having reviewed it
  yet this session.
version: "1.0"
author: kellyfeeney@navapbc.com
author_name: Kelly Feeney
team: Operations and Automation
sensitive_data: false
problem: "Claude handles the initial human review (~20 minutes). Over time, we will continue updating the skill to get more accurate & save more time (~60 minutes)  at evaluating the priority, impact, and type of solution (no code tool, automation/AI resourcing from Eng) to apply to workflows."
estimated_impact: "Saves ~20 min per workflow review to start (hope to increase time saved over time); as volume of submissions increases the value of the skill scales"
usage_frequency: A few times per week
expected_audience: 2 - 5 people
impact_type: [Time saved per use, Reduced error rate or rework, Faster turnaround / cycle time]
compatibility: [claude-chat, claude-cowork]
tags: [workflow-automation, ops-backlog-review]
data_sources: "Google Form & Sheet, optional: Confluence pages, meeting transcripts, (if for submission includes links to other context)"
---

# Central Ops Workflow Review

[...rest of body unchanged...]
