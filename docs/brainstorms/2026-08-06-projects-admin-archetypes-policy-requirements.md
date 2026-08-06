---
date: 2026-08-06
topic: projects-admin-archetypes-policy
---

# Projects Admin — Archetypes and Policy Guidance

## Summary

A new unlinked `/projects-admin` page with two tabs — archetypes and policy guidance — backed by two new DynamoDB tables, seeded once from the Contract Explorer prototype's JSON files and authoritative thereafter. A new `projects-admin` role gates it. Archetypes are record CRUD; postures are user-extensible, so a maintainer can add a posture with its guidance steps and have it appear in the Contract Explorer with no deploy.

---

## Problem Frame

The Contract Explorer prototype carries two hand-maintained reference datasets: five delivery archetypes, and the AI-use guidance shown to a team once their contract's posture is known. Both currently live as JSON files outside this repo, inlined into a single static HTML file at bundle time.

That arrangement makes every content change an engineering task. Correcting a guidance step — the operative instruction a team reads before touching an AI tool on a federal contract — means editing a JSON file, re-bundling the HTML, and redeploying. The people who own that content are not the people who can perform those steps. The four postures themselves are worse: `allowed`, `restricted`, `silent`, and `prohibited` are a closed set baked into a hardcoded array literal, four CSS class names, and a chart color map, so a fifth posture is not a content change at all.

The cost lands unevenly. Archetype descriptions drifting stale is cosmetic. Policy guidance drifting stale is not — the prototype presents it as the authoritative "how to proceed" for contracts where the wrong answer is a compliance problem.

---

## Actors

- A1. Projects admin: holds the new `projects-admin` role. Adds and edits archetypes and policy guidance. Not an engineer, and has no other administrative capability in the hub.
- A2. Site admin: grants and revokes the `projects-admin` role, and has the same access to both tabs.
- A3. Google Sheet pipeline: the existing upstream that assigns each program its posture and archetype values. It is not modified by this work, and it has no knowledge of records created here.

---

## Key Flows

- F1. Add a posture that did not previously exist
  - **Trigger:** A1 needs a posture the four seeded ones do not cover.
  - **Actors:** A1
  - **Steps:** Open the policy guidance tab. Add a posture, giving it a label, a color, a position in the posture ordering, and its guidance steps in the order a reader should follow them. Save.
  - **Outcome:** The posture exists and the Contract Explorer enumerates it in the authored position, with no deploy. It has zero programs against it until A3 begins emitting its value, and the tab shows that count as zero.
  - **Covered by:** R10, R11, R12, R13, R15

- F2. Correct a guidance step
  - **Trigger:** The governed policy changes, or A1 finds an inaccurate step.
  - **Actors:** A1
  - **Steps:** Open the posture, edit the step text, reorder steps if the sequence changed, save.
  - **Outcome:** The Contract Explorer serves the revised guidance. The change is attributable to A1 in the audit trail.
  - **Covered by:** R6, R11, R12

- F3. Retire an archetype still in use
  - **Trigger:** A1 wants to remove an archetype that program records still reference.
  - **Actors:** A1
  - **Steps:** Open the archetype. Attempt removal. The reference count is visible, and hard deletion is refused; A1 deactivates it instead.
  - **Outcome:** The archetype is no longer offered as a choice, existing program references still resolve, and no program silently loses its archetype.
  - **Covered by:** R14, R15

---

## Requirements

**Page and access control**

- R1. A page exists at `/projects-admin`, reachable by direct URL and linked from no navigation anywhere in the hub. It holds two tabs: archetypes and policy guidance.
- R2. A new `projects-admin` role exists. It is orthogonal to the existing role hierarchy rather than a rung within it: holding it grants access to these two tabs and confers no other capability anywhere in the hub, and holders of the existing content-curation role do not acquire it.
- R3. Site admins have the same access to both tabs as `projects-admin` holders. All other roles have none.
- R4. Every read and mutation on this data is authorized on the server. The page being unlinked is a discoverability measure and is not relied on as an access boundary. A signed-in user without the role receives an explicit refusal rather than an empty page.
- R5. `projects-admin` is selectable wherever site admins already assign roles, and accepted by the existing role-change API. This is the only change to the existing admin page; nothing else about it is modified.
- R6. Granting or revoking `projects-admin` remains restricted to site admins and is recorded in the existing role-change audit trail. Every add, edit, deactivation, and reordering on either tab is likewise recorded, attributed to the acting user.

**Archetype management**

- R7. The archetypes tab lists every archetype and supports adding a new one and editing an existing one.
- R8. An archetype carries a stable identifier, a label, a description, a color, an icon, an ordered list of characteristics, and an ordered list of AI opportunities. The two lists support adding, editing, reordering, and removing entries.
- R9. An archetype's icon is chosen from a closed menu drawn from the hub's existing icon set, with each option displayed as its rendered icon rather than its name alone. A value absent from that menu cannot be saved, so an archetype can never reference an icon that renders as nothing.

