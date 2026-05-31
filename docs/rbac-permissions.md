# Role-Based Access Control — Skills Hub

## Roles

| Role | Who | Assigned by |
|---|---|---|
| `user` | Default for all logged-in users | Automatic on first login |
| `maintain` | Ops team, trusted content curators | Admin via `/admin` → Users tab |
| `admin` | Site administrators | Admin via `/admin` → Users tab |

Roles are stored on the user record in DynamoDB (`users` table, `role` field). The role hierarchy is linear: **admin ⊇ maintain ⊇ user**.

---

## Permission Matrix

| Action | user | maintain | admin |
|---|---|---|---|
| Browse and search public skills | ✓ | ✓ | ✓ |
| View skill / agent / plugin detail | ✓ | ✓ | ✓ |
| Submit a skill for review | ✓ | ✓ | ✓ |
| Edit own pending submission | ✓ | ✓ | ✓ |
| Approve pending skill submissions | ✗ | ✓ | ✓ |
| Reject pending skill submissions | ✗ | ✓ | ✓ |
| Edit any skill (content, tags) | ✗ | ✓ | ✓ |
| Add / edit enterprise skills | ✗ | ✓ | ✓ |
| Manage category featured slots | ✗ | ✓ | ✓ |
| Add / edit plugins | ✗ | ✓ | ✓ |
| Delete plugins | ✗ | ✗ | ✓ |
| Delete any skill | ✗ | ✗ | ✓ |
| Manage user roles | ✗ | ✗ | ✓ |
| View audit log | ✗ | ✗ | ✓ |

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

### Admin
Full access. Admins can do everything a Maintainer can, plus:
- **User management**: View all users, promote or demote roles
- **Destructive actions**: Delete skills, plugins
- **Audit log**: View full history of all actions taken on the hub

---

## Category vs. Tag

These are distinct concepts and should not be conflated:

**Category** — A curated top-level navigation grouping (Writing & Comms, Research & Analysis, Planning, Dev & Code, Ops & Automation). A skill is placed in a category by a Maintainer. Categories are fixed — adding a new category requires a code change. Each category has a `featuredSlugs` list for highlighting enterprise or curated skills at the top of the category card.

**Tag** — A freeform label on the skill itself (`testing`, `documentation`, `federal`, `security`). Many tags per skill. Added by the author at submission time or by a Maintainer during curation. Tags are for search filtering and discovery, not navigation. The browsing-by-tag UI is not yet built.

---

## Skill Sources

| `source` | Meaning | Who manages |
|---|---|---|
| `github` | Synced from GitHub repos (SKILL.md files) | Automated sync script |
| `user-submitted` | Submitted via the hub `/submit` form | Reviewed by Maintainers |
| `anthropic-builtin` | Synced from Anthropic `/v1/skills` API | Weekly cron (automated) |
| `anthropic-enterprise` | Manually curated org-level skills | Maintainers via admin panel |
