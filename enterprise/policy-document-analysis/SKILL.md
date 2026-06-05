---
name: policy-document-analysis
description: >
  Systematically analyze UI policy documents (federal regulations, state
  laws, administrative instructions) to extract implementable business rules,
  identify ambiguities, and map implementation requirements. Use when
  analyzing policy documents, extracting requirements, resolving policy
  ambiguities, ensuring regulatory compliance, or mapping policy to system
  components.
version: "1.0"
author: ernesttanson@navapbc.com
author_name: Ernest Tanson
team: Project Management
sensitive_data: false
problem: Save time needed to review policy documents and write requirement for implementation.
estimated_impact: Cuts business rules extraction from weeks to days.
usage_frequency: Weekly
expected_audience: 16+ people
impact_type: [Time saved per use, Reduced error rate or rework, Faster turnaround / cycle time, Increased output volume or consistency]
compatibility: [claude-chat]
tags: [policy-document-analysis, unemployment-policy, new-jersey-ui-moderinzation]
data_sources: federal, state and administrative documents
---

# Policy Document Analysis & Decomposition

## Purpose

Systematically analyze unemployment insurance policy documents to extract implementable business rules, identify ambiguities, and ensure modernized systems accurately reflect policy intent.

## Document Hierarchy

### Precedence Rules
1. Federal law supersedes state law
2. State law supersedes state regulations
3. Regulations supersede administrative instructions
4. Recent guidance supersedes older (with effective dates)
5. Specific provisions supersede general

**Federal**: FUTA (26 U.S.C. Chapter 23), Social Security Act Title III, 20 CFR Part 625-654, UIPL letters

**State**: UI law (e.g., N.J.S.A. 43:21-1), state regulations, administrative instructions, policy bulletins

## Five-Layer Decomposition Framework

### Layer 1: Structural Analysis
Understand document organization, identify relevant sections.

**Process**:
1. Document inventory (title, citation, effective date, version)
2. Section mapping (table of contents, cross-references, dependencies)
3. Relevance filtering (payment, eligibility, calculation, exceptions)

**Deliverable**: Annotated section inventory with relevance scores

### Layer 2: Linguistic Parsing
Extract normative language and conditional logic.

**Modal Verbs**:
- SHALL/MUST → mandatory requirements (system constraints)
- SHOULD → recommended practices (configurable defaults)
- MAY → optional provisions (feature flags)
- SHALL NOT/MUST NOT → prohibited actions (validation rules)

**Sentence Indexing (required before extraction):**
Before parsing conditions, index every sentence in the relevant section. This is the
foundation for source anchoring (Check S-006). Assign sequential IDs within the rule:

```
S-001: "If a claimant worked zero (0) base weeks during the base year, the claimant's
        weekly benefit rate will be based on all of the wages earned and weeks worked,
        as long as the alternate earnings criteria has been met."
        [Page 1, § Purpose para 2]

S-002: "NOTE: If the claimant has at least one (1) base week in the base year this
        calculation cannot be used."
        [Page 1, § Purpose NOTE]
```

Rules for sentence indexing:
- Copy verbatim — no paraphrasing, no ellipsis, no summarizing
- One sentence per entry even if the policy runs sentences together
- NOTE blocks, examples, and reminders are indexed separately — they often contain implicit rules
- Each rule gets its own sentence index starting at S-001

**Conditional Extraction**:
```
IF [condition]
THEN [action]
ELSE IF [alternate]
THEN [alternate action]
ELSE [default]
```

See [linguistic_parsing.md](linguistic_parsing.md) for detailed patterns.

### Layer 3: Business Rules Extraction
Transform policy language into implementable rules.

**Output Format: Markdown + YAML Dual-Format** (v2.0)

Each rule is extracted as a single `.md` file with two layers:

1. **YAML frontmatter** (between `---` delimiters) — the machine-readable system of record.
   Contains all structured fields: rule_id, conditions, inputs, outputs, edge cases,
   ambiguity flags, staff validation status. Parsed programmatically by the pipeline.
2. **Markdown body** — the human-readable analyst workspace. Contains plain language
   summaries, source policy text tables, decision logic in pseudocode, annotatable
   review tables for ambiguities and staff validation, and implementation notes.

This replaces the prior JSON-only format. The YAML frontmatter preserves identical
determinism constraints (every condition has an explicit else; no vague actions;
source anchoring to indexed sentences). The Markdown body adds the analyst-facing
context without weakening those constraints.

**If the YAML frontmatter and Markdown body ever conflict, the YAML is authoritative.**

