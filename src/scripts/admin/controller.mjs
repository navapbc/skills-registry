import { escapeHtml } from '../../lib/render.mjs';

// Creates the tab controller. `loaders` maps tabId -> async load(panel, ctx).
// Returns { activateTab, reloadTab } for the entry script to wire up.
export function createTabController({ loaders, role }) {
  let currentTab = null;

  async function loadTab(tabId) {
    const panel = document.getElementById(`tab-${tabId}`);
    if (!panel) return;
    panel.innerHTML = '<p class="text-sm text-gray-400">Loading...</p>';
    try {
      const load = loaders[tabId];
      if (load) await load(panel, ctx);
    } catch (err) {
      panel.innerHTML = `<p class="text-sm text-red-500">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  function activateTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('border-plum-600', isActive);
      btn.classList.toggle('text-plum-700', isActive);
      btn.classList.toggle('text-gray-600', !isActive);
      btn.classList.toggle('border-transparent', !isActive);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    if (currentTab !== tabId) {
      currentTab = tabId;
      loadTab(tabId);
    }
  }

  function reloadTab(tabId) {
    currentTab = null;
    loadTab(tabId);
  }

  const ctx = { role, activateTab, reloadTab };
  return { activateTab, reloadTab };
}
