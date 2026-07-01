---
name: project-index-search
description: >
  Search Nava's Project Index spaces to find relevant past performance, similar work, and project capabilities for proposal research. Use this skill whenever someone asks to find past Nava projects, look up similar work for an active opportunity, search for past performance examples, identify which projects match an RFP requirement, find project capabilities by agency or technology, filter by portfolio (FedCiv, FedHealth, VA, State), filter by archetype (Product Team, Data Modernization Team, Enterprise Operations Team, etc.), or asks any variant of "what has Nava done with X?" or "find me projects similar to Y." Triggers on natural language queries using RFP phrasing, federal evaluation language, agency names, technology keywords, dollar thresholds, portfolio names, or archetype labels. Also triggers when someone asks who to talk to about a specific project area.
usage_frequency: A few times per week
version: "1.0"
author: rynbennett@navapbc.com
author_name: Ryn Bennett
team: Delivery Operations
sensitive_data: false
problem: >
  Primary: Any Nava employee who wants to find out what past work Nava has done in a given area — by agency, technology, capability, or project type. Ancillary: proposal writers building past performance sections, delivery PMs scoping similar work or identifying reusable approaches, account managers prepping for client conversations, new hires orienting to the portfolio, and leadership doing capability gap analysis.
estimated_impact: Proposal writers report a 30% reduction in time spent on past performance research, based on pilot observation.
expected_audience: 16+ people
impact_type: ["Time saved per use", "Faster turnaround / cycle time", "Increased output volume or consistency"]
compatibility: [claude-chat, claude-cowork]
data_sources: Project Indexes in Confluence

---

# Project Index Search

A skill for finding relevant Nava project history to support proposal research.

## What this skill does

Given a natural language query, this skill:
1. Discovers all Project Index spaces and fetches their **overview pages** to build a portfolio/archetype index
2. Filters and ranks projects using portfolio, archetype, and keyword matching
3. Fetches detailed pages (Section 1.1, 2.1, 2.2) for matching projects
4. Cross-references Salesforce for contract metadata (value, POP, award status)
5. Surfaces Google Drive links to project folders and submitted proposal artifacts where available
6. Returns a structured result set optimized for proposal use — with go/no-go metadata first, then capability detail, then source links

## Core design principle

BD staff trust information they can trace to a source. Every result must include at least one clickable link — to a Confluence page, a Drive folder, or a Salesforce record. Results without source links should be flagged as unverified, not omitted.

---

## Step 0: Build the Project Index registry from overview pages (MANDATORY FIRST STEP)

Before running any content search, build a lightweight registry of all Project Index spaces by fetching their overview (home) pages. This is the **highest-priority data source** for filtering — it contains the canonical project name, portfolio assignment, and archetype classification.

### How overview pages work

Each Project Index space has a **home page** (the space overview, accessed via `/wiki/spaces/{SPACE_KEY}/overview`). When populated, this page contains a structured metadata table:

```
| Project Name       | [Canonical project name]           |
| Portfolio          | [FedCiv | FedHealth | VA | State]  |
| Primary Archetype  | [Archetype label]                  |
| Secondary Archetype| [Archetype label or N/A]           |
```

### Known portfolio values (as of March 2026):
- **FedCiv** — Federal civilian agencies (SEC, IRS, DOS, DOE, OPM, HOR, etc.)
- **FedHealth** — Federal health agencies (CMS projects including MPSM, Heat, OSRE, QPP, Healthcare.gov)
- **VA** — Department of Veterans Affairs (VA.gov, SPRUCE, BIO, etc.)
- **State** — State and local government (MA PFML, MD FAMLI, Vermont, MI Bridges, City of Boston, MT WIC, etc.)

### Known archetype values (as of March 2026):
- Product Team
- Data Modernization Team
- Enterprise Operations Team
- (Others may exist — treat the overview page as authoritative)

### How to build the registry

1. **Get all Project Index spaces:**
   Use `getConfluenceSpaces` with `cloudId: 7098e6a8-4012-415f-9d9e-b4b2e371b219`. Paginate if needed (limit 250 per call). Filter to spaces whose `name` starts with "Project Index:" or "DRAFT Project Index:".

