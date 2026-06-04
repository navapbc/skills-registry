import { describe, it, expect } from 'vitest';
import {
  SKILL_CATEGORIES, COMPAT_OPTIONS,
  catLabel, catSelectOptions, tagChips, compatChips, relTime, actorName,
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
