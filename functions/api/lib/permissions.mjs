const ROLE_RANK = { user: 0, maintain: 1, admin: 2 };
export const atLeast = (user, role) => (ROLE_RANK[user?.role] ?? 0) >= (ROLE_RANK[role] ?? 99);

const ADMIN_ONLY = new Set(['read:users', 'set:role', 'read:audit', 'delete:skill', 'delete:plugin']);
const MAINTAIN_PLUS = new Set(['approve:skill', 'reject:skill', 'edit:any-skill', 'manage:plugins', 'manage:enterprise', 'manage:categories']);

export function can(user, action, resource = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;
  if (MAINTAIN_PLUS.has(action)) return atLeast(user, 'maintain');

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
