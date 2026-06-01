import { describe, it, expect } from 'vitest';
import { parseFrontmatter, getDescription, slugify } from '../scripts/utils.mjs';

describe('parseFrontmatter', () => {
  it('returns empty meta and full content when no frontmatter', () => {
    const result = parseFrontmatter('# Hello\nSome text');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('# Hello\nSome text');
  });

  it('parses basic string fields', () => {
    const content = `---\nname: My Skill\ndescription: Does something\n---\n# Body`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBe('My Skill');
    expect(meta.description).toBe('Does something');
    expect(body).toBe('# Body');
  });

  it('parses boolean true', () => {
    const { meta } = parseFrontmatter('---\nsensitive_data: true\n---\nbody');
    expect(meta.sensitive_data).toBe(true);
  });

  it('parses boolean false', () => {
    const { meta } = parseFrontmatter('---\nsensitive_data: false\n---\nbody');
    expect(meta.sensitive_data).toBe(false);
  });

  it('parses array values', () => {
    const { meta } = parseFrontmatter('---\ncompatibility: [claude-code, claude-chat]\n---\nbody');
    expect(meta.compatibility).toEqual(['claude-code', 'claude-chat']);
  });

  it('strips quotes from string values', () => {
    const { meta } = parseFrontmatter('---\nname: "Quoted Name"\nversion: \'1.2.3\'\n---\nbody');
    expect(meta.name).toBe('Quoted Name');
    expect(meta.version).toBe('1.2.3');
  });

  it('ignores lines without a colon', () => {
    const { meta } = parseFrontmatter('---\nname: Valid\nnocolon\n---\nbody');
    expect(meta.name).toBe('Valid');
    expect(Object.keys(meta)).toEqual(['name']);
  });

  it('handles values with colons (e.g. URLs)', () => {
    const { meta } = parseFrontmatter('---\nurl: https://example.com\n---\nbody');
    // Only the first colon is the key separator; rest is the value
    expect(meta.url).toBe('https://example.com');
  });

  it('trims whitespace from keys and values', () => {
    const { meta } = parseFrontmatter('---\n  name :   padded value  \n---\nbody');
    expect(meta.name).toBe('padded value');
  });

  it('parses YAML folded scalar (>) into a single string', () => {
    const content = `---\nname: test\ndescription: >\n  First line of description.\n  Second line here.\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.description).toBe('First line of description. Second line here.');
  });

  it('parses YAML literal block scalar (|) into a single string', () => {
    const content = `---\nname: test\ndescription: |\n  Line one.\n  Line two.\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.description).toBe('Line one. Line two.');
  });

  it('parses fields after a block scalar correctly', () => {
    const content = `---\ndescription: >\n  Multi-line text here.\nversion: "2.0"\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.description).toBe('Multi-line text here.');
    expect(meta.version).toBe('2.0');
  });
});

describe('getDescription', () => {
  it('returns first non-heading, non-empty line', () => {
    expect(getDescription('# Title\n\nThis is the description.')).toBe('This is the description.');
  });

  it('skips heading lines', () => {
    expect(getDescription('# H1\n## H2\nActual text')).toBe('Actual text');
  });

  it('skips blank lines', () => {
    expect(getDescription('\n\nFirst real line')).toBe('First real line');
  });

  it('returns empty string when only headings', () => {
    expect(getDescription('# Title\n## Subtitle')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(getDescription('')).toBe('');
  });

  it('trims trailing whitespace from result', () => {
    expect(getDescription('Some text   ')).toBe('Some text');
  });
});

describe('slugify', () => {
  it('lowercases input', () => {
    expect(slugify('MySkill')).toBe('myskill');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('my skill name')).toBe('my-skill-name');
  });

  it('collapses multiple non-alphanumeric chars to single hyphen', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--my-skill--')).toBe('my-skill');
  });

  it('handles special characters', () => {
    expect(slugify('skill/v2.0 (beta)!')).toBe('skill-v2-0-beta');
  });

  it('handles already-slugified strings unchanged', () => {
    expect(slugify('nava-labs-style')).toBe('nava-labs-style');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles strings with only special chars', () => {
    expect(slugify('---')).toBe('');
  });
});
