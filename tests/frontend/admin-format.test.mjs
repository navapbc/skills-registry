import { describe, it, expect } from 'vitest';
import {
  SKILL_CATEGORIES, COMPAT_OPTIONS,
  catLabel, catSelectOptions, tagChips, compatChips, relTime, actorName,
  userSegments, ACTIVE_WINDOW_MS, weeklyCumulative, sparkline,
} from '../../src/lib/admin/format.mjs';

describe('catLabel', () => {
  it('maps a known id to its label', () => {
    expect(catLabel('build-and-ship')).toBe('Build & Ship');
  });
  it('accepts an array and uses the first element', () => {
    expect(catLabel(['personal-productivity'])).toBe('Personal Productivity');
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
    const html = catSelectOptions('personal-productivity');
    expect(html).toContain('<option value="personal-productivity" selected>Personal Productivity</option>');
    expect(html).toContain('<option value="build-and-ship" >Build &amp; Ship</option>');
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

describe('weeklyCumulative', () => {
  const NOW = Date.parse('2026-07-09T00:00:00.000Z');
  const iso = (daysAgo) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  it('returns one cumulative count per week, ending at the current total', () => {
    const items = [
      { created_at: iso(25) }, // >3wk ago → in every bucket
      { created_at: iso(15) }, // ~2wk ago
      { created_at: iso(8) },  // ~1wk ago
      { created_at: iso(1) },  // this week
    ];
    const series = weeklyCumulative(items, { now: NOW, weeks: 4 });
    expect(series).toEqual([1, 2, 3, 4]);
    expect(series[series.length - 1]).toBe(items.length);
  });

  it('counts items missing created_at in every bucket (assumed to predate window)', () => {
    const items = [{}, { created_at: iso(1) }];
    expect(weeklyCumulative(items, { now: NOW, weeks: 4 })).toEqual([1, 1, 1, 2]);
  });

  it('supports a custom field and week count', () => {
    const items = [{ last_seen_at: iso(10) }, { last_seen_at: iso(2) }];
    expect(weeklyCumulative(items, { now: NOW, weeks: 2, field: 'last_seen_at' })).toEqual([1, 2]);
  });

  it('handles empty or missing input', () => {
    expect(weeklyCumulative([], { now: NOW })).toEqual([0, 0, 0, 0]);
    expect(weeklyCumulative(undefined, { now: NOW })).toEqual([0, 0, 0, 0]);
  });
});

describe('sparkline', () => {
  it('renders a polyline with one point per value', () => {
    const svg = sparkline([1, 2, 3, 4]);
    expect(svg).toContain('<polyline');
    expect(svg.match(/,/g).length).toBeGreaterThanOrEqual(3); // >=4 coord pairs
    expect(svg).toContain('stroke="currentColor"');
  });

  it('returns empty string for series too short to plot', () => {
    expect(sparkline([])).toBe('');
    expect(sparkline([5])).toBe('');
    expect(sparkline(undefined)).toBe('');
  });

  it('keeps a flat series within the padded box', () => {
    const svg = sparkline([3, 3, 3, 3], { width: 60, height: 16 });
    // range collapses to 1; all y should sit at the padded baseline, not clip.
    expect(svg).toContain('<polyline');
    expect(svg).not.toContain('NaN');
  });

  it('escapes the className', () => {
    const svg = sparkline([1, 2], { className: 'text-gray-400"><script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
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
