---
name: policy-requirements-explorer
description: >
  Input policy document (links or downloads) to generate a flowchart, service
  blueprint, and plain list of all policy-based delivery requirements. Best
  used for discovery and team alignment.   Examples: - "Looking at Federal
  Regulation X, Memo Y and State Manual Z, what are the income requirements
  for AK residents to be eligible for Medicaid?" - "Based on policy in the
  VA's M21 manual, what are the documentation requirements for a veteran with
  a presumptive claim who is applying for benefits?"  Results should be
  reviewed by a human!
version: "1.0"
author: nataliewatkins@navapbc.com
author_name: Natalie Watkins
team: TS&S
sensitive_data: false
problem: "Aids with manual requirements gathering from long, dense policy documents, which takes days or weeks. This is often a first step for teams beginning work on a new product or feature. 

Also automates creation of a service blueprint, another common first step."
estimated_impact: Depending on accuracy of output and scope, turns days or weeks in under an hour of effort.
usage_frequency: A few times per month
expected_audience: 2-5 people
impact_type: [Time saved per use, Faster turnaround / cycle time, Cost avoidance (fewer tools, vendor hours, etc.), Increased output volume or consistency]
compatibility: [claude-chat, claude-cowork]
tags: [policy, visualization, service-blueprint]
data_sources: Links to online policy documents or downloaded files
---

# Policy Requirements Explorer

> **Recommended:** This skill is the *rendering* half of what works best as a two-skill pipeline.
> The *analysis* half is the **`policy-document-analysis`** skill. When it's available, invoking it
> on the scoped sources first — and saving its output to a file before writing the dataset — gives
> you anchored verbatim quotes, conditions, ambiguity flags, and a precedence hierarchy to build
> from. If it isn't available or you're working from already-decomposed rules, you can analyze the
> sources inline instead; either way, hold to the integrity rules below.

## Order of operations

Do these in order. Step 1 (intake) is a hard stop — don't proceed without both inputs.

1. **Scope & intake (REQUIRED — two inputs).** Before doing anything else, confirm you have BOTH:
   - **Requirements scope** — what subset of requirements to model.
   - **Policy documents** — either a list of links or markdown files.

   **If either is missing, STOP and ask the user for both in one message before proceeding.**
   Do not infer scope or guess at sources. A good scope prompt to give the user:

   > "Scope: model only the requirements that govern communications/notices sent to a claimant
   > (determinations, payment notices, appeal rights, requests for info, overpayment notices, etc.).
   > Skip eligibility-calculation rules except where they trigger a required communication."

   Once you have both: gather the sources (read local files; fetch public law from eCFR / Cornell LII
   / govinfo; use a rendering browser for JS-rendered portals). Record every source link for
   `meta.sources`.
2. **Analyze the sources (recommended: `policy-document-analysis`).**
   - When the `policy-document-analysis` skill is available, invoke it on the scoped sources and save
     its output to a file (e.g. `analysis.md`) alongside the dataset you will create.
   - Whether via that skill or inline, the analysis must yield: anchored verbatim quotes, conditions,
     ambiguity flags, and the precedence hierarchy. Every requirement you write should trace back to
     a rule in it.
   - Don't hand-wave the decomposition. If you analyze inline, be as rigorous as the skill would be.
3. **Map analysis → dataset.** Follow `reference/extraction-guide.md`; consult `reference/schema.md`
   for the exact JSON shape of every field. Save the dataset as `<domain>.json`.
4. **Build:** `python3 scripts/build.py <domain>.json --out <Domain>-Requirements.html`. Fix every
   ❌ error and review ⚠️ warnings (e.g. orphaned requirements).
5. **Verify:** embedded JSON parses, every requirement maps into the flow/blueprint, citations match
   the sources exactly, and the Mermaid diagram renders (open it in a browser).
6. **Deliver** the HTML. Keep the dataset JSON (and the analysis file, if you produced one) alongside
   it so the tool can be regenerated or audited later.

## What this skill produces

A single self-contained HTML file (opens in any browser, no login, no server) that turns policy
source material into a reviewable set of **system requirements**, shown three ways:

1. **Decision flowchart** — the determination as clickable yes/no gates ending in outcomes.
2. **Service blueprint** — the same sequence from the claimant's side (asked → policy triggered → outcome).
3. **All requirements** — a filterable/sortable card list.

Shared features: per-requirement cards with a tier badge (by legal authority), the controlling
citation, a collapsible **verbatim** source quote, a ⚖ controlling-authority/preemption callout, an
AI-suggested gap, an editable status, and free-text notes. Status and notes persist to
`localStorage`; there's Export/Import to JSON.

## Architecture: fixed engine + per-domain data

- `assets/template.html` — the **engine**. Generic, never edited. It reads one embedded JSON block
  and renders all three views.
- the **dataset** — one JSON object: `meta`, `tiers`, `requirements`, `flow`, `blueprint`, optional
  `outcomeKinds`. This is what you create each run.
- `scripts/build.py` — validates a dataset and splices it into the template to produce the final HTML.

Your job each run is to **produce a correct dataset from the analysis** (ideally the
`policy-document-analysis` output), then build. You do not modify the template.

## Integrity rules (non-negotiable)

- **Build from real analysis, not hunches.** The dataset must trace to a rigorous decomposition of
  the sources — ideally `policy-document-analysis` output. Don't hand-derive requirements from a
  skim.
- **Verbatim quotes only.** The `quote` field is exact source text. Paraphrase goes in `statement`.
- **Never invent or alter a citation.** If unsure, flag it in `gap` rather than guess.
- **Don't overstate sub-regulatory authority.** Manuals/guidance implement law; capture that in the
  `authority` object so the hierarchy is honest.
- **Surface ambiguity, don't paper over it.** Undefined terms, case-by-case judgment, statute/reg
  conflicts, and uncaptured text belong in `gap`.
- **Mermaid-safe flow edge labels.** Flowchart edge labels render with Mermaid's `-->|label|`
  syntax, which breaks on `(`, `)`, `[`, `]`, and `|`. **Never put those characters in a
  `flow.edges[].label`.** Put parenthetical detail in the node label or the requirement `statement`.

## Worked examples

`examples/` contains two complete datasets to read as references:

- `nj-ui-certification.json` — NJ Unemployment weekly certification; four tiers (federal regulation,
  NJ statute, NJ regulation, federal guidance); federal-over-state via "Multiple policies" callouts.
- `md-famli-amendments.json` — Maryland FAMLI amendments & corrections; two state tiers (statute →
  COMAR), an intra-sovereign hierarchy, plus a branching decision flow.

Build either with `python3 scripts/build.py examples/<file>.json --out /tmp/example.html`.
