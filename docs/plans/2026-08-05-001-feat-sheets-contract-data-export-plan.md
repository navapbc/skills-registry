---
title: "feat: Google Sheets contract data export CLI"
type: feat
status: active
date: 2026-08-05
origin: docs/brainstorms/2026-08-05-sheets-contract-data-export-requirements.md
---

# feat: Google Sheets contract data export CLI

## Summary

Add a locally-runnable Node CLI script that authenticates to Google Sheets with a service-account key, reads the Nava projects/programs workbook via the Sheets v4 REST API, and writes both a single JSON file (all tabs, rows keyed by header row) and one CSV per tab. Pure transformation logic lives in `scripts/lib/` and is unit-tested; the network and auth path is validated by running it.

---

## Problem Frame

Nothing in this repo can read Google Sheets today — every existing data path pulls from the GitHub API and writes to DynamoDB. Contract Explorer work is blocked on manual CSV exports that cannot be repeated or diffed. Full context in the origin document.

---

## Requirements

- R1. Read the target workbook and write its contents to a JSON file on the local filesystem.
- R2. Dump every tab by default, keyed by tab name.
- R3. A flag narrows the dump to a caller-specified subset of tabs.
- R4. Output is a faithful representation of the sheet — no renaming, filtering, or derived fields.
- R5. Each tab's rows are an array of objects keyed by that tab's header row.
- R6. Authenticate using a Google service-account key file; no interactive consent flow.
- R7. Credential path, output path, and workbook ID are each overridable via flag or environment variable, with local defaults.
- R8. Read-only access to the workbook.
- R9. Missing, unreadable, or rejected credentials exit non-zero, naming which of the three occurred.
- R10. A `--tabs` value naming a nonexistent tab exits non-zero and lists the tabs that do exist.
- R11. Lack of workbook access is reported distinctly from a bad-credential failure.
- R12. The same run also emits one CSV per exported tab, using the same header row as column headers.

**Origin actors:** A1 (developer running the extractor locally), A2 (`contract-explorer@…` service account)
**Origin acceptance examples:** AE1 (R2), AE2 (R3, R10), AE3 (R9), AE4 (R11), AE5 (R5), AE6 (R12), AE7 (R12)

---

## Scope Boundaries

- No GitHub Action workflow, repo-secret, or OIDC wiring.
- No Contract Explorer page, data model, or API route.
- No DynamoDB, S3, or hosted storage write path.
- No scheduling, change detection, or diffing against prior runs.
- No `.gitignore` or secret-hygiene changes — handled directly by the user.
- No retry, backoff, or rate-limit handling. One operator, one workbook, on-demand runs.
- No type coercion of cell values beyond what the Sheets API returns.
- No XLSX output.
- No `package.json` script alias.
- No tests for the auth or HTTP path.

---

## Context & Research

### Relevant Code and Patterns

- `scripts/verify-category-tags-ddb.mjs` — the closest structural analogue and the pattern to mirror: docblock usage header with example invocations, manual `process.argv.slice(2)` parsing with no arg-parsing dependency, explicit `console.error` + `process.exit(1)` on bad usage, pure logic delegated to a `scripts/lib/` module.
- `scripts/lib/verify-category-tags.mjs` — the extraction convention for pure, testable logic imported by a CLI script.
- `tests/verify-category-tags.test.mjs` — the matching test-file convention.
- `scripts/utils.mjs` — small pure helpers (`slugify` is directly reusable for CSV filenames).

### Institutional Learnings

- `docs/solutions/` does not exist in this repo; no prior learnings apply. Adjacent architecture notes live in `docs/ARCHITECTURE.md` and describe only the GitHub → DynamoDB path.

### External References

- Google Sheets API v4: `GET /v4/spreadsheets/{id}` returns `sheets[].properties.title` for tab discovery; `GET /v4/spreadsheets/{id}/values:batchGet?ranges=...` returns per-range `values` as a 2D array. Scope `https://www.googleapis.com/auth/spreadsheets.readonly`.
- `google-auth-library` `JWT` class handles the service-account signed-assertion exchange and yields a bearer token.

---

## Key Technical Decisions

