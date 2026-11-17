import { KEY, nutrientKeys, mealInfo, freshState, normalizeNotes, valueOrNull, format, formatField, itemId, normalizeState } from './model.js';

(() => {
      'use strict';

      const $ = (id) => document.getElementById(id);
      const create = (tag, className, textValue) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (textValue !== undefined) el.textContent = textValue;
        return el;
      };
      const ICON_EDIT = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13l-2.6.7.7-2.6z"/></svg>';
      const ICON_REMOVE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      let state;
      let editingId = null;
      let dragSource = null;
      let toastTimeout;
      try {
        const stored = localStorage.getItem(KEY);
        state = stored ? normalizeState(JSON.parse(stored)) : freshState();
      } catch (error) {
        state = freshState();
        setTimeout(() => showToast('Could not load saved data. Import your most recent backup if needed.'), 150);
      }

      function persist() {
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
          return true;
        } catch {
          showToast('Local saving failed. Export a backup and check browser storage permissions.');
          return false;
        }
      }
      function showToast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.hidden = false;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => { toast.hidden = true; }, 4400);
      }
      function changeState(change) {
        change();
        persist();
        render();
      }
      function moveFood(mealKey, draggedId, targetId, after) {
        const order = state.meals[mealKey].filter(id => id !== draggedId);
        let index = order.indexOf(targetId);
        if (index === -1) index = order.length;
        else if (after) index += 1;
        order.splice(index, 0, draggedId);
        changeState(() => { state.meals[mealKey] = order; });
      }
      const getFood = (id) => state.foods.find(food => food.id === id);
      const getFoods = (mealKey) => state.meals[mealKey].map(getFood).filter(Boolean);
      const getSummary = (foods) => {
        const total = {};
        const missing = {};
        for (const key of nutrientKeys) {
          total[key] = foods.reduce((sum, food) => sum + (food.nutrients[key] ?? 0), 0);
          missing[key] = foods.filter(food => food.nutrients[key] === null).length;
        }
        return { total, missing, count: foods.length };
      };
      function textValue(summary, key, digits = 1) {
        if (!summary.count || summary.missing[key] === summary.count) return '—';
        return format(summary.total[key], digits);
      }
      function valueNode(summary, key, digits = 1, unit = '') {
        const node = create('div', 'value');
        node.append(document.createTextNode(textValue(summary, key, digits)));
        if (summary.count && summary.missing[key] > 0 && summary.missing[key] !== summary.count) {
          const partial = create('span', 'partial', '†');
          partial.title = `Partial total: ${summary.missing[key]} food(s) missing this value`;
          node.append(partial);
        }
        if (unit) node.append(create('span', 'unit', unit));
        return node;
      }
      function nutrientCell(summary, key, label, unit = 'g', digits = 1) {
        const node = create('div', 'nutrient');
        node.append(valueNode(summary, key, digits, unit));
        node.append(create('div', 'label', label));
        return node;
      }
      function saltCell(summary) {
        const node = create('div', 'nutrient');
        const value = summary.count && summary.missing.sodium === summary.count ? '—' : format(summary.total.sodium * 0.0025, 3);
        const partial = summary.missing.sodium > 0 && summary.missing.sodium < summary.count ? '†' : '';
        const amount = create('div', 'value', `${value}${partial}`);
        amount.append(create('span', 'unit', 'g'));
        node.append(amount, create('div', 'label', 'Salt equivalent'));
        return node;
      }
      function renderSummary() {
        const all = mealInfo.flatMap(({ key }) => getFoods(key));
        const summary = getSummary(all);
        const container = $('plan-summary');
        container.replaceChildren();
        const intro = create('div');
        intro.append(create('div', '', 'Typical plan total'));
        const kcal = create('strong', '', textValue(summary, 'calories', 0));
        if (summary.missing.calories > 0 && summary.missing.calories < summary.count) kcal.append(create('span', 'partial', '†'));
        intro.append(kcal, document.createTextNode(' kcal'));
        container.append(intro, create('span', 'vdivider'));
        const protein = create('div');
        protein.append(create('div', '', 'Protein'));
        protein.append(create('strong', '', `${textValue(summary, 'protein')}${summary.missing.protein > 0 && summary.missing.protein < summary.count ? '†' : ''} g`));
        const sat = create('div');
        sat.append(create('div', '', 'Saturated fat'));
        sat.append(create('strong', '', `${textValue(summary, 'satFat')}${summary.missing.satFat > 0 && summary.missing.satFat < summary.count ? '†' : ''} g`));
        const carbs = create('div');
        carbs.append(create('div', '', 'Carbs'));
        carbs.append(create('strong', '', `${textValue(summary, 'carbs')}${summary.missing.carbs > 0 && summary.missing.carbs < summary.count ? '†' : ''} g`));
        const sodium = create('div');
        sodium.append(create('div', '', 'Sodium'));
        sodium.append(create('strong', '', `${textValue(summary, 'sodium', 0)}${summary.missing.sodium > 0 && summary.missing.sodium < summary.count ? '†' : ''} mg`));
        const sugars = create('div');
        sugars.append(create('div', '', 'Sugars'));
        sugars.append(create('strong', '', `${textValue(summary, 'sugars')}${summary.missing.sugars > 0 && summary.missing.sugars < summary.count ? '†' : ''} g`));
        container.append(protein, create('span', 'vdivider'), sat, create('span', 'vdivider'), carbs, create('span', 'vdivider'), sodium, create('span', 'vdivider'), sugars);
        const missingInSummary = ['calories', 'protein', 'satFat', 'carbs', 'sodium', 'sugars'].some(key => summary.missing[key] > 0);
        if (missingInSummary) container.title = 'Some selected foods have blank nutrition values. The shown totals include entered values only.';
        else container.removeAttribute('title');
      }
      function renderMeals() {
        const grid = $('meal-grid');
        grid.replaceChildren();
        const availableNames = [...state.foods].sort((a, b) => a.name.localeCompare(b.name));
        for (const { key, name, subtitle, color } of mealInfo) {
          const foods = getFoods(key);
          const summary = getSummary(foods);
          const section = create('article', 'meal');
          section.style.setProperty('--meal-color', color);
          const head = create('div', 'meal-top');
          head.append(create('h3', 'meal-name', name), create('p', 'meal-subtitle', subtitle));
          const totals = create('div', 'meal-nutrients');
          const hero = create('div', 'hero');
          const kcalNode = create('div');
          const kcalValue = valueNode(summary, 'calories', 0);
          kcalValue.className = 'number';
          kcalNode.append(kcalValue, create('span', 'unit', 'kcal'));
          const sat = create('div', 'hero-right');
          sat.append(create('strong', '', `${textValue(summary, 'satFat')}${summary.missing.satFat > 0 && summary.missing.satFat < summary.count ? '†' : ''} g`), create('span', '', 'saturated fat')); 
          hero.append(kcalNode, sat);
          const metrics = create('div', 'nutrient-grid');
          metrics.append(
            nutrientCell(summary, 'protein', 'Protein'),
            nutrientCell(summary, 'carbs', 'Carbs'),
            nutrientCell(summary, 'fat', 'Total fat'),
            nutrientCell(summary, 'fiber', 'Fiber'),
            nutrientCell(summary, 'sugars', 'Sugars'),
            nutrientCell(summary, 'sodium', 'Sodium', 'mg', 0),
            nutrientCell(summary, 'cholesterol', 'Cholesterol', 'mg', 0),
            saltCell(summary)
          );
          totals.append(hero, metrics);
          const bottom = create('div', 'meal-foods');
          bottom.append(create('div', 'food-heading', `Foods · ${foods.length}`));
          const items = create('ul', 'food-items');
          if (!foods.length) {
            const empty = create('li', 'food-empty', 'Nothing added yet. Choose from your food library below.');
            items.append(empty);
          }
          for (const food of foods) {
            const item = create('li', 'food-item');
            item.draggable = true;
            item.addEventListener('dragstart', (event) => {
              event.dataTransfer.setData('text/plain', `${key}:${food.id}`);
              event.dataTransfer.effectAllowed = 'move';
              dragSource = { meal: key, id: food.id };
              item.classList.add('dragging');
            });
            item.addEventListener('dragend', () => {
              dragSource = null;
              document.querySelectorAll('.food-item.dragging,.food-item.drop-before,.food-item.drop-after').forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
            });
            item.addEventListener('dragover', (event) => {
              if (!dragSource || dragSource.meal !== key) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const rect = item.getBoundingClientRect();
              const after = (event.clientY - rect.top) > rect.height / 2;
              item.parentElement.querySelectorAll('.drop-before,.drop-after').forEach(el => { if (el !== item) el.classList.remove('drop-before', 'drop-after'); });
              item.classList.toggle('drop-before', !after);
              item.classList.toggle('drop-after', after);
            });
            item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
            item.addEventListener('drop', (event) => {
              event.preventDefault();
              if (!dragSource || dragSource.meal !== key) return;
              const rect = item.getBoundingClientRect();
              const after = (event.clientY - rect.top) > rect.height / 2;
              moveFood(key, dragSource.id, food.id, after);
            });
            item.append(create('span', 'food-item-label', food.name));
            const actions = create('div', 'food-item-actions');
            actions.append(create('span', 'food-item-kcal', food.nutrients.calories === null ? '— kcal' : `${format(food.nutrients.calories, 0)} kcal`));
            const edit = create('button');
            edit.innerHTML = ICON_EDIT;
            edit.type = 'button';
            edit.title = `Edit ${food.name} in master list`;
            edit.setAttribute('aria-label', `Edit ${food.name}`);
            edit.addEventListener('click', () => openEditor(food.id));
            const remove = create('button');
            remove.innerHTML = ICON_REMOVE;
            remove.type = 'button';
            remove.title = `Remove ${food.name} from ${name}`;
            remove.setAttribute('aria-label', `Remove ${food.name} from ${name}`);
            remove.addEventListener('click', () => changeState(() => { state.meals[key] = state.meals[key].filter(id => id !== food.id); }));
            actions.append(edit, remove);
            item.append(actions);
            items.append(item);
          }
          const picker = create('div', 'add-row');
          const select = create('select', 'select');
          select.setAttribute('aria-label', `Choose a food for ${name}`);
          const placeholder = create('option', '', 'Choose a food…');
          placeholder.value = '';
          select.append(placeholder);
          const candidates = availableNames.filter(food => !state.meals[key].includes(food.id));
          for (const food of candidates) {
            const option = create('option', '', food.name);
            option.value = food.id;
            select.append(option);
          }
          const add = create('button', 'button primary', '+ Add');
          add.type = 'button';
          add.disabled = true;
          select.addEventListener('change', () => { add.disabled = !select.value; });
          add.addEventListener('click', () => {
            const selectedId = select.value;
            if (!selectedId || !getFood(selectedId) || state.meals[key].includes(selectedId)) return;
            changeState(() => { state.meals[key].push(selectedId); });
          });
          picker.append(select, add);
          bottom.append(items, picker);
          if (foods.some(food => nutrientKeys.some(nutrient => food.nutrients[nutrient] === null))) {
            bottom.append(create('p', 'partial-note', '† Partial totals use entered values only. “—” means no value is entered, not zero.'));
          }
          section.append(head, totals, bottom);
          grid.append(section);
        }
      }
      function renderCatalog() {
        const tbody = $('food-table');
        const search = $('food-search').value.trim().toLocaleLowerCase();
        const foods = state.foods.filter(food => food.name.toLocaleLowerCase().includes(search)).sort((a, b) => a.name.localeCompare(b.name));
        tbody.replaceChildren();
        for (const food of foods) {
          const row = create('tr');
          row.append(create('td', 'food-name-cell', food.name));
          const fields = [
            ['calories', ' kcal', 0], ['protein', ' g', 1], ['carbs', ' g', 1],
            ['fat', ' g', 1], ['satFat', ' g', 1], ['fiber', ' g', 1], ['sodium', ' mg', 0]
          ];
          for (const [key, unit, digits] of fields) {
            const value = food.nutrients[key];
            const cell = create('td', value === null ? 'none' : '', formatField(value, unit, digits));
            row.append(cell);
          }
          const sodium = food.nutrients.sodium;
          row.append(create('td', sodium === null ? 'none' : '', sodium === null ? '—' : `${format(sodium * 0.0025, 3)} g`));
          const actionsCell = create('td');
          const actions = create('div', 'food-actions');
          const edit = create('button', 'button small', 'Edit');
          edit.type = 'button';
          edit.setAttribute('aria-label', `Edit ${food.name}`);
          edit.addEventListener('click', () => openEditor(food.id));
          const del = create('button', 'button small danger', 'Delete');
          del.type = 'button';
          del.setAttribute('aria-label', `Delete ${food.name}`);
          del.addEventListener('click', () => deleteFood(food.id));
          actions.append(edit, del);
          actionsCell.append(actions);
          row.append(actionsCell);
          tbody.append(row);
        }
        if (!foods.length) {
          const row = create('tr');
          const cell = create('td', 'no-results', state.foods.length ? 'No matching foods.' : 'Your master list is empty. Add a food to begin.');
          cell.colSpan = 10;
          row.append(cell);
          tbody.append(row);
        }
        $('food-count').textContent = `(${state.foods.length})`;
        const entered = state.foods.filter(food => nutrientKeys.some(key => food.nutrients[key] !== null)).length;
        $('catalog-status').textContent = `${entered} of ${state.foods.length} foods have at least one nutrition value · ${foods.length} shown`;
      }
      function render() { renderSummary(); renderMeals(); renderCatalog(); }
      function firstNameMatch(prefix) {
        const lower = prefix.toLocaleLowerCase();
        if (!lower) return '';
        return state.foods.map(food => food.name).sort((a, b) => a.localeCompare(b)).find(name => name.toLocaleLowerCase().startsWith(lower)) || '';
      }
      function updateGhost() {
        const input = $('field-name');
        const ghost = $('name-ghost');
        ghost.replaceChildren();
        delete ghost.dataset.completion;
        if (document.activeElement !== input) return;
        const typed = input.value;
        if (!typed) return;
        const match = firstNameMatch(typed);
        if (!match || match.length <= typed.length) return;
        const seen = document.createElement('span');
        seen.textContent = typed;
        seen.className = 'ghost-typed';
        const rest = document.createElement('span');
        rest.textContent = match.slice(typed.length);
        rest.className = 'ghost-rest';
        ghost.append(seen, rest);
        ghost.dataset.completion = match;
      }
      function clearGhost() {
        const ghost = $('name-ghost');
        ghost.replaceChildren();
        delete ghost.dataset.completion;
      }
      function isDuplicateName(value) {
        const name = value.trim().toLocaleLowerCase();
        if (!name) return false;
        return state.foods.some(food => food.id !== editingId && food.name.toLocaleLowerCase() === name);
      }
      function checkNameDuplicate() {
        const input = $('field-name');
        const hint = $('name-duplicate-hint');
        const save = $('save-food-button');
        const duplicate = isDuplicateName(input.value);
        hint.hidden = !duplicate;
        input.setAttribute('aria-invalid', String(duplicate));
        input.title = duplicate ? 'Item already exists.' : '';
        save.disabled = duplicate;
        return duplicate;
      }
      function openEditor(id = null) {
        editingId = id;
        const food = id ? getFood(id) : null;
        if (id && !food) return;
        $('food-form').reset();
        $('form-warning').textContent = '';
        $('dialog-title').textContent = food ? `Edit ${food.name}` : 'Add food';
        $('save-food-button').textContent = food ? 'Save changes' : 'Add to master list';
        $('field-name').value = food?.name ?? '';
        for (const key of nutrientKeys) $(fieldId(key)).value = food?.nutrients[key] ?? '';
        $('field-notes').value = food?.notes ?? '';
        syncSaltFromSodium();
        checkNameDuplicate();
        updateGhost();
        $('food-dialog').showModal();
        $('field-name').focus();
      }
      const fieldId = key => 'field-' + key;
      function syncSaltFromSodium() {
        const raw = $('field-sodium').value;
        $('field-salt').value = raw === '' ? '' : String(Number((Number(raw) * 0.0025).toFixed(6)));
      }
      function syncSodiumFromSalt() {
        const raw = $('field-salt').value;
        $('field-sodium').value = raw === '' ? '' : String(Number((Number(raw) * 400).toFixed(6)));
      }
      function saveEditor(event) {
        event.preventDefault();
        const name = $('field-name').value.trim();
        if (!name || name.length > 100) { $('form-warning').textContent = 'Enter a food name (up to 100 characters).'; return; }
        if (state.foods.some(food => food.id !== editingId && food.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          $('form-warning').textContent = 'That food is already in the master list.';
          return;
        }
        const nutrients = {};
        for (const key of nutrientKeys) {
          const input = $(fieldId(key));
          const raw = input.value;
          const value = valueOrNull(raw);
          if (raw !== '' && value === null) { $('form-warning').textContent = 'Nutrients must be valid, nonnegative numbers.'; input.focus(); return; }
          nutrients[key] = value;
        }
        const notes = normalizeNotes($('field-notes').value);
        const original = editingId ? getFood(editingId) : null;
        changeState(() => {
          if (original) { original.name = name; original.nutrients = nutrients; original.notes = notes; }
          else state.foods.push({ id: itemId(), name, nutrients, notes });
        });
        $('food-dialog').close();
        showToast(original ? `${name} updated in every meal.` : `${name} added to your master list.`);
      }
      function deleteFood(id) {
        const food = getFood(id);
        if (!food) return;
        const used = mealInfo.filter(({ key }) => state.meals[key].includes(id)).map(({ name }) => name);
        const suffix = used.length ? ` It will also be removed from ${used.join(', ')}.` : '';
        if (!confirm(`Delete ${food.name} from the master list?${suffix}`)) return;
        changeState(() => {
          state.foods = state.foods.filter(entry => entry.id !== id);
          for (const { key } of mealInfo) state.meals[key] = state.meals[key].filter(item => item !== id);
        });
        showToast(`${food.name} deleted.`);
      }
      function exportBackup() {
        const data = JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'Wellspan Foodboard' }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = create('a');
        anchor.href = url;
        anchor.download = `wellspan-foodboard-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
        showToast('Backup exported. Keep the JSON file somewhere safe.');
      }
      async function importBackup(event) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (file.size > 2_000_000) { showToast('Backup is too large (2 MB maximum).'); return; }
        let candidate;
        try { candidate = normalizeState(JSON.parse(await file.text())); }
        catch (error) { showToast(error?.message || 'Could not read the backup.'); return; }
        if (!confirm(`Replace the current master list and meal plans with ${candidate.foods.length} foods from this backup? Export your current data first if you want to keep it.`)) return;
        state = candidate;
        $('food-search').value = '';
        persist();
        render();
        showToast('Backup restored.');
      }
      function reset() {
        if (!confirm('Reset the whole Foodboard? This clears all nutrition edits and meal selections, and restores the starter food list. Export a backup first if you want to keep this version.')) return;
        state = freshState();
        $('food-search').value = '';
        persist();
        render();
        showToast('Foodboard reset to the starter list.');
      }
      $('new-food-button').addEventListener('click', () => openEditor());
      $('food-search').addEventListener('input', renderCatalog);
      $('field-name').addEventListener('input', () => { checkNameDuplicate(); updateGhost(); });
      $('field-name').addEventListener('focus', updateGhost);
      $('field-name').addEventListener('blur', clearGhost);
      $('field-name').addEventListener('keydown', (event) => {
        const completion = $('name-ghost').dataset.completion;
        if (!completion) return;
        const input = $('field-name');
        const atEnd = input.selectionStart === input.value.length;
        if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'ArrowRight' && atEnd)) {
          event.preventDefault();
          input.value = completion;
          input.setSelectionRange(completion.length, completion.length);
          checkNameDuplicate();
          updateGhost();
        }
      });
      $('food-form').addEventListener('submit', saveEditor);
      $('cancel-button').addEventListener('click', () => $('food-dialog').close());
      $('field-sodium').addEventListener('input', syncSaltFromSodium);
      $('field-salt').addEventListener('input', syncSodiumFromSalt);
      $('export-button').addEventListener('click', exportBackup);
      $('import-button').addEventListener('click', () => $('import-file').click());
      $('import-file').addEventListener('change', importBackup);
      $('reset-button').addEventListener('click', reset);
      const THEME_KEY = 'wellspan-theme';
      const themeToggle = $('theme-toggle');
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      const currentTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const dark = theme === 'dark';
        themeToggle.setAttribute('aria-pressed', String(dark));
        themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
        themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        if (themeMeta) themeMeta.content = dark ? '#0e1310' : '#f2eee1';
        try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable; theme applies for this session */ }
      }
      themeToggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
      applyTheme(currentTheme());
      window.addEventListener('storage', event => {
        if (event.key === THEME_KEY) { applyTheme(event.newValue === 'dark' ? 'dark' : 'light'); return; }
        if (event.key !== KEY || $('food-dialog').open) return;
        try {
          state = event.newValue ? normalizeState(JSON.parse(event.newValue)) : freshState();
          render();
        } catch { showToast('Another tab changed storage, but its data could not be loaded.'); }
      });
      render();
      try { if (localStorage.getItem(KEY) === null) persist(); }
      catch { showToast('Browser storage is unavailable. Export backups because changes will not persist.'); }
    })();
