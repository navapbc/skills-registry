# Future Considerations

Tracked items for post-MVP. Sourced from team feedback sessions.

---

## Versioning
- Automate changelog info from git history or GitHub releases
- Show version diff on skill detail page

## Sensitive Data Flag
- Currently self-declared by skill author in registry metadata
- Future: automate detection during skill review process (scan SKILL.md content, or require explicit field in submission form)

## Skill Tags
- Add a "tags" field in the Google Form (with examples: productivity, design, research, writing)
- Explore AI-assisted tag recommendations during review: analyze skill description + SKILL.md content to suggest tags
- Tags would power filtering and discovery on the marketplace

## Skill Discovery
- **Most Popular** badge or ranking (requires usage tracking — to be figured out)
- **Starter Kits**: curated lists by team or role ("Skills for Design", "Skills for PMs") with links to individual skills
- Plugins of bundled skills only available in Cowork could generate curated list pages

## Compatibility Tag Automation
- `claude-code` tag: currently manually set; explore auto-detection based on skill file structure or install method
- Confirm tagging process as part of the Zapier/Google Form → registry pipeline

## Sensitive Data Automation
- Currently relies on submitter declaring `sensitive_data: true` in form
- Future: automated flag during skill review (keyword scan, or reviewer checklist in Sheets)

## Install Flow
- Explore one-click install for Claude Chat / Cowork rather than manual "Customize → Skills" instructions
- Track install events to power Most Popular feature
