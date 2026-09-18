---
name: transform-output-reader
description: >
  Teaches Claude how to read an AWS Transform for Mainframe output package.
  Activates when a session is handed Transform output (a folder or zip with
  bre/, analyze_code/ and data_analysis/ subtrees, or a read-only S3 prefix)
  and asked what a COBOL program or JCL job does, who calls what, which
  programs touch a dataset, or where a business rule or term lives. The skill
  labels every artifact deterministic (parser output: inventory, dependency
  graph, lineage, dictionary structure) or LLM-generated (rule text,
  diagrams, descriptions), gives a never-do list so generated prose is not
  quoted as fact, explains how to read the functionality tree and
  Given/When/Then rules, and ships a standard-library Python script that
  builds a small persistent index of a package (members, callers, callees,
  data sources, domains) so a session searches tens of megabytes instead of
  loading gigabytes. Read-only; contains no data from any package.
version: "1.0"
author: morganrobertson@navapbc.com
author_name: Morgan Robertson
team: Practice - Engineering
sensitive_data: false
problem: "Transform output for one mainframe estate is about 12 GB across 14 packages: thousands of multi-megabyte JSON rule documents plus HTML renderings, a dependency graph, and thousands of dictionary CSVs. A session that opens it naively downloads gigabytes, exhausts its context on one program, and quotes LLM-generated rule text as if it were the specification. In controlled tests an unguided session downloaded 7.6 GB to answer one question and still covered only 6 of 14 packages; with the skill, sessions answered the same class of question from 1 to 35 MB, covered all 14 packages, and separated parser facts from generated prose. Pilot teams consuming Transform output in Claude Code need that behavior by default rather than re-learning it per session."
estimated_impact: Cuts a cross-estate lookup from a multi-GB download and hours of reading to under 40 MB and 10-30 minutes; prevents generated rule text being cited as specification.
usage_frequency: A few times per week
expected_audience: 6-15 people
impact_type: [Time saved per use, Reduced error rate or rework]
compatibility: [claude-cowork, claude-code]
tags: [aws-transform, mainframe-modernization, legacy-code-analysis]
data_sources: "AWS Transform for Mainframe output packages supplied to the user: a local folder, an unzipped distributable, or a synced prefix of a read-only S3 bucket. Packages are published only after sensitive-information screening. The skill itself contains no records, identifiers or credentials and uses no API, database or connector; it instructs the session never to recover redacted values."
---

# Transform Output Reader

AWS Transform for Mainframe produces three kinds of artifact from legacy source:
a code analysis (inventory, dependency graph, unresolved references), a data
analysis (record layouts and dataset lineage), and a business-rule extraction
(one narrative document per program and job, with flow diagrams and typed
rules). A package bundles all three for one scope: a batch scheduling network,
an online estate, or a module.

The code and lineage analyses are parser output. The rule documents are written
by a language model. A session that does not know which is which will quote
generated prose as fact, compare numbers that are not comparable, and spend its
token budget on files that are five to fifty times larger than they need to be.
This skill exists to prevent those three mistakes.

## When to use

- You have been given a Transform package, or a prefix of the read-only
  distribution bucket, and need to answer questions from it.
- You are starting a pilot or investigation that will lean on Transform output
  over several sessions and want a durable index rather than a fresh scan each
  time.
- You need to explain to a stakeholder what a Transform artifact does and does
  not establish.

Do not use this skill to judge whether an extraction was good enough to
publish, or to validate rules against legacy source. Those are producer-side
reviews with their own tooling; see "When to escalate".

## Before you open anything

1. **Packages are read-only.** Never write into a package or into the
   distribution bucket. Build your index and notes in your own working folder.
2. **Packages are screened.** Published packages have been swept for sensitive
   information, and removed values appear as stable tokens such as
   `[REDACTED-...-NN]` or `STAFF_NN@...`. Do not attempt to recover a value
   behind a token. If you see something that looks like a real personal
   identifier or credential, stop and report it to the package publisher; do
   not copy it anywhere.