2. **For each space, fetch the homepage:**
   Each space result includes a `homepageId` field. Use `getConfluencePage` with `contentFormat: "markdown"` to fetch the home page body.

   - If `homepageId` is `null`, the space has no home page — flag as "Overview page missing."
   - If the body contains default Confluence boilerplate ("Welcome to your new space!"), the overview has not been populated — flag as "Overview page not configured."
   - If the body contains the metadata table, parse the four fields.

3. **Parse the metadata table:**
   The overview body is a markdown table. Extract:
   - `Project Name` — the canonical short name (may differ from space title)
   - `Portfolio` — one of the known portfolio values
   - `Primary Archetype` — the delivery model classification
   - `Secondary Archetype` — additional classification or "N/A" / empty

4. **Store the registry in memory** for use in Steps 1–5. Each entry:
   ```
   {
     space_key: "PIDOSPAO",
     space_name: "Project Index: Department of State Passport Adjudication - OCAM",
     homepage_id: "2573238384",
     project_name: "Department of State Passport Adjudication",
     portfolio: "FedCiv",
     primary_archetype: "Data Modernization Team",
     secondary_archetype: "N/A",
     overview_populated: true
   }
   ```

### Performance note

Fetching all overview pages adds upfront latency (potentially 30–50+ page fetches). This is acceptable for two reasons:
1. Portfolio filtering is the most common BD query pattern ("show me FedCiv projects") and cannot be answered without this data.
2. The registry enables instant filtering before any CQL search, reducing wasted downstream fetches.

For queries that clearly target a single known project by name, you MAY skip the full registry build and go directly to that space. But for portfolio-level, archetype-level, or exploratory queries, the full registry is required.

### When the registry reveals the answer directly

If the user's query is purely a portfolio or archetype filter (e.g., "show me all FedCiv projects," "which projects are Data Modernization Teams?"), the registry alone may be sufficient to answer. Present the filtered list with project names, portfolios, and archetypes, then offer to fetch deeper detail (Section 1.1, 2.1, 2.2) for specific projects of interest.

---

## Step 1: Interpret the query

Before searching, translate the user's query into applicable search dimensions:

**A. Portfolio filter** — Does the query specify or imply a portfolio?
- Direct: "FedCiv projects," "state portfolio," "VA work," "FedHealth"
- Implied: "SEC" → FedCiv, "CMS" → FedHealth, "Massachusetts" → State
- If a portfolio filter applies, use the Step 0 registry to narrow the candidate set BEFORE running CQL searches.

**B. Archetype filter** — Does the query specify or imply a delivery model?
- Direct: "product teams," "data modernization," "enterprise operations"
- Implied: "staff augmentation" → Enterprise Operations Team, "forms modernization" → could be Product Team or Data Modernization Team
- If an archetype filter applies, use the Step 0 registry to narrow the candidate set.

**C. Federal/RFP phrasing** — language an evaluator or solicitation would use
- e.g., "eligibility and enrollment modernization," "Section 508 accessibility compliance," "mainframe migration," "legacy system modernization"

**D. Nava internal taxonomy** — capability tags, archetype labels, agency shorthand
- e.g., "CMS," "VA," "benefits delivery," "platform team," "data modernization"

**E. Technology keywords** — stack terms, tools, frameworks
- e.g., "React," "CI/CD," "AWS," "Ruby on Rails," "PostgreSQL"

If the user's query is ambiguous (e.g., "find me something like the Alaska project"), ask one clarifying question before searching: "Are you looking for similar scope/domain, similar tech stack, or similar agency type?"

**Filtering priority order:**
1. Portfolio filter (from registry) — narrows to a portfolio slice
2. Archetype filter (from registry) — narrows within or across portfolios
3. CQL text search — finds matches within the narrowed set
4. If no portfolio or archetype filter applies, run CQL across all Project Index spaces as before

---

## Step 2: Search Confluence Project Index spaces

Use the Atlassian MCP to search across Project Index spaces, scoped by the Step 0/Step 1 filtering.

### Primary search targets (in priority order):
1. **Space overview/home page** (project name, portfolio, archetype — from Step 0 registry)
2. **Section 1.1 — Project Scope** (contract value, POP, agency, contract number)
3. **Section 2.1 — Capabilities** (what the project delivered, in proposal-friendly language)
4. **Section 2.2 — Tech Stack** (technologies used)
5. **Section 1.4 — Client Satisfaction** (CPARS/PMR ratings if populated)

