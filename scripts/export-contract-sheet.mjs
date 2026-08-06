#!/usr/bin/env node
/**
 * Export the "Nava Projects and Programs Database for Sage - CURRENT" Google Sheet
 * to JSON and CSV
 * (docs/plans/2026-08-05-001-feat-sheets-contract-data-export-plan.md, U5).
 *
 * Produces, in one run:
 *   <out>/contract-sheet.json   the whole workbook, tabs keyed by name — each tab
 *                               carries its header-keyed rows AND its raw cell grid
 *   <out>/<tab-slug>.csv        one file per exported tab
 *
 * Output is a faithful dump of the sheet — no renaming, filtering, or derived
 * fields. Shaping for the Contract Explorer happens downstream.
 *
 * As of 2026-08-05, auto-detection is correct on 5 of the 7 tabs. Two need help, so
 * the full-fidelity invocation for this workbook is:
 *
 *   node scripts/export-contract-sheet.mjs \
 *     --header-row "Sage View=2" --header-row "All Columns (Full View)=6"
 *
 * Other examples:
 *
 *   node scripts/export-contract-sheet.mjs
 *   node scripts/export-contract-sheet.mjs --tabs "Contracts orig,Project Indexes"
 *   node scripts/export-contract-sheet.mjs --out tmp/sheet-export --credentials ./key.json
 *
 * Any Google Sheet works, not just the default one — paste the URL straight from
 * the browser (a bare spreadsheet ID is accepted too):
 *
 *   node scripts/export-contract-sheet.mjs \
 *     --spreadsheet "https://docs.google.com/spreadsheets/d/<id>/edit?gid=0#gid=0"
 *
 * Whatever sheet you point at must be shared with the service account.
 *
 * Options (each falls back to an env var, then to a default):
 *   --credentials <path>  GOOGLE_APPLICATION_CREDENTIALS   default ./credentials.json
 *   --spreadsheet <ref>   CONTRACT_SHEET_ID                 URL or ID; default the
 *                                                           workbook above
 *   --out <dir>           CONTRACT_SHEET_OUT_DIR            default ./sheet-export
 *   --tabs <a,b,c>        CONTRACT_SHEET_TABS               default every tab
 *   --header-row <t=n>    CONTRACT_SHEET_HEADER_ROWS        default auto-detect
 *
 * Header rows: most tabs in this workbook open with title banners or blank spacers,
 * so the header row is auto-detected by density and the chosen 1-based row number is
 * printed for every tab. When a pick looks wrong, override it with
 * `--header-row "Tab Name=6"` (repeatable, or comma-separated). The raw grid in the
 * JSON means a bad pick never loses data.
 *
 * Prerequisites:
 *   1. A Google service-account key file (NOT an OAuth client secret).
 *   2. The workbook shared with that service account's email — Viewer is enough.
 *   3. The Google Sheets API enabled on the service account's GCP project.
 *
 * The key file and everything under the output directory contain non-public
 * contract data and must stay out of git. This repo is public.
 *
 * Nothing is written until every tab has been fetched and serialized, so a failed
 * run leaves no partial output.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { slugify } from './utils.mjs';
import { parseSpreadsheetId, selectTabs, rowsToObjects, toCsv } from './lib/sheet-export.mjs';
import {
  SheetsError,
  loadServiceAccountKey,
  authorize,
  fetchTabTitles,
  fetchTabValues,
} from './lib/sheets-client.mjs';

const DEFAULT_SPREADSHEET_ID = '1hax9xwy69e5H8dfo4KI7g9Cvhe0j59CwjUSYRujShP4';
const JSON_FILENAME = 'contract-sheet.json';

const USAGE =
  'Usage: node scripts/export-contract-sheet.mjs [--credentials <path>] [--spreadsheet <url-or-id>]\n' +
  '                                             [--out <dir>] [--tabs <a,b,c>] [--header-row <tab=n>]';

function parseArgs(argv) {
  const opts = {};
  const headerRowArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) fail(`Unexpected argument: ${flag}\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined) fail(`${flag} requires a value.\n${USAGE}`);

    switch (flag) {
      case '--credentials': opts.credentials = value; break;
      case '--spreadsheet': opts.spreadsheet = value; break;
      case '--out': opts.out = value; break;
      case '--tabs': opts.tabs = value; break;
      case '--header-row': headerRowArgs.push(value); break;
      default: fail(`Unknown option: ${flag}\n${USAGE}`);
    }
  }

  const tabsRaw = opts.tabs ?? process.env.CONTRACT_SHEET_TABS;
  const headerRowsRaw = headerRowArgs.length
    ? headerRowArgs.join(',')
    : process.env.CONTRACT_SHEET_HEADER_ROWS;

  return {
    credentialsPath: resolve(
      opts.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'credentials.json',
    ),
    spreadsheetId: resolveSpreadsheetId(
      opts.spreadsheet ?? process.env.CONTRACT_SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    ),
    outDir: resolve(opts.out ?? process.env.CONTRACT_SHEET_OUT_DIR ?? 'sheet-export'),
    tabs: tabsRaw ? tabsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    headerRows: parseHeaderRows(headerRowsRaw),
  };
}

// parseSpreadsheetId throws on a bad value; the CLI owns exit codes, so translate.
function resolveSpreadsheetId(value) {
  try {
    return parseSpreadsheetId(value);
  } catch (err) {
    fail(err.message);
  }
}

// "Sage View=2,Contracts orig=1" -> Map { 'sage view' => 1, 'contracts orig' => 0 }.
// Accepts 1-based row numbers to match what the operator reads off the sheet, and
// stores 0-based indices. Keys are normalized so --header-row matches --tabs.
function parseHeaderRows(raw) {
  const map = new Map();
  if (!raw) return map;

  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const eq = entry.lastIndexOf('=');
    if (eq < 1) fail(`--header-row expects "Tab Name=<row number>", got "${entry}".`);

    const title = entry.slice(0, eq).trim();
    const row = Number(entry.slice(eq + 1).trim());
    if (!Number.isInteger(row) || row < 1) {
      fail(`--header-row for "${title}" must be a row number of 1 or more, got "${entry.slice(eq + 1).trim()}".`);
    }
    map.set(title.toLowerCase(), row - 1);
  }
  return map;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// CSV filenames come from tab titles, so two titles that slugify alike would
// silently overwrite each other. Refuse instead.
function csvFilenames(titles) {
  const byName = new Map();
  for (const title of titles) {
    const name = `${slugify(title) || 'tab'}.csv`;
    if (byName.has(name)) {
      fail(
        `Tabs "${byName.get(name)}" and "${title}" both map to ${name}. ` +
          'Rename one tab, or use --tabs to export them in separate runs.',
      );
    }
    byName.set(name, title);
  }
  return new Map([...byName].map(([name, title]) => [title, name]));
}

async function main() {
  const { credentialsPath, spreadsheetId, outDir, tabs, headerRows } = parseArgs(process.argv.slice(2));

  const auth = await authorize(loadServiceAccountKey(credentialsPath));
  console.log(`Authenticated as ${auth.clientEmail}`);

  const availableTitles = await fetchTabTitles(auth, spreadsheetId);
  if (availableTitles.length === 0) fail(`Workbook ${spreadsheetId} has no tabs.`);

  const { selected, missing } = selectTabs(availableTitles, tabs);
  if (missing.length > 0) {
    fail(
      `No such tab: ${missing.map((t) => `"${t}"`).join(', ')}\n` +
        `Available tabs: ${availableTitles.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  const unusedOverrides = [...headerRows.keys()].filter(
    (k) => !selected.some((t) => t.toLowerCase() === k),
  );
  if (unusedOverrides.length > 0) {
    fail(
      `--header-row names tabs that are not being exported: ${unusedOverrides.join(', ')}\n` +
        `Exporting: ${selected.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  const filenames = csvFilenames(selected);
  const values = await fetchTabValues(auth, spreadsheetId, selected);

  // Serialize everything before writing anything, so a mid-run failure can't
  // leave a stale JSON next to fresh CSVs.
  const tabsOut = {};
  const files = [];
  for (const title of selected) {
    const grid = values[title];
    const override = headerRows.get(title.toLowerCase());
    const { headerRow, headers, rows } = rowsToObjects(grid, override);

    tabsOut[title] = {
      // 1-based to match the row numbers shown in Google Sheets; null when the tab
      // is blank and no header could be found.
      header_row: headerRow < 0 ? null : headerRow + 1,
      header_row_source: override !== undefined ? 'override' : 'detected',
      headers,
      rows,
      // The full sheet including whatever sat above the header. This is the escape
      // hatch when the detected header row is wrong — no data is ever lost to a
      // bad pick, it just has to be re-derived downstream.
      grid,
    };
    files.push({ name: filenames.get(title), body: toCsv(headers, rows) });
  }

  const doc = {
    source: {
      spreadsheet_id: spreadsheetId,
      fetched_at: new Date().toISOString(),
      tabs: selected,
    },
    tabs: tabsOut,
  };
  files.push({ name: JSON_FILENAME, body: JSON.stringify(doc, null, 2) + '\n' });

  // A narrower run (or a different workbook) leaves the previous run's CSVs sitting
  // next to the new JSON, which reads as one coherent export but isn't. Warn rather
  // than delete — these are the operator's files, not ours to remove.
  const written = new Set(files.map((f) => f.name));
  const stale = existsSync(outDir)
    ? readdirSync(outDir).filter((f) => f.endsWith('.csv') && !written.has(f))
    : [];

  mkdirSync(outDir, { recursive: true });
  for (const { name, body } of files) writeFileSync(join(outDir, name), body);

  console.log(`\nWrote ${files.length} files to ${outDir}\n`);
  console.log(`  ${'FILE'.padEnd(30)} ${'HDR'.padEnd(9)} ROWS  COLS  TAB`);
  for (const title of selected) {
    const t = tabsOut[title];
    const hdr = t.header_row === null
      ? 'none'
      : `row ${t.header_row}${t.header_row_source === 'override' ? '*' : ''}`;
    console.log(
      `  ${filenames.get(title).padEnd(30)} ${hdr.padEnd(9)} ` +
        `${String(t.rows.length).padStart(4)}  ${String(t.headers.length).padStart(4)}  ${title}`,
    );
  }
  console.log(`  ${JSON_FILENAME.padEnd(30)} ${''.padEnd(9)} ${String(selected.length).padStart(4)} tabs`);
  console.log('\n  HDR is the detected header row (* = your --header-row override).');
  console.log('  If a row looks wrong, re-run with --header-row "Tab Name=<n>".');

  if (stale.length > 0) {
    console.log(
      `\n  WARNING: ${stale.length} CSV file(s) in ${outDir} are left over from an ` +
        'earlier run and were NOT refreshed:',
    );
    for (const f of stale) console.log(`    ${f}`);
    console.log('  Delete them, or treat contract-sheet.json as the authoritative list.');
  }
}

main().catch((err) => {
  if (err instanceof SheetsError) fail(err.message);
  throw err;
});
