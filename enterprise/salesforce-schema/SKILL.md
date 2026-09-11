---
name: salesforce-schema
description: >
  A reference card for Nava's Salesforce org that Claude reads before it
  touches Salesforce. It carries the real field API names, picklist values,
  stage names, junction objects, and the query patterns that work in our org,
  plus the data quality traps that produce wrong answers (Amount is Nava's
  share, not contract value; Program is multi-select; CloseDate means
  expected award). It activates on its own whenever you ask Claude anything
  about pipeline, opportunities, stages, Gate 2, competitors, company
  records, or ask it to run a Salesforce query or update. It has no records
  or credentials in it. It's the map, not the data.
version: "1.0"
author: mikecase@navapbc.com
author_name: Mike Case
team: Other
sensitive_data: false
problem: "Without it, Claude guesses at Salesforce field names and gets them wrong, burns four or five exploratory queries per question, and misreads our conventions: it reports Amount as total contract value, filters Program with equals and gets zero rows, or text-scans Competitors and times out. Every BD skill that touches Salesforce (project-index-search, external-discussion-prep, Gate 2 analysis) depends on someone having loaded this first. Publishing it means those skills work the same for everyone instead of only on the machines where I installed it."
estimated_impact: Cuts a Salesforce question from four or five exploratory queries to one or two, roughly 5 to 10 minutes saved per question. Removes the common wrong answers (Amount vs TCV, multi-select filters, timeout patterns).
usage_frequency: Daily
expected_audience: 6-15 people
impact_type: [Time saved per use, Reduced error rate or rework]
compatibility: [claude-chat, claude-cowork, claude-code]
tags: [salesforce, business-development, pipeline]
data_sources: "Salesforce only (Nava org): Opportunity, Account, Contact, OpportunityContactRole, Task, Event, CampaignMember, Companies_C__c, and the three company junction objects. The skill is a schema reference. It contains field names, picklist values, and query templates; no records, no client data, no credentials. It tells Claude how to query Salesforce correctly through the user's own connector, and its write guidance is conservative (never overwrite human-entered summaries)."
---

# Nava PBC Salesforce Schema Reference

## Purpose

This skill provides the correct field API names, picklist values, relationships, and
business logic for Nava's Salesforce org. **Always consult this before constructing
SOQL queries or Salesforce operations** to avoid wasted exploratory queries, incorrect
field references, and failed writes.

---

## Opportunity Object

### Stage Progression

Stages follow a numbered pipeline progression. Use the exact strings below in SOQL:

| Stage | API Value | Status | Notes |
|-------|-----------|--------|-------|
| Lead | `0 - Lead` | Open | New lead, not yet qualified |
| Identification | `1 - Identification` | Open | Initial research, early enrichment |
| Assessment | `2 - Assessment` | Open | Active assessment, Gate 2 preparation |
| Capture | `3 - Capture` | Open | Post-Gate 2, active capture and solution development |
| Pre-Proposal | `4 - Pre-Proposal` | Open | Proposal preparation |
| Proposal | `5 - Proposal` | Open | Active proposal writing |
| Submitted | `6 - Submitted` | Closed | Awaiting decision |
| Closed/Won | `6 - Closed/Won` | Closed | Won work, moved to delivery execution and revenue tracked in Unanet |
| Won/Transitioning | `6 - Won/Transitioning` | Closed | We have been notified of intent to award to Nava, but paperwork not finalized |
| Closed/Lost | `6 - Closed/Lost` | Closed | Reason for closing tracked in Closed_Lost_Reason__c, no-bid, lost, cancelled |

#### Common Stage Filters

