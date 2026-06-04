---
name: confluence-editor
description: >
  Safely edits Confluence pages using targeted, reviewable changes instead of
  full-page replacements. Triggered when you say things like "update the
  Confluence page", "add a section to the wiki", "fix this doc in
  Confluence", or paste a Confluence URL and describe what to change. It
  fetches the page in native ADF format, applies precise mutations (replace
  text, add/delete sections, update table rows), renders a human-readable
  diff in the chat for your review, then pushes the update only after you
  approve.
version: "1.0"
author: loren@navapbc.com
author_name: Loren Yu
team: TS&S
sensitive_data: false
problem: Editing Confluence via AI is risky without this skill — the default updateConfluencePage tool replaces the entire page body in one shot with no visibility into what changed, making it easy to accidentally clobber content, wipe formatting, or lose macros. This skill makes all edits as targeted operations on the ADF tree and shows a readable diff before anything goes live, preventing accidental content loss. It is also a lot more token efficient than the updateConfluencePage tool since the updateConfluencePage requires the LLM to regenerate the entire Confluence page as tokens, which is very wasteful. Token efficiency also translates to performance as well. This skill is much faster than using the updateConfluencePage tool for large Confluence pages.
estimated_impact: Saves ~15–30 min per Confluence edit
usage_frequency: A few times per week
expected_audience: 16+ people
impact_type: [Time saved per use, Reduced error rate or rework, Cost avoidance (fewer tools, vendor hours, etc.)]
compatibility: [claude-cowork, claude-code]
tags: [confluence, wiki-editing, document-editing]
data_sources: Atlassian Confluence (via Atlassian MCP connector)
---

# Confluence Editor

A safe, reviewable workflow for editing Confluence pages. Instead of replacing an entire page in one shot (which is error-prone and hard to review), this skill fetches the page in ADF format, applies targeted mutations directly to the JSON tree, and shows clean human-readable diffs — all while preserving every macro, panel, status label, and piece of formatting.

## Why this exists

The Atlassian MCP's `updateConfluencePage` tool replaces the entire page body. This creates two problems:

1. **No visibility** — it's hard to see what actually changed
2. **Accidental damage** — easy to clobber content unintentionally

This skill solves both by making all changes as targeted operations on the ADF tree. Only the specific nodes that need changing are touched; everything else is preserved exactly as-is.

## Architecture: ADF as source of truth, readable view for humans

The skill uses **ADF (Atlassian Document Format)** — Confluence's native JSON format — as the source of truth. ADF preserves everything: macros, panels, status labels, mentions, layouts, tables with merged cells, etc.

Since raw ADF JSON is hard for humans to review, the skill includes a **one-way renderer** that converts ADF to a clean, annotated readable format for display and diffing. This readable format is *never* converted back to ADF — it exists purely for human review.

**What the readable view looks like:**
```
# Project Status

The target launch date is March 15, 2026.

[STATUS: color=green, text="On Track"]

[EXPAND: title="Background Details"]
  This project was initiated in Q1 to modernize the billing pipeline.
  The team consists of 5 engineers across two squads.
[/EXPAND]

[MACRO: key="jira"]

| Name    | Role         |
|---------|--------------|
| Alice   | Tech Lead    |
| Bob     | Frontend Eng |

- [ ] Review the architecture doc
- [x] Set up CI pipeline
```

Macros and complex elements appear as `[TAG: attrs]...[/TAG]` blocks. Tables render as markdown-style grids with annotations for merged cells or colored backgrounds. The text content of every element is visible and diffable.

## Transport: direct API for both reads and writes

**The rule: every fetch and every push goes through `scripts/confluence_api.py`. No exceptions for "small" pages, "one-off" edits, or any other heuristic.**

Why: both the MCP `getConfluencePage` and `updateConfluencePage` tools force the agent to move the ADF body through its own context. On the push side, you (the model) emit the entire ADF body as a tool-call parameter. On the fetch side, the response body lands inline in context and then has to be re-emitted via `Write` to persist it to disk. Either direction, a 10KB page burns thousands of output tokens transcribing JSON character-by-character. The direct API reads from / writes to disk — you only emit a short shell command. So the workflow that uses the MCP for I/O is pathologically slow on both ends.

| Operation | Default transport | Notes |
|-----------|-------------------|-------|
| **Fetch (always)** | **`confluence_api.py fetch`** | Writes ADF straight to disk; agent only sees the small JSON summary |
| **Push (always)** | **`confluence_api.py push`** | Reads body from disk; agent emits a short shell command, not the body |

