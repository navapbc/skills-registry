---
date: 2026-08-05
topic: sheets-contract-data-export
---

# Google Sheets Contract Data Export

## Summary

A locally-runnable CLI script that authenticates to Google Sheets with a service-account key and dumps the "Nava Projects and Programs Database for Sage - CURRENT" workbook to a JSON file — all tabs by default, a selectable subset via flag. Built so the same extraction can later run headless in a scheduled GitHub Action without reworking the auth path.

---

## Problem Frame

Nava's projects and programs database lives in a Google Sheet maintained by hand. A new Contract Explorer page in the skills hub will be populated from that data, but nothing in this repo can read Google Sheets today — every existing data path (`scripts/sync-registry-v2.mjs`, `scripts/sync-ddb.mjs`) pulls from the GitHub API and writes to DynamoDB. Verified: no Google Sheets client, credential handling, or Sheets-aware workflow exists in `scripts/`, `.github/workflows/`, or `package.json` dependencies.

Until the sheet can be read programmatically, any work on the Contract Explorer is blocked on manual CSV exports — which cannot be repeated reliably, cannot be diffed, and go stale the moment the sheet is edited.

A second constraint shapes where the data can go: `navapbc/skills-registry` is a public repository. Contract values, client names, and period-of-performance dates cannot be committed to it.

---

## Actors

- A1. Developer running the extractor locally: invokes the CLI to produce a JSON snapshot for Contract Explorer development.
- A2. Google service account (`contract-explorer@…`): the identity the script authenticates as; the workbook is already shared with it.

---

## Requirements

**Extraction**

- R1. The script reads the "Nava Projects and Programs Database for Sage - CURRENT" workbook and writes its contents to a JSON file on the local filesystem.
- R2. By default, the script dumps every tab in the workbook, keyed by tab name.
- R3. A flag narrows the dump to a caller-specified subset of tabs.
- R4. The output is a faithful representation of the sheet as it exists — no column renaming, filtering, derived fields, or business-rule transformation. Shaping for Contract Explorer happens downstream.
- R5. Each tab's rows are represented as an array of objects keyed by that tab's header row.
- R12. The same run also emits CSV output: one CSV file per exported tab, using the same header row as its column headers. JSON and CSV are produced together, not selected between.

**Authentication and configuration**

- R6. The script authenticates using a Google service-account key file. No interactive browser consent flow.
- R7. The credential file path, the output file path, and the target workbook are each overridable via flag or environment variable, with sensible local defaults.
- R8. The script performs no writes to the workbook — read-only access only.

**Failure behavior**

- R9. When the credential file is missing, unreadable, or rejected by Google, the script exits non-zero with a message naming which of those three occurred.
- R10. When a tab named via the subset flag does not exist in the workbook, the script exits non-zero and lists the tab names that do exist.
- R11. When the service account lacks access to the workbook, the script distinguishes that from a bad-credential failure in its error message.

---

## Acceptance Examples

- AE1. **Covers R2.** Given valid credentials and no tab flag, when the script runs, the output JSON contains an entry for every tab in the workbook.
- AE2. **Covers R3, R10.** Given a tab flag naming one real tab and one nonexistent tab, when the script runs, it exits non-zero, names the missing tab, and writes no output file.
- AE3. **Covers R9.** Given a credential path pointing at a nonexistent file, when the script runs, it exits non-zero with a message identifying the missing credential file — not a generic stack trace.
- AE4. **Covers R11.** Given valid credentials for a service account the workbook is not shared with, when the script runs, the error says the account lacks access to the workbook rather than reporting an auth failure.
- AE5. **Covers R5.** Given a tab whose first row is `Project, Agency, Value`, when the script runs, that tab's entry in the output is an array of objects with `Project`, `Agency`, and `Value` keys.
- AE6. **Covers R12.** Given a workbook with six tabs and no tab flag, when the script runs, the output is one JSON file plus six CSV files.
- AE7. **Covers R12.** Given a cell value containing a comma, a double quote, or a newline, when the CSV is written, that value round-trips intact through a standard CSV reader.

---

## Success Criteria

- A developer with the service-account key can produce a complete JSON snapshot of the workbook in one command, on a clean checkout, without reading the source.
- Spot-checking the JSON against the sheet shows every tab present and row counts matching, and each tab's CSV opens cleanly in a spreadsheet application with the same rows.
- The three predictable setup failures (missing key, unshared sheet, wrong tab name) each produce a message that tells the operator what to fix.
- Moving the extraction into a GitHub Action later requires supplying the credential via a repo secret and changing the output destination — not rewriting how the script authenticates or reads.

---

## Scope Boundaries

- The GitHub Action workflow itself, and any repo-secret or OIDC wiring.
- The Contract Explorer page, its data model, and its API route.
- Loading the data into DynamoDB, S3, or any hosted storage.
- Scheduling, change detection, or diffing against a previous run.
- Automated tests. Validation is by inspection in this scope.
- Reconciling this data against the Confluence Project Index data that `enterprise/project-index-search/SKILL.md` already treats as project source-of-truth. Two overlapping records of Nava project history will exist; deciding which is authoritative is a separate question.
- `.gitignore` and secret-hygiene changes — the user is handling these directly.

---

## Key Decisions

- **Service-account key, not OAuth client credentials**: the OAuth flow requires browser consent and cannot run headless, which would force a rewrite when the Action migration happens. The service account works identically locally and in CI.
- **Faithful dump, not a Contract-Explorer-shaped model**: the page's data model isn't designed yet. Transforming now would bake in guesses; a raw snapshot lets the shaping decision happen once the page requirements are real.
- **All tabs by default, subset by flag**: the workbook's tab inventory hasn't been reviewed, and the Contract Explorer's data needs aren't final. Defaulting to everything avoids re-running the extractor each time a new tab turns out to matter.
- **Output stays local, not committed**: `navapbc/skills-registry` is public. Verified via `gh repo view` — `"isPrivate": false`.
- **JSON and CSV both emitted every run, one CSV per tab**: CSV is single-table by nature and cannot represent a multi-tab workbook in one file. Emitting both unconditionally avoids a format flag and keeps the two views consistent, since both derive from the same header row.

---

## Dependencies / Assumptions

- The workbook is already shared with the `contract-explorer@contract-explorer-504620.iam.gserviceaccount.com` service account (confirmed by the user).
- A service-account key file exists locally. Two candidate untracked files are present at repo root: `credentials.json` and `contract-explorer-504620-4f322db6d3e1.json`. Verified: neither is tracked by git nor present in git history.
- The user is adding both the credential file(s) and the extractor's output path to `.gitignore` before the script produces any output.
- The Google Sheets API is enabled on the `contract-explorer-504620` GCP project (confirmed by the user).
- Every tab intended for export has a usable header row, since rows are keyed by it (R5). Unverified — the sheet could not be read during this brainstorm.
- The workbook's tab count, column structure, and row volume are unknown; the sheet could not be read during this brainstorm.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] What happens to a tab with no usable header row, a header row that isn't row 1, or duplicate header names? Requires reading the workbook to know whether these cases exist.
- [Affects R2][Needs research] Does the workbook contain tabs that are visibly scratch, archival, or formula-only? If so, whether the default should exclude them is worth revisiting once the tab inventory is known.
- [Affects R4][Technical] How should merged cells, formulas, and empty trailing rows be represented in the dump?
