import { describe, it, expect } from 'vitest';
import {
  SKILL_CATEGORIES, COMPAT_OPTIONS,
  catLabel, catSelectOptions, tagChips, compatChips, relTime, actorName,
  userSegments, ACTIVE_WINDOW_MS,
} from '../../src/lib/admin/format.mjs';

describe('catLabel', () => {
  it('maps a known id to its label', () => {
    expect(catLabel('dev-code')).toBe('Dev & Code');
  });
  it('accepts an array and uses the first element', () => {
    expect(catLabel(['planning'])).toBe('Planning');
  });
  it('falls back to the raw id when unknown', () => {
    expect(catLabel('mystery')).toBe('mystery');
  });
  it('maps empty/missing to the "— none —" entry', () => {
    expect(catLabel('')).toBe('— none —');
    expect(catLabel(null)).toBe('— none —');
  });
});

describe('catSelectOptions', () => {
  it('marks the current category selected', () => {
    const html = catSelectOptions('planning');
    expect(html).toContain('<option value="planning" selected>Planning</option>');
    expect(html).toContain('<option value="dev-code" >Dev &amp; Code</option>');
  });
  it('renders one option per category', () => {
    expect(catSelectOptions('').match(/<option/g).length).toBe(SKILL_CATEGORIES.length);
  });
});

describe('tagChips', () => {
  it('shows up to 3 chips', () => {
    const html = tagChips(['a', 'b', 'c']);
    expect(html.match(/<span/g).length).toBe(3);
    expect(html).toContain('#a');
  });
  it('adds a +N overflow indicator beyond 3', () => {
    expect(tagChips(['a', 'b', 'c', 'd', 'e'])).toContain('+2');
  });
  it('shows an italic none for empty/missing', () => {
    expect(tagChips([])).toContain('none');
    expect(tagChips(undefined)).toContain('none');
  });
});

describe('compatChips', () => {
  it('shows up to 2 chips then +N', () => {
    const html = compatChips(['claude-code', 'cursor', 'github-copilot']);
    expect(html).toContain('claude-code');
    expect(html).toContain('+1');
  });
  it('shows none for empty', () => {
    expect(compatChips([])).toContain('none');
  });
  it('exposes the canonical compat options', () => {
    expect(COMPAT_OPTIONS).toContain('claude-code');
  });
});

describe('relTime', () => {
  it('returns empty string for falsy input', () => {
    expect(relTime('')).toBe('');
    expect(relTime(null)).toBe('');
  });
  it('formats minutes, hours, and days', () => {
    const iso = (ms) => new Date(Date.now() - ms).toISOString();
    expect(relTime(iso(5 * 60000))).toBe('5m');
    expect(relTime(iso(90 * 60000))).toBe('1h');
    expect(relTime(iso(50 * 60 * 60000))).toBe('2d');
  });
});

describe('userSegments', () => {
  const NOW = Date.parse('2026-07-09T00:00:00.000Z');
  const iso = (daysAgo) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  it('classifies new, returning, and dormant users', () => {
    const users = [
      // new: first seen 5 days ago
      { user_id: 'a', created_at: iso(5), last_seen_at: iso(5) },
      // returning: created 100 days ago, active 3 days ago
      { user_id: 'b', created_at: iso(100), last_seen_at: iso(3) },
      // dormant: created 100 days ago, last seen 40 days ago
      { user_id: 'c', created_at: iso(100), last_seen_at: iso(40) },
    ];
    const seg = userSegments(users, NOW);
    expect(seg).toEqual({ total: 3, new: 1, returning: 1, dormant: 1, active: 2 });
  });

  it('treats activity exactly at the 28-day edge as active', () => {
    const users = [{ user_id: 'a', created_at: iso(100), last_seen_at: new Date(NOW - ACTIVE_WINDOW_MS).toISOString() }];
    expect(userSegments(users, NOW).active).toBe(1);
  });

  it('counts a user missing last_seen_at as dormant', () => {
    const users = [{ user_id: 'a', created_at: iso(2) }];
    expect(userSegments(users, NOW)).toMatchObject({ total: 1, dormant: 1, active: 0 });
  });

  it('active always equals new + returning', () => {
    const users = [
      { user_id: 'a', created_at: iso(1), last_seen_at: iso(1) },
      { user_id: 'b', created_at: iso(200), last_seen_at: iso(10) },
      { user_id: 'c', created_at: iso(200), last_seen_at: iso(200) },
    ];
    const seg = userSegments(users, NOW);
    expect(seg.active).toBe(seg.new + seg.returning);
  });

  it('handles empty or missing input', () => {
    expect(userSegments([], NOW)).toEqual({ total: 0, new: 0, returning: 0, dormant: 0, active: 0 });
    expect(userSegments(undefined, NOW).total).toBe(0);
  });
});

describe('actorName', () => {
  const users = [{ user_id: 'u1', name: 'Ada Lovelace' }];
  it('returns the matching user name', () => {
    expect(actorName(users, 'u1')).toBe('Ada Lovelace');
  });
  it('falls back to the local-part of an email-like id', () => {
    expect(actorName(users, 'bob@nava.com')).toBe('bob');
  });
  it('returns ? for missing id', () => {
    expect(actorName(users, undefined)).toBe('?');
  });
});
