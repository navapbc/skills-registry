// Category definitions for the API layer.
//
// This duplicates the id/label/metadata of the 5 hub categories that also live
// in the frontend config (src/lib/categories.mjs). The two are kept in sync by
// a parity test (tests/categories-parity.test.mjs) because the API Lambda zip
// only bundles functions/api/ — the frontend module cannot be imported here at
// runtime (see .github/workflows/deploy.yml).
//
// Featured slugs are NOT stored here — they are maintained via the admin panel
// and stored as synthetic DynamoDB rows (slug = "category::<id>").
export const CATEGORIES = [
  {
    id: 'personal-productivity',
    label: 'Personal Productivity',
    subtitle: 'My day, my week, my growth',
    hero_description:
      'My day, my week, my growth. Skills that help you stay organized, plan your time, and track your own progress.',
    accent_color: '#7F77DD',
    icon: 'calendar-check',
  },
  {
    id: 'research-and-analyze',
    label: 'Research & Analyze',
    subtitle: 'Look up, understand, extract',
    hero_description:
      'Look up, understand, extract. Skills that search, analyze, or synthesize source material — policy docs, past work, company knowledge.',
    accent_color: '#1D9E75',
    icon: 'search',
  },
  {
    id: 'write-and-review',
    label: 'Write & Review',
    subtitle: 'Produce and review documents',
    hero_description:
      'Produce and review documents. Skills that draft, structure, translate, or evaluate written deliverables against Nava templates and standards.',
    accent_color: '#D4537E',
    icon: 'file-text',
  },
  {
    id: 'team-automations',
    label: 'Team Automations',
    subtitle: 'Recurring team processes, automated',
    hero_description:
      'Recurring team processes, automated. Skills that run regular operational workflows for a specific team — scoring, reconciliation, reporting.',
    accent_color: '#BA7517',
    icon: 'repeat',
  },
  {
    id: 'build-and-ship',
    label: 'Build & Ship',
    subtitle: 'Developer tools. Requires Claude Code',
    hero_description:
      'Developer tools. Requires Claude Code. Dev tooling, CI/CD, API integrations, and program-specific skill bundles for engineering teams.',
    accent_color: '#378ADD',
    icon: 'code',
  },
];

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
