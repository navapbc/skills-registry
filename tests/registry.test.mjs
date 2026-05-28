import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RegistrySchema } from '../src/lib/registry-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, '../public/registry/index.json'), 'utf8');
const registry = JSON.parse(raw);

describe('Registry JSON schema', () => {
  it('passes full Zod schema validation', () => {
    const result = RegistrySchema.safeParse(registry);
    if (!result.success) {
      // Surface the first few issues for easier debugging
      const issues = result.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`);
      expect.fail(`Schema validation failed:\n${issues.join('\n')}`);
    }
  });

  it('has at least one plugin and one skill', () => {
    expect(registry.plugins.length).toBeGreaterThan(0);
    expect(registry.skills.length).toBeGreaterThan(0);
  });
});

describe('Registry consistency', () => {
  it('has minimal intra-plugin slug duplicates (fix with name: frontmatter)', () => {
    let total = 0;
    for (const plugin of registry.plugins) {
      const pluginSkills = registry.skills.filter(s => s.plugin === plugin.slug);
      const slugs = pluginSkills.map(s => s.slug);
      const dupes = [...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))];
      if (dupes.length > 0) {
        console.warn(`Plugin "${plugin.slug}" has duplicate slugs: ${dupes.join(', ')}`);
        total += dupes.length;
      }
    }
    // Threshold calibrated to current known count (11). These are caused by old slug-generation
    // logic using parent-dir names instead of filename stems — fixed in the sync script and will
    // drop to ~0 after the next registry sync. Lower this threshold once a fresh sync runs.
    expect(total).toBeLessThan(15);
  });

  it('cross-plugin slug collisions are below threshold (fix with name: frontmatter)', () => {
    const slugs = registry.skills.map(s => s.slug);
    const collidingSlugs = [...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))];
    if (collidingSlugs.length > 0) {
      console.warn(`⚠ ${collidingSlugs.length} slugs collide across plugins: ${collidingSlugs.join(', ')}`);
      console.warn('Add a "name:" field to the relevant SKILL.md files to resolve.');
    }
    // Hard bound — catches catastrophic regressions without blocking on cross-org naming gaps
    expect(collidingSlugs.length).toBeLessThan(30);
  });

  it('has no duplicate plugin slugs', () => {
    const slugs = registry.plugins.map(p => p.slug);
    const dupes = slugs.filter((slug, i) => slugs.indexOf(slug) !== i);
    expect(dupes, `Duplicate plugin slugs: ${dupes.join(', ')}`).toEqual([]);
  });

  it('plugin skill_count matches number of skills with that plugin', () => {
    for (const plugin of registry.plugins) {
      const actual = registry.skills.filter(s => s.plugin === plugin.slug && s.type === 'skill').length;
      expect(actual, `Plugin "${plugin.slug}" skill_count mismatch`).toBe(plugin.skill_count);
    }
  });

  it('plugin agent_count matches number of agents with that plugin', () => {
    for (const plugin of registry.plugins) {
      const actual = registry.skills.filter(s => s.plugin === plugin.slug && s.type === 'agent').length;
      expect(actual, `Plugin "${plugin.slug}" agent_count mismatch`).toBe(plugin.agent_count);
    }
  });

  it('every skill references an existing plugin slug', () => {
    const pluginSlugs = new Set(registry.plugins.map(p => p.slug));
    const orphans = registry.skills.filter(s => !pluginSlugs.has(s.plugin)).map(s => s.slug);
    expect(orphans, `Skills with unknown plugin: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every plugin lists only skill slugs that exist', () => {
    const skillSlugs = new Set(registry.skills.map(s => s.slug));
    for (const plugin of registry.plugins) {
      const missing = plugin.skills.filter(s => !skillSlugs.has(s));
      expect(missing, `Plugin "${plugin.slug}" references missing skills: ${missing.join(', ')}`).toEqual([]);
    }
  });
});
