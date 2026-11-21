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

test('serving grams accept only a matching weight linked to the printed serving', () => {
  const report = read('supported-nutrition');
  report.fields.unshift({
    id: 'serving_size', label: 'Serving size as printed', type: 'text', required: false,
    status: 'valid', value: '1/2 cup (125g)', reason: null,
    evidence: 'Serving size 1/2 cup (125g)', support: 'matched'
  });
  report.fields[1].value = 125;
  report.fields[1].evidence = '1/2 cup (125g)';
  report.counts.valid += 1;
  assert.equal(assessExtractionReport(report).ok, true);
  assert.deepEqual(assessExtractionReport(report).serving, [
    { id: 'serving_size', value: '1/2 cup (125g)' },
    { id: 'serving_g', value: 125 }
  ]);

  const short = structuredClone(report);
  short.fields[1].evidence = '125g';
  assert.equal(assessExtractionReport(short).ok, true);

  for (const [evidence, value] of [
    ['Protein 125g', 125],
    ['1/2 cup (125g)', 1],
    ['1/2 cup (126g)', 125],
    ['1/2 cup (125mg)', 125]
  ]) {
    const invalid = structuredClone(report);
    invalid.fields[1].evidence = evidence;
    invalid.fields[1].value = value;
    assert.equal(assessExtractionReport(invalid).ok, false, evidence);
  }

  const unsupported = structuredClone(report);
  unsupported.fields[0].support = 'unmatched';
  assert.equal(assessExtractionReport(unsupported).ok, false);

  const unrelated = structuredClone(report);
  unrelated.fields[0].value = '2 tbsp (125g)';
  unrelated.fields[0].evidence = 'Serving size 2 tbsp (125g)';
  assert.equal(assessExtractionReport(unrelated).ok, false);

  const withoutServingText = structuredClone(report);
  withoutServingText.fields.shift();
  withoutServingText.counts.valid -= 1;
  assert.equal(assessExtractionReport(withoutServingText).ok, false);
  withoutServingText.fields[0].evidence = 'Serving size 125g';
  assert.equal(assessExtractionReport(withoutServingText).ok, true);
});

test('ambiguous optional sodium evidence is quarantined while verified nutrients remain usable', () => {
  const report = read('supported-nutrition');
  const sodium = report.fields.find(field => field.id === 'sodium_mg');
  sodium.status = 'valid';
  sodium.value = 0;
  sodium.reason = null;
  sodium.support = 'matched';
  sodium.evidence = '0mg';
  report.counts.valid += 1;
  report.counts.missing -= 1;

  const result = assessExtractionReport(report);
  assert.equal(result.ok, true);
  assert.equal(result.nutrition.calories, 185);
  assert.equal(result.nutrition.protein, 4.3);
  assert.equal(result.nutrition.sodium, null);
  assert.deepEqual(result.quarantined, ['sodium_mg']);
  assert.match(result.warnings.join(' '), /Sodium.*not imported/);

  const wrongLine = structuredClone(report);
  wrongLine.fields.find(field => field.id === 'sodium_mg').evidence = 'Cholesterol 0mg';
  const wrong = assessExtractionReport(wrongLine);
  assert.equal(wrong.ok, true);
  assert.equal(wrong.nutrition.sodium, null);

  const supported = structuredClone(report);
  supported.fields.find(field => field.id === 'sodium_mg').evidence = 'Sodium 0mg';
  const accepted = assessExtractionReport(supported);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.quarantined, []);
  assert.equal(accepted.nutrition.sodium, 0);

  const required = structuredClone(report);
  required.fields.find(field => field.id === 'sodium_mg').required = true;
  assert.equal(assessExtractionReport(required).ok, false);

  const wrongNumber = structuredClone(report);
  wrongNumber.fields.find(field => field.id === 'sodium_mg').evidence = '1mg';
  assert.equal(assessExtractionReport(wrongNumber).ok, false);

  const unsupported = structuredClone(report);
  unsupported.fields.find(field => field.id === 'sodium_mg').support = 'unmatched';
  unsupported.counts.unsupported += 1;
  assert.equal(assessExtractionReport(unsupported).ok, false);
});

test('printed carbohydrate singular and plural labels import, while ambiguous quotes remain quarantined', () => {
  const base = read('supported-nutrition');
  const nutrient = base.fields.find(field => field.id === 'protein_g');
  nutrient.id = 'carbohydrate_g';
  nutrient.label = 'Total carbohydrate';
  nutrient.value = 4;

  for (const evidence of ['Total Carbohydrate 4g', 'Total Carbohydrates 4g', 'Carbohydrates 4 g', 'Total Carb. 4g', 'Total Carbs 4g']) {
    const report = structuredClone(base);
    report.fields.find(field => field.id === 'carbohydrate_g').evidence = evidence;
    const assessment = assessExtractionReport(report);
    assert.equal(assessment.ok, true, evidence);
    assert.equal(assessment.nutrition.carbs, 4, evidence);
    assert.deepEqual(assessment.quarantined, [], evidence);
  }

  for (const evidence of ['4g', 'Total Fat 4g', 'Dietary Fiber 4g']) {
    const report = structuredClone(base);
    report.fields.find(field => field.id === 'carbohydrate_g').evidence = evidence;
    const assessment = assessExtractionReport(report);
    assert.equal(assessment.ok, true, evidence);
    assert.equal(assessment.nutrition.carbs, null, evidence);
    assert.deepEqual(assessment.quarantined, ['carbohydrate_g'], evidence);
  }

  const mismatch = structuredClone(base);
  mismatch.fields.find(field => field.id === 'carbohydrate_g').evidence = 'Total Carbohydrates 14g';
  assert.equal(assessExtractionReport(mismatch).ok, false);

  const required = structuredClone(base);
  const requiredField = required.fields.find(field => field.id === 'carbohydrate_g');
  requiredField.required = true;
  requiredField.evidence = '4g';
  assert.equal(assessExtractionReport(required).ok, false);
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
