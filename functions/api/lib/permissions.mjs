const ADMIN_ONLY = new Set(['approve:skill', 'reject:skill', 'read:users', 'set:role', 'manage:plugins', 'read:audit']);

export function can(user, action, resource = null) {
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;

  switch (action) {
    case 'read:skill': {
      if (!resource) return false;
      if (resource.created_by === user.user_id) return true;
      return resource.status === 'approved' &&
        (resource.visibility === 'public' || resource.visibility === 'internal');
    }
    case 'create:skill':
      return true;
    case 'update:skill':
    case 'delete:skill':
      return resource?.created_by === user.user_id;
    default:
      return false;
  }
}
