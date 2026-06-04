import { escapeHtml } from '../../lib/render.mjs';
import { analyzeSkillFile } from '../../lib/parse-skill.mjs';
import { renderValidationResults } from '../../lib/admin/validation-view.mjs';

export async function load(panel) {
  panel.innerHTML = `
    <p class="text-xs text-gray-500 mb-3">Paste a SKILL.md file below to preview exactly what the registry would extract — captured fields, defaults, ignored keys, schema validation, and how well it matches the submission form. Nothing is submitted.</p>
    <textarea id="validate-input" class="w-full h-64 text-xs font-mono border border-gray-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-plum-300" placeholder="---&#10;name: my-skill&#10;description: ...&#10;---&#10;&#10;# My Skill"></textarea>
    <div class="mt-2"><button id="validate-btn" class="text-sm px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 transition-colors">Validate</button></div>
    <div id="validate-results" class="mt-4"></div>`;

  const input = panel.querySelector('#validate-input');
  const results = panel.querySelector('#validate-results');
  let lastAnalysis = null;

  const run = () => {
    const text = input.value.trim();
    if (!text) { results.innerHTML = ''; lastAnalysis = null; return; }
    try {
      lastAnalysis = analyzeSkillFile(text);
      results.innerHTML = renderValidationResults(lastAnalysis);
      const copyBtn = results.querySelector('#copy-record-btn');
      copyBtn?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(JSON.stringify(lastAnalysis.record, null, 2));
        const status = results.querySelector('#copy-status');
        status.classList.remove('hidden');
        setTimeout(() => status.classList.add('hidden'), 2000);
      });
    } catch (e) {
      results.innerHTML = `<p class="text-sm text-red-500">Could not parse: ${escapeHtml(e.message)}</p>`;
    }
  };

  let debounce;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 300); });
  panel.querySelector('#validate-btn').addEventListener('click', run);
}
