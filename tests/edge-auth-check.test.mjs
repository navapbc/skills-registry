import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The CloudFront viewer-request function is a Terraform template, so it cannot be
 * imported directly. The template variables are substituted here the same way
 * terraform's templatefile() does, and the module is loaded from a data URL.
 *
 * Worth the small amount of machinery: `rewriteUri` carries a hardcoded allowlist
 * of client-rendered shell paths, and a route missing from it fails in a way that
 * is easy to miss — the index page resolves and only the detail URLs 404, so a
 * smoke test of "does the page load" passes. It ships via terraform apply rather
 * than the site sync, so it is also the piece most likely to be deployed late.
 */
let rewriteUri;
let isPublicPath;

beforeAll(async () => {
  const template = readFileSync(
    resolve(process.cwd(), 'functions/edge/auth-check.js.tpl'),
    'utf8',
  );

  const source = template
    .replaceAll('${jwt_secret}', 'test-secret')
    .replaceAll('${login_path}', '/login')
    // `crypto` is only used by the JWT verification this file does not exercise,
    // and the node: specifier is not resolvable from a data URL.
    .replace(/^import crypto from 'crypto';$/m, 'const crypto = undefined;')
    + '\nexport { rewriteUri, isPublicPath };';

  ({ rewriteUri, isPublicPath } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  ));
});

// Every client-rendered route. A route absent here resolves at its index path and
// 404s on every detail URL beneath it.
const CSR_ROUTES = [
  'skills', 'plugins', 'agents', 'category', 'admin', 'submit', 'contracts', 'initiatives',
];

describe('rewriteUri', () => {
  it.each(CSR_ROUTES)('routes /%s to its own index.html', (route) => {
    expect(rewriteUri(`/${route}`)).toBe(`/${route}/index.html`);
  });

  it.each(CSR_ROUTES)('routes a /%s/<id> detail path to the same shell', (route) => {
    expect(rewriteUri(`/${route}/some-detail-id`)).toBe(`/${route}/index.html`);
  });

  it('routes a contracts id containing hyphens and digits', () => {
    expect(rewriteUri('/contracts/states-maryland-statewide-agile-teams'))
      .toBe('/contracts/index.html');
    expect(rewriteUri('/contracts/fedciv-example-agency-forms-aaa00a00a0000-nava'))
      .toBe('/contracts/index.html');
  });

  it('routes an initiatives id, including the longest real slug', () => {
    // Initiative ids are uncapped slugs of prose titles — the longest real one is 89
    // characters. A length-sensitive rewrite would break exactly the detail URLs
    // that matter and leave the grid working.
    expect(rewriteUri('/initiatives/askca-california-wide-chatbot'))
      .toBe('/initiatives/index.html');
    expect(rewriteUri(
      '/initiatives/government-services-navigator-prototype-labs-user-facing-ai-team',
    )).toBe('/initiatives/index.html');
  });

  it('leaves the root alone', () => {
    expect(rewriteUri('/')).toBe('/');
  });

  it('passes through anything with a file extension', () => {
    expect(rewriteUri('/favicon.ico')).toBe('/favicon.ico');
    expect(rewriteUri('/_astro/chunk.abc123.js')).toBe('/_astro/chunk.abc123.js');
    expect(rewriteUri('/contracts/index.html')).toBe('/contracts/index.html');
  });

  it('falls back to a directory index for unlisted extensionless paths', () => {
    expect(rewriteUri('/whats-new')).toBe('/whats-new/index.html');
    expect(rewriteUri('/my-skills')).toBe('/my-skills/index.html');
  });
});

describe('isPublicPath', () => {
  it('keeps the login page and static assets reachable without a session', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/favicon.ico')).toBe(true);
    expect(isPublicPath('/_astro/chunk.js')).toBe(true);
  });

  it('does not make the explorer public', () => {
    // The audience widens to every signed-in user, which is not the same as
    // unauthenticated — the edge gate must still challenge for a session.
    expect(isPublicPath('/contracts')).toBe(false);
    expect(isPublicPath('/contracts/labs-aecf')).toBe(false);
  });
});

// The route list above is hand-maintained, which is the same drift this file
// exists to catch. Derive the template's actual list and compare, so adding a
// route to production without adding it here fails loudly.
describe('CSR route list stays in sync with the template', () => {
  it('covers every rewrite the template declares', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'functions/edge/auth-check.js.tpl'),
      'utf8',
    );
    const declared = [...template.matchAll(/uri\.indexOf\('\/([a-z-]+)'\) === 0\) return '\//g)]
      .map((m) => m[1]);
    expect(declared.sort()).toEqual([...CSR_ROUTES].sort());
  });
});