3. **Look for the publisher's own metadata before deriving anything.** A
   distribution carries `README.md`, `MANIFEST.json` and `CHECKSUMS.sha256` at
   its root, beside the package prefixes, not inside them. A package folder
   may also carry provenance or review notes. The index builder searches the
   package, its parent and its grandparent and lists whatever it finds; when
   the package came from a bucket, fetch the root files first (`aws s3 ls
   s3://<bucket>/`, then copy `MANIFEST.json` and `README.md`) and pass the
   manifest with `--manifest`. Those files state scope, subsystem mix,
   vintage, clearance and product limitations; they outrank anything you
   derive. Verify a download against the checksums when they are provided.
4. **Build the index before browsing.** See "Step 1".

## Step 1: build the index

```bash
python3 scripts/build_index.py <package_root> --out ./transform-index-<name> [--manifest ./dist/MANIFEST.json]
```

`<package_root>` is the folder containing `bre/`, `analyze_code/` and
`data_analysis/`. The script reads the deterministic artifacts once, takes the
description, counts and functionality titles from the top of each rule
document, and writes three small files:

| file | what it is for |
|---|---|
| `transform_index.md` | package summary plus one row per program and job: type, size, rule count, functionality count, dictionary present, apparent function, callers, callees, data sources |
| `transform_index.csv` | the same rows with full lists, for filtering in code |
| `gaps.md` | members with no rule document, unresolved references by type, and the unresolved program names that are probably application code |
| `domains.json` | the stakeholder view: domains with members, provenance and confirmation, plus a glossary of business terms; seeded from the package's own decomposition when it has one, merged (never overwritten) on rebuild |

It runs in seconds on the largest published packages, and it works on a
partial download: with only `analyze_code/` and the lineage tables synced, the
structural columns are complete and the rest are marked `n/a`. Read
`transform_index.md` instead of listing directories. Choose the documents you
open from it.

**Keep the index and grow it.** Put `transform_index.*`, `gaps.md`,
`domains.json` and a `notes.md` in one folder per package in your workspace. Every time you answer
a question, append the answer to `notes.md` with the member name, the document
path and the rule ids you relied on. Across sessions this becomes the fastest
way back in, and it is the artifact the publishing team can verify and fold into
the shared knowledge base. Send it back to them when a pilot closes.

## Step 2: know what you are reading

Every artifact in a package falls into one of three classes.

| artifact | class | use it for | do not use it for |
|---|---|---|---|
| `analyze_code/assets_*.csv` | deterministic | inventory, member type, size, complexity | anything about behavior |
| `analyze_code/classification_*.json` | deterministic | member type by path | - |
| `analyze_code/dependencies_*.json` | deterministic | who calls whom, job runs program, program touches dataset, table, map or transaction | - |
| `analyze_code/missing_*.csv` | deterministic | what was referenced but not present in the package | judging quality without filtering utility noise first |
| `analyze_code/duplicatedIds_*.json`, `code_issues_*.csv` | deterministic | duplicate members, project-level errors | - |
| `data_analysis/data_lineage_output/*` | deterministic | which jobs and programs read or write which dataset, with DD name and disposition | - |
| `data_analysis/data_dictionary_output/*` structural columns | deterministic | record layouts, field names, pictures, levels, values | a key-field inventory (fields are systematically dropped) |
| data dictionary `business_definition` column | LLM-generated | a hint at a field's meaning | anything you would cite |
| `bre/**/*-cbl.json`: `description`, functionality titles and descriptions, diagrams, rule names, rule descriptions, acceptance criteria | LLM-generated | understanding what a program appears to do and where in its logic a behavior sits | call structure, dataset I/O, exact counts, anything you would quote as a requirement |
| `bre/**/*-cbl.json`: `overview.total_rules`, `total_key_functionalities`, rule ids, rule types, `key_functionality_id`, `sub_graph_node_text` | mixed: the fields are stable, the values are the extractor's choices | navigating within a document | comparing programs by count |
| `bre/**/*-jcl.json` | LLM-generated | what a job appears to do, step by step | the program and dataset facts, which belong to the dependency graph and `jcl_to_dsn` |
| `bre/ApplicationLevelAnalysis/**` | LLM-generated, second order | orientation on a module-style package | citing without checking the program document beneath |
| `bre/**/*.html`, `bre/index.html` | rendering / navigation | a human with a browser | a session; the JSON beside each HTML has the same content at a fraction of the size |
| **your** `transform_index.*`, `gaps.md` | derived by this skill | finding which artifact to open | evidence about the code; cite what the row points to |
| **your** `domains.json`, glossary, and any `stakeholder_domains` / `aliases` in a manifest entry | asserted by people, or seeded from generated grouping | framing findings in stakeholder terms; routing to the right package | a statement about what the code does; a domain tag is a classification, not a behavior |

