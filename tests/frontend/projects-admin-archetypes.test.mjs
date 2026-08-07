import { describe, it, expect } from 'vitest';
import {
  renderArchetypeRow,
  renderArchetypeTable,
  renderIconPicker,
  renderArchetypeForm,
} from '../../src/scripts/projects-admin/archetypes.mjs';
import { ARCHETYPE_ICON_NAMES } from '../../src/lib/icons.mjs';

const ARCHETYPE = {
  id: 'product-team',
  label: 'Product Team',
  description: 'Cross-functional team building a digital product.',
  color: '#651A94',
  icon: 'users',
  status: 'active',
  characteristics: ['Cross-functional', 'Iterative delivery'],
  ai_opportunities: ['Rapid prototyping'],
};

describe('renderArchetypeTable', () => {
  it('renders one row per archetype with its label, id and color', () => {
    const html = renderArchetypeTable([ARCHETYPE, { ...ARCHETYPE, id: 'platform-team', label: 'Platform Team' }]);
    expect(html.match(/<tr class="border-b/g)).toHaveLength(2);
    expect(html).toContain('Product Team');
    expect(html).toContain('platform-team');
    expect(html).toContain('background:#651A94');
  });

  it('renders the icon as markup, not as its name', () => {
    const html = renderArchetypeTable([ARCHETYPE]);
    expect(html).toContain('<svg');
    expect(html).not.toContain('>users<');
  });

  it('shows an empty state rather than an empty table', () => {
    const html = renderArchetypeTable([]);
    expect(html).toContain('No archetypes yet');
    expect(html).not.toContain('<table');
  });

  // There is no delete endpoint. Mirroring the enterprise tab literally would
  // have wired a Delete button to a route that does not exist.
  it('offers Edit only — never a Delete control', () => {
    const html = renderArchetypeTable([ARCHETYPE]);
    expect(html).toContain('edit-archetype-btn');
    expect(html.toLowerCase()).not.toContain('delete');
  });

  it('marks an inactive archetype without hiding it', () => {
    const html = renderArchetypeTable([{ ...ARCHETYPE, status: 'inactive' }]);
    expect(html).toContain('inactive');
    expect(html).toContain('Product Team');
  });
});

describe('renderArchetypeRow — escaping', () => {
  it('renders a label containing markup as text', () => {
    const html = renderArchetypeRow({ ...ARCHETYPE, label: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('does not let a color value break out of the style attribute', () => {
    const html = renderArchetypeRow({ ...ARCHETYPE, color: '#000" onload="alert(1)' });
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('renders an archetype with no list fields without erroring', () => {
    const { characteristics, ai_opportunities, ...bare } = ARCHETYPE;
    const html = renderArchetypeRow(bare);
    expect(html).toContain('0 / 0');
  });
});

describe('renderIconPicker', () => {
  it('offers exactly the allowlisted icons and nothing else', () => {
    const html = renderIconPicker('users');
    for (const name of ARCHETYPE_ICON_NAMES) {
      expect(html).toContain(`value="${name}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(ARCHETYPE_ICON_NAMES.length);
  });

  it('offers no free-text input, so an off-menu value is unreachable', () => {
    const html = renderIconPicker('users');
    expect(html).not.toContain('type="text"');
  });

  it('renders each option as an icon rather than a bare name', () => {
    const html = renderIconPicker('users');
    expect(html.match(/<svg/g)).toHaveLength(ARCHETYPE_ICON_NAMES.length);
  });

  it('marks the current selection', () => {
    expect(renderIconPicker('database')).toMatch(/value="database"[^>]*checked/);
  });

  it('selects nothing when the record has no icon yet', () => {
    // Matched as an attribute, not a substring — `peer-checked:` is a class name.
    expect(renderIconPicker(undefined)).not.toMatch(/<input[^>]*\schecked/);
  });
});

describe('renderArchetypeForm', () => {
  // The negative lookahead matters: the input's class list contains
  // `disabled:bg-gray-50`, which a bare substring match would hit.
  const ID_DISABLED = /id="arch-id"[^>]*\sdisabled(?!:)/;

  it('locks the id when editing, so a record cannot be moved by rename', () => {
    expect(renderArchetypeForm(ARCHETYPE)).toMatch(ID_DISABLED);
  });

  it('leaves the id editable when adding', () => {
    expect(renderArchetypeForm()).not.toMatch(ID_DISABLED);
  });

  it('offers a deactivate control only for a record that exists', () => {
    expect(renderArchetypeForm(ARCHETYPE)).toContain('Deactivate');
    expect(renderArchetypeForm()).not.toContain('Deactivate');
  });

  it('offers reactivation for an inactive record', () => {
    expect(renderArchetypeForm({ ...ARCHETYPE, status: 'inactive' })).toContain('Reactivate');
  });

  it('renders both list editors, starting empty rather than with a blank row', () => {
    const html = renderArchetypeForm();
    expect(html).toContain('data-le-root="characteristics"');
    expect(html).toContain('data-le-root="ai_opportunities"');
    expect(html).not.toContain('data-le-row');
  });

  it('pre-fills existing list entries in order', () => {
    const html = renderArchetypeForm(ARCHETYPE);
    expect(html).toContain('value="Cross-functional"');
    expect(html).toContain('value="Iterative delivery"');
  });
});
