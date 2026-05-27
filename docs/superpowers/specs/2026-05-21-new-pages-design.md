# New Pages Design — My Skills + What's New

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Two new pages for the Nava Skills Registry, plus a submit link swap. Both pages are fully client-rendered with no backend — My Skills uses localStorage, What's New uses the existing registry JSON.

---

## 1. Submit Skill

Already implemented — "+ Submit Skill" button links to Google Form. No page needed.

---

## 2. My Skills (`/my-skills`)

### Purpose
Lets users track which skills they've installed so they can quickly re-copy install commands.

### Data model
localStorage key `nava_installed_skills` stores a JSON array:
```json
[{ "slug": "brainstorming", "name": "Brainstorming", "plugin": "superpowers",
   "description": "...", "compatibility": ["claude-code"], "installedAt": 1716300000000 }]
```

### Install trigger
Anywhere the install command is copied (skill detail page "Copy" button), the skill is written to localStorage. The button label toggles: "Copy" → "Installed ✓" for 2 seconds, then stays "Installed ✓" if already in localStorage on page load.

### Page layout
- Header: "My Skills" title + "X skills installed" count + "Clear all" link (only when populated)
- Empty state: dashed-border box, ✦ icon, "No skills installed yet", "Browse Marketplace →" CTA
- Populated: 2-column card grid (same width as skill detail sidebar cards)
- Each card: skill name, plugin tag pill, description (truncated), "Installed X ago" timestamp, Copy button, ✕ remove button
- Removing a skill updates localStorage and re-renders the list immediately

### Sidebar
Add "My Skills" as a nav link below "Marketplace" in Base.astro.

---

## 3. What's New (`/whats-new`)

### Purpose
Shows recently added/updated skills as a changelog feed, useful for teams tracking Zapier-sourced additions.

### Data source
`registry/index.json` — skills sorted by `last_updated` descending. No new data needed.

### Grouping logic
Relative to the most recent `last_updated` date in the dataset (not `Date.now()`, since this is a static site):
- **This week** — within 7 days of the newest skill's date
- **This month** — 7–30 days before the newest skill's date  
- **Earlier** — anything older

Using the newest date in the dataset as the anchor keeps groups meaningful even after a static build.

### Page layout
- Header: "What's New" title + subtitle "Recently added and updated skills"
- Section headers: "This week", "This month", "Earlier" (each as a small uppercase label with a bottom border, only shown if the group has items)
- Each item: author avatar (letter + plum circle), skill name, type tag pill (skill/agent), description, "Plugin · Added [date]" footer
- Items link to their `/skills/[slug]` detail page

### Sidebar
Add "What's New" nav link in Base.astro below "My Skills".

---

## Sidebar nav (final order)

```
NAVIGATION
  ⊞  Marketplace
  ◈  My Skills       ← new
  ★  What's New      ← new

PLUGINS
  ▤  [plugin list from registry]
```