- **Active pipeline** (not closed): `StageName NOT LIKE '6%'`
- **Qualified pipeline** (not closed): `StageName IN ('3 - Capture', '4 - Pre-Proposal', '5 - Proposal', '6 - Submitted')`
- **Pursuit pipeline** (actively working): `StageName IN ('2 - Assessment', '3 - Capture', '4 - Pre-Proposal', '5 - Proposal')`
- **Closed outcomes**: `StageName LIKE '6%'`
- **Won deals**: `StageName IN ('6 - Closed/Won', '6 - Won/Transitioning')`
- **Lost/No Bid**: `StageName IN ('6 - Closed/Lost')`

#### Stage Transition Rules

- **Gate 2 (Assessment → Capture)** is the only enforced gate transition. The review
  requires populated Gate 2 fields (`Is_it_Real__c`, `Can_We_Win__c`, `Do_We_Want_to_Win__c`)
  and approval from EVP of Growth. No Opportunity should move to Stage 3 without
  Capture Manager and Solution Architect assignments.
- **Gate 1 (Identification → Assessment)** is informal — no enforced gate, but signals
  the team has committed to active assessment.
- **No gate enforcement** exists for Capture → Pre-Proposal or Pre-Proposal → Proposal.
- **Stage 6 transitions** are outcome-based, not gate-based.

### Key Picklist Fields

#### Portfolio__c
Segments the pipeline by business unit:
- `Federal Civilian`
- `Federal Health`
- `State`
- `NavaLabs`

#### Program__c (Multi-Select)
Semicolon-delimited. Use `INCLUDES()` for multi-select filtering in SOQL.
Known values: `Unemployment Insurance`, `Medicaid`, `Integrated Eligibility`, `SNAP`,
`TANF`, `Paid Leave`, `Child Welfare`, `HR1`, `Workforce Development`

Example: `WHERE Program__c INCLUDES ('Medicaid')`

#### Top_Opp__c
Flags priority opportunities. Known values: `Yes - Value`, `Yes - Strategic`, `Yes - Revenue`

#### Set_Asides__c (Multi-Select)
Acquisition type / set-aside: `Full/Open/Unrestricted (Publicly Available)`,
`Nava Contract Vehicle`, `Small Business`, `GSA MAS`

#### Contractor_Type__c
Known values: `Prime Contractor`, `Subcontractor`

#### Type (Standard)
Known values: `New Business`, `Organic Growth`, `Existing Business (Recompetes)`, `Existing Business (Follow-on's)`

### Opportunity Field Reference

#### Value & Financials
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Total Value to Nava | `Amount` | Currency | Primary pipeline reporting field. Represents TCV *to Nava* after workshare splits, NOT the full contract TCV |
| Annual Value for Nava | `Annual_Contract_Value__c` | Formula (Currency) | Calculated annual run rate |
| TCV (Overall) | `TCV_Total_Contract_Value_Overall__c` | Currency | Full contract value — **usually null**, low reliability |
| Pricing | `Pricing__c` | Text Area(255) | |

#### Dates & Timeline
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Contract Reward Date | `CloseDate` | Date | Standard "Close Date" field, repurposed as expected award date |
| Contract End Date | `Contract_End_Date__c` | Date | |
| Date Moved to Capture | `Date_Moved_to_Capture__c` | Date | Stage transition tracking — when Gate 2 passed |
| Parent Contract Expiration | `Parent_Contract_Expiration_Date__c` | Date | For recompetes |
| Questions Due | `Questions_Due__c` | Date | |
| RFI Release / Due / Reminder | `RFI_Release_Date__c`, `RFI_Due_Date__c`, `RFI_Reminder_Date__c` | Date | |
| RFP Release / Due / Reminder | `RFP_Release_Date__c`, `RFP_Due_Date__c`, `RFP_Reminder_Date__c` | Date | |
| RFP Release Date Certainty | `RFP_Release_Date_Basis__c` | Picklist | |
| Final Phase Due | `Final_Phase_Due__c` | Date | |

