// Thin Google Sheets v4 read client
// (docs/plans/2026-08-05-001-feat-sheets-contract-data-export-plan.md, U4).
//
// Deliberately not the `googleapis` SDK: only two endpoints are needed and Node 22
// has global fetch, so the full SDK would be a large dependency for two GETs.
//
// Every failure is mapped to a distinct SheetsError code. The 401-vs-403 split is
// the load-bearing one — "key is bad" and "sheet isn't shared with this account"
// are the two setup mistakes an operator actually makes, and conflating them sends
// them looking in the wrong place.

import { readFileSync } from 'fs';
import { JWT } from 'google-auth-library';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export class SheetsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
  }
}

/**
 * Load and validate a service-account key file.
 *
 * Read before any network call so a missing or malformed file can never be
 * confused with a credential rejection from Google.
 */
export function loadServiceAccountKey(credentialsPath) {
  let raw;
  try {
    raw = readFileSync(credentialsPath, 'utf8');
  } catch {
    throw new SheetsError(
      'credentials-unreadable',
      `Cannot read the service-account key file at ${credentialsPath}.`,
    );
  }

  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new SheetsError(
      'credentials-malformed',
      `${credentialsPath} is not valid JSON. Expected a Google service-account key file.`,
    );
  }

  if (!key.client_email || !key.private_key) {
    throw new SheetsError(
      'credentials-malformed',
      `${credentialsPath} is missing client_email or private_key. ` +
        'Expected a service-account key, not an OAuth client secret.',
    );
  }

  return key;
}

/** Exchange the service-account key for a read-only bearer token. */
export async function authorize(key) {
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [READONLY_SCOPE],
  });

  let token;
  try {
    ({ access_token: token } = await jwt.authorize());
  } catch (err) {
    throw new SheetsError(
      'credentials-rejected',
      `Google rejected the service-account credentials for ${key.client_email}: ${err.message}`,
    );
  }

  if (!token) {
    throw new SheetsError(
      'credentials-rejected',
      `Google returned no access token for ${key.client_email}.`,
    );
  }

  return { token, clientEmail: key.client_email };
}

/** Tab titles in workbook order. */
export async function fetchTabTitles(auth, spreadsheetId) {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const body = await getJson(auth, url, spreadsheetId);
  return (body.sheets ?? []).map((s) => s.properties.title);
}

/** Cell values per tab, as `{ [title]: string[][] }`. */
export async function fetchTabValues(auth, spreadsheetId, titles) {
  if (titles.length === 0) return {};

  // A quoted range with no cell reference means "the whole tab". Single quotes in a
  // tab name are escaped by doubling, per the A1 notation rules.
  const ranges = titles
    .map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`)
    .join('&');
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}&majorDimension=ROWS`;
  const body = await getJson(auth, url, spreadsheetId);

  const out = {};
  (body.valueRanges ?? []).forEach((vr, i) => {
    // Response order matches request order, which is what lets us map back to the
    // requested title — the echoed `range` is normalized and not reliably comparable.
    out[titles[i]] = vr.values ?? [];
  });
  return out;
}

async function getJson(auth, url, spreadsheetId) {
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  } catch (err) {
    throw new SheetsError('network', `Could not reach the Google Sheets API: ${err.message}`);
  }

  if (!res.ok) throw statusError(res.status, await res.text(), auth, spreadsheetId);
  return res.json();
}

function statusError(status, body, auth, spreadsheetId) {
  switch (status) {
    case 401:
      return new SheetsError(
        'credentials-rejected',
        `Google rejected the credentials for ${auth.clientEmail} (HTTP 401).`,
      );
    case 403:
      // Also fires when the Sheets API is disabled on the project, so name both.
      return new SheetsError(
        'no-access',
        `${auth.clientEmail} does not have access to workbook ${spreadsheetId} (HTTP 403).\n` +
          '  Share the sheet with that address (Viewer is enough), and confirm the ' +
          'Google Sheets API is enabled on its GCP project.',
      );
    case 404:
      return new SheetsError(
        'workbook-not-found',
        `No workbook with ID ${spreadsheetId} (HTTP 404). Check the ID in the sheet URL.`,
      );
    default:
      return new SheetsError('api-error', `Google Sheets API returned HTTP ${status}: ${body}`);
  }
}
