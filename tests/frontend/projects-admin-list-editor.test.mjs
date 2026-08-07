import { describe, it, expect } from 'vitest';
import {
  moveUp,
  moveDown,
  removeAt,
  append,
  compact,
  renderListEditor,
} from '../../src/scripts/projects-admin/list-editor.mjs';

const ITEMS = ['first', 'second', 'third'];

describe('moveUp', () => {
  it('swaps an item with the one before it', () => {
    expect(moveUp(ITEMS, 1)).toEqual(['second', 'first', 'third']);
  });

  it('leaves the others in place', () => {
    expect(moveUp(ITEMS, 2)).toEqual(['first', 'third', 'second']);
  });

  it('is a no-op at the top rather than wrapping around', () => {
    expect(moveUp(ITEMS, 0)).toEqual(ITEMS);
  });

  it('does not mutate the input', () => {
    const original = [...ITEMS];
    moveUp(ITEMS, 1);
    expect(ITEMS).toEqual(original);
  });
});

describe('moveDown', () => {
  it('swaps an item with the one after it', () => {
    expect(moveDown(ITEMS, 0)).toEqual(['second', 'first', 'third']);
  });

  it('is a no-op at the bottom rather than wrapping around', () => {
    expect(moveDown(ITEMS, 2)).toEqual(ITEMS);
  });

  it('round-trips with moveUp', () => {
    expect(moveUp(moveDown(ITEMS, 0), 1)).toEqual(ITEMS);
  });
});

describe('removeAt', () => {
  it('removes the item and closes the gap', () => {
    expect(removeAt(ITEMS, 1)).toEqual(['first', 'third']);
  });

  it('ignores an out-of-range index', () => {
    expect(removeAt(ITEMS, 9)).toEqual(ITEMS);
  });

  it('can empty the list', () => {
    expect(removeAt(['only'], 0)).toEqual([]);
  });
});

describe('append', () => {
  it('adds a blank entry at the end', () => {
    expect(append(ITEMS)).toEqual([...ITEMS, '']);
  });
});

describe('compact', () => {
  // The API rejects an empty entry outright, so an untouched "add" row must not
  // be submitted as one.
  it('drops blank and whitespace-only entries', () => {
    expect(compact(['a', '', '   ', 'b'])).toEqual(['a', 'b']);
  });

  it('trims the entries it keeps', () => {
    expect(compact(['  padded  '])).toEqual(['padded']);
  });

  it('preserves order', () => {
    expect(compact(['c', '', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty list when everything is blank', () => {
    expect(compact(['', '  '])).toEqual([]);
  });
});

describe('renderListEditor', () => {
  it('renders one row per item, numbered from one', () => {
    const html = renderListEditor('steps', ITEMS, { label: 'Steps' });
    expect(html.match(/data-le-row=/g)).toHaveLength(3);
    expect(html).toContain('>1<');
    expect(html).toContain('>3<');
  });

  it('disables move-up on the first row and move-down on the last', () => {
    const html = renderListEditor('steps', ITEMS);
    expect(html).toMatch(/data-le-up="0" disabled/);
    expect(html).toMatch(/data-le-down="2" disabled/);
    expect(html).not.toMatch(/data-le-up="1" disabled/);
  });

  it('gives every control an accessible label naming its position', () => {
    const html = renderListEditor('steps', ITEMS, { label: 'Steps' });
    expect(html).toContain('aria-label="Move Steps item 1 up"');
    expect(html).toContain('aria-label="Remove Steps item 3"');
  });

  it('escapes item text rather than rendering it as markup', () => {
    const html = renderListEditor('steps', ['<img src=x onerror=alert(1)>']);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders an add control even when the list is empty', () => {
    const html = renderListEditor('steps', []);
    expect(html).toContain('data-le-add');
    expect(html).not.toContain('data-le-row');
  });
});