If you find yourself about to call `mcp__claude_ai_Atlassian__getConfluencePage` or `mcp__claude_ai_Atlassian__updateConfluencePage`, stop. Switch to `confluence_api.py` instead. The only acceptable reason to fall back to the MCP tools is if `confluence_api.py` raises `AuthError` — see "Auth fallback" below.

### Using confluence_api.py

```bash
# Fetch ADF body to disk
python3 scripts/confluence_api.py fetch <page_id> --out /tmp/confluence-edit-<page_id>.json
# Writes the file at --out, prints {body_path, version, title, space_id}

# Mutate the file on disk (use adf_mutator.py functions, same as always)

# Push back (version = current + 1)
python3 scripts/confluence_api.py push <page_id> /tmp/confluence-edit-<page_id>.json \
  --title "Page Title" --version 12 --message "Update launch date"
```

Or import from Python for batch work:

```python
from confluence_api import fetch_page, push_page, AuthError
```

### Auth fallback

Before committing to the direct-API path, test auth with a cheap GET (e.g. `fetch_page` against any known page, or a small `GET /pages/{id}` via curl). If you hit HTTP 401/403, the stored token is stale — `confluence_api.py` raises `AuthError`. When that happens:

1. Fall back to MCP for this session (don't block the user's task on a credential refresh).
2. At the end of the task, include this note in your final response — phrased as a note, not a blocker:

   > The Confluence API token at `~/.config/claude-skills/api-caller/apis/confluence/.env` is expired — refresh at https://id.atlassian.com/manage/api-tokens for faster edits next time.

## Core Workflow

### Step 1: Fetch the page in ADF

Fetch the page via the direct API:

```bash
python3 scripts/confluence_api.py fetch <pageId> --out /tmp/confluence-edit-<pageId>.json
```

This writes the ADF body to the `--out` path and prints a small JSON summary (`body_path`, `version`, `title`, `space_id`) to stdout. Note the title and version — you'll need them for the push. Also save a pristine copy to `/tmp/confluence-edit-{pageId}-original.json` so the diff step (Step 4) has something to compare against:

```bash
cp /tmp/confluence-edit-<pageId>.json /tmp/confluence-edit-<pageId>-original.json
```

**Do not call `mcp__claude_ai_Atlassian__getConfluencePage` here.** It works, but forces the entire ADF body through your context just so you can `Write` it to disk — the same output-budget problem that makes MCP push pathologically slow, on the fetch side. The only time MCP fetch is acceptable is when `confluence_api.py` raises `AuthError` and you've already decided to fall back per the "Auth fallback" section above.

**Sanity-check the fetched body before mutating.** Also fetch the page with `contentFormat: "markdown"` (the MCP `getConfluencePage` tool is fine for this — markdown is small and lands inline) and skim it — count the top-level sections/headings and confirm the ADF you saved has a comparable number of content nodes. If the ADF looks much shorter than the markdown, STOP and report rather than risking a destructive push. This catches both truncation bugs and transcription errors when the fetched response has to be piped through intermediate files.

If the user provides a Confluence URL instead of a page ID, extract the page ID from it. Confluence URLs typically look like `https://{site}.atlassian.net/wiki/spaces/{SPACE}/pages/{pageId}/{title}`.

### Step 2: Show the user the current page

Run the renderer to convert ADF to the readable format:

```bash
python /path/to/skill/scripts/adf_renderer.py /tmp/confluence-edit-{pageId}.json
```

Show the user the readable view so they can see what's currently on the page. If they haven't already told you exactly what to change, this helps them identify what needs editing.

### Step 3: Apply targeted mutations

Use the Python functions from `scripts/adf_mutator.py` to modify the ADF tree. Import and call them directly from a short Python script — they operate on the ADF JSON in-place and preserve all surrounding structure.

The module is organized into three composable layers. **New use cases should compose primitives rather than add new functions** — if you can't express what you need with the primitives below, that's a signal to extend a primitive (or add a new inline builder), not to write a bespoke walker.

#### Layer 1: Locators (read-only, return stable references)

Walk the tree and return `TextMatch` or `NodeRef` records that stay valid across in-place mutations.

