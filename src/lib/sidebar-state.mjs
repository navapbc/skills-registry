// Single source of truth for the collapsible-sidebar preference.
// The pre-paint inline script in Base.astro duplicates the "=== '1'" check
// inline because it must run before the bundle loads.
export const STORAGE_KEY = 'sidebar-collapsed';

/** Returns true when the stored raw value means the sidebar is collapsed. */
export function isCollapsed(raw) {
  return raw === '1';
}

/** Serializes a collapsed boolean to the string persisted in localStorage. */
export function serialize(collapsed) {
  return collapsed ? '1' : '0';
}
