const PROTOCOL = 'lobo.handoff/v1';
const MAX_TEXT = 16384;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_RESULT_CHARS = 128 * 1024;
const SESSION_TIMEOUT_MS = 240000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECIPE_ID = /^[a-z][a-z0-9-]{0,63}$/;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function canonicalOrigin(value, allowLoopback = false) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid Workbench origin');
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Enter a valid HTTPS Workbench address'); }
  const host = url.hostname;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(host)))) {
    throw new Error('Use only the Workbench HTTPS origin, without a path, query or credentials');
  }
  return url.origin;
}

function validateInputs(recipeId, inputs) {
  if (!RECIPE_ID.test(recipeId)) throw new Error('Invalid Recipe ID');
  if (!plain(inputs) || Object.keys(inputs).length !== 1) throw new Error('Choose exactly one source');
  if (Object.hasOwn(inputs, 'text')) {
    if (typeof inputs.text !== 'string' || !inputs.text.trim() || inputs.text.length > MAX_TEXT) {
      throw new Error('Text must contain 1 to 16,384 characters');
    }
    return { text: inputs.text };
  }
  if (Object.hasOwn(inputs, 'image')) {
    const file = inputs.image;
    if (typeof Blob === 'undefined' || !(file instanceof Blob) ||
      !IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      throw new Error('Use a PNG, JPEG or WebP image between 1 byte and 5 MiB');
    }
    return { image: file };
  }
  throw new Error('Unsupported source type');
}

function beginHandoff({ phoneOrigin, recipeId, inputs, onStatus = () => {}, onTerminal = () => {}, win = window }) {
  const origin = canonicalOrigin(phoneOrigin);
  canonicalOrigin(win.location.origin, true);
  const source = validateInputs(recipeId, inputs);
  const requestId = win.crypto?.randomUUID?.();
  if (!UUID_V4.test(requestId || '')) throw new Error('Cryptographic UUIDv4 is required');
  const target = origin + '/#lobo-handoff=v1&origin=' +
    encodeURIComponent(win.location.origin) + '&requestId=' + requestId;
  let popup = null;
  let phase = 'opening';
  let timeout = null;
  const report = (name, payload) => { phase = name; onStatus(name, payload); };
  const dispose = () => {
    win.removeEventListener('message', onMessage);
    if (timeout !== null) win.clearTimeout(timeout);
    timeout = null;
  };
  const finish = (type, payload) => {
    if (phase === 'complete') return;
    dispose();
    phase = 'complete';
    onTerminal({ type, ...(payload || {}) });
  };
  function onMessage(event) {
    if (phase === 'complete' || !popup || event.source !== popup || event.origin !== origin) return;
    const data = event.data;
    if (!plain(data) || data.protocol !== PROTOCOL || data.requestId !== requestId) return;
    if (data.type === 'ready' && phase === 'awaiting-ready') {
      if (!exact(data, ['protocol', 'type', 'requestId'])) return;
      popup.postMessage({ protocol: PROTOCOL, type: 'request', requestId, recipeId, inputs: source }, origin);
      report('awaiting-approval');
      return;
    }
    if (phase !== 'awaiting-approval') return;
    if (data.type === 'declined' && exact(data, ['protocol', 'type', 'requestId'])) {
      finish('declined');
      return;
    }
    if (data.type === 'failed' && exact(data, ['protocol', 'type', 'requestId', 'recipeId', 'code']) &&
      data.recipeId === recipeId && typeof data.code === 'string' && data.code.length <= 128) {
      finish('failed', { code: data.code });
      return;
    }
    if (data.type !== 'result' || !exact(data, ['protocol', 'type', 'requestId', 'recipeId', 'completion', 'output']) ||
      data.recipeId !== recipeId || data.completion !== 'confirmed' || !plain(data.output) ||
      !exact(data.output, ['type', 'value'])) return;
    const output = data.output;
    if (output.type === 'text' && typeof output.value !== 'string') return;
    if (output.type === 'json' && !plain(output.value)) return;
    if (!['text', 'json'].includes(output.type)) return;
    let serialized;
    try { serialized = JSON.stringify(output.value); } catch { return; }
    if (typeof serialized !== 'string' || serialized.length > MAX_RESULT_CHARS) return;
    finish('result', { recipeId, output, completion: 'confirmed' });
  }
  win.addEventListener('message', onMessage);
  try {
    popup = win.open(target, '_blank');
  } catch (error) {
    dispose();
    throw error;
  }
  if (!popup) {
    dispose();
    throw new Error('The Workbench window was blocked by the browser');
  }
  report('awaiting-ready');
  timeout = win.setTimeout(() => finish('expired'), SESSION_TIMEOUT_MS);
  return {
    requestId,
    popup,
    get phase() { return phase; },
    cancel() { if (phase !== 'complete') finish('cancelled'); }
  };
}

export { PROTOCOL, MAX_TEXT, MAX_IMAGE_BYTES, MAX_RESULT_CHARS, SESSION_TIMEOUT_MS, canonicalOrigin, validateInputs, beginHandoff };