#### Roles & Assignments
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Capture Manager | `Capture_Manager__c` | Picklist | Assigned at Gate 2 |
| Client Executive | `Client_Executive__c` | Text(40) | Free text, NOT a lookup. ⚠️ Known data quality issue: some records store User IDs instead of names |
| Delivery Lead | `Delivery_Lead__c` | Picklist | |
| Solution Architect | `Solution_Architect__c` | Picklist (Multi-Select) | |
| Proposal Manager | `Proposal__c` | Picklist | |
| Proposal Writer | `Proposal_Writer__c` | Text(40) | Free text |

#### Competitive & Partners
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Competitors | `Competitors__c` | Text(255) | Legacy free text, comma-separated. ~11% populated. Structured data now in junction objects. |
| Incumbent | `Incumbent__c` | Text(254) | Free text, often messy — may contain URLs, contract numbers, speculation. ~44% populated. |
| Partners | `Partners__c` | Text(254) | Legacy free text |
| Partner Info | `Partner_Info__c` | Text Area(255) | |

#### Assessment & Strategy (SWOT / Gate 2)
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Is it Real? | `Is_it_Real__c` | Rich Text(32768) | Gate 2 question — validates procurement reality |
| Can We Win? | `Can_We_Win__c` | Rich Text(32768) | Gate 2 question — competitive position |
| Do We Want to Win? | `Do_We_Want_to_Win__c` | Rich Text(32768) | Gate 2 question — strategic fit |
| Strengths | `Strengths__c` | Rich Text(32768) | SWOT |
| Weaknesses | `Weaknesses__c` | Rich Text(32768) | SWOT |
| Opportunities | `Opportunities__c` | Rich Text(32768) | SWOT |
| Threats | `Threats__c` | Rich Text(32768) | SWOT |
| Likelihood to Pursue | `Likelihood_to_Pursue__c` | Picklist | |

#### Status & Tracking
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Current Status | `Current_Status__c` | Long Text(32768) | Narrative status update — variable reliability |
| Blue Bird? | `Blue_Bird__c` | Checkbox | Unexpected/unplanned opportunity |
| Discovery Completed | `Discovery_Completed__c` | Checkbox | |
| Budget Confirmed | `Budget_Confirmed__c` | Checkbox | |
| ROI Analysis Completed | `ROI_Analysis_Completed__c` | Checkbox | |
| Level of effort | `Level_of_effort__c` | Picklist | |
| Has Tech Challenge | `Has_Tech_Challenge__c` | Checkbox/Text | |
| Has Orals | `Has_Orals__c` | Checkbox/Text | |

#### Closed Outcomes
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Closed Lost Reason | `Closed_Lost_Reason__c` | Picklist | |
| Loss Reason | `Loss_Reason__c` | Picklist | ⚠️ Appears duplicative with Closed_Lost_Reason__c |
| Closed Lost/No Bid Info | `Closed_Lost_and_No_Bid_Information__c` | Long Text(32768) | Debrief and learning capture |
| Debrief | `Debrief__c` | Text Area(255) | |
| Debrief Status | `Debrief_Status__c` | Picklist | |
| Retro | `Retro__c` | Text Area(255) | |

#### Staffing & Resources
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Customer POCs | `Customer_POCs__c` | Text(255) | Free text — NOT linked to Contact records |
| KP Needs | `KP_Needs__c` | Long Text(1000) | Key Personnel staffing needs |
| SME Needs | `SME_Needs__c` | Long Text(1000) | Subject Matter Expert needs |
| Latest Staffing Notes | `Latest_Staffing_Notes__c` | Long Text(32000) | |

#### Capabilities & Scope
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Custom Capabilities | `Custom_Capabilities__c` | Picklist (Multi-Select) | Semicolon-delimited |
| Commercial Capabilities | `Commercial_Capabilities__c` | Picklist (Multi-Select) | Semicolon-delimited |
| Portfolio | `Portfolio__c` | Formula (Text) | Calculated field |
| Program | `Program__c` | Picklist (Multi-Select) | Semicolon-delimited |

