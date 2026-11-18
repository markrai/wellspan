import test from 'node:test';
import assert from 'node:assert/strict';
import { beginHandoff, canonicalOrigin, validateInputs, MAX_IMAGE_BYTES, PROTOCOL } from '../src/lobo-handoff.js';
import { readFileSync } from 'node:fs';

const ID = '12345678-1234-4234-9234-123456789abc';
const PHONE = 'https://phone.example:7869';
const APP = 'https://wellspan.example:18789';
const report = JSON.parse(readFileSync(new URL('../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8'));

function harness(inputs = { image: new Blob(['image bytes'], { type: 'image/png' }) }, recipeId = 'nutrition-label-facts') {
  const messages = [];
  const posted = [];
  const phases = [];
  const terminal = [];
  let opened = null;
  let timer = null;
  const popup = {
    postMessage(data, origin) { posted.push({ data, origin }); },
    closed: false
  };
  const win = {
    location: { origin: APP },
    crypto: { randomUUID: () => ID },
    open(url, where) { opened = { url, where }; return popup; },
    addEventListener(type, fn) { messages.push({ type, fn }); },
    removeEventListener(type, fn) {
      const index = messages.findIndex(item => item.type === type && item.fn === fn);
      if (index >= 0) messages.splice(index, 1);
    },
    setTimeout(fn, ms) { timer = { fn, ms }; return 1; },
    clearTimeout() { timer = null; }
  };
  const session = beginHandoff({
    win, phoneOrigin: PHONE, recipeId, inputs,
    onStatus: phase => phases.push(phase),
    onTerminal: result => terminal.push(result)
  });
  const deliver = (data, origin = PHONE, source = popup) => {
    for (const { fn } of [...messages]) fn({ data, origin, source });
  };
  const ready = () => deliver({ protocol: PROTOCOL, type: 'ready', requestId: ID });
  const result = () => deliver({
    protocol: PROTOCOL, type: 'result', requestId: ID, recipeId,
    completion: 'confirmed', output: { type: 'json', value: report }
  });
  return { session, deliver, ready, result, terminal, posted, phases, get opened() { return opened; }, get timer() { return timer; } };
}

test('only an HTTPS Workbench origin without credentials, path or query is accepted', () => {
  assert.equal(canonicalOrigin(PHONE + '/'), PHONE);
  for (const url of [
    'http://phone.example:7869', 'https://user:pw@phone.example:7869',
    PHONE + '/workbench', PHONE + '?x=1', PHONE + '/#secret',
    'javascript:alert(1)', 'https://evil.example@phone.example',
    'ftp://phone.example'
  ]) assert.throws(() => canonicalOrigin(url));
  assert.equal(canonicalOrigin('http://127.0.0.1:3000', true), 'http://127.0.0.1:3000');
});

test('popup invitation contains only origin and cryptographic nonce, never the image bytes', () => {
  const env = harness();
  const target = new URL(env.opened.url);
  assert.equal(env.opened.where, '_blank');
  assert.equal(target.origin, PHONE);
  assert.equal(target.hash, '#lobo-handoff=v1&origin=' + encodeURIComponent(APP) + '&requestId=' + ID);
  assert.equal(env.posted.length, 0);
  assert.equal(env.timer.ms, 240000);
});

test('authenticated ready alone emits request to the exact verified phone origin', () => {
  const env = harness();
  env.deliver({ protocol: PROTOCOL, type: 'ready', requestId: ID }, 'https://impostor.example');
  env.deliver({ protocol: PROTOCOL, type: 'ready', requestId: '00000000-0000-4000-8000-000000000001' });
  env.deliver({ protocol: PROTOCOL, type: 'ready', requestId: ID }, PHONE, {});
  env.deliver({ protocol: PROTOCOL, type: 'ready', requestId: ID, leaked: true });
  assert.equal(env.posted.length, 0);
  env.ready();
  assert.equal(env.posted.length, 1);
  assert.equal(env.posted[0].origin, PHONE);
  assert.equal(env.posted[0].data.requestId, ID);
  assert.equal(env.posted[0].data.recipeId, 'nutrition-label-facts');
  assert.equal(env.posted[0].data.inputs.image.type, 'image/png');
  env.ready();
  assert.equal(env.posted.length, 1);
});

test('confirmed result from exact opener is terminal and cannot replay', () => {
  const env = harness();
  env.ready();
  env.deliver({
    protocol: PROTOCOL, type: 'result', requestId: ID, recipeId: 'nutrition-label-facts',
    completion: 'confirmed', output: { type: 'json', value: report }
  }, 'https://impostor.example');
  env.deliver({
    protocol: PROTOCOL, type: 'result', requestId: ID, recipeId: 'nutrition-label-facts',
    completion: 'unconfirmed', output: { type: 'json', value: report }
  });
  assert.equal(env.terminal.length, 0);
  env.result();
  assert.equal(env.terminal.length, 1);
  assert.equal(env.terminal[0].completion, 'confirmed');
  env.result();
  assert.equal(env.terminal.length, 1);
});

test('failure and user decline are terminal and do not disclose a model result', () => {
  const failed = harness();
  failed.ready();
  failed.deliver({ protocol: PROTOCOL, type: 'failed', requestId: ID,
    recipeId: 'nutrition-label-facts', code: 'RECIPE_FAILED' });
  assert.deepEqual(failed.terminal, [{ type: 'failed', code: 'RECIPE_FAILED' }]);
  const decline = harness();
  decline.ready();
  decline.deliver({ protocol: PROTOCOL, type: 'declined', requestId: ID });
  assert.deepEqual(decline.terminal, [{ type: 'declined' }]);
});

test('cancel and expiry prevent any later message from being accepted', () => {
  const cancelled = harness();
  cancelled.session.cancel();
  cancelled.ready();
  cancelled.result();
  assert.deepEqual(cancelled.terminal, [{ type: 'cancelled' }]);
  const expired = harness();
  expired.timer.fn();
  expired.ready();
  assert.deepEqual(expired.terminal, [{ type: 'expired' }]);
});

test('request rejects unknown Recipe names, text/image limits and unsafe MIME types', () => {
  assert.throws(() => validateInputs('Bad Recipe', { text: 'yes' }));
  assert.throws(() => validateInputs('extract-to-json', { text: ' '.repeat(4) }));
  assert.throws(() => validateInputs('extract-to-json', { text: 'x'.repeat(16385) }));
  assert.throws(() => validateInputs('nutrition-label-facts', { image: new Blob(['x'], { type: 'image/gif' }) }));
  assert.throws(() => validateInputs('nutrition-label-facts', { image: new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' }) }));
  assert.throws(() => validateInputs('nutrition-label-facts', { image: new Blob([], { type: 'image/png' }) }));
  assert.throws(() => validateInputs('nutrition-label-facts', { text: 'x', image: new Blob(['x'], { type: 'image/png' }) }));
});

test('text-only handoff supports other existing Workbench Recipes', () => {
  const env = harness({ text: 'Vendor: Example' }, 'extract-to-json');
  env.ready();
  assert.deepEqual(env.posted[0].data.inputs, { text: 'Vendor: Example' });
  env.deliver({ protocol: PROTOCOL, type: 'result', requestId: ID,
    recipeId: 'extract-to-json', completion: 'confirmed', output: { type: 'text', value: 'Example' } });
  assert.equal(env.terminal[0].output.value, 'Example');
});

test('oversized or malformed results are not accepted', () => {
  const env = harness();
  env.ready();
  for (const output of [
    { type: 'json', value: [] },
    { type: 'json', value: { content: 'x'.repeat(128 * 1024) } },
    { type: 'text', value: {} },
    { type: 'file', value: {} }
  ]) env.deliver({ protocol: PROTOCOL, type: 'result', requestId: ID, recipeId: 'nutrition-label-facts',
    completion: 'confirmed', output });
  assert.equal(env.terminal.length, 0);
  env.session.cancel();
});
