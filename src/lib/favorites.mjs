const FAV_KEY  = 'nava_favorite_skills';
const INST_KEY = 'nava_installed_skills';

// In-memory cache — null means not yet seeded from localStorage
let _favs = null;
let _favSet = null;

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── API sync (fire-and-forget, never throws to caller) ────────────────────────
function pushFavorites(slugs) {
  fetch('/api/users/me/favorites', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorites: slugs }),
  }).catch(() => {});
}

function pushInstalled(installed) {
  fetch('/api/users/me/installed', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installed: installed.map(({ slug, name, type, installedAt }) => ({ slug, name, type, installedAt })) }),
  }).catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────────────────

function ensureFavs() {
  if (_favs !== null) return;
  _favs = lsGet(FAV_KEY);
  _favSet = new Set(_favs.map(f => f.slug));
}

/**
 * Call once per page after GET /api/users/me resolves.
 * Reconciles the localStorage cache with the server-side slug list.
 * Returns true if the favorites list changed (caller should re-render).
 */
export function initFromUser(user) {
  const serverSlugs = user?.favorites;
  if (!Array.isArray(serverSlugs)) return false;

  const current = lsGet(FAV_KEY);
  const serverSet = new Set(serverSlugs);
  const reconciled = current.filter(obj => serverSet.has(obj.slug));
  const changed = reconciled.length !== current.length;

  _favs = reconciled;
  _favSet = new Set(reconciled.map(f => f.slug));
  if (changed) lsSet(FAV_KEY, reconciled);

  return changed;
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export function getFavorites() {
  ensureFavs();
  return _favs;
}

export function isFavorited(slug) {
  ensureFavs();
  return _favSet.has(slug);
}

export function toggleFavorite(skill) {
  ensureFavs();
  const idx = _favs.findIndex(f => f.slug === skill.slug);
  if (idx >= 0) {
    _favs.splice(idx, 1);
    _favSet.delete(skill.slug);
  } else {
    _favs.unshift({
      slug: skill.slug,
      name: skill.name,
      plugin: skill.plugin ?? '',
      type: skill.type ?? 'skill',
      description: skill.description ?? '',
      compatibility: skill.compatibility ?? [],
    });
    _favSet.add(skill.slug);
  }
  lsSet(FAV_KEY, _favs);
  pushFavorites(Array.from(_favSet));
  return idx < 0; // true = now favorited
}

export function removeFavorite(slug) {
  ensureFavs();
  const idx = _favs.findIndex(f => f.slug === slug);
  if (idx < 0) return;
  _favs.splice(idx, 1);
  _favSet.delete(slug);
  lsSet(FAV_KEY, _favs);
  pushFavorites(Array.from(_favSet));
}

// ── Installed skills ──────────────────────────────────────────────────────────

export function getInstalled() {
  return lsGet(INST_KEY);
}

export function addInstalled(skill, cmd) {
  const installed = getInstalled();
  if (installed.find(s => s.slug === skill.slug)) return;
  installed.unshift({
    slug: skill.slug,
    name: skill.name,
    plugin: skill.plugin ?? '',
    description: skill.description ?? '',
    compatibility: skill.compatibility ?? [],
    type: skill.type ?? 'skill',
    installedAt: Date.now(),
    installCommand: cmd,
  });
  lsSet(INST_KEY, installed);
  pushInstalled(installed);
}

export function removeInstalled(slug) {
  const installed = getInstalled().filter(s => s.slug !== slug);
  lsSet(INST_KEY, installed);
  pushInstalled(installed);
}

export function clearInstalled() {
  lsSet(INST_KEY, []);
  pushInstalled([]);
}

// ── DOM wiring ────────────────────────────────────────────────────────────────

export function initFavoriteButtons(root = document) {
  root.querySelectorAll('.fav-btn').forEach(btn => {
    const slug = btn.dataset.slug;
    if (!slug || btn.dataset.favInit) return;
    btn.dataset.favInit = '1';

    const star = btn.querySelector('.fav-star');
    function setFavState(fav) {
      btn.setAttribute('aria-pressed', String(fav));
      btn.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites');
      btn.setAttribute('title', fav ? 'Remove from favorites' : 'Favorite');
      btn.classList.toggle('text-amber-400', fav);
      btn.classList.toggle('text-gray-300', !fav);
      if (star) star.textContent = fav ? '★' : '☆';
    }

    setFavState(isFavorited(slug));

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      let skill;
      try { skill = JSON.parse(btn.dataset.skill || '{}'); } catch { skill = { slug }; }
      setFavState(toggleFavorite(skill));
    });
  });
}
