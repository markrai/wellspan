import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareLabelReview, approvedLabelValues } from '../src/lobo-food-editor.js';

const fixture = name => JSON.parse(readFileSync(new URL('../probe/fixtures/' + name + '.json', import.meta.url), 'utf8'));

test('eligible nutrition maps to review-only fields with evidence and serving basis', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.equal(review.ok, true);
  assert.deepEqual(review.rows.map(row => [row.key, row.value]), [['calories', 185], ['protein', 4.3], ['sodium', null]]);
  assert.equal(review.rows[0].evidence, 'Calories 185');
  assert.deepEqual(review.serving, [{ id: 'serving_g', value: 28 }]);
  assert.deepEqual(approvedLabelValues(review, ['protein', 'calories'], true), { protein: 4.3, calories: 185 });
});

test('missing, malformed and unsupported nutrients never become editable values', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.throws(() => approvedLabelValues(review, ['sodium'], true), /unavailable/);
  assert.throws(() => approvedLabelValues(review, ['protein'], false), /Confirm/);
  assert.throws(() => approvedLabelValues(review, [], true), /Select/);
  assert.throws(() => approvedLabelValues(review, ['calories', 'calories'], true), /unique/);
  assert.throws(() => approvedLabelValues(review, ['other'], true), /unavailable/);
  for (const name of ['unsupported-quote', 'malformed-answer']) {
    const invalid = prepareLabelReview(fixture(name));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.rows.length, 0);
    assert.throws(() => approvedLabelValues(invalid, ['calories'], true), /Confirm/);
  }
});

test('a report containing only serving details cannot be auto-applied', () => {
  const report = structuredClone(fixture('supported-nutrition'));
  report.fields = [report.fields[0]];
  report.counts = { valid: 1, missing: 0, invalid: 0, unsupported: 0 };
  const review = prepareLabelReview(report);
  assert.equal(review.ok, false);
  assert.match(review.errors.join(' '), /No verified nutrition/);
});

test('selection never writes unselected or missing nutrients', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.deepEqual(approvedLabelValues(review, ['protein'], true), { protein: 4.3 });
});