| Function | Returns | Use case |
|----------|---------|----------|
| `find_text(adf, substring)` | `list[TextMatch]` | All single-node hits for a substring |
| `find_text_unique(adf, substring)` | `TextMatch` | Exactly-one match; raises if 0 or >1 (safer than `[0]`) |
| `find_node(adf, predicate)` | `list[NodeRef]` | Generic walker — `predicate(node) -> bool` |
| `find_paragraph_containing(adf, substring)` | `list[NodeRef]` | Paragraphs whose joined inline text matches; use when a phrase spans a mark boundary |

`TextMatch` carries `(node, parent, index, start, end)`; `NodeRef` carries `(node, parent, index)`. The `parent` + `index` fields are what lets mutators splice safely.

**Known limit:** `find_text` only matches within a single text node. If a phrase straddles mark boundaries (e.g. `"Hello **world**"`), use `find_paragraph_containing` and operate at paragraph granularity.

#### Layer 2: Builders (pure constructors — no tree knowledge)

**Inline** (short names, compose cleanly inside mutator calls):
- `text(s, marks=None)` — plain text node
- `link(s, href)` — text node with a link mark
- `bold(s)`, `italic(s)`, `code(s)` — marked text nodes
- `mention(account_id, display_name)` — mention node

**Block:**
- `make_heading(text_or_nodes, level=2)`
- `make_paragraph(text_or_nodes)` — accepts a string OR a list of inline nodes
- `make_bullet_list(items)` / `make_ordered_list(items)` — each item may be a string or inline-node list
- `make_status(label, color="neutral")`

#### Layer 3: Generic mutators (take a location + an operation)

| Function | Accepts | Behavior |
|----------|---------|----------|
| `replace_text_range(match, new_nodes)` | `TextMatch` | Replaces [start, end) of the text node with `new_nodes`; splits the node and preserves marks on surviving fragments |
| `insert_before(loc, new_nodes)` | `TextMatch` or `NodeRef` | Inline split + splice, or block-level splice at `index` |
| `insert_after(loc, new_nodes)` | `TextMatch` or `NodeRef` | Same, at the end of the range / after `index` |
| `delete_at(loc)` | `TextMatch` or `NodeRef` | Removes the char range or the whole node |
| `update_attrs_at(ref, new_attrs)` | `NodeRef` | Merges `new_attrs` into the node's `attrs` |

Note: the generic mutators do **not** take `adf` as an argument — the location carries everything they need.

#### Domain wrappers (shortcuts over the primitives)

These cover the common whole-section and table cases ergonomically. Prefer a wrapper when one fits; reach for the primitives when it doesn't.

| Function | Use case |
|----------|----------|
| `replace_text(adf, old, new)` | Change plain text in place (preserves marks). For replacements that introduce links/mentions/marks, use `find_text_unique` + `replace_text_range`. |
| `insert_after_heading(adf, heading, nodes)` | Insert at the top of a section |
| `append_to_section(adf, heading, nodes)` | Insert at the end of a section |
| `insert_section_before(adf, before_heading, nodes)` | Insert a new section (heading + content) |
| `delete_section(adf, heading_text)` | Remove a heading and all content until the next same-level heading |
| `update_node_attrs(adf, type, match, new_attrs)` | Update attrs on all matching nodes (e.g. status color) |
| `add_table_row(adf, after_text, cells)` | Insert a row after a row matching `after_text`; cells may be strings or inline-node lists |
| `delete_table_row(adf, match_text)` | Delete a row whose text contains `match_text` |
| `set_page_property(adf, label, value_nodes)` | Set/update a row in the first Page Properties macro (`bodiedExtension` with `extensionKey="details"`). Returns `"updated"`, `"added"`, or `None` if no macro exists. |
| `get_page_property(adf, label)` | Return the value cell's inline content for `label` in the first Page Properties macro, or `None` if missing. |
| `delete_page_property(adf, label)` | Delete a row from the first Page Properties macro. Returns `True`/`False`. |

#### Examples

**Insert an inline link after a phrase (the motivating compose-from-primitives case):**
```python
from adf_mutator import find_text_unique, insert_after, text, link

loc = find_text_unique(adf, "TSS Tech Specs GDrive folder")
insert_after(loc, [
    text(", using the "),
    link("ADR template", "https://example.com/adr-template"),
])
```

