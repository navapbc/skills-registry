---
name: epic-writer
description: >
  This skill guides you through drafting and refining epics and stories using
  a structured interview, checking along the way whether the work is ready to
  build and flagging dependencies. It covers drafting a new epic, refining an
  existing one, splitting an oversized epic, or turning research notes into
  one or more epics, as well as drafting stories sized for sprint delivery
  with acceptance criteria built in. Once everything is ready, it can also
  create and link the corresponding tickets directly in GitHub or Jira.
version: "1.0"
author: jacquelinesiotto@navapbc.com
author_name: Jacqueline Siotto
team: Project Management
sensitive_data: false
problem: Scoping work into well-formed epics and stories takes time, and quality often suffers under deadline pressure. Dependencies get missed, key details are left out, and epics get drafted before anyone's confirmed the work is ready to build. Writing epics that are clear to both technical teams and clients requires balancing technical accuracy with plain-language clarity, and creating and linking tickets in a work tracker is manual and tedious. Together, these gaps leave teams and clients without a clear, consistent understanding of what's being built, why it matters, and what the real scope is.
estimated_impact: Saves roughly 1–2 hours per epic, reduces rework from misaligned scope
usage_frequency: A few times per month
expected_audience: 16+ people
impact_type: [Time saved per use, Reduced error rate or rework, Increased output volume or consistency, Other]
compatibility: [claude-chat, claude-cowork, claude-code]
tags: [epic-writing, story-writing, delivery-planning]
data_sources: GitHub (via Claude Code and the GitHub CLI, for issue creation and adding issues to an existing project) and Jira Cloud (via the Atlassian connector), both optional and only used if you push the finished work to a tracker. Also reads an optional local config file for tracker settings and any reference documents you share during the interview.
---

