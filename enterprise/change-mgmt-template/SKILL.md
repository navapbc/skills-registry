---
name: change-mgmt-template
version: "2.0"
category: planning
compatibility: [claude-chat, claude-cowork]
description: >
  Generate a Nava-format change management plan from a proposal or initiative description.
  Takes an existing proposal or initiative description and produces a complete CM plan —
  including ADKAR stakeholder analysis, risk matrix, communication plan with draft messages,
  team structure, and success criteria. Follows Nava's CM Overview and Toolkit, the Change
  Management Plan Template V2, and the Sage Handbook CM Process. Use when someone says
  "create a change management plan for X", "I need a CM plan", "help me plan the rollout
  of this change", or when a proposal is ready to move into execution.
---

# Change Management Plan — Nava-Format CM Plan Generation Skill

This skill produces a complete change management plan that follows Nava's established
framework, grounded in a specific proposal or initiative description.

---

## ONBOARDING — Scan, Confirm, Run

### Step 1: Check for Personalized Skill

Check `/mnt/skills/user/` for a personalized change-mgmt skill (any folder
matching `change-mgmt-*` that is NOT `change-mgmt-template`).

- **If found:** Use the personalized skill's config. Say:
  > "Change management loaded — using your `change-mgmt-[initials]` config
  > (driver: [role], [team] · approver: [name]). Share a proposal, upload a
  > doc, or describe what's changing and I'll generate the plan."
  Then proceed to Step 1 (Identify the Source Initiative).

- **If not found:** Continue to Step 2.

### Step 2: Scan and Run

Scan all available context — project instructions, user preferences, memory,
connected integrations (Jira, Google Drive, etc.), and any sibling
personalized skills at `/mnt/skills/user/` (e.g., `proposal-review-*`). Assemble
a config and present it — no confirmation gate, just show what you're using
and invite the user to start:

