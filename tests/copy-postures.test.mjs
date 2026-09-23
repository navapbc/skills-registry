import { describe, it, expect } from 'vitest';
import { CONTENT_FIELDS, planPostureCopy } from '../scripts/lib/copy-postures.mjs';

const NOW = '2026-09-23T20:00:00.000Z';

const posture = (id, over = {}) => ({
  entity_type: 'posture',
  id,
  label: `AI ${id.toUpperCase()} — how to proceed`,
  color: '#e7f1e0',
  status: 'active',
  position: 1,
  steps: ['Read the terms.'],
  definition: 'A definition.',
  created_at: '2026-08-07T00:00:00.000Z',
  created_by: 'someone@navapbc.com',
  ...over,
});

const planOf = (source, target) => planPostureCopy(source, target, NOW);

describe('planPostureCopy', () => {
  it('writes nothing when the content already matches, whatever the audit fields say', () => {
    const { entries } = planOf(
      [posture('allowed', { updated_at: '2026-09-23T19:00:00.000Z' })],
      [posture('allowed', { created_at: '2026-08-01T00:00:00.000Z' })],
    );
    expect(entries).toEqual([{ action: 'same', id: 'allowed', changed: [], item: null }]);
  });

  it('creates a posture the target lacks, from the whole source record', () => {
    const source = posture('conditional');
    const { entries } = planOf([source], []);
    expect(entries[0].action).toBe('create');
    expect(entries[0].item).toEqual(source);
  });

  it('updates only the content fields and keeps the target history', () => {
    const target = posture('silent', { created_by: 'seed', definition: '', color: '#f3f4f6' });
    const { entries } = planOf([posture('silent', { color: '#dbeafe' })], [target]);
    expect(entries[0].action).toBe('update');
    expect(entries[0].changed).toEqual(['color', 'definition']);
    expect(entries[0].item).toMatchObject({
      color: '#dbeafe',
      definition: 'A definition.',
      created_by: 'seed',
      updated_at: NOW,
    });
  });

  it('compares steps by content and order', () => {
    const { entries } = planOf(
      [posture('allowed', { steps: ['b', 'a'] })],
      [posture('allowed', { steps: ['a', 'b'] })],
    );
    expect(entries[0].changed).toEqual(['steps']);
  });

  it('reports a posture only the target holds and never deletes it', () => {
    const plan = planOf([posture('allowed')], [posture('allowed'), posture('legacy')]);
    expect(plan.targetOnly).toEqual(['legacy']);
    expect(plan.entries.map((e) => e.id)).toEqual(['allowed']);
  });

  it('does not write a field the source lacks over the target value', () => {
    const { definition, ...noDefinition } = posture('allowed', { color: '#000001' });
    const { entries } = planOf([noDefinition], [posture('allowed', { definition: 'Keep me.' })]);
    expect(entries[0].changed).toEqual(['color']);
    expect(entries[0].item.definition).toBe('Keep me.');
  });

  it('carries every field the Policy Guidance tab edits', () => {
    expect(CONTENT_FIELDS).toEqual(['label', 'color', 'status', 'position', 'steps', 'definition']);
  });
});