- **`google-auth-library` alone, not the `googleapis` SDK**: only two HTTP endpoints are needed and Node 22 has global `fetch`. Verified: neither package is in `pnpm-lock.yaml` today, so this is a net-new dependency either way — the smaller one is the right default for this repo.
- **Root `devDependencies`, installed with pnpm**: this is developer tooling, not Lambda runtime code. It does not belong in `functions/api/`.
- **Two API calls, metadata first**: resolving tab names before fetching values is what makes fail-fast `--tabs` validation possible (AE2) and supplies the "tabs that do exist" list for R10.
- **All files written after every fetch succeeds**: a mid-run failure leaves no partial output in either format. With both a JSON and N CSVs to emit, a streaming write would make partial-output states routine.
- **Both formats always emitted, one CSV per tab**: CSV is single-table and cannot hold a multi-tab workbook. Emitting both unconditionally removes a format flag and keeps the two views consistent, since they derive from the same header row (see origin: `docs/brainstorms/2026-08-05-sheets-contract-data-export-requirements.md`).
- **Pure logic tested, network path not**: partially overrides the origin doc's "no automated tests." Header-row keying, tab validation, and CSV escaping are pure functions matching the repo's existing `scripts/lib/` + `tests/` convention; CSV escaping in particular fails silently and is exactly what a unit test catches. Auth and HTTP remain untested and are validated by the operator running the script.
- **Provenance in JSON only**: the JSON gets workbook ID, fetch timestamp, and tab list. A provenance row in a CSV would corrupt the table.

---

## Open Questions

### Resolved During Planning

- Which HTTP client: global `fetch` on Node 22 (`mise.toml` pins node 22; `node -v` confirms v22.16.0). No client dependency needed.
- Where the pure logic lives: `scripts/lib/`, following `scripts/lib/verify-category-tags.mjs`.
- Whether new lib files affect coverage thresholds: no. `vitest.config.mjs` scopes `coverage.include` to `scripts/utils.mjs`, `src/lib/**`, and `functions/api/**` — `scripts/lib/**` is outside it, so the 80/80/70 thresholds are unaffected.

### Deferred to Implementation

- Behavior for a tab with no usable header row, a header row that is not row 1, or duplicate header names — depends on what the workbook actually contains, which cannot be seen until the script runs. Carried from origin Outstanding Questions.
- Whether any tabs are scratch/archival/formula-only and should be excluded from the default — decide after the first successful run reveals the tab inventory.
- Representation of merged cells, formulas, and empty trailing rows.
- Exact JSON envelope field names for the provenance block.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
CLI (scripts/export-sheet.mjs)
  parse argv / env  →  { credentialsPath, spreadsheetId, outDir, tabs? }
        │
        ├─ auth:      service-account key file → JWT → bearer token
        │
        ├─ call 1:    spreadsheets.get           → [tab titles]
        │                   │
        │                   └─ selectTabs(allTitles, requestedTabs)
        │                        └─ unknown name → exit(1) + list available
        │
        ├─ call 2:    values.batchGet(ranges)    → { tab → 2D cell array }
        │
        ├─ shape:     rowsToObjects(cells)       → [{ header: value }, …]   (pure)
        │
        └─ write (all-or-nothing):
              out/<workbook>.json    { meta: {…}, tabs: { name → rows } }
              out/<tab-slug>.csv     × N          (pure serializer)
