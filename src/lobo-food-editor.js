import { beginHandoff, canonicalOrigin } from './lobo-handoff.js';
import { normalizeDiscovery, chooseDevice, preferredDevice, rememberDevice } from './lobo-discovery.js';
import { createLabelImageInput } from './label-image-input.js';
import { NUTRIENTS, assessExtractionReport } from './lobo-report.js';

const UNITS = Object.freeze({ calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g', satFat: 'g', fiber: 'g', sugars: 'g', sodium: 'mg', cholesterol: 'mg' });
const FRIENDLY = Object.freeze({ calories: 'Calories', protein: 'Protein', carbs: 'Total carbohydrates', fat: 'Total fat', satFat: 'Saturated fat', fiber: 'Fiber', sugars: 'Total sugars', sodium: 'Sodium', cholesterol: 'Cholesterol' });
const LAST_WORKBENCH_KEY = 'wellspan.lobo.lastWorkbench/v1';

function rememberedWorkbench(storage) {
  try {
    const value = storage?.getItem(LAST_WORKBENCH_KEY);
    return value && canonicalOrigin(value) === value ? value : '';
  } catch {
    return '';
  }
}

function rememberWorkbench(storage, value) {
  try {
    const origin = canonicalOrigin(value);
    storage?.setItem(LAST_WORKBENCH_KEY, origin);
    return origin;
  } catch {
    return '';
  }
}

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
  const devicePicker = $('label-device');
  const refreshDevices = $('label-refresh-devices');
  const discoveryStatus = $('label-discovery-status');
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
  const preferenceStorage = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  let lastOrigin = rememberedWorkbench(preferenceStorage);
  let discovered = [];
  let discoverySession = 0;
  let manualOverride = false;

  function discoveryMessage(message) { discoveryStatus.textContent = message; }
  function renderDevices(devices) {
    devicePicker.replaceChildren();
    const manual = document.createElement('option');
    manual.value = '';
    manual.textContent = 'Manual HTTPS address';
    devicePicker.append(manual);
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.id + ' · ' + device.origin;
      devicePicker.append(option);
    }
    devicePicker.disabled = devices.length === 0;
  }
  async function discoverDevices() {
    const expectedSession = ++discoverySession;
    discoveryMessage('Looking for LOBO devices advertised on Vega’s LAN…');
    refreshDevices.disabled = true;
    try {
      const result = await fetch('/api/v1/lobo/devices', {
        method: 'GET', cache: 'no-store', credentials: 'same-origin',
        signal: AbortSignal.timeout(7000)
      });
      if (!result.ok) throw new Error('discovery_unavailable');
      const response = await result.json();
      if (expectedSession !== discoverySession || !dialog.open) return;
      discovered = normalizeDiscovery(response);
      renderDevices(discovered);
      const chosen = chooseDevice(discovered, preferredDevice(preferenceStorage), lastOrigin);
      if (!manualOverride && chosen) {
        origin.value = chosen.origin;
        devicePicker.value = chosen.id;
      } else {
        devicePicker.value = discovered.find(device => device.origin === origin.value)?.id || '';
      }
      if (discovered.length === 0) {
        discoveryMessage('No fresh LOBO advertisements from Vega. Your saved or manual address remains available.');
      } else if (chosen && !manualOverride) {
        discoveryMessage('Suggested ' + chosen.id + ' from Vega’s LAN. Browser HTTPS trust and reachability are still required.');
      } else {
        discoveryMessage(discovered.length + ' LOBO devices advertised on Vega’s LAN. Choose one or enter an address.');
      }
    } catch {
      if (expectedSession === discoverySession && dialog.open) {
        discovered = [];
        renderDevices([]);
        discoveryMessage('Discovery unavailable. Use your remembered Workbench or enter its HTTPS address.');
      }
    } finally {
      if (expectedSession === discoverySession) refreshDevices.disabled = false;
    }
  }

  devicePicker.addEventListener('change', () => {
    const selected = discovered.find(device => device.id === devicePicker.value);
    if (!selected) {
      manualOverride = true;
      return;
    }
    session++;
    stopListening();
    clearReview();
    origin.value = selected.origin;
    manualOverride = false;
    discoveryMessage('Selected ' + selected.id + '. This LAN advertisement does not prove the phone is trusted or reachable.');
  });
  origin.addEventListener('input', () => {
    session++;
    stopListening();
    clearReview();
    manualOverride = true;
    devicePicker.value = discovered.find(device => device.origin === origin.value)?.id || '';
  });
  refreshDevices.addEventListener('click', discoverDevices);

  const imageInput = createLabelImageInput({
    dialog, photo, preview: image,
    dropZone: $('label-drop-zone'), browse: $('label-browse'), paste: $('label-paste'),
    fileName: $('label-file-name'), notify: statusText,
    beforeReplace: () => {
      session += 1;
      stopListening();
      clearReview();
    }
  });

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
    discoverySession += 1;
    manualOverride = false;
    discovered = [];
    renderDevices([]);
    refreshDevices.disabled = false;
    discoveryMessage('Discovering LOBO devices requires the Vega LAN helper.');
    stopListening();
    clearReview();
    imageInput.reset();
    origin.value = lastOrigin;
    statusText('');
  }
  function open() {
    void discoverDevices();
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
      expired: result.stage === 'ready'
        ? 'LOBO did not establish a handoff in time. Check the phone address, certificate, and whether the Workbench opened.'
        : 'LOBO did not return a confirmed result within 15 minutes after connecting. The Recipe may have finished on the phone, but Wellspan cannot accept an expired handoff.',
      unavailable: 'LOBO could not receive the handoff request. Check the Workbench window and retry.'
    };
    statusText(reason[result.type] || 'LOBO did not return a usable result: ' + (result.code || 'unknown error'));
  }

  run.addEventListener('click', () => {
    session += 1;
    stopListening();
    clearReview();
    const currentSession = session;
    try {
      const requestedOrigin = canonicalOrigin(origin.value);
      const handoff = beginHandoff({
        phoneOrigin: requestedOrigin,
        recipeId: 'nutrition-label-facts',
        inputs: { image: imageInput.image },
        onStatus: (phase, details) => {
          if (session !== currentSession || !dialog.open) return;
          if (phase === 'awaiting-ready') {
            statusText('Waiting for LOBO Workbench to connect.');
          } else if (phase === 'awaiting-approval') {
            lastOrigin = rememberWorkbench(preferenceStorage, requestedOrigin) || requestedOrigin;
            rememberDevice(preferenceStorage, discovered.find(device => device.origin === requestedOrigin)?.id || '');
            statusText('LOBO received the label. Waiting for the Recipe result; this can take several minutes.');
          } else if (phase === 'rejected-result') {
            statusText('LOBO sent a result that Wellspan rejected (' + details.code + '). No values were applied; waiting for a valid result.');
          }
        },
        onTerminal: terminal => onTerminal(terminal, currentSession)
      });
      active = handoff;
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
  return { reset, open };
}

export { LAST_WORKBENCH_KEY, rememberedWorkbench, rememberWorkbench, prepareLabelReview, approvedLabelValues, createLabelAssistant };