**Policy guidance management**

- R10. The policy guidance tab lists every posture and supports adding a new one and editing an existing one. Adding a posture requires no code change and no deploy.
- R11. A posture carries a stable identifier, a label, a color, a display position, and an ordered list of guidance steps. Steps support adding, editing, reordering, and removing, and their authored order is preserved on read.
- R12. A posture's display position determines its order wherever the Contract Explorer enumerates postures, replacing the ordering currently implicit in a hardcoded array. Position carries no meaning beyond display order — it is not a severity or escalation rank, and no behavior branches on it.
- R13. A posture's color is the only presentation attribute it carries. Rendering derives any needed treatment from that single value, so a new posture is styled correctly on creation without a stylesheet change.

**Referential integrity**

- R14. Neither an archetype nor a posture can be hard-deleted while program data references it. It can be deactivated: it stops being offered as a choice for new assignments while existing references continue to resolve.
- R15. Each tab shows, for every record, how many programs reference it. Each tab also surfaces the inverse — archetype or posture values present in program data with no matching record — so a mismatch between the Google Sheet and this data is visible rather than silent.

**Seeding and source of truth**

- R16. A one-time seed populates both tables from the prototype's `archetypes.json` and `policy.json` (currently outside this repo). From the policy file, only the guidance content is seeded; its approver, effective date, review date, source-document link, checklist, hard limits, and standard client response are not stored.
- R17. The seed creates only records that are absent and never overwrites an existing one, so re-running it cannot revert an edit made through either tab.
- R18. The seed translates each archetype's existing icon name to the equivalent in the hub's icon menu, since the prototype's names come from a different icon set.
- R19. After seeding, the tables are the sole source of truth for this data. Neither JSON file is read at runtime by anything.

---

## Acceptance Examples

- AE1. **Covers R2, R3.** Given a user holding only `projects-admin`, when they open any existing administrative surface in the hub, they are refused — the role grants the two new tabs and nothing else.
- AE2. **Covers R2.** Given a user holding the existing content-curation role and not `projects-admin`, when they open `/projects-admin`, they are refused.
- AE3. **Covers R4.** Given a signed-in user without the role who navigates directly to `/projects-admin`, when the page loads, they receive an explicit refusal, and a mutation request issued directly against the API is rejected on the server.
- AE4. **Covers R9.** Given the archetype form, when a user attempts to save an icon value that is not in the menu, the save is refused — there is no path by which a stored archetype references an unrenderable icon.
- AE5. **Covers R10, R12, R13.** Given four seeded postures, when a user adds a fifth with a display position between the second and third, the Contract Explorer lists it in that position with its authored color, and no code was changed or deployed.
- AE6. **Covers R11.** Given a posture whose steps are reordered and saved, when the guidance is read back, the steps appear in the newly authored order.
- AE7. **Covers R14.** Given an archetype that twelve programs reference, when a user attempts to delete it, deletion is refused, the count of twelve is shown, and deactivation is offered instead. After deactivation, those twelve programs still resolve their archetype.
- AE8. **Covers R15.** Given program data carrying a posture value with no matching record, when a user opens the policy guidance tab, that unmatched value is listed with its program count.
- AE9. **Covers R17.** Given a seeded table in which a user has edited an archetype's description, when the seed is run a second time, the edited description is unchanged.
- AE10. **Covers R16.** Given the prototype's policy file, when the seed completes, the four postures and their guidance steps are present and the file's approver and date fields are absent from the table.

---

## Success Criteria

- The content owner for AI-use guidance can correct a step, or introduce a posture the four seeded ones do not cover, without filing an engineering request and without waiting for a deploy.
- A site admin can grant that ability to a specific person without granting them anything else in the hub, and can see afterward who changed what.
- The JSON files can be deleted with nothing breaking.
- Running the seed twice, by accident, does not revert anyone's edits.
- A planner reading this document does not have to decide who may edit this data, whether the posture set is open, what happens to a referenced record on deletion, or which fields of the policy file are in scope.

---

## Scope Boundaries

- Any change to the existing admin page other than making the new role selectable there.
- Loading an icon font, or sourcing icons from anywhere but the hub's existing set. Expanding the icon menu remains a code change — the one field on either tab that is not self-service, accepted deliberately.
- Resource-scoped or per-record permissions. `projects-admin` is all-or-nothing across both tabs.
- The Contract Explorer page itself, its data model, and its read API. This work covers the admin surface and the storage behind it.
- Programs, initiatives, the AI survey, and regulatory data — including the Google Sheet pipeline that assigns program records their posture and archetype values.
- Per-client and per-contract policy records. The per-program Nava-policy and client-policy fields stay where they are.
- Approval workflow or version history on guidance content. The audit trail is the only record of change, and the governed policy document remains authoritative outside the hub.
- Migrating the standalone prototype HTML, or keeping it in sync with the new tables.
- Carrying forward the prototype's additional-archetype field, a label-only value nothing reads today.

