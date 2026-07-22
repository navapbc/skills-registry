// Category definitions for the homepage tiles and category detail pages.
// Category membership (tiles' skill count, detail-page list, tag pills) is
// driven by each skill's `category` field (s.category === cat.id), not a
// per-category slug list.
export const CATEGORIES = [
  {
    id: 'write-and-review',
    label: 'Write & Review',
    subtitle: 'Produce and review documents',
    hero_description:
      'Produce and review documents. Skills that draft, structure, translate, or evaluate written deliverables against Nava templates and standards.',
    accent_color: '#D4537E',
    icon: 'file-text',
    browsable: true,
    contribution_prompt:
      'Have an idea for a Write & Review skill? Status reports, exec summaries, capability statements, and weekly recaps are all good candidates.',
    borderColor: '#c4b5fd',
    textColor: '#7c3aed',
  },
  {
    id: 'research-and-analyze',
    label: 'Research & Analyze',
    subtitle: 'Look up, understand, extract',
    hero_description:
      'Look up, understand, extract. Skills that search, analyze, or synthesize source material — policy docs, past work, company knowledge.',
    accent_color: '#1D9E75',
    icon: 'search',
    browsable: true,
    contribution_prompt:
      'Have an idea for a Research & Analyze skill? Competitive intel, contract vehicle research, and RFP analysis are all good candidates.',
    borderColor: '#94a3b8',
    textColor: '#475569',
  },
  {
    id: 'personal-productivity',
    label: 'Personal Productivity',
    subtitle: 'My day, my week, my growth',
    hero_description:
      'My day, my week, my growth. Skills that help you stay organized, plan your time, and track your own progress.',
    accent_color: '#7F77DD',
    icon: 'calendar-check',
    browsable: true,
    contribution_prompt:
      'Have an idea for a Personal Productivity skill? Expense report automation, Slack digests, and daily standup prep are all good candidates.',
    borderColor: '#6ee7b7',
    textColor: '#059669',
  },
  {
    id: 'build-and-ship',
    label: 'Build & Ship',
    subtitle: 'Developer tools. Requires Claude Code',
    hero_description:
      'Developer tools. Requires Claude Code. Dev tooling, CI/CD, API integrations, and program-specific skill bundles for engineering teams.',
    accent_color: '#378ADD',
    icon: 'code',
    browsable: true,
    contribution_prompt:
      'Have an idea for a Build & Ship skill? PR automation, MCP setup, program onboarding, and code review are all good candidates.',
    borderColor: '#fcd34d',
    textColor: '#92400e',
  },
  {
    id: 'team-automations',
    label: 'Team Automations',
    subtitle: 'Recurring team processes, automated',
    hero_description:
      'Recurring team processes, automated. Skills that run regular operational workflows for a specific team — scoring, reconciliation, reporting.',
    accent_color: '#BA7517',
    icon: 'repeat',
    browsable: true,
    contribution_prompt:
      'Have an idea for a Team Automations skill? Monthly reconciliation, quarterly compliance checks, and onboarding checklists are all good candidates.',
    borderColor: '#d1d5db',
    textColor: '#374151',
  },
];
