import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  archetypesFromSource,
  posturesFromSource,
  skippedPolicyFields,
  buildRecords,
  assertValid,
  ICON_MAP,
  POSTURE_COLORS,
  SeedError,
} from '../scripts/lib/seed-project-reference.mjs';

// Real prototype fixtures, trimmed to the shape the seed actually reads. Kept
// inline rather than committed as files: the sources live outside this repo on
// purpose, since it is public.
const ARCHETYPES_SOURCE = [
  {
    id: 'product-team',
    label: 'Product Team',
    description: 'Cross-functional team building or improving a digital product.',
    icon: 'groups',
    color: '#651A94',
    characteristics: ['Cross-functional: engineers, designers, product, research', 'Iterative delivery'],
    aiOpportunities: ['Rapid prototyping and design iteration', 'Test generation and PR review'],
  },
  {
    id: 'platform-team',
    label: 'Platform Team',
    description: 'Builds and maintains shared infrastructure.',
    icon: 'dns',
    color: '#282E6C',
    characteristics: ['Broad downstream impact'],
    aiOpportunities: ['AI harness and guardrail systems'],
  },
  {
    id: 'data-modernization-team',
    label: 'Data Modernization Team',
    description: 'Transforms how agencies manage data.',
    icon: 'storage',
    color: '#F37100',
    characteristics: ['Large, complex data migrations'],
    aiOpportunities: ['Legacy data schema analysis'],
  },
  {
    id: 'enterprise-operations-team',
    label: 'Enterprise Operations Team',
    description: 'Operates enterprise-scale systems.',
    icon: 'settings',
    color: '#08A588',
    characteristics: ['Operations and maintenance primary'],
    aiOpportunities: ['Configuration management assistance'],
  },
  {
    id: 'strategic-consulting-team',
    label: 'Strategic Consulting Team',
    description: 'Provides strategy, research, and advisory services.',
    icon: 'lightbulb',
    color: '#B14092',
    characteristics: ['Strategy and advisory outputs'],
    aiOpportunities: ['Research synthesis at scale'],
  },
];

const POLICY_SOURCE = {
  effectiveDate: '2026-05',
  reviewDate: '2026-08',
  approver: 'Crystal Cody',
  sourceDoc: 'https://example.invalid/policy',
  guidance: {
    allowed: { label: 'AI ALLOWED — how to proceed', steps: ['You may use AI-assisted tools.', 'Never input PII.'] },
    restricted: { label: 'AI RESTRICTED — how to proceed', steps: ['Read the contract terms.'] },
    silent: { label: 'AI SILENT — how to proceed', steps: ['The contract does not address AI use.'] },
    prohibited: { label: 'AI PROHIBITED — hard stop', steps: ['AI use is not permitted. Stop.'] },
  },
  checklist: ['No client or sensitive data is in my prompt.'],
  standardClientResponse: 'Yes, Nava uses AI-assisted tools in a controlled manner.',
  hardLimits: ['Never input PII into any AI tool.'],
};

describe('archetypesFromSource', () => {
  it('produces one record per source archetype', () => {
    expect(archetypesFromSource(ARCHETYPES_SOURCE)).toHaveLength(5);
  });

  it('translates every Material Symbols icon to a curated-menu name', () => {
    const icons = archetypesFromSource(ARCHETYPES_SOURCE).map((a) => a.icon);
    expect(icons).toEqual(['users', 'server', 'database', 'settings', 'bulb']);
  });

  // The source key is aiOpportunities; the stored key is ai_opportunities.
  // Passing the object through verbatim renders an empty list for every record.
  it('renames aiOpportunities and preserves both lists in source order', () => {
    const [product] = archetypesFromSource(ARCHETYPES_SOURCE);
    expect(product.ai_opportunities).toEqual([
      'Rapid prototyping and design iteration',
      'Test generation and PR review',
    ]);
    expect(product.characteristics[0]).toBe('Cross-functional: engineers, designers, product, research');
    expect(product).not.toHaveProperty('aiOpportunities');
  });

  it('carries label, description and color through unchanged', () => {
    const [product] = archetypesFromSource(ARCHETYPES_SOURCE);
    expect(product.label).toBe('Product Team');
    expect(product.color).toBe('#651A94');
    expect(product.description).toContain('Cross-functional');
  });

  it('fails loudly on an unmapped icon, naming the archetype and the icon', () => {
    const withUnknown = [{ ...ARCHETYPES_SOURCE[0], icon: 'rocket_launch' }];
    expect(() => archetypesFromSource(withUnknown)).toThrow(SeedError);
    expect(() => archetypesFromSource(withUnknown)).toThrow(/product-team.*rocket_launch/s);
  });

  it('rejects a source that is not an array', () => {
    expect(() => archetypesFromSource({ nope: true })).toThrow(/must be a JSON array/);
  });

  it('defaults absent lists to empty rather than undefined', () => {
    const [bare] = archetypesFromSource([{ id: 'x', label: 'X', color: '#000000', icon: 'groups' }]);
    expect(bare.characteristics).toEqual([]);
    expect(bare.ai_opportunities).toEqual([]);
  });

  it('maps every icon the five seeded archetypes use', () => {
    for (const source of ARCHETYPES_SOURCE) {
      expect(ICON_MAP[source.icon], `no mapping for "${source.icon}"`).toBeDefined();
    }
  });
});

