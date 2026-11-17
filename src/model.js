const KEY = 'wellspan-foodboard-v1';
const nutrientKeys = ['calories', 'protein', 'carbs', 'fat', 'satFat', 'fiber', 'sugars', 'sodium', 'cholesterol'];
const mealInfo = [
  { key: 'breakfast', name: 'Breakfast', subtitle: 'Your usual morning meal', color: '#e3a760' },
  { key: 'lunch', name: 'Lunch', subtitle: 'Your usual midday meal', color: '#74a38a' },
  { key: 'dinner', name: 'Dinner', subtitle: 'Your usual evening meal', color: '#8998c1' }
];
const seedNames = [
  'Walnuts', 'Almonds', 'Cashews', 'Pistachios', 'Pine nuts', 'Peanuts', 'Avocado',
  'Extra virgin olive oil (EVOO)', 'Chicken breast', 'Salmon', 'Egg whites',
  'Soy milk', 'Sprouted rolled oats', 'Quinoa', 'Black beans', 'Chickpeas',
  'Whole wheat bread', 'Unleavened mini loaf', '0% fat yogurt', 'Apples',
  'Broccoli', 'Carrots', 'Plant protein', 'Green peas', 'Eggplant', 'Green tea',
  'Lemon juice', 'Red lentils', 'Tofu', 'Olives'
];

const emptyValues = () => Object.fromEntries(nutrientKeys.map(key => [key, null]));
const normalizeNotes = (raw) => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw new Error('Invalid food notes.');
  if (raw.length > 2000) throw new Error('Food notes are too long.');
  return raw.trim() === '' ? '' : raw.replace(/\r\n/g, '\n').trim().slice(0, 2000);
};
const freshState = () => ({
  version: 1,
  foods: seedNames.map((name, index) => ({ id: `starter-${index + 1}`, name, nutrients: emptyValues(), notes: '' })),
  meals: { breakfast: [], lunch: [], dinner: [] }
});
const valueOrNull = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 && number <= 1000000 ? number : null;
};
const format = (value, maxDigits = 1) => Number(value).toLocaleString(undefined, { maximumFractionDigits: maxDigits });
const formatField = (value, unit = '', maxDigits = 1) => value === null ? '—' : `${format(value, maxDigits)}${unit ? ` ${unit}` : ''}`;
const itemId = () => 'food-' + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

function normalizeState(candidate) {
  if (!isRecord(candidate) || !Array.isArray(candidate.foods) || !isRecord(candidate.meals)) throw new Error('This is not a valid Wellspan Foodboard backup.');
  if (candidate.foods.length > 5000) throw new Error('Food library exceeds the supported size.');
  const usedIds = new Set();
  const usedNames = new Set();
  const foods = candidate.foods.map((food) => {
    if (!isRecord(food) || typeof food.name !== 'string' || typeof food.id !== 'string') throw new Error('A food entry is invalid.');
    const name = food.name.trim();
    if (!name || name.length > 100 || food.id.length > 150 || !food.id || usedIds.has(food.id) || usedNames.has(name.toLocaleLowerCase())) throw new Error('Food names or identifiers are missing or duplicated.');
    usedIds.add(food.id);
    usedNames.add(name.toLocaleLowerCase());
    const nutrients = {};
    for (const key of nutrientKeys) {
      const raw = isRecord(food.nutrients) ? food.nutrients[key] : null;
      if (raw !== null && raw !== undefined && raw !== '' && valueOrNull(raw) === null) throw new Error(`Invalid nutrient value for ${name}.`);
      nutrients[key] = valueOrNull(raw);
    }
    return { id: food.id, name, nutrients, notes: normalizeNotes(food.notes) };
  });
  const meals = {};
  for (const { key } of mealInfo) {
    const ids = candidate.meals[key];
    if (!Array.isArray(ids) || ids.length > 5000) throw new Error(`Invalid ${key} food selections.`);
    if (ids.some(id => typeof id !== 'string' || !usedIds.has(id)) || new Set(ids).size !== ids.length) throw new Error(`Invalid ${key} food references.`);
    meals[key] = [...ids];
  }
  return { version: 1, foods, meals };
}

export { KEY, nutrientKeys, mealInfo, seedNames, emptyValues, normalizeNotes, freshState, valueOrNull, format, formatField, itemId, isRecord, normalizeState };
