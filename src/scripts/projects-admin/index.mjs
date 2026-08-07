import { fetchApi } from '../../lib/api.mjs';
import { createTabController } from '../admin/controller.mjs';
import { load as loadArchetypes } from './archetypes.mjs';
import { load as loadPostures } from './postures.mjs';
import { load as loadProjects } from './projects.mjs';

// Site admins are superusers everywhere; projects-admin holders have this page
// and nothing else privileged. Any other role is refused.
//
// Allowlist, never a blocklist — the /admin page shipped with a blocklist gate
// and that is exactly how it came to admit roles it was never meant to.
const PROJECTS_ADMIN_ROLES = ['projects-admin', 'admin'];

export const canAccessProjectsAdmin = (me) => PROJECTS_ADMIN_ROLES.includes(me?.role);

export async function initProjectsAdmin() {
  // The __session cookie carries identity but not role, so ask the API.
  const me = await fetchApi('/users/me').catch(() => null);

  if (!canAccessProjectsAdmin(me)) {
    // Explicit refusal rather than a silent redirect: someone who lost the role
    // should see why, not bounce to the homepage. The page being unlinked is not
    // the boundary — the API refuses these calls regardless of what renders here.
    document.getElementById('projects-admin-denied')?.classList.remove('hidden');
    return;
  }

  document.getElementById('projects-admin-root')?.classList.remove('hidden');

  const loaders = { archetypes: loadArchetypes, postures: loadPostures, projects: loadProjects };
  const { activateTab } = createTabController({ loaders, role: me.role });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  activateTab('archetypes');
}
