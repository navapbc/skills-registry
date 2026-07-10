import { describe, it, expect } from 'vitest';
import { renderAnalyticsPanels } from '../../src/scripts/admin/dashboard.mjs';

describe('renderAnalyticsPanels', () => {
  it('renders rows with counts for each panel', () => {
    const html = renderAnalyticsPanels({
      topSkills: [{ skill_slug: 'my-skill', count: 4 }],
      topSearches: [{ query: 'rails', count: 2, result_count: 3 }],
      filterUsage: [{ filter_value: 'org-wide', count: 5 }],
      window_days: 28,
    });
    expect(html).toContain('my-skill');
    expect(html).toContain('rails');
    expect(html).toContain('org-wide');
    expect(html).toContain('Top Skills (28d)');
    expect(html).toContain('Top Searches (28d)');
    expect(html).toContain('Filter Usage (28d)');
  });

  it('shows empty-state text when arrays are empty', () => {
    const html = renderAnalyticsPanels({});
    expect(html).toContain('No skill views yet.');
    expect(html).toContain('No searches yet.');
    expect(html).toContain('No filters used yet.');
  });

  it('HTML-escapes user-derived strings (no stored XSS via search query)', () => {
    const html = renderAnalyticsPanels({
      topSearches: [{ query: '<img src=x onerror=alert(1)>', count: 1 }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
