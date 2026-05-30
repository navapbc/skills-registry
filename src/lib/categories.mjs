// Category definitions for the homepage grid.
// Ops team: edit curatedSlugs to control which skills appear in each card.
// Slugs must match exactly what is stored in DynamoDB (check /api/skills for current slugs).
export const CATEGORIES = [
  {
    id: 'writing-comms',
    label: 'Writing & Comms',
    borderColor: '#c4b5fd',
    textColor: '#7c3aed',
    curatedSlugs: ['nava-labs-style'],
  },
  {
    id: 'research-analysis',
    label: 'Research & Analysis',
    borderColor: '#94a3b8',
    textColor: '#475569',
    curatedSlugs: ['diagram', 'index-inputs', 'interface-contracts'],
  },
  {
    id: 'planning',
    label: 'Planning',
    borderColor: '#6ee7b7',
    textColor: '#059669',
    curatedSlugs: ['prioritize-epics', 'review-ruleset'],
  },
  {
    id: 'dev-code',
    label: 'Dev & Code',
    borderColor: '#fcd34d',
    textColor: '#92400e',
    curatedSlugs: ['frontend-design', 'init', 'e2e-test'],
  },
  {
    id: 'ops-automation',
    label: 'Ops & Automation',
    borderColor: '#d1d5db',
    textColor: '#374151',
    curatedSlugs: ['generate-ui', 'flow-screenshots'],
  },
];

export const SUBMIT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdW3RSdwVvbFDFz_OBdZ1CzyNq_pYq_z8zsR0NdOknRApcR6A/viewform?usp=preview';
