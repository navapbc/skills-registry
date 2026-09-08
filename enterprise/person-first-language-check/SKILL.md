---
name: person-first-language-check
description: >
  This skill turns NY State’s person-first glossary and the 13 translations
  into a style checker for person-first language, especially relevant in the
  benefits space.  The glossary is available in English, Arabic, Bangla,
  French, Haitian Creole, Italian, Korean, Polish, Russian, Simplified
  Chinese, Spanish, Traditional Chinese, Urdu, and Yiddish.   The skill auto-
  detects the content’s language and checks it against that language's
  official NYS glossary. Flags outdated/stigmatizing terms (age, disability,
  faith, immigration, mental health, public health, race/ethnicity, sexual
  orientation and gender, body size, socioeconomic status, substance use,
  veteran status) with a recommended replacement and reason. Use to review,
  audit, or edit content for inclusive, person-first, identity-first,
  respectful, bias-free, or "sensitive" language, in any of the 14 total
  languages.
version: "1.0"
author: ryan@navapbc.com
author_name: Ryan Sibley
team: Practice - Design
sensitive_data: false
problem: This helps people apply inclusive language edits, which is a principle almost all of our products and programs strive for, without being an expert editor or content strategist.
estimated_impact: 5 to 7 business days down to 2.5
usage_frequency: Weekly
expected_audience: 16+ people
impact_type: [Time saved per use, Reduced error rate or rework, Faster turnaround / cycle time, Increased output volume or consistency]
compatibility: [claude-chat, claude-cowork]
tags: [content-strategy, content-editing, inclusive-writing]
---

# Person-First Language Check

## What this does

Checks a piece of content against New York State's *Person-First and Identity-First Language Glossary* and reports back every term or phrasing choice the glossary flags, with the recommended alternative and the reasoning behind it — in whichever of 14 languages the content is written in.

The glossary is the ground truth here — not general intuitions about "inclusive language." It covers twelve areas: age, disability status, faith, immigration status/nationality/language, mental health, public health, race and ethnicity, sexual orientation and gender diversity, body size, socioeconomic status/racial equity/criminal legal system, substance use and addiction, and veteran status.

## Step 0: Identify the content's language and load the matching reference

This skill ships one reference file per language, all in `references/`, each structured identically (same categories, same Avoid/Prefer/Why format) so the rest of this workflow doesn't change based on language:

| Language | Reference file |
|---|---|
| English | `references/english.md` |
| Arabic (العربية) | `references/arabic.md` |
| Bangla (বাংলা) | `references/bangla.md` |
| French (Français) | `references/french.md` |
| Haitian Creole (Kreyòl Ayisyen) | `references/haitian_creole.md` |
| Italian (Italiano) | `references/italian.md` |
| Korean (한국어) | `references/korean.md` |
| Polish (Polski) | `references/polish.md` |
| Russian (Русский) | `references/russian.md` |
| Simplified Chinese (简体中文) | `references/simplified_chinese.md` |
| Spanish (Español) | `references/spanish.md` |
| Traditional Chinese (繁體中文) | `references/traditional_chinese.md` |
| Urdu (اُردُو) | `references/urdu.md` |
| Yiddish (אידיש) | `references/yiddish.md` |

Determine the language of the content yourself (you don't need to ask the user unless it's genuinely ambiguous, e.g. a short snippet or mixed-language content). Read the one matching reference file in full before scanning — don't read the others, and don't try to check content against a language's file other than its own. If the content is in a language outside this list of 14, say so plainly: this skill can't check it, since no official NYS translation of the glossary exists for that language, and note you could still apply the *English* glossary's general concepts if the user wants a rough pass, but flag that as an approximation rather than an authoritative check.

If a single piece of content mixes two supported languages (for example, a bilingual notice with an English section and a Spanish section), read both matching reference files and check each section against its own language's file.

## How to run a check

1. **Read the content being checked in full** before flagging anything. Context matters a lot here: the same string can be fine in one sentence and a problem in another. A few things to watch for:
   - A flagged word used as a plain adjective or in an unrelated sense isn't a hit. "Illegal parking" isn't about people; "illegals" referring to people is. "Old-fashioned recipe" isn't ageist; "old-fashioned" describing a person's views might be, depending on context. Apply this same judgment regardless of which language you're working in.
   - Some "avoid" terms are still correct in specific registers the glossary itself calls out — clinical diagnostic terms, legal/policy language, or official statistical terminology (e.g. Census/ACS categories). Note these rather than flagging them as flat mistakes.
   - The glossary repeatedly says individual/community preference overrides the general guidance. If the content already states or implies how a specific person or group prefers to be described, that wins — don't flag it just because it differs from the glossary's default.
   - Don't invent flags the reference file doesn't support. If a term isn't covered and you're not confident it's actually a problem per the glossary, leave it alone rather than guessing.

2. **Produce both outputs** (unless the user asks for just one):

   **A. Summary report, written in English** — a markdown report grouped by category, covering only the categories where something was actually found (skip empty categories). For each flagged item:
   - The exact flagged phrase **in its original language**, with enough surrounding context (also in the original language) to locate it
   - The category it falls under
   - The suggested replacement(s), **in the same language as the content** (pulled from that language's reference file — don't invent a translation, use the official suggested term as written there)
   - A one-line reason, in English, drawn from the reference file's "Why" (these are the same underlying rationale as the English glossary, since all 14 versions are translations of one source document)

   Open the report with a one-line count ("X terms flagged across Y categories" or "No issues found — this content follows person-first language guidelines"), and name the detected language of the content near the top of the report.

   **B. Annotated copy, in the content's original language** — the original content with each flagged phrase marked inline and the native-language suggestion right next to it, e.g. `~~[flagged phrase]~~ **[suggested replacement]**`, both in the original language. Keep the rest of the content untouched so the user can see the edit in place. If the content is long (multi-page document), you can annotate just the sections with flags rather than reproducing the whole thing, as long as you say that's what you did.

3. **If nothing is flagged**, say so plainly and briefly, in English — don't pad the report looking for problems that aren't there.

## A note on tone

This is an editorial suggestion tool, not a compliance verdict. The source glossary itself says preferred terms shift over time and aren't uniformly right for every situation or institution — carry that same tone into the report, in every language. Flag issues clearly and explain the reasoning, but don't present the suggestions as absolute rules the user must follow. Also keep in mind the glossary's own note that cultural and linguistic nuance varies by community, so a translated version's phrasing may differ somewhat from a literal translation of the English original — that's expected and correct, not an error.