#### External Links
| Field Label | API Name | Type |
|-------------|----------|------|
| Google Drive | `Google_Drive__c` | URL |
| GovWin IQ link | `GovWin_IQ_link__c` | URL |
| Opportunity Assessment | `Opportunity_Assessment__c` | URL |
| Jira | `Jira__c` | URL |
| Sage | `Sage__c` | URL |
| Procurement Site Link | `Procurement_Site_Link__c` | Text(100) |

#### Identifiers & Metadata
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Opportunity ID | `Opportunity_ID__c` | Auto-number | Human-readable (OPP-000536), NOT the Salesforce record ID |
| Related Opportunity | `Related_Opportunity__c` | Lookup(Opportunity) | Self-referential |
| Solicitation Number | `Solicitation_RFI_ID_Number__c` | Text(40) | |

---

## Companies_C__c Object (Competitive Intelligence)

Custom object for tracking competitors and teaming partners. Used heavily by CI
enrichment, junction population, black hat analysis, and win/loss skills.

### Key Fields
| Field Label | API Name | Type | Notes |
|-------------|----------|------|-------|
| Name | `Name` | Text | Company name |
| Posture | `Posture__c` | Picklist | Relationship posture — see values below |
| Executive Summary | `Executive_Summary__c` | Long Text | Overview paragraph following standard pattern |
| Primary Customers | `Primary_Customers__c` | Text | Top agencies by spend, comma-separated abbreviations |
| Key Qualifications | `Key_Qualifications__c` | Picklist/Text | Must match existing picklist values |
| Vehicles | `Vehicles__c` | Text | Known contract vehicles |
| Set-Asides | `Set_Asides__c` | Text | Must match existing picklist values |
| How We Beat Them | `How_we_beat_them__c` | Text | Evidence-based competitive advantage |
| How They Beat Us | `How_they_beat_us__c` | Text | Evidence-based competitive disadvantage |
| High Price Average | `High_price_average__c` | Currency | Hourly rate (high end) |
| Low Price Average | `Low_price_average__c` | Currency | Hourly rate (low end) |
| Website | `Website__c` | URL | |
| LinkedIn | `LinkedIn__c` | URL | |
| GovWin Link | `GovWin_Link__c` | URL | |
| GSA Link | `GSA_Link__c` | URL | |

#### Posture__c Values
| Value | Meaning |
|-------|---------|
| `Hostile` | Direct competitor, frequently opposes us on deals |
| `Strategic` | Important relationship — could be competitor or partner depending on deal |
| `Growing` | Emerging in our space, increasing frequency of encounters |
| `Transactional` | Occasional overlap, not a primary concern |
| `Shrinking` | Declining presence in our markets |

#### CI Metadata Fields (if schema additions are in place)
| Field | Type | Notes |
|-------|------|-------|
| `Last_Intel_Refresh__c` | Date | When CI data was last updated |
| `Confidence__c` | Picklist | High / Medium / Low — based on source quality |
| `Tier__c` | Number | 1 = Hostile/Strategic, 2 = Growing/Transactional with pipeline overlap, 3 = Others |
| `Category__c` | Text | From vault's 5-category competitive framework |

### Executive Summary Pattern

Follow this structure for consistency:

> [Company] is a [size] [business type] that we have a [posture] relationship with.
> They primarily work with [agencies] and hold [vehicles] contract vehicles, with key
> qualifications like [quals]. We beat them on [factors] and lose to them on [factors].
> [1-2 sentences of strategic context — what makes this competitor notable, any recent
> developments, relationship history].

### Write Rules for Companies_C__c
- **Never overwrite** existing human-entered `Executive_Summary__c` without explicit permission
- **Pricing fields** use hourly rates, not annual — consistent with existing records
- **Primary Customers** uses agency abbreviations (VA, CMS, HHS), not full names
- **Picklist fields** (`Key_Qualifications__c`, `Set_Asides__c`) — match existing values exactly

---

## Junction Objects

Three junction objects connect Companies to Opportunities and Agencies:

