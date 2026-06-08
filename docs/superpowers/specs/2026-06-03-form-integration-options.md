# Form Integration Options — Data Flow & Decision Guide

**Status:** For review by Cory + Diana before any implementation
**Date:** 2026-06-03

---

## Current State

Two parallel paths exist today. Only the GitHub path is fully connected to the Hub.
The Google Form path was planned but the Zapier → GitHub bridge was never built.

```mermaid
flowchart TD
    subgraph GH["GitHub Path — FULLY CONNECTED"]
        direction TB
        GH1[Contributor edits\nSKILL.md frontmatter\nin GitHub repo]
        GH2[GitHub Actions\nsync-registry.mjs\nruns every 4 hours]
        GH3[(DynamoDB\nskills table)]
        GH4[Hub API\n/api/skills]
        GH5[Skill detail page\ntags · compatibility · category]

        GH1 --> GH2 --> GH3 --> GH4 --> GH5
    end

    subgraph FORM["Google Form Path — DISCONNECTED ⚠️"]
        direction TB
        F1[Contributor fills\nGoogle Form]
        F2[Google Sheet\nCol H: tags\nCol I: compatibility\nCols A–G: other metadata]
        F3{Zapier automation\nor Sheets API pull\n\nNOT BUILT}
        F4[SKILL.md updated\nor created in GitHub]

        F1 --> F2 --> F3
        F3 -. planned but missing .-> F4
        F4 -. would flow into .-> GH2
    end

    subgraph ADMINPATH["Admin Override Path — FULLY CONNECTED"]
        direction TB
        A1[Admin edits metadata\nin /admin panel\nSkills & Agents tab]
        A1 --> GH3
    end

    style F3 fill:#fef3c7,stroke:#f59e0b,color:#92400e
    style FORM fill:#fff7ed,stroke:#fed7aa
    style GH fill:#f0fdf4,stroke:#bbf7d0
    style ADMINPATH fill:#f0f9ff,stroke:#bae6fd
```

**What this means today:**
- Tags and compatibility on Hub skill pages come from SKILL.md files — not the Google Sheet
- Form submissions land in the sheet and stop there; ops has to manually create/update GitHub files
- Admins can directly edit metadata fields via the admin panel (already built)

---

## Potential State — Hub Web Form

Remove Google Form and Zapier from the path entirely. Use the submission + admin review
infrastructure that's already built into the Hub.

```mermaid
flowchart TD
    subgraph SUB["Submission Path"]
        direction TB
        S1[Contributor fills\nHub web form\nNava SSO authenticated]
        S2[POST /api/skills\nvalidates required fields\nenforces tag picklist]
        S3[(DynamoDB\nstatus: pending)]
        S4[Admin queue\n/admin → Queue tab\nalready built]
        S5{Admin reviews\ncan edit fields\nbefore approving}
        S6A[Approve →\nstatus: approved]
        S6B[Reject →\nnotification to submitter]

        S1 --> S2 --> S3 --> S4 --> S5
        S5 --> S6A
        S5 --> S6B
    end

    subgraph DISPLAY["Display Path — already works"]
        direction TB
        D1[(DynamoDB\nstatus: approved)]
        D2[Hub API\n/api/skills]
        D3[Skill detail page\ntags · compatibility · category]

        D1 --> D2 --> D3
    end

    subgraph ADMIN["Admin Direct Edit — already works"]
        direction TB
        AE1[Admin edits any skill\nin /admin → Skills & Agents tab\nfields: tags, compatibility, category, status]
        AE1 --> D1
    end

    S6A --> D1

    style SUB fill:#f0fdf4,stroke:#bbf7d0
    style DISPLAY fill:#f0f9ff,stroke:#bae6fd
    style ADMIN fill:#f0f9ff,stroke:#bae6fd
```

**What's already built vs. what's new:**
| Piece | Status |
|---|---|
| POST /api/skills submission endpoint | Built |
| Admin queue review + approve/reject | Built |
| Admin field editing (tags, compatibility) | Built |
| Audit log for changes | Built |
| Hub web form UI (the form itself) | **Not yet built** |
| Tag/compatibility picklist enforcement | **Not yet built** |
| Email notification on reject | **Not yet built** |

Estimated build: 1–2 days for the submission form UI + picklist enforcement.

---

## Open Questions: Hub Web Form vs. Zapier/Google Form

These are the decisions that should be resolved before choosing a path.

### IT Handoff & Maintenance

| Question | Why it matters |
|---|---|
| Does IT currently have Zapier licenses, and who manages them? | Zapier has ongoing subscription costs and requires a designated owner. If no one owns it, automations break silently. |
| Can IT staff configure and debug Zapier workflows without developer support? | Zapier is no-code but non-trivial — someone has to own it when field mappings break or the Google Sheet schema changes. |
| Is the Google Form/Sheet being used for anything beyond Hub population (reporting, audit trails, stakeholder comms)? | If the Sheet is already embedded in other ops workflows, removing it creates side effects beyond the Hub. |
| Who "owns" the Google Form long-term — IT, ops, or dev? | If it's IT, the Zapier path may be easier for them to manage. If it's dev, that advantage disappears. |

### Data Integrity & Consistency

| Question | Why it matters |
|---|---|
| Does the Google Form currently enforce controlled vocabularies for tags and compatibility? | Both paths need picklists to prevent inconsistent values from fragmenting Hub filters. This is a gap in the current form. |
| What's the migration plan for skills that are already in the Google Sheet but not yet in the Hub? | Either path needs a one-time import step for existing sheet data. |
| How are metadata edits handled after initial submission? | The Hub web form path has a built-in admin edit UI. The Zapier path requires re-submitting or editing the sheet row — unclear how that triggers an update. |

### Reliability & Transparency

| Question | Why it matters |
|---|---|
| What happens when Zapier goes down or a webhook fails? | Form submissions could be silently lost. The Hub web form path has no external dependency — it either succeeds or shows the user an error. |
| How will ops know when a submission is waiting for review? | Hub web form: built-in queue in admin panel. Zapier: needs a separate notification step configured. |
| Is there an audit trail requirement? | The Hub already logs all admin actions. Google Sheet has row-level history but it lives outside the Hub. |

### Speed & Experience

| Question | Why it matters |
|---|---|
| Does submission need to go live immediately, or is ops review acceptable? | Both paths can support a review queue. Hub web form makes this the default; Zapier path could bypass it if the sheet-to-GitHub write is direct. |
| Do contributors expect to see their submission status? | Hub web form can show this natively. Zapier path would require a separate email or sheet-based status column. |
| Is the Google Form experience important for non-technical contributors? | Google Forms are very familiar. A well-designed Hub form would be equivalent — and already authenticated — but there's a change management consideration. |

---

## Summary Comparison

| | Google Form + Zapier | Hub Web Form |
|---|---|---|
| **External dependencies** | Google Form, Google Sheet, Zapier | None |
| **IT can manage without dev** | Yes (Zapier UI, no code) | Yes (admin panel UI, no code) |
| **Nava SSO auth** | No (open form) | Yes (already built) |
| **Review queue** | Needs Zapier step to notify | Already built |
| **Audit log** | Google Sheet history (outside Hub) | Built into Hub |
| **Failure mode** | Silent (Zapier drop) | Visible error to submitter |
| **Controlled vocabulary** | Only if form has validated picklists | Can enforce at API level |
| **Existing data migration** | N/A (already in Sheet) | One-time import needed |
| **Build effort (remaining)** | Medium — Zapier config + GitHub write | Low — form UI + picklist only |
| **Ongoing maintenance** | Zapier account + 2 Google assets | One system (Hub) |
