import { describe, it, expect } from 'vitest';
import {
  parseSpreadsheetId,
  selectTabs,
  detectHeaderRow,
  rowsToObjects,
  toCsv,
} from '../scripts/lib/sheet-export.mjs';

describe('parseSpreadsheetId', () => {
  const ID = '1hax9xwy69e5H8dfo4KI7g9Cvhe0j59CwjUSYRujShP4';

  it('extracts the ID from a browser URL with a gid fragment', () => {
    expect(parseSpreadsheetId(
      `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=1917302466#gid=1917302466`,
    )).toBe(ID);
  });

  it('extracts the ID from a bare /edit URL and from one with no trailing path', () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe(ID);
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
  });

  it('extracts the ID from a published /d/e/ URL', () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/e/${ID}/pubhtml`)).toBe(ID);
  });

  it('accepts http and surrounding whitespace', () => {
    expect(parseSpreadsheetId(`  http://docs.google.com/spreadsheets/d/${ID}/edit  `)).toBe(ID);
  });

  it('passes a bare ID through unchanged', () => {
    expect(parseSpreadsheetId(ID)).toBe(ID);
    expect(parseSpreadsheetId('a-b_C123')).toBe('a-b_C123');
  });

  it('rejects a URL that is not a spreadsheet link', () => {
    expect(() => parseSpreadsheetId('https://docs.google.com/document/d/abc/edit'))
      .toThrow(/Could not find a spreadsheet ID/);
  });

  it('rejects a malformed paste that is neither a URL nor an ID', () => {
    expect(() => parseSpreadsheetId('docs.google.com/spreadsheets/d/abc'))
      .toThrow(/neither a Google Sheets URL nor a spreadsheet ID/);
  });

  it('rejects empty input', () => {
    expect(() => parseSpreadsheetId('')).toThrow(/No spreadsheet URL or ID/);
    expect(() => parseSpreadsheetId(undefined)).toThrow(/No spreadsheet URL or ID/);
  });
});

describe('selectTabs', () => {
  const available = ['Contracts', 'Programs', 'Lookup'];

  it('returns every tab in workbook order when nothing is requested', () => {
    expect(selectTabs(available, undefined)).toEqual({ selected: available, missing: [] });
    expect(selectTabs(available, []).selected).toEqual(available);
  });

  it('returns only the requested subset', () => {
    const { selected, missing } = selectTabs(available, ['Lookup', 'Contracts']);
    expect(selected).toEqual(['Lookup', 'Contracts']);
    expect(missing).toEqual([]);
  });

  it('reports unknown tab names alongside the valid ones (AE2)', () => {
    const { selected, missing } = selectTabs(available, ['Contracts', 'Nope']);
    expect(selected).toEqual(['Contracts']);
    expect(missing).toEqual(['Nope']);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const { selected, missing } = selectTabs(available, ['  contracts ', 'PROGRAMS']);
    expect(selected).toEqual(['Contracts', 'Programs']);
    expect(missing).toEqual([]);
  });

  it('does not duplicate a tab requested twice', () => {
    expect(selectTabs(available, ['Contracts', 'contracts']).selected).toEqual(['Contracts']);
  });

  it('returns no selection when every requested tab is unknown', () => {
    const { selected, missing } = selectTabs(available, ['A', 'B']);
    expect(selected).toEqual([]);
    expect(missing).toEqual(['A', 'B']);
  });
});

describe('detectHeaderRow', () => {
  it('picks row 0 when the tab opens straight into its header', () => {
    expect(detectHeaderRow([['A', 'B', 'C'], ['1', '2', '3']])).toBe(0);
  });

  it('skips leading blank rows', () => {
    expect(detectHeaderRow([[], [], ['A', 'B', 'C'], ['1', '2', '3']])).toBe(2);
  });

  it('skips a sparse title banner above the header', () => {
    expect(detectHeaderRow([
      ['Nava Projects and Programs Database'],
      [],
      ['Portfolio', 'Project Name', 'Prime/Sub', 'PoP Start'],
      ['FEDCIV', 'DOE FAFSA', 'Jv W/Focus', '5/04/2025'],
    ])).toBe(2);
  });

  it('skips a partially-filled category row above the header', () => {
    expect(detectHeaderRow([
      ['', 'Nava Projects and Programs Database', '', '', '', '', ''],
      ['', '51', 'Current Projects and Programs'],
      ['', '', '', '', 'OVERVIEW', '', ''],
      ['', 'DelOps', 'Contracts', 'Program Managers'],
      [],
      ['Database code', 'Portfolio', 'Project Name', 'Contract Name', 'Contract Type', 'Prime/Sub', 'Vehicle Org'],
      ['FC006', 'FEDCIV', 'DOE FAFSA', 'DoEd FAFSA', 'FFP', 'Jv W/Focus', 'N/A'],
    ])).toBe(5);
  });

  it('treats whitespace-only cells as empty when measuring density', () => {
    expect(detectHeaderRow([['  ', ' ', ''], ['A', 'B', 'C']])).toBe(1);
  });

  it('returns -1 for an empty or entirely blank tab', () => {
    expect(detectHeaderRow([])).toBe(-1);
    expect(detectHeaderRow(undefined)).toBe(-1);
    expect(detectHeaderRow([[], ['', '']])).toBe(-1);
  });
});

