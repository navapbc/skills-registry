import { describe, it, expect } from 'vitest';
import {
  renderUsageCell,
  renderOrphanNotice,
  renderUsageUnavailableNotice,
} from '../../src/scripts/projects-admin/usage.mjs';
import { renderArchetypeTable } from '../../src/scripts/projects-admin/archetypes.mjs';
import { renderPostureList } from '../../src/scripts/projects-admin/postures.mjs';

const UNAVAILABLE = { available: false, reason: 'Program data is not yet loaded into the hub.' };
const AVAILABLE = {
  available: true,
  counts: { 'product-team': 12, 'platform-team': 0 },
  orphans: [{ value: 'research-team', count: 3 }],
};

const ARCHETYPE = (id) => ({
  id, label: id, color: '#651A94', icon: 'users', status: 'active',
  characteristics: [], ai_opportunities: [],
});
const POSTURE = (id, position) => ({ id, label: id, color: '#fff8e1', position, steps: ['a'], status: 'active' });

// The distinction this whole unit exists for: "no programs reference this" and
// "we don't know yet" must not look the same. A zero reads as safe to remove.
describe('renderUsageCell', () => {
  it('renders a real count when the data is available', () => {
    expect(renderUsageCell(AVAILABLE, 'product-team')).toContain('>12<');
  });

  it('renders a genuine zero as zero', () => {
    expect(renderUsageCell(AVAILABLE, 'platform-team')).toContain('>0<');
  });

  it('renders an em-dash, never a zero, when the data is unavailable', () => {
    const html = renderUsageCell(UNAVAILABLE, 'product-team');
    expect(html).toContain('—');
    expect(html).not.toContain('>0<');
  });

  it('explains why in a tooltip rather than leaving a bare dash', () => {
    expect(renderUsageCell(UNAVAILABLE, 'product-team')).toContain('not yet loaded');
  });

  it('treats a missing usage object as unavailable, not as zero', () => {
    expect(renderUsageCell(undefined, 'anything')).toContain('—');
    expect(renderUsageCell(null, 'anything')).not.toContain('>0<');
  });

  it('shows zero for a record absent from an available count set', () => {
    expect(renderUsageCell(AVAILABLE, 'never-referenced')).toContain('>0<');
  });
});

// The inverse direction — values the upstream sheet emits that match no record.
describe('renderOrphanNotice', () => {
  it('lists unmatched values with their program counts', () => {
    const html = renderOrphanNotice(AVAILABLE, 'archetype');
    expect(html).toContain('research-team');
    expect(html).toContain('3 programs');
  });

  it('renders nothing when there are no orphans', () => {
    expect(renderOrphanNotice({ available: true, counts: {}, orphans: [] }, 'archetype')).toBe('');
  });

  it('renders nothing when the data is unavailable', () => {
    expect(renderOrphanNotice(UNAVAILABLE, 'archetype')).toBe('');
  });

  it('escapes an unmatched value rather than rendering it as markup', () => {
    const usage = { available: true, counts: {}, orphans: [{ value: '<b>x</b>', count: 1 }] };
    expect(renderOrphanNotice(usage, 'posture')).not.toContain('<b>x</b>');
  });

  it('uses the singular for a single program', () => {
    const usage = { available: true, counts: {}, orphans: [{ value: 'solo', count: 1 }] };
    expect(renderOrphanNotice(usage, 'archetype')).toContain('1 program<');
  });
});

describe('renderUsageUnavailableNotice', () => {
  it('explains the blank column once per tab', () => {
    expect(renderUsageUnavailableNotice(UNAVAILABLE)).toContain('not yet loaded');
  });

  it('says nothing when counts are available', () => {
    expect(renderUsageUnavailableNotice(AVAILABLE)).toBe('');
  });
});

describe('both tabs surface usage in both directions', () => {
  it('the archetypes table shows counts and orphans when available', () => {
    const html = renderArchetypeTable([ARCHETYPE('product-team')], AVAILABLE);
    expect(html).toContain('>12<');
    expect(html).toContain('research-team');
  });

  it('the archetypes table shows dashes, not zeroes, when unavailable', () => {
    const html = renderArchetypeTable([ARCHETYPE('product-team')], UNAVAILABLE);
    expect(html).toContain('—');
    expect(html).toContain('not yet loaded');
  });

  it('the posture list shows counts when available', () => {
    const usage = { available: true, counts: { allowed: 7 }, orphans: [] };
    expect(renderPostureList([POSTURE('allowed', 1)], usage)).toContain('>7<');
  });

  it('the posture list shows a dash when unavailable', () => {
    expect(renderPostureList([POSTURE('allowed', 1)], UNAVAILABLE)).toContain('—');
  });

  // Deactivation stays reachable regardless — the count informs the decision, it
  // does not gate it, and deletion is never offered either way.
  it('a referenced record still offers Edit and never Delete', () => {
    const html = renderArchetypeTable([ARCHETYPE('product-team')], AVAILABLE);
    expect(html).toContain('edit-archetype-btn');
    expect(html.toLowerCase()).not.toContain('delete');
  });
});