Open the reference before you touch the file, not after something looks odd:

- about to read an analyze-code file, count callers, or interpret an edge
  verb or a `Missing ...` type: `references/analyze_code_files.md`
- about to read a dictionary or lineage file: `references/data_analysis_files.md`
- about to read a rule document, or seeing keys you did not expect:
  `references/bre_documents.md`
- deciding what to download or skip, or how big something is:
  `references/package_anatomy.md`
- working with the index, domains or a manifest: `references/index_design.md`

### Why the rule documents are one reading, not the reading

A language model wrote each rule document while reading the source. The
wording of every rule, how many rules a program gets, how it is cut into
functionalities, and which of several sibling programs a shared behavior is
attributed to are all choices the model made while writing, not properties of
the source. The same is true of the diagrams and their labels. Roughly a
quarter to a third of the identifier-looking tokens in rule prose are English
phrases rather than names from the source; small utility programs, date
routines in particular, over-narrate the most.

A rule document is therefore a well-organized guide to where in the source a
behavior lives and roughly what it does. It is not a specification and not a
count of anything.

## Never do this

- **Never read a difference in wording between two documents as a
  difference in behavior.** Clone programs with near-identical source receive
  differently worded documents.
- **Never compare rule counts** between packages or between sibling programs
  as a measure of anything. A count is how many statements the model chose to
  write, not how much logic the source holds.
- **Never take call structure from rule text.** A description saying "calls
  X" is a paraphrase. The dependency graph is the record. If they disagree,
  the graph is right and the prose is worth a note.
- **Never take dataset I/O from rule text.** Use `jcl_to_dsn`,
  `program_to_dsn` and the graph's dataset edges. Prose sometimes names a
  dataset that appears only in a comment.
- **Never use the data dictionary as a key-field inventory.** The extractor
  drops fields named exactly `SSN`, fields with digit-leading names, and some
  sensitive-looking names in screen maps, and it truncates some members early.
  Use rule documents or lineage to locate key fields, then confirm in the
  dictionary.
- **Never open a whole `bre/` directory, an `.html` file, or the full
  dependency JSON into context.** Build the index, pick documents from it,
  read `description` and `overview` before descending, and derive the graph
  adjacency you need in code.
- **Never present acceptance criteria as requirements.** They are the model's
  restatement of what the code appears to do, including its bugs.
- **Never treat a member's absence from a package as its absence from the
  system.** Packages are scoped to one network, estate or module.
- **Never cite the index, the gaps file, the domains file or a glossary as
  evidence about the code.** They are derived by this skill or asserted by
  people, and every one of them says so in its first line. They tell you
  where to look and how stakeholders name things. The evidence is the
  artifact they point to, and behind it the source.

## Step 3: reading a logic tree

A program document (`<PROGRAM>-cbl.json`) is a tree. Read it top down and stop
as early as the question allows.

1. **`description`**: one paragraph of what the program appears to do. Enough
   to confirm you have the right member.
2. **`overview.main_flow_diagram`**: a Mermaid flowchart of the whole program.
   Its numbered process nodes are the top-level functionalities, and its
   cylinder nodes are the data sources the model noticed. Read it as a table
   of contents, not as control flow you can execute.
3. **`key_functionalities[]`**: one entry per top-level functionality, each
   with `id`, `title`, `level`, `description`, its own `mermaid_diagram`, its
   `rules[]`, and `sub_functionalities[]` for the rare deeper level.
4. **A rule** inside a functionality carries `rule_id`, `rule_type`,
   `rule_name`, `rule_description`, `acceptance_criteria` as
   `{Given, When, Then}`, `key_functionality_id` (the functionality it belongs
   to) and `sub_graph_node_text` (the label of the diagram node it describes).
   Those two fields are the anchor from a rule to a position in the tree. Use
   them to say "this behavior sits in functionality F at node N", which is a
   claim you can check against the source later.
