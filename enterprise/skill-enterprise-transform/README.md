# Enterprise Skill Transform

**Version:** 2.0

Takes a skill built for one person and makes it work for anyone. Audits for personal
references, hardcoded configs, and role-specific framing. Produces a clean enterprise
template with built-in onboarding, skill-creator handoff, reference file
cross-referencing, and sibling config detection.

---

## What's in This Package

```
skill-enterprise-transform/
├── SKILL.md    The skill
└── README.md   This file
```

---

## When to Use

- An employee built a skill for their own workflow and you want to publish it org-wide
- You're reviewing a skill to check if it's ready for enterprise distribution
- You received a skill package from a team lead and need to strip personal config
  before publishing to the skill marketplace

---

## How to Run It

> "Use the skill-enterprise-transform skill to generalize [this skill / this uploaded package]."

Upload the skill package (zip or individual files) and the skill will:

1. Inventory all files and map relationships
2. Audit for six categories of personalization issues
3. Classify what stays (org-specific) vs. what goes (person-specific)
4. Build the enterprise template with onboarding intake, skill-creator handoff,
   reference file cross-referencing, and sibling config detection
5. Verify nothing critical was dropped by comparing against the original
6. Deliver the package with a summary of all changes

---

## What It Produces

- A clean enterprise template package with SKILL.md, reference files, and README
- Reference file cross-referencing so personalized skills don't duplicate files
- Sibling config detection (for skill families with shared onboarding fields)
- A change summary documenting what was removed, kept, and revised
- Flags for any judgment calls where org-specific vs. person-specific was ambiguous

---

## Key Patterns

**Reference file cross-referencing:** Personalized skills read reference files from
the enterprise template package at a known path instead of duplicating them. Single
source of truth — update the enterprise package and every personalized skill inherits.

**Sibling config detection:** When skills share onboarding fields (e.g.,
proposal-review and change-mgmt both ask for role, approver, Jira, Slack), the
enterprise template checks for an existing personalized sibling skill and offers
to inherit its config. Users onboard once, not per-skill.

---

## Naming Convention

| Original (personal) | Enterprise template | Personalized by employee |
|----------------------|---------------------|--------------------------|
| `proposal-review-SKILL.md` | `proposal-review-template` | `proposal-review-dpo` |
