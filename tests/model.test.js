import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, nutrientKeys, freshState, normalizeState, valueOrNull } from '../src/model.js';

test('keeps the original browser-storage identity and food schema', () => {
  assert.equal(KEY, 'wellspan-foodboard-v1');
  const state = freshState();
  assert.equal(state.version, 1);
  assert.ok(state.foods.length > 0);
  assert.deepEqual(Object.keys(state.meals), ['breakfast', 'lunch', 'dinner']);
  for (const food of state.foods) {
    assert.ok(food.id);
    assert.equal(food.notes, '');
    assert.deepEqual(Object.keys(food.nutrients), nutrientKeys);
    assert.ok(nutrientKeys.every(key => food.nutrients[key] === null));
  }
});

test('preserves custom food nutrients, notes and meal placement', () => {
  const state = freshState();
  state.foods[0].nutrients.protein = 0;
  state.foods[0].nutrients.sodium = 75;
  state.foods[0].notes = 'Usual portion';
  state.meals.breakfast.push(state.foods[0].id);
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
});

test('preserves zero distinct from missing nutrient values', () => {
  assert.equal(valueOrNull(''), null);
  assert.equal(valueOrNull('0'), 0);
  assert.equal(valueOrNull('2.5'), 2.5);
  assert.equal(valueOrNull('-3'), null);
  assert.equal(valueOrNull('not-a-number'), null);
});

test('rejects duplicate food names and identifiers', () => {
  const state = freshState();
  state.foods.push({ ...state.foods[0], id: 'another-id', name: state.foods[0].name.toUpperCase() });
  assert.throws(() => normalizeState(state), /duplicated/i);
  state.foods.at(-1).name = 'An unrelated food';
  state.foods.at(-1).id = state.foods[0].id;
  assert.throws(() => normalizeState(state), /duplicated/i);
});

test('rejects invalid meal references and out-of-range nutrient data', () => {
  const state = freshState();
  state.meals.lunch = ['food-that-does-not-exist'];
  assert.throws(() => normalizeState(state), /references/i);
  state.meals.lunch = [];
  state.foods[0].nutrients.sodium = -1;
  assert.throws(() => normalizeState(state), /Invalid nutrient/i);
});
