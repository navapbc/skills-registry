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

// Call after any innerHTML render that includes .fav-btn elements.
export function initFavoriteButtons(root = document) {
  root.querySelectorAll('.fav-btn').forEach(btn => {
    const slug = btn.dataset.slug;
    if (!slug || btn.dataset.favInit) return;
    btn.dataset.favInit = '1'; // prevent double-binding

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
