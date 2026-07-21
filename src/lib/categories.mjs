// Category definitions for the homepage grid and category detail pages.
// slugs: all skills assigned to this category (shown in grid + category page)
// featuredSlugs: enterprise-managed skills shown with "Featured" label at top
//   (leave empty until Anthropic API enterprise skill sync is built)
// Ops team: edit slugs/featuredSlugs to curate the hub's categories.
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
    featuredSlugs: [],
    slugs: [
      'nava-labs-style',
      'ux-writing',
      'update-docs',
      'caseworker-communication',
    ],
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
    featuredSlugs: [],
    slugs: [
      'diagram',
      'analyze-codebase',
      'design-review',
      'index-inputs',
      'review-stats',
      'dso-test-quality-report',
    ],
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
    featuredSlugs: [],
    slugs: [
      'brainstorm',
      'implementation-plan',
      'prioritize-epics',
      'preplanning',
      'roadmap',
      'interface-contracts',
      'sprint',
      'plan-review',
      'oscillation-check',
      'audit-plans',
      'open-items',
    ],
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
    featuredSlugs: [],
    slugs: [
      'fix-bug',
      'debug-everything',
      'playwright-debug',
      'e2e-test',
      'test',
      'typecheck',
      'lint',
      'build',
      'review',
      'resolve-conflicts',
      'respond-to-pr-comments',
      'pre-push-check',
      'verification-before-completion',
      'validate-work',
      'frontend-design',
      'tweakcn-design',
      'color-and-contrast',
      'responsive-design',
      'spatial-design',
      'typography',
      'interaction-design',
      'motion-design',
      'skill-refactor',
    ],
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
    featuredSlugs: [],
    slugs: [
      'retro',
      'tickets-health',
      'generate-ui',
      'flow-screenshots',
      'create-bug',
      'agent-browser',
      'retro-finalize',
      'add-learning',
      'end-session',
      'session-start',
    ],
  },
];

export const SUBMIT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview';