**Core YAML frontmatter fields**:
```yaml
rule_id: "DOMAIN-###-SHORT_NAME"           # enforced pattern
status: DRAFT                               # DRAFT → IN_REVIEW → APPROVED → ACTIVE
category: CALCULATION                       # ELIGIBILITY | CALCULATION | PAYMENT | EXCEPTION | VALIDATION
modal_strength: SHALL                       # SHALL | MUST | SHOULD | MAY | SHALL_NOT
source:
  citation: "N.J.S.A. § section"           # required traceability
  sentence_index:                           # source anchoring
    - id: "S-001"
      text: "verbatim policy sentence"
      location: "Page X, § Y para Z"
inputs:
  - id: "I-001"
    name: "field_name"
    type: CURRENCY                          # DATE | CURRENCY | INTEGER | BOOLEAN | STRING
    required: true
conditions:
  - if: "field OPERATOR value"
    then: "explicit system behavior"
    else: "explicit failure path — NEVER leave blank"
outputs:
  - id: "O-001"
    name: "output_field"
    type: CURRENCY
    downstream_consumers: ["RULE-ID"]
edge_cases:
  - id: "EC-001"
    scenario: "description"
    handling: "explicit handling"
    impact: CLAIMANT                        # CLAIMANT | CALCULATION | SYSTEM
ambiguity_flags:
  - id: "AMB-001"
    issue: "description"
    resolution_status: UNRESOLVED           # RESOLVED | UNRESOLVED | IN_REVIEW
staff_validation:
  status: PENDING                           # PENDING | APPROVED | VETOED
```

**The critical determinism constraint**: Every `condition` requires an explicit `else`.
Vague values like "handle appropriately" fail validation and are blocked from the rule registry.

**After extraction, validate before proceeding**:
- Run `python validate_rule.py <rule-file.md>` — the 24-check validation pipeline
  (see [schema_validation.md](schema_validation.md) for the full check inventory)
- Validation phases: Parse (P) → Schema (S) → Determinism (D) → Registry (R) → Consistency (C)
- Rules scoring < 100% on ERROR-severity checks are blocked from the rule registry
- Unresolved `ambiguity_flags` must be escalated to the policy team before the rule is finalized
- For batch validation: `python validate_rule.py rules/` validates all rule files in a directory
- For pipeline integration: `python validate_rule.py rules/ --format json` outputs machine-readable results

See [extraction_templates_v2.md](extraction_templates_v2.md) for the full dual-format
template, worked example, Python parsing/validation code, analyst annotation workflow,
and migration guide from JSON-only format.

### Layer 4: Ambiguity Detection
Identify gaps, contradictions, unclear provisions.

**Categories**:
1. Undefined terms (e.g., "good cause")
2. Implicit assumptions (e.g., "week begins Sunday")
3. Calculation gaps (e.g., rounding not specified)
4. Contradictory provisions (two sections, different formulas)
5. Missing exception handling (e.g., divisor zero)

**Ambiguity Log**:
```markdown
## AMB-###
**Location**: [Section]
**Type**: [Category]
**Issue**: [Description]
**Impact**: System | Staff | Claimant
**Resolution Options**: [Pros/cons]
**Recommended**: [Selection + rationale]
**Validation**: [ ] Policy team [ ] Shadow mode [ ] Documented
```

See [ambiguity_resolution.md](ambiguity_resolution.md) for resolution workflows.

### Layer 5: Implementation Mapping
Connect rules to system components.

**Mapping Structure**:
```
Business Rule → System Implementation
├── Database: Which tables/fields?
├── Calculation Engine: Which module?
├── Validation: What checks?
├── Audit Trail: How prove compliance?
└── Reporting: What metrics?
```

See [implementation_mapping.md](implementation_mapping.md) for detailed examples.

## Practical Workflow

### Step 1: Document Intake (Day 1)
- Receive document (PDF/Word/scanned)
- Convert to structured format (markdown preferred)
- Create metadata record
- Identify cross-referenced documents
- Add to analysis backlog with priority

### Step 2: First Pass Read (Day 1-2)
- Read full document for context
- Highlight payment-related sections
- Note unfamiliar terms for research
- Flag obvious ambiguities
- Sketch high-level rule categories

### Step 3: Detailed Decomposition (Day 3-5)
For each relevant section:
- Apply Layer 2: Linguistic parsing
- Apply Layer 3: Extract business rules (dual-format Markdown + YAML)
- **Run `validate_rule.py`** on each extracted rule before proceeding
- Apply Layer 4: Log ambiguities (captured in both YAML `ambiguity_flags` and Markdown body)
- Apply Layer 5: Map to system
- Generate test scenarios