### Search execution:

**CRITICAL: Use `searchConfluenceUsingCql` (CQL search), NOT `searchAtlassian` (Rovo Search).**

Rovo Search does not support space-scoping and will return results from the entire Confluence instance — engineering wikis, HR pages, Nava Handbook, etc. CQL search supports the `space.title` filter needed to restrict results to Project Index spaces.

**If the candidate set is already filtered by portfolio/archetype from Step 0:**
Run CQL queries scoped to the specific space keys:
```
CQL: type = page AND space.key IN ("PIDOSPAO", "PISEDT", ...) AND text ~ "[search terms]"
```

**If no portfolio/archetype filter applies, run three CQL queries in parallel:**
```
CQL query A: type = page AND space.title ~ "Project Index" AND text ~ "[federal/RFP phrasing terms]"
CQL query B: type = page AND space.title ~ "Project Index" AND text ~ "[Nava taxonomy terms]"
CQL query C: type = page AND space.title ~ "Project Index" AND text ~ "[technology keywords]"
```

Use cloudId `7098e6a8-4012-415f-9d9e-b4b2e371b219` for all CQL queries.

Deduplicate results by space. A project that appears in results from multiple queries is a stronger match and should be ranked higher.

### If CPARS field is empty:
Note this explicitly in the result. Do not omit the project — CPARS absence is a content gap, not a project disqualifier. Flag it: "CPARS rating not yet recorded — contact contracts team to verify."

---

## Step 2.5: Fetch core pages for each matching project (MANDATORY)

Search excerpts are too thin for proposal use. For each unique project space identified in Step 2, you MUST fetch the following pages in full before returning results. Do not skip this step. Do not summarize from search snippets alone.

### Pages to fetch (in priority order):

**1. Section 1.1 — Project Scope (REQUIRED)**
This is where contract value, POP dates, contract vehicle, prime/sub relationships, and stakeholder details live. Without this, the result card will be missing the metadata BD staff need for go/no-go decisions.

**2. Section 2.1 — Capabilities and Competencies (REQUIRED)**
This is the capability language that maps to RFP evaluation factors. Without this, the result card will have placeholder bullets instead of proposal-ready content.

**3. Section 2.2 — Tech Stack (REQUIRED if available)**
Technologies demonstrated. Evaluators increasingly ask for this explicitly.

### How to fetch:

For each matched project space, run a single CQL query to find all three pages:

```
type = page AND space.key = "[SPACE_KEY]" AND (title ~ "Project Scope" OR title ~ "Capabilities" OR title ~ "Tech Stack" OR title ~ "1.1" OR title ~ "2.1" OR title ~ "2.2")
```

Then use `getConfluencePage` with each returned page ID and `contentFormat: "markdown"` to retrieve the full page bodies.

**Performance note:** Yes, this adds latency — potentially 3 page fetches × N projects. This is acceptable. BD staff need complete, source-verified result cards, not fast stubs. If the result set exceeds 5 projects, fetch pages for the top 5 by search-rank and note the remainder as unfetched.

### What to extract from Section 1.1:

