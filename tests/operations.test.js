import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../src/model.js';
import { applyOperation, decideSync, sameBoard } from '../src/operations.js';

const sample = () => freshState();
const ack = (revision, state) => ({ revision, state });
const workspace = (base, draft, revision = 2, approved = true) => ({
  ack: ack(revision, base),
  projection: draft,
  outbox: [{ id: '1', operation: { type: 'board.replace', board: draft } }],
  bootstrapApproved: approved,
  conflict: null
});

test('food edits keep IDs and preserve missing values distinct from zero', () => {
  const before = sample();
  const original = structuredClone(before.foods[0]);
  const updated = structuredClone(original);
  updated.nutrients.sodium = 0;
  const after = applyOperation(before, { type: 'food.upsert', food: updated, expected: original });
  assert.equal(after.foods[0].id, original.id);
  assert.equal(after.foods[0].nutrients.sodium, 0);
  assert.equal(after.foods[0].nutrients.calories, null);
  assert.equal(before.foods[0].nutrients.sodium, null);
});

test('stale editor is rejected before overwriting another tab', () => {
  const base = sample();
  const original = structuredClone(base.foods[0]);
  const edited = structuredClone(original);
  edited.name = 'Edited name';
  const first = applyOperation(base, { type: 'food.upsert', food: edited, expected: original });
  assert.throws(() => applyOperation(first, { type: 'food.upsert', food: original, expected: original }), /another tab/);
});

test('meal changes persist order and deletion removes references', () => {
  let board = sample();
  const a = board.foods[0].id;
  const b = board.foods[1].id;
  board = applyOperation(board, { type: 'meal.add', meal: 'breakfast', id: a });
  board = applyOperation(board, { type: 'meal.add', meal: 'breakfast', id: b });
  board = applyOperation(board, { type: 'meal.move', meal: 'breakfast', id: b, targetId: a, after: false });
  assert.deepEqual(board.meals.breakfast, [b, a]);
  board = applyOperation(board, { type: 'food.delete', id: b, expected: board.foods[1] });
  assert.deepEqual(board.meals.breakfast, [a]);
});

test('synchronization rejects divergent same or newer revisions', () => {
  const base = sample();
  const edited = applyOperation(base, { type: 'meal.add', meal: 'breakfast', id: base.foods[0].id });
  const local = workspace(base, edited);
  assert.equal(decideSync(local, ack(2, base)), 'replace');
  assert.equal(decideSync(local, ack(3, base)), 'conflict');
  assert.equal(decideSync(local, ack(3, edited)), 'acknowledge');
  assert.equal(decideSync(local, ack(2, edited)), 'acknowledge');
  assert.equal(decideSync(local, ack(2, edited)), 'acknowledge');
  assert.ok(!sameBoard(base, edited));
});

test('bootstrap requires explicit approval and no pre-existing state', () => {
  const draft = sample();
  const local = workspace(null, draft, 0, false);
  assert.equal(decideSync(local, ack(0, null)), 'needs-approval');
  local.bootstrapApproved = true;
  assert.equal(decideSync(local, ack(0, null)), 'bootstrap');
  assert.equal(decideSync(local, ack(1, sample())), 'acknowledge');
});

test('without pending writes, newer server state can be adopted', () => {
  const board = sample();
  const local = workspace(board, board);
  local.outbox = [];
  assert.equal(decideSync(local, ack(3, board)), 'adopt');
  assert.equal(decideSync(local, ack(1, board)), 'conflict');
});
