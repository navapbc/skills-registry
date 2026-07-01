---
name: finance-onboarding-checkskill
description: >
  Runs the monthly LCAT check for the Finance team. It pulls all billable
  roles from the Jira Staffing board (project SO) where the Project Start
  Date falls in a given month, then creates a new Google Sheet report in the
  Delivery Staffing Movements Drive folder for Finance to compare LCATs
  against Unanet.  Trigger phrases: "monthly LCAT check", "run the LCAT
  check", "LCAT check for [month]", "run the finance report", "monthly
  finance check", "pull staffing for [month]", "create the finance onboarding
  sheet", or "finance staffing report."  What it does, step by step:  - Asks
  you which month to report on and whether to notify Finance in Slack
  afterward - Queries Jira (project SO) for roles with a Project Start Date
  in that month, excluding Corporate/Non-Billable - Builds a CSV with
  columns: Project Name, Employee Full Name, Project Start Date, Summary,
  Issue Key, GSA LCAT, Contract LCAT, Unanet LCAT, Flag/Comment? - Creates a
  new Google Sheet titled {Month} {Year} - Delivery Staffing Movements in the
  Finance LCAT reports Drive folder - Optionally sends a summary message to
  the Finance Slack channel
version: "1.0"
author: clare@navapbc.com
author_name: Clare Rogoyska
team: Operations and Automation
sensitive_data: false
problem: "Before this skill, running the monthly Finance LCAT check was a two-hour manual process — exporting a report from Jira, cleaning and sorting the data, formatting it into something Finance could actually use, and then tracking down the right people to send it to.

Now it takes minutes. The skill pulls the right roles directly from the Jira Staffing board, builds the report in the exact format Finance needs, drops it into the shared Drive folder, and can notify the Finance team in Slack — all in one shot, no spreadsheet wrangling required."
estimated_impact: Saves around 45 minutes in the Jira export to cleanup, saves around 45 minutes in sorting and formatting the data, saves around 15-30 minutes in sharing and notifying
usage_frequency: Monthly or less
expected_audience: 2-5 people
impact_type: [Time saved per use, Reduced error rate or rework, Faster turnaround / cycle time, Other]
compatibility: [claude-chat]
tags: [lcat-check, monthly-invoice-review, staffing-movements-report]
data_sources: Jira staffing board, Google Drive, Slack
---

# Monthly LCAT Check

This skill generates the monthly Finance onboarding report by pulling assigned roles from the
Nava Jira Staffing board and creating a Google Sheet for the Finance team to reconcile against Unanet.

## What you need from the user

Before doing anything, confirm:
1. **Which month** to report on (e.g. "June 2026"). If they haven't specified, ask. If the context
   makes it obvious (e.g. they say "this month" or "last month"), infer it and confirm.
2. **Whether to notify Finance in Slack** after the sheet is created. Always ask before sending — never send automatically.

## Step 1: Query Jira for roles that started in the target month

Use the Jira MCP with cloudId `navasage.atlassian.net`.

Build the JQL using the first and last day of the target month. Exclude Corporate/Non-Billable roles — Finance only needs billable project assignments:
```
project = SO AND cf[10130] >= "YYYY-MM-01" AND cf[10130] <= "YYYY-MM-31" AND cf[17867] != "Corporate/Non-Billable" ORDER BY cf[10130] ASC
```
Use `maxResults=100` and check `pageInfo.hasNextPage` — if true, fetch additional pages using
the `nextPageToken` until all results are collected.

Request these fields for each issue:
- `summary`
- `customfield_10130` — Project Start Date
- `customfield_10133` — Employee Full Name (primary)
- `customfield_10514` — Employee Full Name (fallback if 10133 is empty)
- `customfield_17867` — Project Name
- `customfield_10099` — GSA LCAT
- `customfield_10148` — Contract LCAT

**Extracting values:** Several of these return objects, not plain strings. Always check:
- If the field is a dict, pull `.value` (e.g. `customfield_10099.value`)
- If it's a string, use it directly
- If null/empty, leave blank — don't fill in guesses

**Employee Full Name:** Use `customfield_10133`. If that's empty, fall back to `customfield_10514`.

**Project Start Date format:** Convert from `YYYY-MM-DD` to `M/D/YYYY` (e.g. `2026-06-01` → `6/1/2026`).

## Step 2: Build the CSV content

Use these column headers exactly (matching the existing sheet format):
```
Project Name, Employee Full Name, Project Start Date, Summary, Issue Key, GSA LCAT, Contract LCAT, Unanet LCAT, Flag/Comment?
```

Leave `Unanet LCAT` and `Flag/Comment?` blank — Finance fills those in during their Unanet reconciliation.

Include all roles regardless of Jira status (ARCHIVED, open, filled) — Finance will flag anything they don't need. Corporate/Non-Billable roles are already excluded at the query level (see Step 1).

## Step 3: Create a new Google Sheet

Use the Google Drive MCP to create the file:
- **Title:** `{Month} {Year} - Delivery Staffing Movements` (e.g. `June 2026 - Delivery Staffing Movements`)
- **Content:** The CSV you built in Step 2
- **contentMimeType:** `text/csv` (Google Drive will auto-convert to a Google Sheet)
- **parentId:** `0AGC27df_PJirUk9PVA` (the Finance LCAT reports Drive folder)

After creating, share the `viewUrl` from the response with the user.

**Permissions reminder:** After sharing the link, always remind the user to open the sheet and set sharing to **"Nava (navapbc.com) — Editor"** so the Finance team can access it. They can do this via Share → General access → change to Nava with Editor role. This cannot be done automatically.

> **Note on the master sheet:** The ideal workflow would add a new tab directly to the existing
> "Delivery Staffing Movements" sheet (`1r3FLgfHXu48q6FQZPZ9oA4jN0HCqa4I3U3lSgK3MmT0`), but the
> Google Drive MCP can only create files, not modify tabs in existing spreadsheets. The separate
> monthly file approach is the reliable fallback. If the user's Chrome browser is already signed
> into Google, you can optionally try the browser tool to add the tab directly — but only if they ask.

## Step 4: Notify Finance in Slack (with permission)

Before sending, confirm with the user. If they say yes, send to channel `C0BDFV39CG2`:

```
📊 *{Month} {Year} Finance Staffing Report is ready!*

{N} roles with a Project Start Date in {Month} have been pulled from the Jira Staffing board.

👉 [View the report]({Google Sheet URL})

The *Unanet LCAT* and *Flag/Comment?* columns are blank — please fill those in as you compare against Unanet.
```

## Jira field reference

| What you want | Jira field |
|---|---|
| Project Start Date (filter + display) | `customfield_10130` |
| Project Name | `customfield_17867` |
| Employee Full Name | `customfield_10133` (fallback: `customfield_10514`) |
| GSA LCAT | `customfield_10099` |
| Contract LCAT | `customfield_10148` |

## Config

| Setting | Value |
|---|---|
| Jira cloudId | `navasage.atlassian.net` |
| Jira project | `SO` |
| Drive parent folder | `0AGC27df_PJirUk9PVA` |
| Finance Slack channel | `C0BDFV39CG2` |
| Master sheet (for reference) | `1r3FLgfHXu48q6FQZPZ9oA4jN0HCqa4I3U3lSgK3MmT0` |

## What to tell the user when you're done

After creating the sheet:
- Share the link
- State how many roles were included
- Remind them that Unanet LCAT and Flag/Comment? are blank for them to fill in
- Ask if they want to notify Finance in Slack (if you haven't already)
- If zero results were found, warn the user — this likely means the date filter needs checking
