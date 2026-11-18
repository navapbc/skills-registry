import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { globSync } from 'fs';
import { execSync } from 'child_process';

/**
 * fetchApi() prepends `/api` itself. Passing an already-prefixed path produces a
 * request to `/api/api/...`, which 404s — and because the API tests call the Hono
 * app directly, nothing else in the suite notices. A whole page shipped broken
 * this way once; this guards the class rather than the instance.
 */
describe('fetchApi call sites', () => {
  const files = execSync(
    "git ls-files 'src/**/*.astro' 'src/**/*.mjs' 'src/**/*.ts'",
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('never pass a path that already starts with /api', () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/fetchApi\(\s*['"`](\/[^'"`]*)/g)) {
        if (match[1].startsWith('/api')) offenders.push(`${file}: fetchApi('${match[1]}')`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds call sites at all, so the guard cannot pass vacuously', () => {
    const total = files.reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(/fetchApi\(/g)].length, 0,
    );
    expect(total).toBeGreaterThan(5);
  });

  it('loads the initiatives page from the API for grid and detail views', () => {
    const source = readFileSync('src/pages/initiatives/index.astro', 'utf8');
    expect(source).toContain('data = await fetchApi(initiativesApiPath(initiativeId));');
    expect(source).not.toContain('LOCAL_INITIATIVES_DATA');
  });
});