describe('posturesFromSource', () => {
  it('produces one posture per guidance key and nothing else', () => {
    const postures = posturesFromSource(POLICY_SOURCE);
    expect(postures.map((p) => p.id)).toEqual(['allowed', 'restricted', 'silent', 'prohibited']);
  });

  it('assigns display positions from the guidance key order', () => {
    expect(posturesFromSource(POLICY_SOURCE).map((p) => p.position)).toEqual([1, 2, 3, 4]);
  });

  // The source file carries no color at all — every entry is just label + steps.
  it('supplies a color for every posture, since the source has none', () => {
    for (const posture of posturesFromSource(POLICY_SOURCE)) {
      expect(posture.color).toBe(POSTURE_COLORS[posture.id]);
      expect(posture.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('preserves step order as authored', () => {
    const [allowed] = posturesFromSource(POLICY_SOURCE);
    expect(allowed.steps).toEqual(['You may use AI-assisted tools.', 'Never input PII.']);
  });

  it('carries none of the policy file\'s other top-level fields onto a record', () => {
    for (const posture of posturesFromSource(POLICY_SOURCE)) {
      for (const field of ['approver', 'effectiveDate', 'reviewDate', 'sourceDoc', 'checklist', 'hardLimits']) {
        expect(posture).not.toHaveProperty(field);
      }
    }
  });

  it('fails loudly on a guidance key with no mapped color', () => {
    const extra = { guidance: { ...POLICY_SOURCE.guidance, conditional: { label: 'X', steps: ['a'] } } };
    expect(() => posturesFromSource(extra)).toThrow(/conditional.*no mapped color/s);
  });

  it('rejects a posture with an empty step list', () => {
    const empty = { guidance: { allowed: { label: 'A', steps: [] } } };
    expect(() => posturesFromSource(empty)).toThrow(/no guidance steps/);
  });

  it('rejects a source with no guidance object', () => {
    expect(() => posturesFromSource({ checklist: [] })).toThrow(/`guidance` object/);
    expect(() => posturesFromSource({ guidance: [] })).toThrow(/`guidance` object/);
  });
});

describe('skippedPolicyFields', () => {
  it('reports the fields present in the source but not carried', () => {
    expect(skippedPolicyFields(POLICY_SOURCE)).toEqual([
      'effectiveDate', 'reviewDate', 'approver', 'sourceDoc',
      'checklist', 'standardClientResponse', 'hardLimits',
    ]);
  });

  it('reports nothing for a source that has only guidance', () => {
    expect(skippedPolicyFields({ guidance: {} })).toEqual([]);
  });
});

describe('buildRecords', () => {
  it('produces a validated record set from both sources', () => {
    const records = buildRecords({ archetypes: ARCHETYPES_SOURCE, policy: POLICY_SOURCE });
    expect(records).toHaveLength(9);
    expect(records.filter((r) => r.entity_type === 'archetype')).toHaveLength(5);
    expect(records.filter((r) => r.entity_type === 'posture')).toHaveLength(4);
  });

  // The seed must not be able to write something the API would reject.
  it('rejects a record the API would refuse, before anything is written', () => {
    const badColor = [{ ...ARCHETYPES_SOURCE[0], color: 'purple' }];
    expect(() => buildRecords({ archetypes: badColor, policy: POLICY_SOURCE })).toThrow(/invalid: color/);
  });

  it('rejects an id that is not slug-safe', () => {
    const badId = [{ ...ARCHETYPES_SOURCE[0], id: 'Product Team' }];
    expect(() => buildRecords({ archetypes: badId, policy: POLICY_SOURCE })).toThrow(/invalid: id/);
  });

  it('names the offending record when validation fails', () => {
    const badLabel = [{ ...ARCHETYPES_SOURCE[1], label: '' }];
    expect(() => assertValid(archetypesFromSource(badLabel))).toThrow(/archetype "platform-team"/);
  });
});

// Guards the mapping tables against the real source files drifting out from
// under them — an icon or posture added upstream with no mapping here fails the
// seed, and this is where that shows up first.
//
// The sources live outside this repository on purpose, since it is public, so
// point at them explicitly to run these:
//
//   PROJECT_REFERENCE_SOURCE_DIR="/path/to/data" pnpm test
//
// Without that variable the checks skip rather than fail — no developer's local
// directory layout is baked into the repo.
describe('against the real prototype sources, when available', () => {
  const SOURCE_DIR = process.env.PROJECT_REFERENCE_SOURCE_DIR;
  const read = (name) => {
    if (!SOURCE_DIR) return null;
    try {
      return JSON.parse(readFileSync(`${SOURCE_DIR}/${name}`, 'utf8'));
    } catch {
      return null;
    }
  };

  it('maps every icon the real archetypes.json uses', () => {
    const source = read('archetypes.json');
    if (!source) return;
    expect(() => archetypesFromSource(source)).not.toThrow();
  });

  it('maps a color for every posture in the real policy.json', () => {
    const source = read('policy.json');
    if (!source) return;
    expect(() => posturesFromSource(source)).not.toThrow();
  });

  it('produces a fully valid record set from the real files', () => {
    const archetypes = read('archetypes.json');
    const policy = read('policy.json');
    if (!archetypes || !policy) return;
    expect(() => buildRecords({ archetypes, policy })).not.toThrow();
  });
});
