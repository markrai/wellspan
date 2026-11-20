import test from 'node:test';
import assert from 'node:assert/strict';
import { labelImageError, clipboardImages } from '../src/label-image-input.js';

test('label images must be PNG, JPEG or WebP, nonempty and no larger than 5 MiB', () => {
  const image = new Blob(['image'], { type: 'image/png' });
  assert.equal(labelImageError(image), null);
  assert.equal(labelImageError(new Blob(['x'], { type: 'image/jpeg' })), null);
  assert.equal(labelImageError(new Blob(['x'], { type: 'image/webp' })), null);
  assert.match(labelImageError(new Blob(['x'], { type: 'image/gif' })), /PNG, JPEG or WebP/);
  assert.match(labelImageError(new Blob([], { type: 'image/png' })), /1 byte/);
  assert.match(labelImageError(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' })), /5 MiB/);
  assert.match(labelImageError(null), /Select/);
  assert.match(labelImageError({ type: 'image/png', size: 5 }), /Select/);
});

test('clipboard prefers image items without treating copied text as a file', () => {
  const image = new Blob(['image'], { type: 'image/png' });
  assert.deepEqual(clipboardImages([
    { kind: 'string', type: 'text/plain' },
    { kind: 'file', type: 'image/png', getAsFile: () => image }
  ]), [image]);
  assert.deepEqual(clipboardImages([{ kind: 'string', type: 'text/html' }]), []);
  assert.equal(clipboardImages([
    { kind: 'file', type: 'image/png', getAsFile: () => image },
    { kind: 'file', type: 'image/png', getAsFile: () => image }
  ]).length, 2);
});