### Company_Vehicle_Junction__c (Company ↔ Opportunity)
Tracks which competitors/incumbents appear on which deals.

| Field | API Name | Notes |
|-------|----------|-------|
| Company | `Companies__c` | Lookup to Companies_C__c |
| Opportunity | `Vehicles__c` | Lookup to Opportunity |
| Incumbent | `Incumbent__c` | Boolean — true if incumbent, false if competitor |
| Context | `Context__c` | Source attribution (e.g., "Parsed from Opportunity.Competitors__c") |
| Differentiator | `Differentiator__c` | Notes on competitive positioning |

### Company_Teaming_Junction__c (Company ↔ Opportunity as partner)
Tracks teaming relationships on deals.

| Field | API Name | Notes |
|-------|----------|-------|
| Company | `Company__c` | Lookup to Companies_C__c |
| Opportunity | `Opportunity__c` | Lookup to Opportunity |
| Incumbent | `Incumbent__c` | Boolean |
| Context Intel | `Context_Intel__c` | Source attribution |
| Differentiator | `Differentiator__c` | |

### Company_Agency_Junction__c (Company ↔ Account)
Tracks which competitors work at which agencies.

| Field | API Name | Notes |
|-------|----------|-------|
| Company | `Company_Connections__c` | Lookup to Companies_C__c |
| Agency | `Agency_Connections__c` | Lookup to Account |

---

## Account Object (Client Agencies)

- Represents federal agencies and state governments
- Names are short identifiers: "Colorado", "ACF", "USCIS", "Veterans Affairs"
- `Type` picklist: `Customer`, `Prospect`, `Partner`, `Competitor`, `Other`
- Supports parent-child hierarchy via `ParentId` (e.g., ACF → HHS)
- Most metadata fields (Industry, Billing, Phone) are unpopulated
- Join: `Opportunity.AccountId = Account.Id`

### Common Agency Name Mappings
When matching agency names (especially from free-text fields), normalize abbreviations:

| Abbreviation | Account Name |
|-------------|-------------|
| VA | Veterans Affairs (Federal) OR Virginia (State) |
| CMS | Centers for Medicare & Medicaid Services |
| HHS | Health and Human Services |
| DOD / DoD | Department of Defense |
| ACF | Administration for Children and Families |
| USCIS | U.S. Citizenship and Immigration Services |

---

## Contact Object (Stakeholders)

- Standard fields only; no custom fields. `Contact` has **no `Description` field**; notes live on Tasks/Events.
- ⚠️ Some records are non-person placeholders — filter by `Email != null` for real contacts
- **Thin link to Opportunities.** `OpportunityContactRole` records exist but are sparse (often one untyped role
  per contact, or none). Most client POCs are free text in `Opportunity.Customer_POCs__c` and in
  `Current_Status__c` narrative. **Check both**: query `OpportunityContactRole` by `ContactId`, then scan the
  Account's opportunities' `Customer_POCs__c` / `Current_Status__c` for the person's name client-side.
- Activity: `Task` and `Event` by `WhoId`. `Task` has **no `Type` field** in this org. Many Contacts have zero
  logged activity even when Slack shows an active relationship.
- `CampaignMember` by `ContactId` for thought-leadership campaign history.
- For person lookups, SOSL search (`FIND {name} IN NAME FIELDS RETURNING Contact(...)`) is more reliable than
  field queries. Names vary on record (nicknames, legal names); try variants.
- The first query in a session sometimes times out; retry once before treating a result as empty.

---

## Common Query Patterns

### Pipeline snapshot by portfolio
```sql
SELECT Name, StageName, Amount, Portfolio__c, CloseDate, Capture_Manager__c
FROM Opportunity
WHERE StageName NOT LIKE '6%'
AND Portfolio__c = 'State'
ORDER BY CloseDate ASC
```

