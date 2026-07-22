import { fetchApi } from '../../lib/api.mjs';
import { createTabController } from './controller.mjs';
import { load as loadDashboard } from './dashboard.mjs';
import { load as loadQueue } from './queue.mjs';
import { load as loadOrgWide } from './org-wide.mjs';
import { load as loadPlugins } from './plugins.mjs';
import { load as loadEnterprise } from './enterprise.mjs';
import { load as loadValidate } from './validate.mjs';
import { load as loadUsers } from './users.mjs';
import { load as loadAudit } from './audit.mjs';

export async function initAdmin() {
  // The __user cookie only has name/email/picture, not role — fetch it.
  const me = await fetchApi('/users/me').catch(() => null);
  if (!me || me.role === 'user') {
    window.location.href = '/';
    return;
  }
  const role = me.role;

  if (role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  const loaders = {
    queue: loadQueue,
    'org-wide': loadOrgWide,
    plugins: loadPlugins,
    enterprise: loadEnterprise,
    validate: loadValidate,
    users: loadUsers,
    audit: loadAudit,
  };

  const { activateTab } = createTabController({ loaders, role });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  const dashPanel = document.getElementById('admin-dashboard');
  await loadDashboard(dashPanel, { role, activateTab });

  activateTab('queue');
}