---

## Key Decisions

- **A separate `/projects-admin` page rather than tabs on the existing admin page**: the two audiences are different, and the existing page is left untouched. The cost is a second tab shell, since the existing one enumerates its tabs directly.
- **`projects-admin` is orthogonal to the role ladder, not a rung in it**: the existing model ranks roles linearly, and there is no rank at which this role is correct — placing it below content curation would make curators inherit it, and above would make its holders inherit skill review. An unrecognized role already falls back to the lowest rank, so the orthogonal treatment fails safe.
- **The role is grantable from the existing admin page, as the sole exception to leaving that page alone**: a role nobody can be granted is inert, and splitting role assignment across two surfaces would give one access-control field two sources of truth.
- **Only the guidance content of the policy file is stored**: leaving the approver, dates, and source-document link out means the hub never presents itself as the governed record. The authoritative policy document stays where it is approved, and the hub carries only the operative guidance derived from it.
- **Postures carry a display position, not a severity rank**: nothing in the prototype compares postures by severity — the one existing sort is alphabetical. Naming the field severity would invite later logic to branch on a number no one maintains as severity. What is actually needed is a deterministic order to replace the hardcoded array, since a table scan guarantees none and alphabetical ordering would place `prohibited` between `allowed` and `restricted`.
- **Color is the only presentation attribute on a posture**: a color is data and renders with no deploy, which is what makes user-added postures viable. Per-posture styling beyond that would reintroduce the code change the requirement exists to remove.
- **Archetype icons come from a curated menu of the hub's existing icon set**: the alternatives were each worse. Loading the full icon font the prototype's names come from would deliver unrestricted icon choice for roughly 313 KB, doubling the hub's font payload and putting two visually inconsistent icon systems in the codebase. Subsetting that font to the current five icons costs 2.1 KB but fixes the icon list in a stylesheet, relocating the deploy requirement rather than removing it. Allowing pasted SVG is the only fully self-service option and introduces a scripting surface on content rendered to every signed-in user. The menu accepts a code change to expand, in exchange for one icon system and a validated field.
- **Deactivation rather than deletion for referenced records**: program records join to archetypes and postures by identifier, and nothing validates the join. Deleting a referenced record would silently drop programs out of filters and strip their badges with no error surfaced anywhere.

---

## Dependencies / Assumptions

- Verified: the whole site is already behind login at the edge, with only the login page and static assets public. `/projects-admin` is therefore session-gated on creation, and role enforcement is the only access work this needs.
- Verified: the new route does not collide with the existing admin route's URI rewrite, and single-level routes are handled by the existing fallback.
- Verified: the hub's icon set is a hand-maintained map of five inline SVG icons, and its lookup returns nothing for an unknown name — a silent failure, which is why R9 validates the field rather than relying on the render layer.
- Verified: none of the prototype's five archetype icon names exist in that map, and the prototype loads no icon font, so those values have never rendered anywhere. Hence the translation in R18.
- Verified: the prototype reads only an archetype's identifier, label, and color. Its description, characteristics, and AI-opportunity lists are authored but unrendered. R8 keeps them editable on the assumption that the new Contract Explorer page will surface them in a detail view; if it will not, R8 can shrink.
- Verified: the prototype's four postures are fixed in a hardcoded array with hardcoded labels, three CSS classes, and a separate chart color map — and the fourth posture has no CSS class, falling back to a default. The presentation model is inconsistent today and is regularized by R13.
- Verified: program records reference archetypes by identifier, and the existing role-change API validates against a fixed set of role names that R5 extends.
- Assumed: program posture and archetype values continue to originate from the Google Sheet. A posture created here has no programs against it until that upstream emits its value, which makes a new posture inert on arrival — accepted, since the requirement is to remove the deploy, not to populate the posture.
- Assumed: the archetype and policy content is not contract-sensitive and carries none of the client names, contract values, or period-of-performance dates that cannot land in this public repository.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R16][Technical] Do the two datasets share one table or take one each? Both are small admin-owned reference data, and the repo has precedent for both a dedicated table and synthetic rows within an existing one.
- [Affects R15][Technical] Reference counts require reading program data, which does not yet live in this repo but is expected soon (confirmed by the user), so R15 is in scope rather than deferred. Whether the count is computed live or cached, and what the tab shows before program data arrives, are planning questions.
- [Affects R9, R18][Needs research] Which icons should the curated menu contain? It needs equivalents for the five seeded archetypes plus enough headroom that the first few additions do not immediately require a code change.
- [Affects R12][Technical] The Contract Explorer's existing posture sort is alphabetical. Switching it to the authored display position is a change to that page, which is out of scope here, but the two should be reconciled when the page is built.
- [Affects R11][Technical] How guidance step order is represented so that reordering is not lossy under concurrent edits.