> "This skill generates a full change management plan from a proposal or
> initiative description — ADKAR stakeholder analysis, risk matrix, communication
> plan with draft messages, and success metrics, aligned to Nava's 6-step CM
> process.
>
> Planning as [role], [team]. Approver: [name or 'not set']. Integrations:
> [list or 'none detected'].
> *(Pulled from your project instructions and connected tools — say 'fix' if
> anything's off.)*
>
> Share a proposal, upload a doc, or describe what's changing and I'll generate
> the plan."

If the user shares content: proceed to Step 1 with this config.
If the user says "fix" or corrects something: absorb the correction and proceed.

For any field that couldn't be detected, note it as "not set" and use defaults
(no approver, no integrations). Do NOT block the plan to ask — run with what
you have.

### Step 3: Optional Enrichment (After First Plan)

After delivering the first CM plan — not before — offer optional personalization:

> "Want to sharpen future plans? I can save a personalized version that locks
> in your config and adds standing context. Takes 2 minutes — or skip it,
> the template works fine as-is."

If yes, ask only the fields that add value beyond what was auto-detected:

**Standing strategic context** *(optional)*
> "Any ongoing initiatives, org changes, or constraints I should factor into
> every CM plan? (e.g., 'CBA renegotiation in progress,' 'Headcount freeze')"

→ Store as: `STRATEGIC_CONTEXT`

Then generate the personalized skill:
> "Two quick things:
> - **Name:** Convention is `change-mgmt-[your initials]` (e.g. `change-mgmt-dpo`)
> - **Trigger phrase:** What should activate it? (default: 'create a change management plan')"

→ Call skill-creator in lightweight mode — generate personalized SKILL.md with
config block baked in. The personalized skill must include a Reference Files section
that points to the enterprise template package for shared reference files (see
"Reference Files" section at end of this skill). Skip evals; the template is already
tested. Save the skill, and confirm: "Here's your personalized skill. Save it and
you should see it in your skills list — no other setup needed."

→ If no: proceed. The template works without personalization.

---

## Nava's Change Management Framework

This skill implements Nava's approach to change management.

### Core Principles

- **Courageous.** Confront change head-on with a clear rationale, eyes-open tradeoffs,
  and an achievable implementation plan.
- **Calm.** For "one-way doors" (irreversible changes), move carefully and methodically.
  For "two-way doors" (reversible changes), move quickly and iterate.
- **Co-created.** Talk to those impacted to gather input before a change and co-create
  solutions. Disagree intensely during creation; once rolling out, commit.
- **Credible.** Build trust by incorporating feedback, creating realistic plans
  (including setting things down to make space), and showing your work.

### The ADKAR Model

Nava uses ADKAR to structure stakeholder readiness:

- **A**wareness — Understanding why change is needed
- **D**esire — Personal motivation to support change
- **K**nowledge — Information on how to change
- **A**bility — Skills and behaviors to implement change
- **R**einforcement — Sustaining the change over time

### When to Apply Structured CM

Apply the full process to changes that:
1. Set long-term direction and affect many people
2. Have complex horizontal interdependencies across teams
3. Are not easily reversible
4. Are risky or controversial

For easily reversible, low-risk changes, pick and choose tools as applicable —
the full process is not needed.

### Nava CM Process (6 Steps)

1. **Fill out change management plan** (this skill does this)
2. **Review with [APPROVER_NAME / CoS or designated approver]**
3. **Seek input from appropriate audiences** (exec, ORB, affected teams)
4. **Finalize and approve**
5. **Execute the plan** (following the timeline and comms plan)
6. **Report on success** (using the success criteria)

---

## Step 1: Identify the Source Initiative

The CM plan should be grounded in a specific proposal or initiative.

### 1A. Existing Proposal Document

If the user has a proposal document (Google Doc, pasted text, uploaded file), read it.
The proposal's Background, Recommendation, DACI, and Timeline sections feed directly
into the CM plan.

### 1B. No Existing Document — Ask Two Questions

If there is no proposal document, ask at most **two clarifying questions**:

1. **What is changing and who does it affect?** "What's the change, and which parts
   of the company are impacted?"
2. **Is this a one-way or two-way door?** "Is this easily reversible, or once we do
   this, it's done?"

If the user gives enough detail, skip to Step 2.

---

## Step 2: Gather Context

Pull from available sources to inform the plan.

### 2A. Google Drive — Past CM Plans and Related Docs (if available)

If Google Drive access is enabled in this session, search for related documentation:
```
fullText contains '[initiative keyword]'
fullText contains 'change management' AND fullText contains '[topic]'
```

If not available, ask: "Are there related documents, prior CM plans, or process
documentation I should know about? Paste links or key content here."

### 2B. Confluence — Policy and Process (if available)

If Confluence access is enabled, search for pages affected by this change.
Look for current policies or processes that will change, and org structure context.

### 2C. User-Provided Context

If integrations are not available, ask: "Before I build the plan, a few quick
context questions:
- Who are the main stakeholder groups affected?
- Any known resistance or concerns you're anticipating?
- Are there existing policies or processes this change will touch?"

---

## Step 3: Draft the Change Management Plan

Use `change-mgmt-plan-template.md` (included in this package) as the structural
foundation. Fill in every section.

### Section-by-Section Guidance

**What is the change?**
- Pull from the proposal's Summary/Recommendation
- 1-3 sentences, high level, no jargon

**Motivation for change**
- Pull from the proposal's Background section
- Make it compelling — if this isn't convincing, adoption risk increases
- Acknowledge the current state, name the gap, explain urgency

**Timeline and milestones**
- Pull from the proposal's Timeline section if available
- Add CM-specific milestones: stakeholder briefings, feedback windows, go-live,
  stabilization check-ins
- Default phases: Planning (2-4 weeks), Transition (1-4 weeks), Stabilization (2-4 weeks)
- Scale to the size of the change

**ADKAR stakeholder analysis**
- Identify all affected stakeholder groups
- Common Nava groups: C-team, Directors, Managers, ICs (by practice), People Ops,
  Contracts, Legal, Delivery Leads, Union (if CBA-related)
- For each group, honestly assess where they are on the ADKAR spectrum
- Be honest about where Desire or Ability gaps are likely — these are usually
  where changes stall

**Risk and mitigations**
- Include at least 3 risks
- Common Nava CM risks: timing conflicts with other initiatives, CBA implications,
  capacity constraints on affected teams, leadership alignment gaps, unclear
  ownership post-transition
- For each risk: concrete mitigation strategy, not vague platitudes

**Communication plan**
- Work outward in concentric circles: Driver → CM team → Approvers → Consulted →
  Affected staff → Broader company
- For each communication: specific date, specific audience, specific sender, specific channel
- Draft actual messages for key communications (at least 3)
- Each message must answer: what's happening, why, why now, and "what does this mean for me?"
- Use plain text for drafted messages

**Change management team**
- Pull DACI from the proposal if available
- Driver = person leading the CM process
- Include reps from each affected part of the company
- Suggest a temp Slack channel name: `#temp-[descriptive-name]`
- Suggest a meeting cadence appropriate to the timeline

**Success metrics / criteria**
- Pull from the proposal's Success Criteria if available
- Add CM-specific metrics:
  - Adoption: 90% of target staff using updated process/tools 60 days after go-live
  - Trust: 90% of affected staff agree they understand why the change was needed
- Make every metric measurable and time-bound

**Retrospective**
- Schedule 2-4 weeks after go-live
- Name the facilitator and participants

---

## Step 4: Review Checklist

Before delivering, verify against Nava's CM standards:

- [ ] Does the plan explain **why** change is necessary, not just what the change is?
- [ ] Does the communication plan work outward in **concentric circles**?
- [ ] Does the ADKAR analysis honestly identify **resistance points**?
- [ ] Are the draft messages **specific and compelling**, not generic?
- [ ] Does the risk matrix include **realistic mitigations**, not wishful thinking?
- [ ] Is the timeline **realistic** — does it account for existing workload and calendar?
- [ ] Does the team structure include reps from **each affected part** of the company?
- [ ] Are success metrics **measurable and time-bound**?
- [ ] Is this the right level of CM? (one-way door = full process; two-way door = lighter touch)
- [ ] Would the **Policy Review Board** need to review this? (new/modified policies: yes)

If any check fails, revise before delivering.

---

## Step 5: Deliver the Plan

### Deliver in conversation
Output the completed CM plan as a markdown document. Suggest the user paste it into
Google Docs, Confluence, or their preferred storage.

### If Jira is configured (JIRA_PROJECT_KEY set)
Offer to create a tracking card in the user's Jira project. Confirm before creating.

---

## Guardrails

- **Read-only on external systems.** This skill reads Drive, Confluence, Jira, and Gmail
  but never writes to any of them.
- **Nava's framework, not generic.** The output follows Nava's specific CM approach
  (ADKAR, concentric circles, Policy Review Board, Sage Handbook process). Do not
  substitute generic CM frameworks.
- **Draft, don't finalize.** The output is a strong starting point. Flag anything
  uncertain with clear placeholders: "[FILL IN: stakeholder / date / metric]".
- **No fabrication.** Never invent stakeholder sentiment, risk assessments, or metrics.
  If you don't have data, say so and leave a placeholder.
- **Proposal-first.** The CM plan is grounded in a specific proposal or initiative
  description. If neither exists, help the user describe it first via the two
  clarifying questions in Step 1B.
- **Integrations are optional.** If Jira is not configured, deliver the
  plan in the conversation. Do not block on missing integrations.

---

## Source Documents

This skill was built from the following Nava documents:

- **Change Management Plan Template V2** — Alex Bisker (included as `change-mgmt-plan-template.md`)
- **Change Management Overview and Toolkit** — Hannah Kane
- **Communication Plan Template** — Hannah Kane
- **Change Management Process** — Confluence, Sage Handbook

### Toolkit References

| Tool | Purpose |
|------|---------|
| CM Plan Template | Default planning template (included) |
| ADKAR Stakeholder Analysis | Framework for stakeholder readiness |
| Comms Plan Template | Communication timeline and drafts |
| Pre-mortem | Anticipate failure modes |
| FAQs Template | Consistent information sharing |
| Managing Resistance | Prepare for and manage pushback |
| Training Template | Build knowledge and ability |
| Reinforcement Toolkit | Sustain the change |

---

## Reference Files (Included in This Package)

- **`change-mgmt-plan-template.md`** — Fillable CM plan template used as the
  structural foundation in Step 3.

### Cross-Reference for Personalized Skills

Personalized skills generated from this template do NOT duplicate reference files.
Instead, they read them from this enterprise template package at:

```
/mnt/skills/user/change-mgmt-template/change-mgmt-plan-template.md
```

When generating a personalized skill via skill-creator, include this section in
the personalized SKILL.md:

```
## Reference Files
Read reference files from the enterprise template package at
`/mnt/skills/user/change-mgmt-template/`:
- `change-mgmt-plan-template.md` — structural foundation for CM plan output

If reference files are not found at the expected path, note "[Reference files
unavailable — install change-mgmt-template or describe your CM plan format]"
and proceed with available context.
```
