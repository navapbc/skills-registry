const KEY = 'nava_favorite_skills';

export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function isFavorited(slug) {
  return getFavorites().some(f => f.slug === slug);
}

export function toggleFavorite(skill) {
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.slug === skill.slug);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.unshift({ slug: skill.slug, name: skill.name, plugin: skill.plugin, type: skill.type, description: skill.description, compatibility: skill.compatibility || [] });
  }
  localStorage.setItem(KEY, JSON.stringify(favs));
  return idx < 0; // true = now favorited
}
