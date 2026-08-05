// Pure transformations for the Google Sheets contract-data export
// (docs/plans/2026-08-05-001-feat-sheets-contract-data-export-plan.md, U2 + U3).
//
// Nothing here touches the network, the filesystem, or `process` — the CLI owns
// all I/O and exit codes so these stay unit-testable.

/**
 * Resolve which tabs to export.
 *
 * With no request, every tab is exported in workbook order. With a request, the
 * caller's tabs are matched case-insensitively and trimmed, since tab names are
 * typed by hand on the command line.
 *
 * Returns `{ selected, missing }` rather than throwing: the CLI decides whether
 * a missing tab is fatal and how to phrase the message.
 */
export function selectTabs(availableTitles, requestedTitles) {
  if (!requestedTitles || requestedTitles.length === 0) {
    return { selected: [...availableTitles], missing: [] };
  }

  const byNormalized = new Map();
  for (const title of availableTitles) {
    // First writer wins, so workbook order decides ties between tabs whose names
    // differ only by case or padding.
    const key = normalizeTitle(title);
    if (!byNormalized.has(key)) byNormalized.set(key, title);
  }

  const selected = [];
  const missing = [];
  for (const requested of requestedTitles) {
    const match = byNormalized.get(normalizeTitle(requested));
    if (match === undefined) {
      missing.push(requested);
    } else if (!selected.includes(match)) {
      selected.push(match);
    }
  }

  return { selected, missing };
}

function normalizeTitle(title) {
  return String(title).trim().toLowerCase();
}

/**
 * Locate a tab's header row.
 *
 * Row 1 is the header on only 2 of the 7 tabs in this workbook. The rest open with
 * title banners, blank spacers, or category rows. What separates a header from that
 * noise is density: banner and category rows are sparse, the header spans nearly the
 * full width of the data below it. So: the first row filled to at least
 * `threshold` of the densest row in the tab.
 *
 * This is a heuristic and will mispick eventually — hence `headerRowFor` overrides
 * in the CLI, the reported row index on every run, and the raw grid preserved in
 * the JSON output.
 */
export function detectHeaderRow(cells, threshold = 0.8) {
  if (!cells || cells.length === 0) return -1;

  const density = cells.map(countNonEmpty);
  const max = Math.max(...density);
  if (max === 0) return -1;

  return density.findIndex((d) => d >= max * threshold);
}

function countNonEmpty(row) {
  return (row ?? []).filter((c) => String(c ?? '').trim() !== '').length;
}

/**
 * Convert a tab's 2D cell array into objects keyed by its header row.
 *
 * Everything above the header row is dropped — it is banner and spacer content,
 * preserved in the raw grid rather than here.
 *
 * The Sheets API truncates trailing empty cells, so rows are routinely shorter than
 * the header. Missing trailing columns become empty strings rather than being
 * absent, which keeps every object the same shape and lets the CSV serializer emit
 * a consistent column count.
 *
 * Blank header cells are named `column_<n>` so their data survives; without a key
 * those columns would vanish from both outputs. Duplicate header names are
 * suffixed for the same reason.
 */
export function rowsToObjects(cells, headerRow) {
  const at = headerRow ?? detectHeaderRow(cells);
  if (!cells || cells.length === 0 || at < 0) return { headerRow: at, headers: [], rows: [] };

  const headers = dedupeHeaders(cells[at].map((h) => String(h ?? '').trim()));
  const rows = cells.slice(at + 1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] === undefined || row[i] === null ? '' : String(row[i]);
    });
    return obj;
  });

  return { headerRow: at, headers, rows };
}

function dedupeHeaders(raw) {
  const seen = new Map();
  return raw.map((name, i) => {
    const base = name === '' ? `column_${i + 1}` : name;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/**
 * Serialize header-keyed rows to RFC 4180 CSV.
 *
 * Column order comes from the same `headers` array that keys the row objects,
 * so the CSV and JSON views of a tab cannot drift apart.
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function escapeCsvField(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
