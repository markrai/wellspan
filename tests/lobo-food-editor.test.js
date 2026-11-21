import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareLabelReview, extractedLabelValues } from '../src/lobo-food-editor.js';

const fixture = name => JSON.parse(readFileSync(new URL('../probe/fixtures/' + name + '.json', import.meta.url), 'utf8'));

test('valid extraction automatically maps every supported printed nutrient and retains evidence', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.equal(review.ok, true);
  assert.deepEqual(review.rows.map(row => [row.key, row.value]), [['calories', 185], ['protein', 4.3], ['sodium', null]]);
  assert.equal(review.rows[0].evidence, 'Calories 185');
  assert.deepEqual(review.serving, [{ id: 'serving_g', value: 28 }]);
  assert.deepEqual(extractedLabelValues(review), { calories: 185, protein: 4.3 });
});

test('missing and unsupported nutrients never populate editable values', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.deepEqual(extractedLabelValues(review), { calories: 185, protein: 4.3 });
  for (const name of ['unsupported-quote', 'malformed-answer']) {
    const invalid = prepareLabelReview(fixture(name));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.rows.length, 0);
    assert.throws(() => extractedLabelValues(invalid), /valid extraction report/);
  }
});

test('a report containing only serving details cannot populate the editor', () => {
  const report = structuredClone(fixture('supported-nutrition'));
  report.fields = [report.fields[0]];
  report.counts = { valid: 1, missing: 0, invalid: 0, unsupported: 0 };
  const review = prepareLabelReview(report);
  assert.equal(review.ok, false);
  assert.match(review.errors.join(' '), /No verified nutrition/);
  assert.throws(() => extractedLabelValues(review), /valid extraction report/);
});

test('ambiguous optional sodium quote is displayed but never auto-fills sodium', () => {
  const report = fixture('supported-nutrition');
  const sodium = report.fields.find(field => field.id === 'sodium_mg');
  Object.assign(sodium, { status: 'valid', value: 0, reason: null, support: 'matched', evidence: '0mg' });
  report.counts.valid += 1;
  report.counts.missing -= 1;
  const review = prepareLabelReview(report);
  assert.equal(review.ok, true);
  assert.equal(review.rows.find(row => row.key === 'sodium').quarantined, true);
  assert.equal(review.rows.find(row => row.key === 'sodium').value, null);
  assert.deepEqual(extractedLabelValues(review), { calories: 185, protein: 4.3 });
  assert.match(review.warnings.join(' '), /Sodium.*not imported/);
});

test('only distinct nonnegative finite known nutrients are eligible for automatic application', () => {
  const review = prepareLabelReview(fixture('supported-nutrition'));
  assert.deepEqual(extractedLabelValues({ ...review, rows: [{ key: 'calories', value: 0 }] }), { calories: 0 });
  for (const rows of [
    [{ key: 'other', value: 10 }],
    [{ key: 'calories', value: -1 }],
    [{ key: 'calories', value: Infinity }],
    [{ key: 'calories', value: 1 }, { key: 'calories', value: 2 }],
    [{ key: 'calories', value: undefined }],
    [{ key: 'calories', value: null }]
  ]) assert.throws(() => extractedLabelValues({ ...review, rows }), /invalid|no valid/);
});