### Step 4: Staff Validation Gate (Week 2)
This is the human-in-the-loop gate. Rules must pass this step before registry entry.

**Pre-gate requirement**: Rule must score 100% on ERROR-severity checks in
`validate_rule.py` before scheduling a staff validation session. Run:
`python validate_rule.py <rule-file.md>` — fix any errors before presenting to staff.

**Protocol:**
1. Facilitator presents each rule using the **Markdown body** — the plain language summary,
   decision logic pseudocode, edge case narratives, and ambiguity sections. Staff never
   see raw YAML or JSON.
2. Staff review the plain language summary, conditions logic, and edge cases
3. Each participant records APPROVED or VETOED with a reason
4. A single veto blocks the rule — no majority vote overrides it
5. Vetoed rules are revised and re-presented at the next session
6. Facilitator transcribes outcomes into both the **YAML `staff_validation` block** and
   the **Markdown Staff Validation Record table** within 3 business days
7. Facilitator runs `validate_rule.py` to confirm cross-layer consistency (Phase C checks)
8. Updated rule document shared back to participants for confirmation

**What staff validate:**
- Does the plain language match how they actually process claims?
- Are the edge cases complete — what scenarios are missing?
- Are the conditions in the right sequence?
- Does anything in the rule contradict informal practice not captured in policy?

**Gate check:** Rule is only registry-eligible when `staff_validation.status == "APPROVED"`
(Check R-003 in validate_rule.py) AND all ambiguities are resolved (Check R-002)

### Step 5: Policy Team Review (Week 3)
- Submit ambiguity log for clarifications
- Request clarification on contradictions
- Confirm "may" provisions interpretation
- Document decisions in writing
- Update business rules repository

### Step 6: Technical Design (Week 4)
- Share implementation mapping with dev team
- Identify data model changes
- Design calculation modules
- Plan validation and audit
- Create shadow mode test plan

## Analysis Tools

**Text Analysis**: Regex for normative verbs, cross-reference mapping, version comparison (diff), annotation (Hypothesis)

**Visual Documentation**: Decision trees, flowcharts, data flow diagrams, matrix tables

**Collaboration**: Shared annotation, weekly reviews, ambiguity triage, living documentation

## Common Document Types

### Zero Base Weeks Instructions
**Focus**: Payment eligibility after benefit year ends, WBR recalculation, dependency continuation

**Extract**: Effective date rules, calculation sequence, exception scenarios

### Monetary Determination Guides
**Focus**: Base period definition, wage credit rules, high quarter requirements

**Extract**: Wage aggregation logic, qualifying thresholds, dependency allowances

### Partial Unemployment Instructions
**Focus**: Earnings disregards, partial benefit formulas, work search

**Extract**: Deduction calculations, rounding rules, state vs federal rules

## Quality Checklist

**Completeness**:
- [ ] All mandatory provisions (SHALL/MUST) extracted
- [ ] Optional provisions (MAY/SHOULD) flagged
- [ ] Cross-references followed
- [ ] Effective dates documented
- [ ] Superseded rules identified

**Accuracy**:
- [ ] Formulas match policy exactly
- [ ] Conditional logic preserves all branches
- [ ] Edge cases from policy included
- [ ] Staff validated interpretation
- [ ] Policy team confirmed resolutions

**Implementability**:
- [ ] All inputs have defined data sources
- [ ] Calculation steps unambiguous
- [ ] Validation rules testable
- [ ] Error handling specified
- [ ] Audit requirements clear

**Traceability**:
- [ ] Each rule cites source + section
- [ ] Policy version recorded
- [ ] Interpretation decisions documented
- [ ] Changes from prior versions noted
- [ ] Shadow test plan references rules

## Example: Zero Base Weeks Analysis

### Layer 1: Structure
Document sections: 1.0 Purpose, 2.0 Eligibility, **3.0 Benefit Rate Recalculation**, **4.0 Dependency Benefits**, 5.0 Reporting

Focus: Sections 3.0 and 4.0 (payment-related)

### Layer 2: Linguistic Parse
```
"The weekly benefit rate SHALL be recalculated using wages 
earned during the 52 weeks immediately preceding the new 
benefit year. IF the claimant has no wages during this period, 
the previous weekly benefit rate SHALL continue."

Parsed:
MANDATORY: Recalculation required
CONDITION: Wages exist in last 52 weeks
TRUE → Calculate new WBR
FALSE → Use previous WBR
```

