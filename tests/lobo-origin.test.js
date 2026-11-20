import test from 'node:test';
import assert from 'node:assert/strict';
import { LAST_WORKBENCH_KEY, rememberedWorkbench, rememberWorkbench } from '../src/lobo-food-editor.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    rawSet: (key, value) => data.set(key, value)
  };
}

test('a validated HTTPS Workbench origin persists across modal sessions', () => {
  const storage = memoryStorage();
  assert.equal(rememberedWorkbench(storage), '');
  assert.equal(rememberWorkbench(storage, 'https://192.168.1.200:7869/'), 'https://192.168.1.200:7869');
  assert.equal(rememberedWorkbench(storage), 'https://192.168.1.200:7869');
  assert.equal(rememberWorkbench(storage, 'https://192.168.1.201:7869'), 'https://192.168.1.201:7869');
  assert.equal(rememberedWorkbench(storage), 'https://192.168.1.201:7869');
});

test('untrusted, malformed and non-HTTPS origins cannot be restored or persisted', () => {
  const storage = memoryStorage();
  for (const unsafe of ['http://192.168.1.200:7869', 'https://host.example/a',
    'https://name:password@host.example', 'not a URL']) {
    assert.equal(rememberWorkbench(storage, unsafe), '');
    storage.rawSet(LAST_WORKBENCH_KEY, unsafe);
    assert.equal(rememberedWorkbench(storage), '');
  }
  storage.rawSet(LAST_WORKBENCH_KEY, 'https://192.168.1.200:7869');
  assert.equal(rememberWorkbench(storage, 'https://host.example/#x'), '');
  assert.equal(rememberedWorkbench(storage), 'https://192.168.1.200:7869');
});

test('storage permission and quota errors do not prevent manual use', () => {
  const blocked = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('quota exceeded'); }
  };
  assert.equal(rememberedWorkbench(blocked), '');
  assert.equal(rememberWorkbench(blocked, 'https://192.168.1.200:7869'), '');
  assert.equal(rememberedWorkbench(null), '');
  assert.equal(rememberWorkbench(null, 'https://192.168.1.200:7869'), 'https://192.168.1.200:7869');
});
