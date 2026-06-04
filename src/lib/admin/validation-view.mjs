import { escapeHtml } from '../render.mjs';

export function renderValidationResults(analysis) {
  const { fields, ignored, validation, warnings } = analysis;

  const sourceLabel = {
    frontmatter: '<span class="text-green-700">from frontmatter</span>',
    derived: '<span class="text-blue-700">⚙️ derived</span>',
    defaulted: '<span class="text-amber-700">⚙️ defaulted</span>',
    pipeline: '<span class="text-gray-400">set by pipeline</span>',
  };
  const fmtValue = (v) => Array.isArray(v)
    ? (v.length ? v.map(x => `<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mr-1">${escapeHtml(String(x))}</span>`).join('') : '<span class="text-gray-300">[]</span>')
    : v === null ? '<span class="text-gray-300">null</span>'
    : v === '' ? '<span class="text-gray-300">(empty)</span>'
    : escapeHtml(String(v));

  const authored = fields.filter(f => f.source !== 'pipeline');
  const pipeline = fields.filter(f => f.source === 'pipeline');

  const banner = validation.valid
    ? `<div class="p-3 rounded bg-green-50 border border-green-200 text-sm text-green-800">✅ Valid skill file — passes SkillSchema.</div>`
    : `<div class="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
        ❌ Invalid — ${validation.errors.length} issue(s):
        <ul class="mt-1 ml-4 list-disc">
          ${validation.errors.map(e => `<li><code>${escapeHtml(e.path || '(root)')}</code>: ${escapeHtml(e.message)}</li>`).join('')}
        </ul>
      </div>`;

  const warningsBlock = warnings.length
    ? `<div class="mt-4 p-3 rounded bg-amber-50 border border-amber-200">
        <h3 class="text-sm font-semibold text-amber-900 mb-2 mt-0">Form conformance — ${warnings.length} thing(s) to check</h3>
        <ul class="text-xs text-amber-800 space-y-1 m-0 ml-4 list-disc">
          ${warnings.map(w => `<li><code>${escapeHtml(w.field)}</code>: ${escapeHtml(w.message)}</li>`).join('')}
        </ul>
      </div>`
    : `<div class="mt-4 p-3 rounded bg-green-50 border border-green-200 text-sm text-green-800">✅ Matches the submission form's expected inputs.</div>`;

  const fieldRows = (list) => list.map(f => `
    <tr class="border-b border-gray-100">
      <td class="py-1 pr-3 font-mono text-xs text-gray-700 align-top">${escapeHtml(f.key)}</td>
      <td class="py-1 pr-3 text-xs align-top">${fmtValue(f.value)}</td>
      <td class="py-1 text-xs whitespace-nowrap align-top">${sourceLabel[f.source] || f.source}</td>
    </tr>`).join('');

  const ignoredBlock = ignored.length
    ? `<div class="mt-4">
        <h3 class="text-sm font-semibold text-gray-900 mb-2">⚠️ Ignored / unrecognized keys</h3>
        <ul class="text-xs text-amber-800 space-y-1">
          ${ignored.map(i => `<li><code>${escapeHtml(i.key)}</code> — not a recognized field; will be dropped${i.suggestion ? ` — did you mean <code>${escapeHtml(i.suggestion)}</code>?` : ''}</li>`).join('')}
        </ul>
      </div>`
    : '';

  return `
    ${banner}
    ${warningsBlock}
    <div class="mt-4">
      <h3 class="text-sm font-semibold text-gray-900 mb-2">Extracted fields</h3>
      <table class="w-full text-left"><tbody>${fieldRows(authored)}</tbody></table>
    </div>
    <div class="mt-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-2">Set by the pipeline, not your file</h3>
      <table class="w-full text-left opacity-70"><tbody>${fieldRows(pipeline)}</tbody></table>
    </div>
    ${ignoredBlock}
    <div class="mt-4">
      <button id="copy-record-btn" class="text-xs px-2 py-1 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Copy as JSON</button>
      <span id="copy-status" class="text-xs text-green-600 ml-2 hidden">Copied ✓</span>
    </div>`;
}