```

Failure-mode routing, which R9–R11 depend on:

| Condition | Detected at | Exit message names |
|---|---|---|
| Key file absent / unparseable | before any network call | the credential path |
| Token exchange rejected | auth step | invalid credentials |
| HTTP 403 on `spreadsheets.get` | call 1 | service account lacks access to the workbook |
| HTTP 404 on `spreadsheets.get` | call 1 | workbook ID not found |
| `--tabs` name not in metadata | after call 1 | the missing tab + the available tabs |

---

## Implementation Units

- U1. **Add the auth dependency**

**Goal:** Make service-account JWT auth available to the script.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Approach:**
- Add `google-auth-library` to root `devDependencies` and install with pnpm so the lockfile updates.
- No `googleapis` SDK — see Key Technical Decisions.

**Patterns to follow:**
- Existing root `devDependencies` in `package.json` (`@octokit/rest` is the analogous API-client entry).

**Test scenarios:**
- Test expectation: none — dependency addition, no behavioral change.

**Verification:**
- `google-auth-library` resolves from a fresh `pnpm install --frozen-lockfile`.

---

- U2. **Pure tab selection and row shaping**

**Goal:** Implement and test the two pure transformations the CLI depends on — validating a requested tab subset against the workbook's actual tabs, and converting a 2D cell array into header-keyed objects.

**Requirements:** R2, R3, R5, R10

**Dependencies:** None

**Files:**
- Create: `scripts/lib/sheet-export.mjs`
- Create: `tests/sheet-export.test.mjs`

**Approach:**
- `selectTabs(availableTitles, requestedTitles)` — with no request, returns all titles in workbook order; with a request, returns the matching subset or reports which requested names are unknown. It reports rather than exits, so the CLI owns process control and the function stays testable.
- `rowsToObjects(cells)` — first row is the header, each subsequent row becomes an object keyed by it. Rows shorter than the header get empty-string values for the missing trailing columns, which is how the Sheets API represents trailing blanks.
- Keep both functions free of I/O and `process` access.

**Patterns to follow:**
- `scripts/lib/verify-category-tags.mjs` — pure, side-effect-free, imported by a CLI script, unit-tested in `tests/`.

**Test scenarios:**
- Happy path — `selectTabs` with no request returns every title in workbook order.
- Happy path — `selectTabs` with a valid subset returns only those tabs.
- Error path — Covers AE2. `selectTabs` with one valid and one unknown name reports the unknown name and surfaces the available titles.
- Edge case — `selectTabs` request differing only in case or surrounding whitespace: assert whichever matching rule is chosen, so the behavior is pinned rather than accidental.
- Happy path — Covers AE5. `rowsToObjects` on `[['Project','Agency','Value'],['A','B','C']]` yields one object with those three keys.
- Edge case — a row shorter than the header row yields empty strings for the missing trailing columns.
- Edge case — a cell array with only a header row yields an empty array, not an error.
- Edge case — an entirely empty cell array yields an empty array.

**Verification:**
- `pnpm test` passes with the new test file included; no existing coverage threshold regresses.

---

- U3. **CSV serializer**

**Goal:** Convert header-keyed rows into RFC 4180 CSV text that survives a round trip.

**Requirements:** R12

**Dependencies:** U2

**Files:**
- Modify: `scripts/lib/sheet-export.mjs`
- Modify: `tests/sheet-export.test.mjs`

**Approach:**
- `toCsv(headers, rows)` returns a string: header line followed by one line per row.
- Quote any field containing a comma, double quote, newline, or carriage return; escape embedded double quotes by doubling them. Fields needing no quoting are emitted bare.
- Column order comes from the same header array that keys the JSON objects, so the two outputs cannot drift.
- No CSV dependency — the escaping rule is a few lines and a dependency would exceed the need.

**Patterns to follow:**
- Same pure-module convention as U2.

**Test scenarios:**
- Happy path — plain values produce a header line plus one line per row, in header order.
- Edge case — Covers AE7. A value containing a comma is quoted.
- Edge case — Covers AE7. A value containing a double quote is quoted with the inner quote doubled.
- Edge case — Covers AE7. A value containing a newline is quoted and the newline is preserved inside the quotes.
- Edge case — an empty-string value emits an empty field, not the literal `undefined` or `null`.
- Edge case — a row missing a key present in the headers emits an empty field in that column.
- Edge case — zero rows emits the header line alone.

**Verification:**
- Serialized output for a value containing all three special characters parses back to the original value through a standard CSV reader.

---

- U4. **Sheets API client**

**Goal:** Authenticate as the service account and fetch workbook metadata and cell values, with each failure mode surfaced distinctly.

**Requirements:** R1, R6, R8, R9, R11

**Dependencies:** U1

**Files:**
- Create: `scripts/lib/sheets-client.mjs`

**Approach:**
- Read and parse the service-account key file; a missing or unparseable file is reported before any network call so it can never be confused with an auth rejection.
- Build a `JWT` from the key with the read-only Sheets scope and obtain a bearer token. Read-only scope is what enforces R8 — no write path exists to guard.
- `fetchTabTitles(spreadsheetId)` calls `spreadsheets.get` and returns the tab titles. `fetchTabValues(spreadsheetId, titles)` calls `values:batchGet` and returns each tab's 2D cell array.
- Map HTTP status to a distinguishable error: 401 → credentials rejected, 403 → service account lacks workbook access, 404 → workbook ID not found. This mapping is what R9 and R11 turn on, and conflating 401 with 403 is the specific failure to avoid — an unshared sheet is the most likely real-world setup error.
- Throw typed errors; the CLI decides exit codes and message formatting.

**Patterns to follow:**
- `scripts/verify-category-tags-ddb.mjs` uses the AWS SDK directly with no wrapper abstraction — keep this module equally thin.

**Test scenarios:**
- Test expectation: none — network and auth path, validated by running the script per the origin doc's inspection-based success criteria. The pure status-to-error mapping may be extracted and tested if it grows beyond a small lookup.

**Verification:**
- Against the real workbook, the module returns the tab titles and non-empty cell arrays.
- Pointing at a nonexistent credential path, a malformed key file, and a workbook the account cannot access each produce three visibly different errors.

---

- U5. **CLI entrypoint**

**Goal:** Wire argument parsing, the client, the transforms, and all-or-nothing file output into one runnable command.

**Requirements:** R1, R2, R3, R4, R5, R7, R9, R10, R11, R12

**Dependencies:** U2, U3, U4

**Files:**
- Create: `scripts/export-sheet.mjs`

**Approach:**
- Docblock header at the top of the file with purpose, prerequisites (service-account key, workbook shared with the account), and example invocations — matching `scripts/verify-category-tags-ddb.mjs`.
- Parse `process.argv.slice(2)` manually: credential path, workbook ID, output directory, and optional `--tabs` (comma-separated). Each falls back to an environment variable, then to a local default. No arg-parsing dependency.
- Sequence: parse args → authenticate → fetch tab titles → `selectTabs` (exit non-zero with the available list if any requested tab is unknown) → fetch values → `rowsToObjects` per tab → build the JSON envelope with provenance → `toCsv` per tab → write everything.
- Hold all serialized output in memory and write only after every fetch and transform succeeds, so a failure mid-run leaves no partial JSON and no orphan CSVs.
- CSV filenames derive from tab titles via `slugify` from `scripts/utils.mjs`. If two tab titles slugify to the same name, fail rather than silently overwriting.
- Create the output directory if absent. Print a summary line per file written.

**Patterns to follow:**
- `scripts/verify-category-tags-ddb.mjs` — docblock usage header, manual argv parsing, `console.error` + `process.exit(1)` on bad usage, `__dirname`/`ROOT` resolution via `fileURLToPath`.
- `scripts/utils.mjs` — `slugify`.

**Test scenarios:**
- Test expectation: none automated — this unit is I/O orchestration over already-tested pure logic. Validated by the manual scenarios below, which correspond to the origin acceptance examples.

**Verification:**
- Covers AE1. A run with no `--tabs` produces a JSON file containing an entry for every tab in the workbook.
- Covers AE6. The same run produces one CSV per exported tab alongside the JSON.
- Covers AE2. A run naming one real and one nonexistent tab exits non-zero, names the missing tab, lists the available tabs, and leaves no output files behind.
- Covers AE3. A run with a credential path pointing at a nonexistent file exits non-zero with a message identifying the missing credential file — not a stack trace.
- Covers AE4. A run with credentials for an account the workbook is not shared with reports lack of workbook access, distinct from an auth failure.
- Covers AE5. Spot-checking a tab in the JSON shows objects keyed by that tab's header row.
- Covers AE7. A CSV cell containing a comma, quote, or newline opens correctly in a spreadsheet application.
- Row counts in both JSON and CSV match the sheet for at least one spot-checked tab.

---

## System-Wide Impact

- **Interaction graph:** None. New standalone script; no existing module imports it and it writes to no shared store. `scripts/utils.mjs` gains a consumer but no change.
- **Error propagation:** Typed errors thrown by `scripts/lib/sheets-client.mjs`, caught and formatted at the CLI boundary, which owns all exit codes.
- **State lifecycle risks:** Partial-output risk is the only one, addressed by deferring all writes until after every fetch succeeds.
- **API surface parity:** None — no other interface exports this data.
- **Integration coverage:** The auth and HTTP path has no automated coverage by design. The U5 verification list is the substitute and must actually be run before this is considered done.
- **Unchanged invariants:** No change to the GitHub → DynamoDB sync path, the Astro build, the Lambdas, or Terraform. `vitest.config.mjs` coverage thresholds are unaffected — `scripts/lib/**` sits outside `coverage.include`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Credential file or exported data accidentally committed to this public repo | User is adding `credentials.json`, `contract-explorer-504620-4f322db6d3e1.json`, and the output directory to `.gitignore` before the script runs. Verified none are currently tracked or in git history. Default output path should sit under a single directory that is easy to ignore as one entry. |
| Tabs lacking a clean header row break `rowsToObjects` in ways the tests do not anticipate | Deferred to implementation by design — the workbook could not be read at plan time. First real run is the discovery step; adjust the shaping rule then. |
| Two tab titles slugify to the same CSV filename, silently overwriting one | U5 fails explicitly on collision rather than overwriting. |
| Large workbook exceeds a single `values:batchGet` response | Unverified — row volume is unknown. If the first run truncates or errors, chunk the ranges. Not designed for up front. |
| Adding a Google dependency to a repo with no prior Google surface | Single small package in `devDependencies`; no runtime or Lambda impact. |

---

## Documentation / Operational Notes

- The script's docblock header is the primary documentation — it must state that the workbook has to be shared with the service-account email and that the Sheets API must be enabled on the GCP project.
- No README update in this scope. Worth adding when the extraction moves into a GitHub Action, which is where a second operator first encounters it.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-05-sheets-contract-data-export-requirements.md](docs/brainstorms/2026-08-05-sheets-contract-data-export-requirements.md)
- Pattern reference: `scripts/verify-category-tags-ddb.mjs`, `scripts/lib/verify-category-tags.mjs`, `tests/verify-category-tags.test.mjs`
- Shared helper: `scripts/utils.mjs` (`slugify`)
- Test config: `vitest.config.mjs`
