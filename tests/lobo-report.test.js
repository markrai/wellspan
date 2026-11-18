import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assessExtractionReport, numericEvidenceContains } from '../src/lobo-report.js';

const fixtures = {
  'supported-nutrition': '46c10412799a5b660ae2515e347f37540f8c435064c460bf29151d24bde70a8f',
  'unsupported-quote': '38ba15e1967c4d9d5146dc71108a091468d4d22d2c37fce597097765ec8ece76',
  'malformed-answer': '72ad65451a57148538122c87220d7ec07f30348a486fbc4d36b4c49f1f055f16'
};
const read = name => JSON.parse(readFileSync(new URL('../probe/fixtures/' + name + '.json', import.meta.url), 'utf8'));

test('copied public contract fixtures preserve byte parity', () => {
  for (const [name, expected] of Object.entries(fixtures)) {
    const bytes = readFileSync(new URL('../probe/fixtures/' + name + '.json', import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
});

test('supported nutrition is eligible for review but not for automatic ingestion', () => {
  const report = read('supported-nutrition');
  const assessment = assessExtractionReport(report);
  assert.equal(assessment.ok, true);
  assert.equal(assessment.nutrition.calories, 185);
  assert.equal(assessment.nutrition.protein, 4.3);
  assert.equal(assessment.nutrition.sodium, null);
  assert.equal(assessment.nutrition.satFat, null);
  assert.deepEqual(assessment.serving, [{ id: 'serving_g', value: 28 }]);
  assert.match(assessment.warnings.join(' '), /original label/);
});

test('structurally valid but unsupported evidence is blocked', () => {
  const assessment = assessExtractionReport(read('unsupported-quote'));
  assert.equal(assessment.ok, false);
  assert.equal(assessment.nutrition, null);
  assert.match(assessment.errors.join(' '), /source-matched|unsupported/);
});

test('malformed extraction diagnostic is refused', () => {
  const assessment = assessExtractionReport(read('malformed-answer'));
  assert.equal(assessment.ok, false);
  assert.equal(assessment.nutrition, null);
});

test('report parser fails closed on unknown schema, extra properties, bad counts and duplicate IDs', () => {
  const source = read('supported-nutrition');
  for (const change of [
    draft => { draft.schema = 'lobo.extract.report/v2'; },
    draft => { draft.mystery = 1; },
    draft => { draft.counts.valid = 2; },
    draft => { draft.fields[1].id = draft.fields[0].id; },
    draft => { draft.fields[0].surprise = true; },
    draft => { draft.fields[0].value = null; },
    draft => { draft.fields[0].type = 'text'; },
    draft => { draft.fields[0].evidence = 'Calories 28'; }
  ]) {
    const draft = structuredClone(source);
    change(draft);
    assert.equal(assessExtractionReport(draft).ok, false, JSON.stringify(draft));
  }
});

test('numeric evidence checks token values instead of numeric substrings', () => {
  assert.equal(numericEvidenceContains('Protein 4.3 g', 4.3), true);
  assert.equal(numericEvidenceContains('Calories 180', 80), false);
  assert.equal(numericEvidenceContains('Protein 14.3 g', 4.3), false);
  assert.equal(numericEvidenceContains('Sodium 1,200 mg', 1200), true);
  assert.equal(numericEvidenceContains('Fat 0 g', 0), true);
});

test('an explicit zero stays zero while an absent nutrient stays null', () => {
  const report = read('supported-nutrition');
  report.fields[2].value = 0;
  report.fields[2].evidence = 'Protein 0 g';
  const assessment = assessExtractionReport(report);
  assert.equal(assessment.ok, true);
  assert.equal(assessment.nutrition.protein, 0);
  assert.equal(assessment.nutrition.sodium, null);
});

test('unreasonable or negative nutrition quantities block the draft mapping', () => {
  const report = read('supported-nutrition');
  report.fields[1].value = -185;
  report.fields[1].evidence = 'Calories -185';
  const assessment = assessExtractionReport(report);
  assert.equal(assessment.ok, false);
  assert.equal(assessment.nutrition, null);
});
