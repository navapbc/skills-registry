# Role-Based Access Control — Skills Hub

## Roles

| Role | Who | Assigned by |
|---|---|---|
| `user` | Default for all logged-in users | Automatic on first login |
| `maintain` | Ops team, trusted content curators | Admin via `/admin` → Users tab |
| `admin` | Site administrators | Admin via `/admin` → Users tab |
| `projects-admin` | Contract Explorer content owners | Admin via `/admin` → Users tab |

Roles are stored on the user record in DynamoDB (`users` table, `role` field).

---

## Two axes: the ladder and capability roles

The model has **two independent axes**, and picking the wrong one is the most common way to introduce a privilege leak.

**The ladder** — `user`, `maintain`, `admin` — is linear: **admin ⊇ maintain ⊇ user**. Each rung inherits everything below it. Use it for roles that are strictly more trusted versions of the rung beneath.

**Capability roles** sit *outside* the ladder. They grant one named capability and inherit nothing. `projects-admin` is the first of these: it grants management of Contract Explorer reference data and confers no curation, review, plugin, or user-management rights. Use this axis when a role is *different in kind* rather than *more trusted* — when there is no rung at which it would be correct. For `projects-admin` there isn't: below `maintain` and every curator would inherit it; above and its holders would inherit skill review.

**Choosing between them.** Ask whether the new role should inherit the capabilities of the role below it. Yes → add a rung. No → add a capability role.

Two consequences worth knowing before adding either:

- **Capability roles are deliberately absent from `ROLE_RANK`.** The rank lookup falls back to the lowest value for an unrecognised role, so an unranked role clears no rank gate. That absence is what makes the design fail safe — do not "fix" it by adding a rank.
- **Any new action added to a rank-gated set must be asserted denied for every capability role.** Rank-gated actions are checked before capability roles are consulted, so a new entry in the admin-only or maintain-plus sets is invisible to capability-role holders — but only as long as a test says so. `tests/api/permissions.test.mjs` enumerates every privileged action against `projects-admin` individually for exactly this reason.

**The role field holds one value.** A person cannot be both `maintain` and `projects-admin`; assigning one replaces the other, and assigning `projects-admin` to a curator silently removes their curation rights. Supporting both would require making the field an array, which has not been done.

---

## Permission Matrix

| Action | user | maintain | admin | projects-admin |
|---|---|---|---|---|
| Browse and search public skills | ✓ | ✓ | ✓ | ✓ |
| View skill / agent / plugin detail | ✓ | ✓ | ✓ | ✓ |
| Submit a skill for review | ✓ | ✓ | ✓ | ✓ |
| Edit own pending submission | ✓ | ✓ | ✓ | ✓ |
| Approve pending skill submissions | ✗ | ✓ | ✓ | ✗ |
| Reject pending skill submissions | ✗ | ✓ | ✓ | ✗ |
| Edit any skill (content, tags) | ✗ | ✓ | ✓ | ✗ |
| Add / edit enterprise skills | ✗ | ✓ | ✓ | ✗ |
| Manage category featured slots | ✗ | ✓ | ✓ | ✗ |
| Add / edit plugins | ✗ | ✓ | ✓ | ✗ |
| Open the `/admin` panel | ✗ | ✓ | ✓ | ✗ |
| Delete plugins | ✗ | ✗ | ✓ | ✗ |
| Delete any skill | ✗ | ✗ | ✓ | ✗ |
| Manage user roles | ✗ | ✗ | ✓ | ✗ |
| View audit log | ✗ | ✗ | ✓ | ✗ |
| Manage archetypes and policy guidance | ✗ | ✗ | ✓ | ✓ |
| Read synced project data | ✗ | ✗ | ✓ | ✓ |

The first four rows are the baseline floor every signed-in user has. `projects-admin` keeps that floor — "grants one capability and nothing else" means nothing else *privileged*.

**One capability, now spanning two tables and three tabs.** `manage:project-reference` gates the archetypes tab, the policy guidance tab, *and* reads of synced project data — the last of which lives in a separate `projects` table. The action name is therefore narrower than what it grants; it was left unrenamed because renaming a permission action is a wider change than the accuracy is worth. Two consequences worth knowing:

- Anyone who can edit archetypes can also read contract names, agencies, offices, and period-of-performance dates for every project. That was the intent — the same people own both — but it is a single grant, not two.
- Splitting those audiences later means a permission change as well as a route change, since no separate action exists to hand out.

Project data is **read-only through the API**. There is no write route, and the API Lambda's IAM grant on that table omits write actions, so a write route added later fails against infrastructure rather than succeeding quietly. The Google Sheet is the only write surface.

---

## What Each Role Can Do

### User (default)
Everyone who signs in with a navapbc.com Google account gets this role. Users can browse and search the full hub, and submit their own skills for review. Submitted skills land in a pending queue — they are not visible publicly until a Maintainer approves them.

### Maintain
The ops team and trusted contributors. Maintainers handle the day-to-day curation work:
- **Review queue**: Approve or reject pending skill submissions (with optional rejection reason)
- **Content editing**: Fix descriptions, add tags, update compatibility on any skill
- **Enterprise skills**: Add and edit skills sourced from Anthropic (both built-in tools and org-level skills)
- **Category management**: Assign skills to featured slots in the homepage category grid
- **Plugin management**: Add and edit plugin records

Maintainers cannot delete skills or plugins, and cannot manage user roles.

### Projects Admin

Content owners for the Contract Explorer's reference data. A `projects-admin` holder can add and edit delivery archetypes and AI-posture policy guidance from the unlinked `/projects-admin` page, and read the project data synced from the Nava projects sheet on that page's Projects tab. They can do nothing else privileged anywhere in the hub — they cannot open `/admin`, review submissions, or manage plugins or users, and they cannot modify project data anywhere.

The page is not linked from any navigation. That is a discoverability measure, not a boundary: the whole site is behind login at the edge, and every read and mutation on this data is authorised server-side.

### Admin
Full access. Admins can do everything a Maintainer can, plus:
- **User management**: View all users, promote or demote roles
- **Destructive actions**: Delete skills, plugins
- **Audit log**: View full history of all actions taken on the hub

---

## Category vs. Tag

These are distinct concepts and should not be conflated:

**Category** — A curated top-level navigation grouping (Writing & Comms, Research & Analysis, Planning, Dev & Code, Ops & Automation). A skill is placed in a category by a Maintainer. Categories are fixed — adding a new category requires a code change.

**Tag** — A freeform label on the skill itself (`testing`, `documentation`, `federal`, `security`). Many tags per skill. Added by the author at submission time or by a Maintainer during curation. Tags are for search filtering and discovery, not navigation. The browsing-by-tag UI is not yet built.

---

## Skill Sources

| `source` | Meaning | Who manages |
|---|---|---|
| `github` | Synced from GitHub repos (SKILL.md files) | Automated sync script |
| `user-submitted` | Submitted via the hub `/submit` form | Reviewed by Maintainers |
| `anthropic-builtin` | Synced from Anthropic `/v1/skills` API | Weekly cron (automated) |
| `anthropic-enterprise` | Manually curated org-level skills | Maintainers via admin panel |
