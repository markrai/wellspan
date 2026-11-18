const REPORT_SCHEMA = 'lobo.extract.report/v1';
const REPORT_KEYS = ['schema', 'status', 'format', 'problems', 'fields', 'counts'];
const FIELD_KEYS = ['id', 'label', 'type', 'required', 'status', 'value', 'reason', 'evidence', 'support'];
const COUNT_KEYS = ['valid', 'missing', 'invalid', 'unsupported'];
const TYPES = new Set(['text', 'number', 'date', 'boolean']);
const STATUS = new Set(['valid', 'missing', 'invalid']);
const SUPPORT = new Set(['matched', 'unmatched', 'none']);
const EVIDENCE_TERMS = Object.freeze({
  serving_g: /\b(serving|portion)\b/i,
  calories_kcal: /\b(calories|energy)\b/i,
  protein_g: /\bprotein\b/i,
  carbohydrate_g: /\b(carbohydrate|carbs?)\b/i,
  fat_g: /\b(total fat|fat)\b/i,
  saturated_fat_g: /\bsaturat/i,
  fiber_g: /\b(fiber|fibre)\b/i,
  sugar_g: /\bsugars?\b/i,
  sodium_mg: /\bsodium\b/i,
  cholesterol_mg: /\bcholesterol\b/i
});
const NUTRIENTS = Object.freeze({
  calories_kcal: 'calories',
  protein_g: 'protein',
  carbohydrate_g: 'carbs',
  fat_g: 'fat',
  saturated_fat_g: 'satFat',
  fiber_g: 'fiber',
  sugar_g: 'sugars',
  sodium_mg: 'sodium',
  cholesterol_mg: 'cholesterol'
});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactly = (value, allowed) => plain(value) && Object.keys(value).length === allowed.length &&
  allowed.every(key => Object.hasOwn(value, key));

function numericEvidenceContains(quote, value) {
  if (typeof quote !== 'string' || !Number.isFinite(value)) return false;
  const numbers = quote.match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
  return numbers.some(part => Number(part.replaceAll(',', '')) === value);
}

function validateField(field, seen, errors) {
  if (!exactly(field, FIELD_KEYS)) {
    errors.push('Field contains missing or unexpected properties');
    return;
  }
  const id = field.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(id)) {
    errors.push('Field ID is invalid');
    return;
  }
  if (seen.has(id)) errors.push('Duplicate field ID: ' + id);
  seen.add(id);
  if (typeof field.label !== 'string' || field.label.length < 1 || field.label.length > 60 ||
    typeof field.required !== 'boolean' || !TYPES.has(field.type) ||
    !STATUS.has(field.status) || !SUPPORT.has(field.support)) {
    errors.push(id + ': invalid field metadata');
    return;
  }
  if (field.reason !== null && typeof field.reason !== 'string') errors.push(id + ': invalid reason');
  if (field.evidence !== null && (typeof field.evidence !== 'string' || field.evidence.length > 300)) {
    errors.push(id + ': invalid evidence');
  }
  if (field.support === 'none' ? field.evidence !== null : !field.evidence) {
    errors.push(id + ': evidence/support disagree');
  }
  if (field.status === 'valid') {
    const value = field.value;
    if (value === null) errors.push(id + ': missing valid value');
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15)) {
      errors.push(id + ': invalid number');
    }
    if (field.type === 'text' && (typeof value !== 'string' || value.length > 500)) errors.push(id + ': invalid text');
    if (field.type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      errors.push(id + ': invalid date');
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') errors.push(id + ': invalid boolean');
    if (field.support !== 'matched') errors.push(id + ': no source-matched evidence');
    if (field.type === 'number' && field.support === 'matched' && !numericEvidenceContains(field.evidence, value)) {
      errors.push(id + ': numeric value does not appear in its quoted evidence');
    }
    if (field.type === 'number' && field.support === 'matched' && EVIDENCE_TERMS[id] &&
      !EVIDENCE_TERMS[id].test(field.evidence || '')) {
      errors.push(id + ': quoted evidence does not identify the expected nutrition field');
    }
    if (field.type === 'text' && typeof value === 'string' && field.support === 'matched' &&
      !field.evidence?.toLocaleLowerCase().includes(value.toLocaleLowerCase())) {
      errors.push(id + ': text does not appear in its quoted evidence');
    }
  } else {
    if (field.value !== null) errors.push(id + ': missing/invalid field has a non-null value');
    if (field.required) errors.push(id + ': required field is missing or invalid');
    if (field.status === 'invalid') errors.push(id + ': producer reported invalid field');
  }
}

function assessExtractionReport(report) {
  const errors = [];
  if (!exactly(report, REPORT_KEYS) || report.schema !== REPORT_SCHEMA) {
    return { ok: false, errors: ['Unknown or malformed extraction-report contract'], warnings: [], nutrition: null };
  }
  if (!['valid', 'invalid'].includes(report.status) || !['json', 'fenced', 'none'].includes(report.format) ||
    !Array.isArray(report.problems) || !report.problems.every(problem => typeof problem === 'string') ||
    !Array.isArray(report.fields) || report.fields.length < 1 || report.fields.length > 20 ||
    !exactly(report.counts, COUNT_KEYS) ||
    !COUNT_KEYS.every(key => Number.isInteger(report.counts[key]) && report.counts[key] >= 0 && report.counts[key] <= 20)) {
    return { ok: false, errors: ['Malformed extraction report fields or counts'], warnings: [], nutrition: null };
  }
  if (report.status !== 'valid') errors.push('LOBO reported invalid extraction');
  if (report.problems.length) errors.push('LOBO reported extraction problems');
  const seen = new Set();
  for (const field of report.fields) validateField(field, seen, errors);
  for (const name of ['valid', 'missing', 'invalid']) {
    if (report.counts[name] !== report.fields.filter(field => field?.status === name).length) {
      errors.push('Incorrect ' + name + ' field count');
    }
  }
  if (report.counts.unsupported !== report.fields.filter(field => field?.support === 'unmatched').length) {
    errors.push('Incorrect unsupported evidence count');
  }
  if (report.counts.unsupported > 0) errors.push('At least one field has unsupported evidence');
  const warnings = ['Evidence quotes are producer-claimed matches. Compare every field and serving basis against the original label.'];
  const nutrition = errors.length ? null : Object.fromEntries(
    Object.entries(NUTRIENTS).map(([sourceId, target]) => {
      const field = report.fields.find(entry => entry.id === sourceId);
      const value = field?.status === 'valid' && field.type === 'number' && field.support === 'matched'
        ? field.value : null;
      return [target, Number.isFinite(value) && value >= 0 && value <= 1000000 ? value : null];
    })
  );
  if (nutrition && report.fields.some(field => Object.hasOwn(NUTRIENTS, field.id) &&
    field.status === 'valid' && (typeof field.value !== 'number' || field.value < 0 || field.value > 1000000))) {
    errors.push('Nutrient value cannot be used as a nonnegative Wellspan quantity');
  }
  const serving = report.fields.filter(field => ['serving_size', 'serving_g'].includes(field.id))
    .map(field => ({ id: field.id, value: field.status === 'valid' ? field.value : null }));
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    nutrition: errors.length === 0 ? nutrition : null,
    serving
  };
}

export { REPORT_SCHEMA, NUTRIENTS, numericEvidenceContains, assessExtractionReport };