5. **`all_rules[]`** is the flat list and the superset. About one rule in
   seven is in `all_rules` but under no functionality, and on some programs it
   is closer to two in five. When completeness matters, read `all_rules` and
   use the tree only to place each rule. Note the capitalized keys there
   (`Rule_Id`, `Rule_Type`, `Rule_Name`, `Rule_Description`,
   `Acceptance_Criteria`) versus the lowercase keys inside functionalities.

Older packages use a legacy shape with different key names
(`Functionality_Name`, `Business_Rules_Within_Functionality`, acceptance
criteria as a list of strings, and no `overview`). `references/bre_documents.md`
has the side-by-side table.

A job document (`<JOB>-jcl.json`) is flat: `description`, `rules[]`, and one
`flow_diagram_code` for the step sequence. Confirm the programs and datasets it
names against the dependency graph and `jcl_to_dsn`.

## Step 4: reading the data analysis

- **Lineage** answers "what reads or writes this dataset" and "what does this
  job touch at each step". `jcl_to_dsn` (batch only), `program_to_dsn`, and
  `dsn_to_file` are the same facts from three directions. Online packages have
  no `jcl_to_dsn` because they have no JCL.
- **Per-member dictionary CSVs** answer "what is the record layout of this
  member". Prefer them over the two consolidated CSVs, which are every member
  concatenated. Every column except `business_definition` is parsed from the
  data division.
- **The gaps are systematic, not random.** Roughly one COBOL program in ten
  and a third of copybooks have no dictionary at all; some members are
  truncated after their first records; specific field names are suppressed.
  Say "the dictionary does not show it", never "the source does not have it".
  Column detail and the full gap list: `references/data_analysis_files.md`.

## Finding a term across the distribution

"Where does X appear?" is the commonest first question and the one most likely
to waste a budget, because the natural move is to download packages and grep.
Work in cost tiers instead, exhaust each tier across **every** package before
moving to the next, and stop when you have an answer. Normalize names as you
go: strip file extensions and uppercase, because one package may list `PROG`
and another `PROG.cbl`.

1. **Object keys, free.** List the distribution recursively, or read
   `CHECKSUMS.sha256`, which names every object. A member name, job name or
   document name that exists anywhere shows up here.
2. **Deterministic subset, tens of megabytes for the whole estate.** For every
   package: `assets_*.csv`, `classification_*.json`, `dependencies_*.json`,
   `missing_*.csv`, and the lineage CSVs. This finds the term as a program,
   copybook, dataset, DD name, table, transaction or unresolved reference, and
   gives you callers and callees at the same time. Build the index for each
   package from this subset.
3. **Dictionaries, a few megabytes per package.** The two consolidated CSVs
   find the term as a field or record name or a literal value. Many business
   terms live only here, as a suffix or prefix on a family of fields; when
   that is what you find, the defining copybooks and the programs that expand
   them are your deterministic footprint, and the dependency graph's Copy
   edges are a lower bound on those programs.
4. **Rule prose, only now, and server-side if you can.** A term that exists
   only in generated text is a business name or alias no code carries. Search
   the `bre/**/*.json` objects in place (S3 Select, or an equivalent
   server-side filter) rather than downloading them; a positive control on a
   term you know is present proves the search works. Downloading whole `bre/`
   trees for a term search is never the right move.
5. **Then open documents**, chosen from the index, for the members you found.

Report coverage with the answer: which packages you checked at which tier.
"Not found" is a statement about this distribution at the tiers you covered,
not about the system. Try the near-miss forms too (hyphenated, spaced, with a
prefix or suffix) and say what the near misses were, so a substring hit on an
unrelated name is not mistaken for the term. One token can be a file, a
cursor, a DD name and a field prefix at once; check the node type or column
before treating matches as one thing. If the term is absent
everywhere, record it in the glossary as an open question with what you
checked; it is most likely a stakeholder name for something the code calls
something else.

## Step 5: domains, the stakeholder view

