// Allowed input values from the "New Claude Skill (Nava-wide use)" Google Form.
// These power soft "form-conformance" warnings in the admin validator — they are
// intentionally NOT enforced by SkillSchema, because the org-wide GitHub sync ingests
// skills that legitimately use values outside the Nava submission form's options.

export const TEAMS = [
  'Business Development', 'Communications', 'Contracts', 'Delivery Operations',
  'Executive', 'Finance', 'Operations and Automation', 'People Operations',
  'Practice - Design', 'Practice - Engineering', 'Practice - Product Management',
  'Program Management', 'Project Management', 'TS&S', 'Other',
];

export const COMPATIBILITY_OPTIONS = ['claude-chat', 'claude-cowork', 'claude-code'];

export const IMPACT_TYPES = [
  'Time saved per use',
  'Reduced error rate or rework',
  'Faster turnaround / cycle time',
  'Cost avoidance (fewer tools, vendor hours, etc.)',
  'Increased output volume or consistency',
  'Other',
];

export const USAGE_FREQUENCIES = [
  'Daily', 'A few times per week', 'Weekly', 'A few times per month', 'Monthly or less',
];

export const AUDIENCES = ['Just me', '2-5 people', '6-15 people', '16+ people'];

// Fields the form marks required (mapped to frontmatter keys). author + the file
// itself are handled outside frontmatter, so they aren't listed here.
const REQUIRED_FIELDS = [
  { field: 'author_name', label: 'First and Last Name' },
  { field: 'team', label: 'Team' },
  { field: 'problem', label: 'Problem solved' },
  { field: 'impact_type', label: 'Impact type' },
  { field: 'estimated_impact', label: 'Estimated impact per use' },
  { field: 'usage_frequency', label: 'Usage frequency' },
  { field: 'expected_audience', label: 'Expected audience' },
];

// skill-name / tag format: lowercase alphanumerics separated by single hyphens.
const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isEmpty(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Check a derived record against the submission form's allowed inputs.
 * Returns an array of soft warnings: { field, message }.
 * @param {object} record  the built skill record
 * @param {object} meta    the raw parsed frontmatter (to detect "not specified" cases)
 */
export function checkFormConstraints(record, meta = {}) {
  const warnings = [];

  // Required-by-form fields that are missing.
  if (!meta.name) {
    warnings.push({ field: 'name', message: 'Form requires a Skill name — no `name` in frontmatter.' });
  }
  if (!meta.description) {
    warnings.push({ field: 'description', message: 'Form requires a Skill description — no `description` in frontmatter (using first body line).' });
  }
  for (const { field, label } of REQUIRED_FIELDS) {
    if (isEmpty(record[field])) {
      warnings.push({ field, message: `Form requires "${label}" — \`${field}\` not found in frontmatter.` });
    }
  }

  // Skill name format.
  if (meta.name && !SLUG_FORMAT.test(record.name)) {
    warnings.push({ field: 'name', message: `Skill name "${record.name}" isn't in skill-name format (lowercase words separated by hyphens, e.g. exec-summary).` });
  }

  // Enumerated single-value fields.
  if (record.team && !TEAMS.includes(record.team)) {
    warnings.push({ field: 'team', message: `Team "${record.team}" is not one of the form's team options.` });
  }
  if (record.usage_frequency && !USAGE_FREQUENCIES.includes(record.usage_frequency)) {
    warnings.push({ field: 'usage_frequency', message: `Usage frequency "${record.usage_frequency}" is not one of the form's options (${USAGE_FREQUENCIES.join(', ')}).` });
  }
  if (record.expected_audience && !AUDIENCES.includes(record.expected_audience)) {
    warnings.push({ field: 'expected_audience', message: `Expected audience "${record.expected_audience}" is not one of the form's options (${AUDIENCES.join(', ')}).` });
  }

  // Enumerated multi-value fields.
  if (Array.isArray(record.impact_type)) {
    const bad = record.impact_type.filter(v => !IMPACT_TYPES.includes(v));
    if (bad.length) {
      warnings.push({ field: 'impact_type', message: `Impact type value(s) not on the form: ${bad.map(b => `"${b}"`).join(', ')}.` });
    }
  }
  if (Array.isArray(record.compatibility)) {
    const bad = record.compatibility.filter(v => !COMPATIBILITY_OPTIONS.includes(v));
    if (bad.length) {
      warnings.push({ field: 'compatibility', message: `"Where does it run" value(s) not on the form: ${bad.map(b => `"${b}"`).join(', ')}. Form options: ${COMPATIBILITY_OPTIONS.join(', ')}.` });
    }
  }

  // Tags: form asks for 1-3 lowercase-hyphen tags.
  if (Array.isArray(record.tags)) {
    if (record.tags.length < 1 || record.tags.length > 3) {
      warnings.push({ field: 'tags', message: `Form asks for 1-3 tags; found ${record.tags.length}.` });
    }
    const badTags = record.tags.filter(t => !SLUG_FORMAT.test(t));
    if (badTags.length) {
      warnings.push({ field: 'tags', message: `Tag(s) not in lowercase-hyphen format: ${badTags.map(t => `"${t}"`).join(', ')}.` });
    }
  }

  // Sensitive-data question is required on the form; warn when not explicitly set.
  if (meta.sensitive_data === undefined) {
    warnings.push({ field: 'sensitive_data', message: 'Form requires the sensitive-data question — `sensitive_data` not set, defaulted to No.' });
  }

  return warnings;
}
