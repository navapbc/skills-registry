import { describe, it, expect } from 'vitest';
import { renderValidationResults } from '../../src/lib/admin/validation-view.mjs';

const base = {
  fields: [
    { key: 'name', value: 'my-skill', source: 'frontmatter' },
    { key: 'slug', value: 'my-skill', source: 'pipeline' },
  ],
  ignored: [],
  validation: { valid: true, errors: [] },
  warnings: [],
  record: { name: 'my-skill' },
};

describe('renderValidationResults', () => {
  it('shows the valid banner when schema passes', () => {
    const html = renderValidationResults(base);
    expect(html).toContain('Valid skill file');
    expect(html).toContain('Copy as JSON');
  });

  it('shows errors when invalid', () => {
    const html = renderValidationResults({
      ...base,
      validation: { valid: false, errors: [{ path: 'name', message: 'Required' }] },
    });
    expect(html).toContain('Invalid');
    expect(html).toContain('1 issue(s)');
    expect(html).toContain('Required');
  });

  it('renders the warnings block when warnings exist', () => {
    const html = renderValidationResults({
      ...base,
      warnings: [{ field: 'description', message: 'too short' }],
    });
    expect(html).toContain('Form conformance');
    expect(html).toContain('too short');
  });

  it('renders the ignored-keys block when ignored keys exist', () => {
    const html = renderValidationResults({
      ...base,
      ignored: [{ key: 'foo', suggestion: 'name' }],
    });
    expect(html).toContain('Ignored / unrecognized keys');
    expect(html).toContain('did you mean');
  });

  it('splits authored vs pipeline fields into two tables', () => {
    const html = renderValidationResults(base);
    expect(html).toContain('Extracted fields');
    expect(html).toContain('Set by the pipeline');
  });
});