describe('rowsToObjects', () => {
  it('keys each row by the header row (AE5)', () => {
    const { headerRow, headers, rows } = rowsToObjects([
      ['Project', 'Agency', 'Value'],
      ['Alpha', 'CMS', '100'],
    ]);
    expect(headerRow).toBe(0);
    expect(headers).toEqual(['Project', 'Agency', 'Value']);
    expect(rows).toEqual([{ Project: 'Alpha', Agency: 'CMS', Value: '100' }]);
  });

  it('drops banner rows above the detected header', () => {
    const { headerRow, headers, rows } = rowsToObjects([
      ['Annual Report'],
      [],
      ['Project', 'Agency'],
      ['Alpha', 'CMS'],
    ]);
    expect(headerRow).toBe(2);
    expect(headers).toEqual(['Project', 'Agency']);
    expect(rows).toEqual([{ Project: 'Alpha', Agency: 'CMS' }]);
  });

  it('honors an explicit header row over the heuristic', () => {
    const cells = [
      ['Column 1', 'Database project code', 'Portfolio'],
      ['Database project code', 'Database code', 'Portfolio'],
      ['', 'FC026', 'FEDCIV'],
    ];
    expect(rowsToObjects(cells).headerRow).toBe(0);

    const { headerRow, headers, rows } = rowsToObjects(cells, 1);
    expect(headerRow).toBe(1);
    expect(headers).toEqual(['Database project code', 'Database code', 'Portfolio']);
    expect(rows).toEqual([{ 'Database project code': '', 'Database code': 'FC026', Portfolio: 'FEDCIV' }]);
  });

  it('names blank header cells so their column survives', () => {
    // A leading unlabelled column is common in this workbook — "Contracts orig"
    // opens with one. Without a key its data would vanish from both outputs.
    const { headers, rows } = rowsToObjects([
      ['', 'PORTFOLIO', 'PROJECT'],
      ['', 'FEDCIV', 'DOJ CRT'],
    ]);
    expect(headers).toEqual(['column_1', 'PORTFOLIO', 'PROJECT']);
    expect(rows).toEqual([{ column_1: '', PORTFOLIO: 'FEDCIV', PROJECT: 'DOJ CRT' }]);
  });

  it('suffixes duplicate header names so neither column is lost', () => {
    const { headers, rows } = rowsToObjects([['Portfolio', 'Portfolio'], ['a', 'b']]);
    expect(headers).toEqual(['Portfolio', 'Portfolio_2']);
    expect(rows).toEqual([{ Portfolio: 'a', Portfolio_2: 'b' }]);
  });

  it('fills missing trailing columns with empty strings', () => {
    const { rows } = rowsToObjects([['A', 'B', 'C'], ['x', '', '']]);
    expect(rows).toEqual([{ A: 'x', B: '', C: '' }]);
  });

  it('trims whitespace from header names', () => {
    expect(rowsToObjects([[' Project ', 'Agency'], ['a', 'b']]).headers).toEqual(['Project', 'Agency']);
  });

  it('returns an empty row list for a header-only tab', () => {
    expect(rowsToObjects([['A', 'B']])).toEqual({ headerRow: 0, headers: ['A', 'B'], rows: [] });
  });

  it('returns empty headers and rows for an empty tab', () => {
    expect(rowsToObjects([])).toEqual({ headerRow: -1, headers: [], rows: [] });
    expect(rowsToObjects(undefined)).toEqual({ headerRow: -1, headers: [], rows: [] });
  });

  it('coerces non-string cell values to strings', () => {
    const { rows } = rowsToObjects([['N'], [0], [false]]);
    expect(rows).toEqual([{ N: '0' }, { N: 'false' }]);
  });
});

describe('toCsv', () => {
  const parseBack = (csv) => csv.trimEnd().split('\n');

  it('emits a header line plus one line per row, in header order', () => {
    const csv = toCsv(['A', 'B'], [{ B: '2', A: '1' }]);
    expect(parseBack(csv)).toEqual(['A,B', '1,2']);
  });

  it('quotes a value containing a comma (AE7)', () => {
    expect(toCsv(['A'], [{ A: 'x,y' }])).toBe('A\n"x,y"\n');
  });

  it('quotes a value containing a double quote and doubles the inner quote (AE7)', () => {
    expect(toCsv(['A'], [{ A: 'say "hi"' }])).toBe('A\n"say ""hi"""\n');
  });

  it('quotes a value containing a newline and preserves it (AE7)', () => {
    expect(toCsv(['A'], [{ A: 'line1\nline2' }])).toBe('A\n"line1\nline2"\n');
  });

  it('quotes a value containing a carriage return', () => {
    expect(toCsv(['A'], [{ A: 'a\rb' }])).toBe('A\n"a\rb"\n');
  });

  it('quotes a header that itself contains a comma', () => {
    expect(toCsv(['Cost, USD'], [{ 'Cost, USD': '5' }])).toBe('"Cost, USD"\n5\n');
  });

  it('emits an empty field for empty, missing, null, and undefined values', () => {
    expect(toCsv(['A', 'B', 'C'], [{ A: '', B: null, C: undefined }])).toBe('A,B,C\n,,\n');
    expect(toCsv(['A', 'B'], [{ A: 'x' }])).toBe('A,B\nx,\n');
  });

  it('emits the header line alone when there are no rows', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B\n');
  });
});
