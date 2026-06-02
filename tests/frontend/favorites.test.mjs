import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Global mocks (set before any module import) ───────────────────────────────
let _store = {};
const mockLocalStorage = {
  getItem:    (k)    => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k)    => { delete _store[k]; },
  clear:      ()     => { _store = {}; },
};
vi.stubGlobal('localStorage', mockLocalStorage);
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));

// ── Per-test setup ────────────────────────────────────────────────────────────
// vi.resetModules() gives each test a fresh module instance (resets _favs / _favSet).
let getFavorites, isFavorited, toggleFavorite, removeFavorite;
let getInstalled, addInstalled, removeInstalled, clearInstalled, initFromUser;

beforeEach(async () => {
  _store = {};
  vi.mocked(global.fetch).mockClear();
  vi.resetModules();
  ({
    getFavorites, isFavorited, toggleFavorite, removeFavorite,
    getInstalled, addInstalled, removeInstalled, clearInstalled, initFromUser,
  } = await import('../../src/lib/favorites.mjs'));
});

// ── initFromUser ──────────────────────────────────────────────────────────────
describe('initFromUser', () => {
  it('returns false when user has no favorites field', () => {
    expect(initFromUser({})).toBe(false);
    expect(initFromUser({ role: 'user' })).toBe(false);
    expect(initFromUser(null)).toBe(false);
  });

  it('returns false when favorites is not an array', () => {
    expect(initFromUser({ favorites: 'not-an-array' })).toBe(false);
  });

  it('returns false when server list matches localStorage', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'a' }, { slug: 'b' }]);
    expect(initFromUser({ favorites: ['a', 'b'] })).toBe(false);
  });

  it('returns true and prunes objects removed on another device', () => {
    _store['nava_favorite_skills'] = JSON.stringify([
      { slug: 'a', name: 'A' },
      { slug: 'b', name: 'B' },
    ]);
    const changed = initFromUser({ favorites: ['a'] });
    expect(changed).toBe(true);
    expect(getFavorites()).toHaveLength(1);
    expect(getFavorites()[0].slug).toBe('a');
  });

  it('persists the reconciled list to localStorage', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'a' }, { slug: 'b' }]);
    initFromUser({ favorites: ['a'] });
    const stored = JSON.parse(_store['nava_favorite_skills']);
    expect(stored).toHaveLength(1);
    expect(stored[0].slug).toBe('a');
  });
});

// ── getFavorites ──────────────────────────────────────────────────────────────
describe('getFavorites', () => {
  it('returns empty array when nothing stored', () => {
    expect(getFavorites()).toEqual([]);
  });

  it('returns stored favorites', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'test', name: 'Test' }]);
    expect(getFavorites()).toHaveLength(1);
    expect(getFavorites()[0].slug).toBe('test');
  });

  it('returns empty array on corrupt JSON', () => {
    _store['nava_favorite_skills'] = 'not-json{{{';
    expect(getFavorites()).toEqual([]);
  });
});

// ── isFavorited ───────────────────────────────────────────────────────────────
describe('isFavorited', () => {
  it('returns false when not in favorites', () => {
    expect(isFavorited('some-skill')).toBe(false);
  });

  it('returns true when slug is in favorites', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'some-skill' }]);
    expect(isFavorited('some-skill')).toBe(true);
  });
});

// ── toggleFavorite ────────────────────────────────────────────────────────────
describe('toggleFavorite', () => {
  const skill = { slug: 'my-skill', name: 'My Skill', type: 'skill',
                  description: 'desc', plugin: 'p', compatibility: [] };

  it('adds skill and returns true when not yet favorited', () => {
    expect(toggleFavorite(skill)).toBe(true);
    expect(isFavorited('my-skill')).toBe(true);
  });

  it('removes skill and returns false when already favorited', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'my-skill' }]);
    expect(toggleFavorite(skill)).toBe(false);
    expect(isFavorited('my-skill')).toBe(false);
  });

  it('prepends new favorite to the front of the list', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'existing' }]);
    toggleFavorite(skill);
    expect(getFavorites()[0].slug).toBe('my-skill');
    expect(getFavorites()[1].slug).toBe('existing');
  });

  it('persists to localStorage', () => {
    toggleFavorite(skill);
    const stored = JSON.parse(_store['nava_favorite_skills']);
    expect(stored[0].slug).toBe('my-skill');
  });

  it('calls fetch to sync with server', () => {
    toggleFavorite(skill);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/users/me/favorites',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

// ── removeFavorite ────────────────────────────────────────────────────────────
describe('removeFavorite', () => {
  it('removes by slug and syncs to server', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'a' }, { slug: 'b' }]);
    removeFavorite('a');
    expect(isFavorited('a')).toBe(false);
    expect(isFavorited('b')).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/users/me/favorites', expect.anything());
  });

  it('is a no-op for an unknown slug', () => {
    _store['nava_favorite_skills'] = JSON.stringify([{ slug: 'a' }]);
    removeFavorite('non-existent');
    expect(getFavorites()).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── getInstalled ──────────────────────────────────────────────────────────────
describe('getInstalled', () => {
  it('returns empty array when nothing stored', () => {
    expect(getInstalled()).toEqual([]);
  });

  it('returns stored installed skills', () => {
    _store['nava_installed_skills'] = JSON.stringify([{ slug: 'fix-bug', name: 'Fix Bug' }]);
    const installed = getInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe('fix-bug');
  });
});

// ── addInstalled ──────────────────────────────────────────────────────────────
describe('addInstalled', () => {
  const skill = { slug: 'fix-bug', name: 'Fix Bug', type: 'skill',
                  description: 'desc', plugin: 'p', compatibility: [] };

  it('prepends skill to installed list', () => {
    addInstalled(skill, '/install fix-bug');
    const installed = getInstalled();
    expect(installed[0].slug).toBe('fix-bug');
    expect(installed[0].installCommand).toBe('/install fix-bug');
    expect(installed[0].installedAt).toBeGreaterThan(0);
  });

  it('does not add a duplicate slug', () => {
    _store['nava_installed_skills'] = JSON.stringify([{ slug: 'fix-bug' }]);
    addInstalled(skill, 'cmd');
    expect(getInstalled()).toHaveLength(1);
  });

  it('syncs to server sending only minimal fields (not installCommand)', () => {
    addInstalled(skill, '/install fix-bug');
    const call = vi.mocked(global.fetch).mock.calls.find(
      ([url]) => url === '/api/users/me/installed',
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body);
    expect(body.installed[0]).toHaveProperty('slug');
    expect(body.installed[0]).toHaveProperty('installedAt');
    expect(body.installed[0]).not.toHaveProperty('installCommand');
  });
});

// ── removeInstalled ───────────────────────────────────────────────────────────
describe('removeInstalled', () => {
  it('removes by slug and syncs to server', () => {
    _store['nava_installed_skills'] = JSON.stringify([{ slug: 'a' }, { slug: 'b' }]);
    removeInstalled('a');
    expect(getInstalled()).toHaveLength(1);
    expect(getInstalled()[0].slug).toBe('b');
    expect(global.fetch).toHaveBeenCalledWith('/api/users/me/installed', expect.anything());
  });
});

// ── clearInstalled ────────────────────────────────────────────────────────────
describe('clearInstalled', () => {
  it('empties the installed list and syncs to server', () => {
    _store['nava_installed_skills'] = JSON.stringify([{ slug: 'a' }, { slug: 'b' }]);
    clearInstalled();
    expect(getInstalled()).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith('/api/users/me/installed', expect.anything());
  });
});
