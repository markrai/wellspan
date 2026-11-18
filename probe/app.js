import { beginHandoff } from '/src/lobo-handoff.js';
import { assessExtractionReport } from '/src/lobo-report.js';

const $ = id => document.getElementById(id);
let active = null;
const sourceFormat = () => $('recipe-id').value === 'nutrition-label-facts' ? 'image' : 'text';

function status(message) { $('handoff-status').textContent = message; }
function terminal(result) {
  active = null;
  $('run-probe').disabled = false;
  $('cancel-probe').disabled = true;
  if (result.type === 'result') {
    status('LOBO approved and returned a confirmed Recipe result.');
    if (result.output.type === 'json') showReport(result.output.value);
    else {
      $('result-status').textContent = 'Text-only Recipe response. Not a structured extraction report.';
      $('raw-report').textContent = result.output.value;
    }
  } else {
    status({
      declined: 'LOBO declined the request. No Recipe output was shared.',
      failed: 'LOBO declined successful output: ' + (result.code || 'RECIPE_FAILED'),
      cancelled: 'Stopped listening. This does not cancel a Recipe already running on the phone.',
      expired: 'Handoff session expired. Start a new one.'
    }[result.type] || 'Handoff ended.');
  }
}

function showReport(report) {
  const result = assessExtractionReport(report);
  $('result-status').textContent = result.ok
    ? 'Report passed the consumer structure and evidence checks. Still requires source/serving review.'
    : 'Ineligible extraction report. Do not use values.';
  $('result-errors').textContent = result.errors.join('\n');
  $('raw-report').textContent = JSON.stringify(report, null, 2);
  $('nutrition-preview').textContent = result.nutrition
    ? JSON.stringify({ serving: result.serving, nutrients: result.nutrition }, null, 2)
    : 'No validated nutrition preview.';
  $('result-rows').replaceChildren();
  if (!Array.isArray(report?.fields)) {
    $('result-fields').hidden = true;
    return;
  }
  $('result-fields').hidden = false;
  for (const field of report.fields.slice(0, 20)) {
    const row = document.createElement('tr');
    for (const text of [
      field?.label || field?.id || 'Unknown',
      field?.value === null ? 'Not entered' : String(field?.value),
      (field?.status || '') + ' / ' + (field?.support || ''),
      field?.evidence || 'No quoted evidence'
    ]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    $('result-rows').append(row);
  }
}

function updateMode() {
  const image = sourceFormat() === 'image';
  $('photo-input').hidden = !image;
  $('text-input').hidden = image;
}
$('recipe-id').addEventListener('change', updateMode);
$('probe-form').addEventListener('submit', event => {
  event.preventDefault();
  if (active) return;
  const recipeId = $('recipe-id').value;
  const inputs = sourceFormat() === 'image'
    ? { image: $('photo').files?.[0] }
    : { text: $('source-text').value };
  try {
    $('result-status').textContent = 'Waiting for LOBO.';
    active = beginHandoff({
      phoneOrigin: $('phone-origin').value,
      recipeId,
      inputs,
      onStatus: phase => {
        status(phase === 'awaiting-ready'
          ? 'Workbench window opened. Waiting for its authenticated ready message.'
          : 'Workbench received the request. Review the image and Recipe on your phone, then approve or decline.');
      },
      onTerminal: terminal
    });
    $('run-probe').disabled = true;
    $('cancel-probe').disabled = false;
  } catch (error) {
    status('Cannot start handoff: ' + (error?.message || 'unknown error'));
  }
});
$('cancel-probe').addEventListener('click', () => active?.cancel());
document.querySelectorAll('[data-fixture]').forEach(button => {
  button.addEventListener('click', async () => {
    const name = button.dataset.fixture;
    if (!['supported-nutrition', 'unsupported-quote', 'malformed-answer'].includes(name)) return;
    try {
      const response = await fetch('/probe/fixtures/' + name + '.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Fixture unavailable');
      showReport(await response.json());
      status('Loaded published ' + name + ' fixture. No phone contacted.');
    } catch (error) {
      status('Fixture could not be loaded: ' + error.message);
    }
  });
});
updateMode();
