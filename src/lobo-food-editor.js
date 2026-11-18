import { beginHandoff } from './lobo-handoff.js';
import { NUTRIENTS, assessExtractionReport } from './lobo-report.js';

const UNITS = Object.freeze({ calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g', satFat: 'g', fiber: 'g', sugars: 'g', sodium: 'mg', cholesterol: 'mg' });
const FRIENDLY = Object.freeze({ calories: 'Calories', protein: 'Protein', carbs: 'Total carbohydrates', fat: 'Total fat', satFat: 'Saturated fat', fiber: 'Fiber', sugars: 'Total sugars', sodium: 'Sodium', cholesterol: 'Cholesterol' });

function prepareLabelReview(report) {
  const result = assessExtractionReport(report);
  if (!result.ok) return { ok: false, errors: result.errors, rows: [], serving: [] };
  const rows = report.fields.filter(field => Object.hasOwn(NUTRIENTS, field.id)).map(field => {
    const key = NUTRIENTS[field.id];
    return { key, label: FRIENDLY[key], unit: UNITS[key], value: field.status === 'valid' ? result.nutrition[key] : null, evidence: field.status === 'valid' ? field.evidence : null };
  });
  if (!rows.some(row => row.value !== null)) return { ok: false, errors: ['No verified nutrition values were returned.'], rows: [], serving: result.serving };
  return { ok: true, errors: [], rows, serving: result.serving };
}

function approvedLabelValues(review, keys, confirmedPortion) {
  if (!review?.ok || !confirmedPortion) throw new Error('Confirm that the label serving matches your usual portion.');
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length) throw new Error('Select at least one unique nutrient to apply.');
  const rows = new Map(review.rows.map(row => [row.key, row]));
  const values = {};
  for (const key of keys) {
    const row = rows.get(key);
    if (!row || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) throw new Error('Selected nutrient is unavailable or invalid.');
    values[key] = row.value;
  }
  return values;
}

function createLabelAssistant({ getExisting, applyValues }) {
  const $ = id => document.getElementById(id);
  const dialog = $('food-dialog');
  const photo = $('label-photo');
  const origin = $('label-origin');
  const status = $('label-status');
  const run = $('label-run');
  const stop = $('label-stop');
  const reviewPanel = $('label-review');
  const apply = $('label-apply');
  const portion = $('label-portion-confirm');
  const table = $('label-fields');
  const image = $('label-photo-preview');
  let session = 0;
  let active = null;
  let review = null;
  let previewUrl = null;
  let lastOrigin = '';

  function statusText(message) { status.textContent = message; }
  function clearReview() {
    review = null;
    table.replaceChildren();
    reviewPanel.hidden = true;
    portion.checked = false;
    apply.disabled = true;
  }
  function stopListening() {
    if (active) {
      const handoff = active;
      active = null;
      handoff.cancel();
    }
    run.disabled = false;
    stop.hidden = true;
  }
  function reset() {
    session += 1;
    stopListening();
    clearReview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    image.removeAttribute('src');
    image.hidden = true;
    photo.value = '';
    origin.value = lastOrigin;
    statusText('');
  }
  function updateApply() {
    apply.disabled = !review?.ok || !portion.checked || table.querySelectorAll('input[data-nutrient]:checked').length === 0;
  }
  function showReview(report) {
    clearReview();
    review = prepareLabelReview(report);
    if (!review.ok) {
      statusText('LOBO extraction was not eligible: ' + review.errors.join('; '));
      return;
    }
    const serving = review.serving.map(item => item.value === null ? item.id + ': not printed' : item.id + ': ' + String(item.value)).join(' · ');
    $('label-serving').textContent = serving || 'Serving details were not supplied. Check the original label.';
    for (const row of review.rows) {
      const tr = document.createElement('tr');
      const selection = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.nutrient = row.key;
      checkbox.disabled = row.value === null;
      checkbox.checked = row.value !== null && getExisting(row.key) === '';
      checkbox.setAttribute('aria-label', 'Use ' + row.label);
      checkbox.addEventListener('change', updateApply);
      selection.append(checkbox);
      const nutrient = document.createElement('td');
      nutrient.textContent = row.label;
      const value = document.createElement('td');
      value.textContent = row.value === null ? 'Not printed' : String(row.value) + ' ' + row.unit;
      const evidence = document.createElement('td');
      evidence.textContent = row.evidence || 'No printed value';
      tr.append(selection, nutrient, value, evidence);
      table.append(tr);
    }
    reviewPanel.hidden = false;
    statusText('LOBO returned checked values. Compare the image, evidence and serving before applying.');
    updateApply();
  }
  function onTerminal(result, expectedSession) {
    if (expectedSession !== session || !dialog.open) return;
    active = null;
    run.disabled = false;
    stop.hidden = true;
    if (result.type === 'result') {
      if (result.output?.type !== 'json') {
        statusText('LOBO returned text, not a nutrition extraction report.');
        return;
      }
      showReview(result.output.value);
      return;
    }
    const reason = {
      declined: 'LOBO did not approve this request.',
      cancelled: 'Stopped listening. This does not stop inference already running on the phone.',
      expired: 'The LOBO handoff expired.'
    };
    statusText(reason[result.type] || 'LOBO could not return an approved result: ' + (result.code || 'unknown error'));
  }

  photo.addEventListener('change', () => {
    session += 1;
    stopListening();
    clearReview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    image.hidden = true;
    image.removeAttribute('src');
    const file = photo.files?.[0];
    if (file && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024) {
      previewUrl = URL.createObjectURL(file);
      image.src = previewUrl;
      image.hidden = false;
      statusText('Compare the original label carefully before applying values.');
    } else if (file) {
      statusText('Select a PNG, JPEG or WebP image up to 5 MiB.');
    } else {
      statusText('');
    }
  });
  run.addEventListener('click', () => {
    session += 1;
    stopListening();
    clearReview();
    const currentSession = session;
    try {
      const handoff = beginHandoff({
        phoneOrigin: origin.value,
        recipeId: 'nutrition-label-facts',
        inputs: { image: photo.files?.[0] },
        onStatus: phase => {
          if (session === currentSession) statusText(phase === 'awaiting-ready'
            ? 'Waiting for LOBO Workbench to connect.'
            : 'Approve the image and Recipe in the LOBO Workbench window.');
        },
        onTerminal: terminal => onTerminal(terminal, currentSession)
      });
      active = handoff;
      lastOrigin = origin.value.trim();
      run.disabled = true;
      stop.hidden = false;
    } catch (error) {
      statusText('Cannot start LOBO: ' + (error?.message || 'invalid request'));
    }
  });
  stop.addEventListener('click', () => { if (active) stopListening(); });
  portion.addEventListener('change', updateApply);
  apply.addEventListener('click', () => {
    try {
      const keys = [...table.querySelectorAll('input[data-nutrient]:checked')].map(input => input.dataset.nutrient);
      const values = approvedLabelValues(review, keys, portion.checked);
      applyValues(values);
      statusText('Applied ' + keys.length + ' selected nutrient values to the editor. Save food to persist them.');
      apply.disabled = true;
    } catch (error) {
      statusText(error?.message || 'Unable to apply values.');
    }
  });
  dialog.addEventListener('close', reset);
  return { reset };
}

export { prepareLabelReview, approvedLabelValues, createLabelAssistant };