### Opportunities approaching RFP release
```sql
SELECT Name, StageName, RFP_Release_Date__c, RFP_Due_Date__c, Capture_Manager__c
FROM Opportunity
WHERE RFP_Release_Date__c != null
AND RFP_Release_Date__c >= TODAY
AND StageName NOT LIKE '6%'
ORDER BY RFP_Release_Date__c ASC
```

### Gate 2 candidates (Assessment stage with gate fields)
```sql
SELECT Name, Amount, Is_it_Real__c, Can_We_Win__c, Do_We_Want_to_Win__c,
       Strengths__c, Weaknesses__c, Capture_Manager__c, Client_Executive__c
FROM Opportunity
WHERE StageName = '2 - Assessment'
ORDER BY Amount DESC
```

### Win/Loss analysis
```sql
SELECT Name, Amount, StageName, Closed_Lost_Reason__c, Loss_Reason__c,
       Competitors__c, Debrief__c, Debrief_Status__c
FROM Opportunity
WHERE StageName IN ('6 - Closed/Won', '6 - Closed/Lost')
AND CloseDate >= LAST_N_DAYS:365
ORDER BY CloseDate DESC
```

### Top opportunities
```sql
SELECT Name, StageName, Amount, Portfolio__c, Top_Opp__c, Capture_Manager__c
FROM Opportunity
WHERE Top_Opp__c != null
AND StageName NOT LIKE '6%'
ORDER BY Amount DESC
```

### Competitor overlap (which deals face a specific competitor)
**Query the junction object by the competitor's Company Id — do NOT text-scan Opportunity.** First get the `Companies_C__c` Id (see Company record lookup below), then:
```sql
SELECT Vehicles__r.Name, Vehicles__r.StageName, Vehicles__r.Amount,
       Vehicles__r.Account__c, Incumbent__c
FROM Company_Vehicle_Junction__c
WHERE Companies__c = '<Companies_C__c Id>'
ORDER BY Vehicles__r.CloseDate DESC
```
`Incumbent__c = true` means the competitor currently holds that contract (a recompete).

> ⚠️ **Performance — avoid timeouts.** The intuitive pattern `WHERE Competitors__c LIKE '%name%' OR Incumbent__c LIKE '%name%'` reliably **times out** on this org: a leading-wildcard `LIKE` can't use an index, and OR-ing two such text fields forces a full table scan. Same trap with SOSL `FIND {x} IN ALL FIELDS` — scope to `IN NAME FIELDS` / `IN EMAIL FIELDS` instead. **Rule: filter on indexed fields (Id, lookups, foreign keys); avoid leading-wildcard `LIKE` and OR-across-text-fields; prefer junction/relationship queries.**

### Company record lookup
```sql
SELECT Id, Name, Posture__c, Executive_Summary__c, Primary_Customers__c,
       Key_Qualifications__c, Vehicles__c, How_we_beat_them__c,
       How_they_beat_us__c, Website__c, LastModifiedDate
FROM Companies_C__c
WHERE Name LIKE '%[search term]%'
```

### Companies by competitive posture
```sql
SELECT Id, Name, Posture__c, Primary_Customers__c
FROM Companies_C__c
WHERE Posture__c IN ('Hostile', 'Strategic')
ORDER BY Posture__c, Name
```

---

## Pipeline Reporting Definitions

- **Amount** ("Total TCV to Nava") — Nava's share after workshare/teaming splits. This is the
  primary pipeline reporting number. NOT the full contract TCV.
- `Annual_Contract_Value__c` is a separate annual run rate calculation
- `TCV_Total_Contract_Value_Overall__c` is the full contract value but is rarely populated

## Opportunity Naming Convention

Standard format: `[State/Agency] [Program] [Description]`

## People Field Conventions

- `Capture_Manager__c`, `Client_Executive__c`, `Solution_Architect__c`, `Proposal_Writer__c`
  are all **text fields** (some are picklists) with intended format "First Last"
- ⚠️ `Client_Executive__c` has a known data quality issue: some records store Salesforce
  User IDs (18-character IDs starting `005`) instead of names