- **Contract value** (with source: "from Confluence Section 1.1")
- **Period of performance** (start and end dates)
- **Contract vehicle** (IDIQ name, task order number, award ID if present)
- **Prime/sub relationship** (who is prime, who is sub, whether it's a JV)
- **Key stakeholders** (agency office, division, named client teams)
- **Background context** that helps frame the "why it matches" summary

### What to extract from Section 2.1:

- **Named capability areas** (e.g., "Benefits Intake Optimization," "Data Validation Engineering," "Accessibility Compliance")
- **Capability descriptions** — 1-2 sentences per capability, reworded into federal evaluation language where the source text is too informal
- **Tags/labels** if present at the bottom of the page (these use the project archetype taxonomy)

### What to extract from Section 2.2:

- **Full tech stack list** organized by layer if the page structures it that way (frontend, backend, APIs, infrastructure)
- **Integration points** (external systems the project connects to — e.g., VBMS, Lighthouse, MPI)

### If any required page is missing or empty:

Flag it explicitly in the result card. Examples:
- "Section 1.1 not populated — contract metadata unavailable."
- "Section 2.1 not populated — capability detail unavailable. Contact delivery PM."
- "Section 2.2 not found — tech stack not documented in Index."

Do NOT fabricate content. Do NOT substitute content from other sections without explicitly noting the source (e.g., "Tech stack inferred from Section 1.1 project description, not from dedicated 2.2 page").

### If Section 2.1 is thin (fewer than 3 distinct capabilities listed):

Include what's there but flag: "Capabilities section is sparse — may not reflect full project scope. Verify with delivery team."

---

## Step 3: Cross-reference Salesforce

For each candidate project surfaced in Step 2, attempt to match to a Salesforce opportunity record to retrieve:
- **Contract value** (critical for $5M+ past performance thresholds)
- **Period of performance** (start/end dates)
- **Award status** (won/lost/active)
- **Contracting vehicle** (IDIQ, BPA, direct, etc.)

If Salesforce authentication is unavailable or the record cannot be found, note the gap and return what Confluence has. Do not block the result — surface it with a flag: "Contract value unverified — confirm in Salesforce."

---

## Step 4: Surface Google Drive links

For each result, look for:
1. A Drive folder link on the Confluence Project Index home page
2. A submitted proposal folder (past performance sections are highest value)
3. Any case study or award notice linked from the Confluence page

If a Drive link exists but leads to a personal drive or an individual's folder (not a shared BD or delivery folder), flag it: "Source document is in a personal Drive folder — may not be accessible or current."

If no Drive link exists, note the absence. Do not fabricate a path.

---

## Step 5: Format and return results

### Result card format (one per matching project):

```
PROJECT: [Project name (from overview page canonical name)]
PORTFOLIO: [FedCiv | FedHealth | VA | State | Not configured]
ARCHETYPE: [Primary Archetype] / [Secondary Archetype if not N/A]
AGENCY: [Client agency]
CONTRACT VALUE: [Dollar amount] | SOURCE: [Salesforce / Confluence / unverified]
PERIOD OF PERFORMANCE: [Start – End]
CPARS RATING: [Rating] | [Not yet recorded — contact contracts team]

WHY IT MATCHES: [1–2 sentences in RFP/evaluation language explaining relevance to the query]

CAPABILITIES DEMONSTRATED (from Section 2.1):
- [Named capability]: [1–2 sentence description in federal evaluation language]
- [Named capability]: [1–2 sentence description]
- [Named capability]: [1–2 sentence description]
[If Section 2.1 is empty or missing, state: "Section 2.1 not populated — contact delivery PM"]
[If Section 2.1 is thin, state: "Capabilities section sparse — verify with delivery team"]

TECH STACK: [Relevant technologies]

SOURCES:
→ Confluence Overview: [Space overview link]
→ Confluence 1.1: [Page link]
→ Drive: [Folder link, or "Not linked — check with [delivery PM name if known]"]
→ Salesforce: [Record link, or "Record not found"]

WHO TO ASK: [If a project lead, PM, or subject matter contact is identified in the Index, list them here with their role]
FOLLOW-UP QUESTION TO ASK THEM: [One sentence framing what the system can't tell them — e.g., "Ask about CPARS complications from the transition period."]
```

### Ranking logic:
1. Projects with populated overview metadata (portfolio + archetype) AND populated Section 2.1 capabilities AND complete metadata rank first
2. Projects with populated overview + Section 2.1 but partial metadata rank second, with gaps flagged
3. Projects with complete metadata but missing/thin Section 2.1 rank third
4. Projects with unpopulated overview pages rank last regardless of other content quality — this signals incomplete onboarding

A project with strong capabilities documentation but missing contract value is more useful for proposal writing than a project with a dollar amount but no capability detail.

Return up to **5 results** unless the user asks for more. Quality over volume — a short list of well-sourced results is more useful than a long list of stubs.

### Editorial summary (REQUIRED after all result cards):

After presenting individual result cards, always include a brief "Honest Flags" section that synthesizes cross-cutting observations a proposal writer needs to know. This is not optional — it's where the skill adds value beyond what a search engine returns. Include:

- **Portfolio-level patterns**: Do these projects cluster in one domain/tech stack/agency office? If so, name the gap. ("All four projects live in the VA.gov/vets-api/React/Lighthouse ecosystem. If the opportunity requires breadth beyond OCTO Benefits Portfolio, you'll need to supplement with other project areas.")
- **Archetype distribution**: Are all results the same archetype? Flag it. ("All five results are Product Teams — if the opportunity calls for staff augmentation or enterprise operations experience, you'll need to look outside this set.")
- **Prime/sub complications**: If multiple results have Nava as a sub, flag the evaluation risk. ("Three of five results have Nava as subcontractor — evaluators may discount these depending on the solicitation's past performance instructions.")
- **Strongest card recommendation**: Name the single best result and say why. ("DBC is your strongest card — highest dollar value, active SPRUCE contract, Nava has direct standing through the JV, and the most complete Index documentation.")
- **Metadata gaps that matter for this specific query**: Don't just flag gaps abstractly — explain what they mean for the proposal. ("BIO and ART both have unverified contract values. If this opportunity has a $5M+ past performance threshold, those need Salesforce confirmation before you cite them.")
- **Overview page gaps**: If any returned projects have unpopulated overview pages, flag this as an Index quality issue. ("3 of 5 projects have unconfigured overview pages — portfolio and archetype data are missing. Flag in #knowledge-graph.")

---

## Step 6: Offer next actions

After returning results, always offer:

1. **Refine the search** — "Want me to narrow by dollar threshold, agency type, archetype, or tech stack?"
2. **Export to proposal format** — "I can format the strongest match as a past performance narrative starter."
3. **Flag a gap** — "If none of these are a strong fit, I can note what's missing and suggest who to ask."
4. **Report a content problem** — "If a result has bad data or a missing overview page, let me know and I'll flag it for #knowledge-graph."
5. **Portfolio summary** — "Want a full list of all [portfolio] projects with their archetypes?"

---

## Known gaps and honest limitations

The Project Index is approximately 75% reliable at the time this skill was written (March 2026). Be transparent about this:

- **Overview pages** are not universally populated. Some spaces still have default Confluence boilerplate instead of the metadata table. These cannot be filtered by portfolio or archetype until configured.
- **CPARS ratings** are frequently absent. The contracts team is the authoritative source.
- **Final submitted proposal artifacts** are often missing from Drive folders. If a user needs a submitted past performance write-up, they may need to ask the original proposal manager.
- **Capability matching** is imprecise without tags aligned to federal evaluation factor language. If Section 2.1 is thin, tell the user.
- **Pricing data** is intentionally absent from the Project Index. If someone asks about rates or cost structures, redirect them to the pricing team — this is not a gap, it is a governance decision.
- **Portfolio/archetype taxonomy** may evolve. The overview page is authoritative — do not hardcode assumptions about which agencies belong to which portfolio. Always check the overview page data.

---

## Edge cases

**Query: "Show me all FedCiv projects" or "What's in the [portfolio] portfolio?"**
→ This is a Step 0 registry query. Build the full registry, filter by portfolio, return the filtered list with project names, archetypes, and overview links. Offer to fetch deeper detail for any specific project.

**Query: "Which projects are Data Modernization Teams?"**
→ Step 0 registry query filtered by archetype. Same approach.

**Query: "Who worked on [project]?"**
→ Check Section 3.x (Team / Workstreams) in the Project Index. If populated, return names and roles. If not, return the space and suggest checking with the delivery PM.

**Query: "Find me projects over $5M"**
→ Use Salesforce as primary source for dollar filtering. Confluence metadata may not be current. Return results with value sourced and flagged.

**Query: "What's our CPARS on [project]?"**
→ Check Section 1.4 first. If empty, tell the user explicitly: "CPARS not recorded in the Project Index — the contracts team maintains the authoritative record."

**Query: "Find projects similar to [active opportunity]"**
→ Ask for the key evaluation factors or PWS keywords from the active opportunity before searching. This is capability matching — it works best with RFP language, not project names.

**Query about pricing, rates, or competitive positioning**
→ Redirect immediately. "Pricing data isn't stored in the Project Index — that's intentional. Talk to [pricing lead / Courtney's successor] for competitive rate analysis."

**Query: "Which overview pages are missing or unconfigured?"**
→ Build the full Step 0 registry and return the list of spaces where `overview_populated: false`. This is an Index health check, not a search — useful for #knowledge-graph maintenance.
