// Pure utility functions shared by sync scripts and tests.

export function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  const lines = match[1].split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }
    const key = line.slice(0, colonIdx).trim();
    if (!key) { i++; continue; }
    let value = line.slice(colonIdx + 1).trim();

    // YAML block scalars: > (folded) and | (literal) — content on subsequent indented lines
    if (value === '>' || value === '|') {
      const blockLines = [];
      i++;
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t'))) {
        blockLines.push(lines[i].trim());
        i++;
      }
      value = blockLines.join(' ').trim();
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: compatibility: [claude-chat, claude-cowork]
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/["']/g, ''));
      i++;
    } else if (value === '' && i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
      // Block sequence:
      //   compatibility:
      //     - claude-chat
      //     - claude-cowork
      const listItems = [];
      i++;
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s+-\s+/, '').trim().replace(/["']/g, ''));
        i++;
      }
      value = listItems;
    } else {
      value = value.replace(/["']/g, '');
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      i++;
    }
    meta[key] = value;
  }
  return { meta, body: content.slice(match[0].length).trim() };
}

export function getDescription(body) {
  const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines[0]?.trim() || '';
}

export function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