Transform will group members into "domains" or "business functions" when a
package was run with application-level analysis, and the seeds it used are
sometimes shipped too. That grouping is one model's reading of the code. It is
useful for orientation and it can be wrong at the level of the whole system:
the model has been seen to expand a system's acronym into an unrelated line
of business and carry that misreading through a third of its narratives while
every mechanical detail stayed correct.

`domains.json` is where the view that matters gets recorded: what the people
who run the system say a set of members is for. The builder seeds it from the
package's own decomposition when one exists and tags those entries
`transform`. You add `robot` entries when the deterministic artifacts show a
grouping (a job family writing one dataset family, a subroutine with one clear
set of callers), saying what the evidence is. A person who knows the business
renames, merges, confirms or rejects, and their entries are `stakeholder`.
Rebuilds regenerate only unconfirmed `transform` seeds; everything else is
preserved. The index shows each member's domains and lists members that have
a rule document but no domain, so the unassigned set stays visible.

The **glossary** in the same file maps a term as it appears in the package to
what stakeholders mean by it. Keep it open while reading generated narrative,
and use it to carry business names that never appear in the code. It is also
where an unknown goes: a term you were asked about and could not find, with
what you checked, so the next session and the publishing team see the open
question.

Once a core glossary of known domains, descriptions and aliases exists, the
publisher may tag each package's manifest entry with `stakeholder_domains` and
`aliases`. The builder reads those into `domains.json` as confirmed
stakeholder entries, so a tagged manifest routes a session to the right
package before anything is opened. Treat that routing the way you would a
probabilistic filter: a tag that matches means "look here", not "the answer
is here", and an untagged package may still be relevant.

Schema, merge rules and the working sequence: `references/index_design.md`.
Deriving an official estate-wide domain view is its own piece of work with its
own owners; this file is where its raw material accumulates and what you hand
back to the publishing team.

## Answering common questions

| question | go to |
|---|---|
| What does program P do? | index row for P, then P's `description` and functionality titles |
| Who calls P, and what does P call? | index row (callers, callees; `~` marks a call that lives in a copybook the program copies); the dependency graph for the full picture |
| Where does term X appear anywhere in the distribution? | the cost-tier procedure in "Finding a term across the distribution", never a package download |
| What runs in job J, in what order, on what data? | `jcl_to_dsn` rows for J (step sequence, program, dataset, DISP); J's document for narrative |
| Which programs write dataset D? | `dsn_to_file` filtered to D; graph edges `Write Dataset` / `Write file` |
| Where is the logic for behavior B? | search rule names and `sub_graph_node_text` across the index's candidate members, then read that functionality; record the rule ids |
| What is the layout of record R? | the per-member dictionary CSV, remembering the gaps |
| Which business area does P belong to? | the `domains` column, then `domains.json` for provenance; unconfirmed means one model's grouping, not a decision |
| Is program P in this package at all? | `assets_*.csv`; if absent, it is out of scope, and it may be present under a runtime alias described in the distribution README |
| Why does P have no rule document? | `gaps.md`; Easytrieve never gets one, and for COBOL or JCL it means extraction did not produce one |

## When to escalate

Ask the publishing team rather than improvising when you need to:

- decide whether an extraction is complete or trustworthy enough for a
  deliverable (a quality review method exists for that);
- validate rule text against the legacy source (that requires source access
  and a validation method, neither of which this skill provides);
- obtain a package or scope that is not in the distribution (requests go
  through the team's board).

## Files in this skill

- `scripts/build_index.py`: the index builder. Standard library only. Finds
  publisher metadata, builds the member table, seeds and merges the domains
  sidecar.
- `references/index_design.md`: the index files, the domains sidecar schema
  and merge rules, the bucket-root metadata workflow, and options considered
  and not adopted.
- `references/package_anatomy.md`: layout, measured sizes, reading order.
- `references/analyze_code_files.md`: the code-analysis files, their schemas
  and pitfalls, the utility-noise prefix list.
- `references/data_analysis_files.md`: lineage and dictionary schemas and the
  known systematic gaps.
- `references/bre_documents.md`: both program-document shapes, the job shape,
  application-level documents, anchors, the superset rule, and which parts
  are the model's choices.
