import { describe, it, expect } from 'vitest';
import { renderFavoriteCard, renderInstalledCard } from '../../src/lib/my-skills-render.mjs';

const FAV = {
  name: 'Exec Summary',
  slug: 'exec-summary',
  plugin: 'nava-writing',
  description: 'Turns a long document into a one-page summary.',
  type: 'skill',
};

const INSTALLED = {
  ...FAV,
  installCommand: 'npx skills add exec-summary',
  installedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * Both renderers feed `innerHTML`, and every value they interpolate arrives from
 * the registry, which takes open submissions. Nothing on the write path enforces
 * the shape of a name or a slug, so these are the tests that keep the escaping in
 * place — it is invisible in the rendered page and trivially dropped in a later
 * edit.
 */
describe('my-skills card escaping', () => {
  const HOSTILE = '<img src=x onerror="alert(1)">';

  for (const [label, render] of [
    ['renderFavoriteCard', (entry) => renderFavoriteCard(entry)],
    ['renderInstalledCard', (entry) => renderInstalledCard(entry, '3 weeks ago')],
  ]) {
    describe(label, () => {
      // `onerror=` survives escaping as a substring, since `=` is not an escaped
      // character — so the property to assert is that no TAG can open, not that
      // the payload's text is absent.
      it('renders a hostile name as inert text', () => {
        const html = render({ ...INSTALLED, name: HOSTILE });
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
      });

      it('renders a hostile plugin and description as inert text', () => {
        const html = render({ ...INSTALLED, plugin: HOSTILE, description: HOSTILE });
        expect(html).not.toContain('<img');
        // Both fields land in the output, both escaped. The count is not asserted:
        // the favourite card renders `plugin` twice, in the badge and the footer.
        expect(html.match(/&lt;img/g).length).toBeGreaterThanOrEqual(2);
      });

      it('keeps a quote in the name inside the aria-label rather than closing it', () => {
        const html = render({ ...INSTALLED, name: 'The "Big" One' });
        expect(html).toContain('aria-label="Remove The &quot;Big&quot; One from');
      });

      it('names the skill in the remove button\'s accessible name', () => {
        expect(render(INSTALLED)).toContain('Exec Summary from');
      });

      it('renders the name and plugin when they are ordinary', () => {
        const html = render(INSTALLED);
        expect(html).toContain('Exec Summary');
        expect(html).toContain('nava-writing');
      });

      it('survives an entry with no name, plugin or description', () => {
        const html = render({ slug: 'bare', type: 'skill' });
        expect(html).toContain('bare');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('null');
      });
    });
  }

  it('percent-encodes a slug rather than letting it break the path', () => {
    // A slug holding `#` truncates the href without this — a routing bug on its
    // own, before any question of injection.
    expect(renderFavoriteCard({ ...FAV, slug: 'a#b?c' })).toContain('/skills/a%23b%3Fc');
    expect(renderInstalledCard({ ...FAV, slug: 'a#b?c' }, 'now')).toContain('/skills/a%23b%3Fc');
  });

  it('cannot be talked into a javascript: href via the slug', () => {
    const html = renderFavoriteCard({ ...FAV, slug: 'javascript:alert(1)' });
    expect(html).not.toContain('href="javascript:');
  });

  it('routes an agent to /agents and a skill to /skills', () => {
    expect(renderFavoriteCard({ ...FAV, type: 'agent' })).toContain('/agents/exec-summary');
    expect(renderFavoriteCard(FAV)).toContain('/skills/exec-summary');
  });

  it('labels an agent with a fixed badge instead of its plugin', () => {
    // The plugin still appears in the card footer, escaped — the claim here is
    // only that the BADGE is the fixed string and interpolates nothing.
    const html = renderFavoriteCard({ ...FAV, type: 'agent', plugin: HOSTILE });
    expect(html).toContain('bg-blue-50 text-blue-700 rounded">agent<');
    expect(html).not.toContain('bg-plum-50');
    expect(html).not.toContain('<img');
  });
});

describe('my-skills blurb truncation', () => {
  it('truncates before escaping, so a cut never lands inside an entity', () => {
    // 98 plain characters then `&`: escaping first would make the 100-char cut
    // fall inside `&amp;` and emit a broken `&am`.
    const description = 'x'.repeat(98) + '&&&&&';
    const html = renderFavoriteCard({ ...FAV, description });
    expect(html).toContain('x'.repeat(98) + '&amp;&amp;...');
    expect(html).not.toMatch(/&am[^p]/);
  });

  it('leaves a short description whole and marks a cut one', () => {
    expect(renderFavoriteCard(FAV)).toContain('one-page summary.');
    expect(renderFavoriteCard(FAV)).not.toContain('...');
    expect(renderFavoriteCard({ ...FAV, description: 'y'.repeat(200) })).toContain('...');
  });
});

describe('renderInstalledCard copy button', () => {
  it('escapes the install command it carries in an attribute', () => {
    const html = renderInstalledCard({ ...INSTALLED, installCommand: 'add "x" && y' }, 'now');
    expect(html).toContain('data-copy="add &quot;x&quot; &amp;&amp; y"');
  });

  it('omits the button when there is no command', () => {
    expect(renderInstalledCard({ ...INSTALLED, installCommand: '' }, 'now')).not.toContain('copy-btn');
  });

  it('takes the installed-time label from its caller', () => {
    expect(renderInstalledCard(INSTALLED, '3 weeks ago')).toContain('Installed 3 weeks ago');
  });
});