**Add a new "Risks" section before "Notes" (wrapper fits cleanly):**
```python
from adf_mutator import insert_section_before, make_heading, make_bullet_list

insert_section_before(adf, "Notes", [
    make_heading("Risks", level=2),
    make_bullet_list([
        "Budget constraints may delay Phase 2",
        "Vendor dependency introduces single point of failure",
    ]),
])
```

**Replace plain text while preserving its marks:**
```python
from adf_mutator import replace_text

replace_text(adf, "March 15, 2026", "April 1, 2026")
```

**Swap a phrase for a mention + text (primitives):**
```python
from adf_mutator import find_text_unique, replace_text_range, mention, text

loc = find_text_unique(adf, "the owner")
replace_text_range(loc, [mention("abc123", "Loren"), text(" (owner)")])
```

#### Important principles

- Make the smallest mutation that accomplishes the goal. Don't restructure content unnecessarily.
- Apply each logical change as its own primitive/wrapper call so the diff is independently traceable.
- If a locator returns zero matches (or an unexpected count), stop — show the readable view and ask which part the user means. Never guess.
- Never add content the user didn't ask for.
- If you find yourself writing a Python loop that walks `adf["content"]` by hand, stop and use `find_node` with a predicate instead.

#### Regression tests

`scripts/test_adf_mutator.py` is the regression suite for the mutator module — 50+ tests covering finders, builders, generic mutators, text-node splitting, mark preservation, unicode, and the motivating inline-link insert case. Run it after any change to `adf_mutator.py`:

```bash
python3 skills/confluence-editor/scripts/test_adf_mutator.py
```

### Step 4: Generate and show the diff

After all mutations are applied, render both the original and modified ADF to readable format, then diff them. Save the diff to a file so you can include it in your response:

```python
from adf_renderer import render_adf
import json, difflib

original = json.loads(open("/tmp/confluence-edit-{pageId}-original.json").read())
modified = json.loads(open("/tmp/confluence-edit-{pageId}.json").read())

before = render_adf(original)
after = render_adf(modified)

diff = difflib.unified_diff(
    before.splitlines(keepends=True),
    after.splitlines(keepends=True),
    fromfile="Before (current page)",
    tofile="After (proposed changes)",
    n=3
)
diff_text = "".join(diff)
print(diff_text)
open("/tmp/confluence-diff-{pageId}.txt", "w").write(diff_text)
```

Alternatively, use the convenience script:
```bash
python /path/to/skill/scripts/confluence_diff.py \
  --before-adf /tmp/confluence-edit-{pageId}-original.json \
  --after-adf /tmp/confluence-edit-{pageId}.json
```

**Displaying the diff — this is the most important part of the whole workflow.** The diff is the user's only chance to review changes before they go live. Tool and bash output is collapsed behind an accordion in many chat UIs (including Cowork), so the user will likely never see it if it only appears there. You must re-display the diff directly in your conversation response as a fenced ` ```diff ` code block. Read the diff back from the tool output or saved file, and include it verbatim in your message text.

For each page being edited, show a header with the page title, followed by the diff. Here's what the user should see in your message:

> **Project Status** (page 12345):
> ```diff
> --- Before (current page)
> +++ After (proposed changes)
> @@ -3,4 +3,4 @@
> -The target launch date is March 15, 2026.
> +The target launch date is April 1, 2026.
> ```
>
> Shall I push this to Confluence?

Do not just say "here's the diff" and leave it buried inside a tool call. The actual diff content needs to be visible in the conversation without clicking or expanding anything. This is the whole point of the skill — reviewable changes.

### Step 5: Push to Confluence

Once the user approves (or in auto-approve mode, immediately after showing the diff), push via the direct API:

```bash
python3 scripts/confluence_api.py push \
  <pageId> /tmp/confluence-edit-<pageId>.json \
  --title "<Page Title>" \
  --version <current_version + 1> \
  --message "<brief description of what changed>"
```

This reads the body from disk, so you don't have to emit ~10KB of JSON as a tool argument — the call is just a short shell command. Always include a descriptive `--message`.

**Do not call `mcp__claude_ai_Atlassian__updateConfluencePage` here.** It works, but burns minutes of output time transcribing the body. The only time MCP push is acceptable is when `confluence_api.py` raises `AuthError` and you've already decided to fall back per the "Auth fallback" section above.

### Step 6: Confirm success

After the update succeeds, tell the user what was changed (brief summary), that the change is live, and that they can revert via Confluence version history if needed (Page → "..." → "Page history").

