import { describe, it, expect } from 'vitest';
import { STORAGE_KEY, isCollapsed, serialize } from '../../src/lib/sidebar-state.mjs';

describe('sidebar-state', () => {
  it('uses the documented storage key', () => {
    expect(STORAGE_KEY).toBe('sidebar-collapsed');
  });

  it('treats "1" as collapsed', () => {
    expect(isCollapsed('1')).toBe(true);
  });

  it('treats "0", null, undefined, and junk as expanded', () => {
    expect(isCollapsed('0')).toBe(false);
    expect(isCollapsed(null)).toBe(false);
    expect(isCollapsed(undefined)).toBe(false);
    expect(isCollapsed('true')).toBe(false);
  });

  it('serializes collapsed booleans to the stored string', () => {
    expect(serialize(true)).toBe('1');
    expect(serialize(false)).toBe('0');
  });
});