### Layer 3: Business Rule (Dual-Format Output)
File: `rules/ZBW-001-WBR-RECALCULATION.md`

**YAML frontmatter** (machine-readable):
```yaml
---
rule_id: "ZBW-001-WBR_RECALCULATION"
status: DRAFT
category: CALCULATION
modal_strength: SHALL
source:
  citation: "Zero Base Weeks § 3.2"
  sentence_index:
    - id: "S-001"
      text: "The weekly benefit rate SHALL be recalculated..."
      location: "Page 3, § 3.2 para 1"
inputs:
  - id: "I-001"
    name: "prior_weekly_benefit_rate"
    type: CURRENCY
    required: true
conditions:
  - if: "new_base_period_wages > 0"
    then: "new_wbr = calculate_wbr(new_base_period_wages)"
    else: "new_wbr = prior_weekly_benefit_rate"
edge_cases:
  - id: "EC-001"
    scenario: "Wages not yet reported"
    handling: "Hold recalculation; flag for manual review"
    impact: CLAIMANT
ambiguity_flags:
  - id: "AMB-001"
    issue: "'Wages earned' — credited or actually earned?"
    resolution_status: UNRESOLVED
staff_validation:
  status: PENDING
---
```

**Markdown body** (analyst-readable): Plain language summary, source text table,
decision logic pseudocode, edge case narratives, annotatable review tables for
ambiguities and staff validation. See [extraction_templates_v2.md](extraction_templates_v2.md)
for the full worked example.

### Layer 4: Ambiguity
```markdown
## AMB-ZBW-001
**Issue**: "Wages earned during 52 weeks" - wages credited 
in period or actually earned?

**Impact**: Affects claimants with delayed wage reporting

**Resolution**: Shadow mode will test both interpretations, 
staff workshop to discuss current practice
```

### Layer 5: Implementation
```markdown
**Data Sources**: Previous claim (claims.prior_benefit_year), 
New wages (wage_records WHERE quarter IN last 52 weeks)

**Calculation Flow**: Identify benefit year end → Fetch wages 
→ Apply WBR rule → Compare to prior → Generate notice
```

## Best Practices

**Do**:
- Read policy in context
- Consult staff who implement daily
- Document interpretation decisions
- Version control documents and analysis
- Create plain language summaries
- Update when policy changes

**Don't**:
- Assume policy is unambiguous
- Ignore COBOL implementation
- Extract rules without understanding intent
- Skip ambiguity resolution
- Let perfect be enemy of good

## Integration with Other Skills

- **Staff Workshops** (staff-collaboration-workshop-design skill): Validate interpretations
- **Business Rules** (business-rules-extraction-cobol skill): Compare policy to COBOL
- **Validation Testing** (validation-test-case-development skill): Test policy compliance
- **Shadow Mode** (shadow-mode-testing-strategy skill): Verify policy implementation

## Additional Resources

- [Extraction Templates v2](extraction_templates_v2.md) - Dual-format (Markdown + YAML) template, worked example, Python parsing code, analyst annotation workflow, migration guide
- [Schema Validation](schema_validation.md) - 24-check validation pipeline (validate_rule.py); check inventory across Parse, Schema, Determinism, Registry, and Consistency phases
- [Linguistic Parsing Guide](linguistic_parsing.md) - Detailed modal verb analysis
- [Ambiguity Resolution](ambiguity_resolution.md) - Resolution workflows
- [Implementation Mapping](implementation_mapping.md) - System component mapping
- [Examples](examples.md) - Real policy analysis scenarios

---

**Version**: 1.5.1
**Changelog**: v1.5.1 — Added top-level `sensitive_data` governance declaration for Skills Marketplace submission.
v1.5.0 — Integrated 24-check validate_rule.py pipeline into workflow (Steps 3, 4); updated all check references to new IDs; schema_validation.md now documents full validation pipeline.
v1.4.0 — Layer 3 output format changed from JSON-only to Markdown + YAML dual-format for analyst readability; extraction_templates_v2.md replaces extraction_templates.md.
v1.3.0 — Layer 2 updated with sentence indexing step for source anchoring (Approach #5).
v1.2.0 — Step 4 formalized as staff validation gate (Check 14, Approach #3).
v1.1.0 — Layer 3 updated to require structured JSON output schema (Approach #1).
**Context**: New Jersey UI Modernization
**Organization**: Nava PBC
