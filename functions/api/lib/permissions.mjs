const ROLE_RANK = { user: 0, maintain: 1, admin: 2 };
export const atLeast = (user, role) => (ROLE_RANK[user?.role] ?? 0) >= (ROLE_RANK[role] ?? 99);

const ADMIN_ONLY = new Set(['read:users', 'set:role', 'read:audit', 'delete:skill', 'delete:plugin']);
const MAINTAIN_PLUS = new Set(['approve:skill', 'reject:skill', 'edit:any-skill', 'manage:plugins', 'manage:enterprise']);

// Capability roles sit OUTSIDE the ROLE_RANK ladder, and their absence from it is
// deliberate rather than an oversight. There is no rank at which `projects-admin`
// is correct: place it below `maintain` and curators inherit it; place it above and
// its holders inherit skill review. Because ROLE_RANK's lookup falls back to 0, an
// unranked role clears no rank gate — which is what makes this fail safe.
//
// The model therefore has two axes. See docs/rbac-permissions.md for the rule on
// choosing between them, and note the standing obligation there: any new action
// added to ADMIN_ONLY or MAINTAIN_PLUS must be asserted denied for every
// capability role in tests/api/permissions.test.mjs.
const CAPABILITY_ROLES = { 'manage:project-reference': 'projects-admin' };

// Every role an admin may assign. Shared by both role-change routes so the two
// cannot drift — a role accepted by one and rejected by the other turns a valid
// selection in the admin UI into a 400. The admin users tab keeps its own copy of
// this list because the API Lambda zip is built from functions/api/ alone and the
// frontend cannot import from here.
export const ASSIGNABLE_ROLES = ['user', 'maintain', 'admin', 'projects-admin'];

export function can(user, action, resource = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;
  if (MAINTAIN_PLUS.has(action)) return atLeast(user, 'maintain');
  if (CAPABILITY_ROLES[action]) return user.role === CAPABILITY_ROLES[action];

  switch (action) {
    case 'read:skill': {
      if (!resource) return false;
      if (resource.visibility === 'hidden') return false;
      if (resource.created_by === user.user_id) return true;
      return resource.status === 'approved' &&
        (resource.visibility === 'public' || resource.visibility === 'internal');
    }
    case 'create:skill':
      return true;
    case 'update:skill':
      if (atLeast(user, 'maintain')) return true;
      return resource?.created_by === user.user_id;
    default:
      return false;
  }
}
