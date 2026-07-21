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
    heroDescription:
      'My day, my week, my growth. Skills that help you stay organized, plan your time, and track your own progress.',
    accentColor: '#7F77DD',
    icon: 'calendar-check',
  },
  {
    id: 'research-and-analyze',
    label: 'Research & Analyze',
    subtitle: 'Look up, understand, extract',
    heroDescription:
      'Look up, understand, extract. Skills that search, analyze, or synthesize source material — policy docs, past work, company knowledge.',
    accentColor: '#1D9E75',
    icon: 'search',
  },
  {
    id: 'write-and-review',
    label: 'Write & Review',
    subtitle: 'Produce and review documents',
    heroDescription:
      'Produce and review documents. Skills that draft, structure, translate, or evaluate written deliverables against Nava templates and standards.',
    accentColor: '#D4537E',
    icon: 'file-text',
  },
  {
    id: 'team-automations',
    label: 'Team Automations',
    subtitle: 'Recurring team processes, automated',
    heroDescription:
      'Recurring team processes, automated. Skills that run regular operational workflows for a specific team — scoring, reconciliation, reporting.',
    accentColor: '#BA7517',
    icon: 'repeat',
  },
  {
    id: 'build-and-ship',
    label: 'Build & Ship',
    subtitle: 'Developer tools. Requires Claude Code',
    heroDescription:
      'Developer tools. Requires Claude Code. Dev tooling, CI/CD, API integrations, and program-specific skill bundles for engineering teams.',
    accentColor: '#378ADD',
    icon: 'code',
  },
];

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