## Key Business Rules

- `Opportunity_ID__c` is the human-readable ID (e.g., OPP-000536), NOT the Salesforce record ID
- `Program__c` is multi-select; always use `INCLUDES()` not `=` for filtering
- `Custom_Capabilities__c` and `Commercial_Capabilities__c` are semicolon-delimited
- `Google_Drive__c` and `Opportunity_Assessment__c` store URLs to external docs
- `GovWin_IQ_link__c` stores the link to the GovWin intelligence record
- `Current_Status__c` is the narrative status update field (long text)
- `CloseDate` is repurposed as "Contract Reward Date" (expected award), not opportunity close

---

## Field Reliability Guide

**High reliability (consistently populated — safe to filter on):**
- Core: `Name`, `StageName`, `Portfolio__c`, `Program__c`
- People: `Capture_Manager__c`, `Client_Executive__c`, `Solution_Architect__c`, `OwnerId`
- Dates: `CloseDate`, `RFP_Release_Date__c`, `RFP_Due_Date__c`, `RFI_Release_Date__c`
- Value: `Amount` (Total TCV to Nava), `Annual_Contract_Value__c`
- Gate 2: `Is_it_Real__c`, `Can_We_Win__c`, `Do_We_Want_to_Win__c`, SWOT fields
- URLs: `Google_Drive__c`, `GovWin_IQ_link__c`, `Opportunity_Assessment__c`

**Variable reliability (populated on mature opps, sparse on newer/smaller ones):**
- `Current_Status__c`, `Incumbent__c`, `Competitors__c`, `Description`
- `SME_Needs__c`, `KP_Needs__c`, `Proposal_Writer__c`
- `Has_Tech_Challenge__c`, `Has_Orals__c`, `Level_of_effort__c`

**Low reliability / under review:**
- `Type` on Opportunity (many nulls in historical data)
- `TCV_Total_Contract_Value_Overall__c` (usually null)
- Most Account fields beyond Name and Type

---

## Data Quality Traps

Known issues that will bite you if you're not careful:

1. **Client_Executive__c stores User IDs** — some records have an 18-character User ID starting `005` instead
   of a name. Queries by person name on this field may return incomplete results.

2. **Incumbent__c is messy** — free text containing URLs, contract numbers, speculation
   markers ("?", "Looks like"), and multi-value entries. Parse carefully: split on commas
   and semicolons, filter out URLs and contract number patterns.

3. **Competitors__c vs. junction objects** — `Competitors__c` is legacy free text (~11%
   populated). Structured competitor data is in `Company_Vehicle_Junction__c`. Check both.

4. **Duplicate loss reason fields** — `Loss_Reason__c` and `Closed_Lost_Reason__c` appear
   to serve the same purpose. Check both when analyzing losses.

5. **Program__c is multi-select** — must use `INCLUDES()`, not `=`. Using `=` will return
   no results for records with multiple programs.

6. **Amount ≠ Total Contract Value** — `Amount` is Nava's share after workshare splits.
   `TCV_Total_Contract_Value_Overall__c` is the full value but is rarely populated.

7. **CloseDate is repurposed** — labeled "Contract Reward Date" in the UI. It's the expected
   award date, not the date the opportunity was closed in Salesforce.

8. **Contact records are thinly connected** — `OpportunityContactRole` exists but is sparse and often
   untyped. Most client POCs are free text in `Customer_POCs__c` and `Current_Status__c`. Check the roles,
   then scan the Account's opportunities for the name. Use SOSL for person lookups.

9. **Rich text in Gate 2 fields** — `Is_it_Real__c`, `Can_We_Win__c`, `Do_We_Want_to_Win__c`
   are Rich Text (32KB). SOQL queries on these fields may include HTML tags in results.

10. **Companies_C__c pricing is hourly** — `High_price_average__c` and `Low_price_average__c`
    are hourly rates, not annual or total values.