## Edge Cases and Safety

### Mutation didn't find its target
If `replace_text` returns 0, or `find_heading_index` returns None, don't proceed — tell the user the text/heading wasn't found and show them the readable view so they can clarify.

### Multiple pages
Each page's fetch → mutate → diff → push cycle is independent and parallelizable — there's no shared state and no ordering constraint between pages. Default to running them concurrently:

- **Many pages, uniform/mechanical edit** (e.g. add the same row to 12 page-properties tables) → use the script-with-thread-pool pattern in [Batch edits on N similar pages](#batch-edits-on-n-similar-pages) below.
- **Small N with different intents** (e.g. 2–3 pages, each getting a different edit) → issue the fetches as parallel tool calls in a single tool-use block, mutate in parallel, then push in parallel. No script needed.
- **Only serialize if pages depend on each other** (rare — e.g. one page's new ID has to be linked from another). Sequential processing is the exception, not the default.

Show one diff per page in the final message, grouped by page title.

### Page not found
If `confluence_api.py fetch` fails (or `getConfluencePage` in the auth-fallback path), report the error clearly. Check: is the page ID correct? Does the user have access?

### Concurrent edits
If `confluence_api.py push` (or `updateConfluencePage` in the auth-fallback path) fails with a version conflict, re-fetch the page and re-apply the mutations from scratch. Tell the user what happened.

### Recovering from mistakes
Confluence keeps full version history. Any change can be reverted: Page → "..." → "Page history" → select previous version → "Restore."

## Batch edits on N similar pages

When applying the same mechanical edit to many pages (e.g. adding a row to a page-properties table across a dozen product briefs), do not spawn one subagent per page. Agent startup overhead dominates when the per-unit work is uniform. Instead, write one Python script that imports `confluence_api` and parallelizes with `concurrent.futures.ThreadPoolExecutor`.

**Meta-rule for parallelism:**
- Mechanical parallelism (same operation, varied inputs) → one script with a thread pool.
- Reasoning parallelism (different research questions, per-unit judgment) → spawn subagents.

**Template:**

```python
# /tmp/batch_edit.py
import json, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, "/path/to/skill/scripts")
from confluence_api import fetch_page, push_page
from adf_mutator import replace_text

# {page_id: spec-for-this-page}
PAGES = {
    "111": {"old": "Q1 2026", "new": "Q2 2026"},
    "222": {"old": "Q1 2026", "new": "Q2 2026"},
    # ...
}

def process(page_id, spec):
    info = fetch_page(page_id)
    adf = json.loads(open(info["body_path"]).read())
    n = replace_text(adf, spec["old"], spec["new"])
    if n == 0:
        return page_id, "no-op"
    json.dump(adf, open(info["body_path"], "w"), indent=2)
    new_v = push_page(page_id, info["body_path"], info["title"],
                      info["version"] + 1, "Batch: update quarter")
    return page_id, f"v{new_v} ({n} replacements)"

with ThreadPoolExecutor(max_workers=8) as ex:
    for page_id, result in ex.map(lambda kv: process(*kv), PAGES.items()):
        print(page_id, result)
```

Still render and show diffs before pushing for the first page or two in a batch — use the diff to confirm the mutation does what you expect, then let the rest run.

## Script Reference

### `scripts/adf_renderer.py`
One-way converter: ADF JSON → human-readable annotated text. Handles all standard ADF node types including headings, paragraphs, lists, tables, code blocks, panels, expands, status labels, macros, task lists, layouts, mentions, and Smart Links.

### `scripts/adf_mutator.py`
Targeted mutations on the ADF tree, organized as locators (finders), builders (pure node constructors), and mutators (generic + domain wrappers). All operations modify in-place and preserve structure outside the targeted change. See "Step 3" above for the full primitive reference.

### `scripts/test_adf_mutator.py`
Regression test suite for `adf_mutator.py`. Run with `python3 scripts/test_adf_mutator.py`. Run after any change to the mutator module.

### `scripts/confluence_diff.py`
Convenience script that combines rendering + diffing. Also includes ADF complexity detection via `--check-adf`.

### `scripts/confluence_api.py`
Direct REST API helpers (`fetch_page`, `push_page`, `AuthError`) plus a CLI. **The default transport for every push** — see "Transport: MCP for reads, direct API for writes" above. Reads credentials from `~/.config/claude-skills/api-caller/apis/confluence/.env`.
