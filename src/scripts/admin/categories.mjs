import { fetchApi } from '../../lib/api.mjs';
import { escapeHtml } from '../../lib/render.mjs';
import { apiPut } from './api.mjs';

export async function load(panel) {
  const { categories } = await fetchApi('/admin/categories');

  panel.innerHTML = `
    <p class="text-xs text-gray-500 mb-4">Featured skills appear at the top of each category card on the homepage. Enter slugs of enterprise or curated skills to feature them.</p>
    <div class="space-y-4">
      ${categories.map(cat => `
        <div class="p-4 bg-white border border-gray-200 rounded-lg" data-cat-id="${escapeHtml(cat.id)}">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700 m-0">${escapeHtml(cat.label)}</h3>
            <button class="save-featured-btn text-xs px-2 py-1 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Save</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 flex-shrink-0">Featured slugs:</span>
            <input
              class="featured-slugs-input flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-plum-300"
              value="${escapeHtml((cat.featuredSlugs ?? []).join(', '))}"
              placeholder="slug-one, slug-two"
            />
          </div>
          <p class="save-status text-xs mt-1 hidden"></p>
        </div>
      `).join('')}
    </div>
  `;

  panel.querySelectorAll('.save-featured-btn').forEach(btn => {
    const card = btn.closest('[data-cat-id]');
    const catId = card.dataset.catId;
    const input = card.querySelector('.featured-slugs-input');
    const status = card.querySelector('.save-status');
    btn.addEventListener('click', async () => {
      const featuredSlugs = input.value.split(',').map(s => s.trim()).filter(Boolean);
      try {
        await apiPut(`/admin/categories/${catId}/featured`, { featuredSlugs });
        status.textContent = 'Saved ✓';
        status.className = 'save-status text-xs mt-1 text-green-600';
        setTimeout(() => status.classList.add('hidden'), 2000);
      } catch (e) {
        status.textContent = `Error: ${e.message}`;
        status.className = 'save-status text-xs mt-1 text-red-500';
      }
    });
  });
}
