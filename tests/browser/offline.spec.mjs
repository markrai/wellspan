import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { freshState, KEY } from '../../src/model.js';

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function startIsolatedServer() {
  const directory = await mkdtemp(join(tmpdir(), 'wellspan-pwa-'));
  const port = await freePort();
  const url = 'http://127.0.0.1:' + port;
  const binary = resolve('.tmp/wellspan-e2e');
  const child = spawn(binary, [
    '-listen', '127.0.0.1:' + port,
    '-db', join(directory, 'wellspan.sqlite'),
    '-static', resolve('.')
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Wellspan exited: ' + output);
      try {
        const response = await fetch(url + '/health', { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { url, child, directory };
      } catch {}
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    throw new Error('Wellspan did not start: ' + output);
  } catch (error) {
    child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const test = base.extend({
  server: async ({}, use) => {
    const server = await startIsolatedServer();
    try {
      await use({ url: server.url });
    } finally {
      server.child.kill('SIGTERM');
      await rm(server.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

async function setupStarter(page, server) {
  page.on('dialog', dialog => dialog.accept());
  await page.goto(server.url);
  await expect(page.locator('#setup-dialog')).toBeVisible();
  await page.locator('#setup-starter').click();
  await expect(page.locator('#sync-status')).toContainText('Synced with Vega, revision 1', { timeout: 15000 });
}

async function changeProtein(page, value) {
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#field-protein').fill(String(value));
  await page.locator('#save-food-button').click();
}

test('first-run import preserves existing food IDs, meal order and null versus zero', async ({ page, request, server }) => {
  const legacy = freshState();
  legacy.foods[0].nutrients.sodium = 0;
  legacy.foods[0].nutrients.protein = 9;
  legacy.meals.breakfast = [legacy.foods[1].id, legacy.foods[0].id];
  await page.goto(server.url);
  await expect(page.locator('#setup-dialog')).toBeVisible();
  await page.evaluate(([key, board]) => localStorage.setItem(key, JSON.stringify(board)), [KEY, legacy]);
  await page.reload();
  await expect(page.locator('#setup-legacy')).toBeVisible();
  await expect(page.locator('#setup-server')).toBeHidden();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#setup-legacy').click();
  await expect(page.locator('#sync-status')).toContainText('Synced with Vega, revision 1', { timeout: 15000 });
  const response = await request.get(server.url + '/api/v1/state');
  const remote = await response.json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].id).toBe(legacy.foods[0].id);
  expect(remote.state.foods[0].nutrients.sodium).toBe(0);
  expect(remote.state.foods[0].nutrients.fat).toBeNull();
  expect(remote.state.meals.breakfast).toEqual(legacy.meals.breakfast);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(JSON.stringify(legacy));
});

test('offline edit survives reload and synchronizes on reconnection', async ({ page, context, request, server }) => {
  await setupStarter(page, server);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  await context.setOffline(true);
  await changeProtein(page, 17);
  await expect(page.locator('#sync-status')).toContainText('Unsynced');
  await page.reload();
  await expect(page.locator('#setup-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#field-protein')).toHaveValue('17');
  await page.locator('#cancel-button').click();
  await context.setOffline(false);
  await page.locator('#sync-retry').click();
  await expect(page.locator('#sync-status')).toContainText('Synced with Vega, revision 2', { timeout: 15000 });
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.state.foods[0].nutrients.protein).toBe(17);
});

test('two devices preserve conflicting edits and require explicit resolution', async ({ page, browser, request, server }) => {
  await setupStarter(page, server);
  const otherContext = await browser.newContext();
  try {
    const second = await otherContext.newPage();
    second.on('dialog', dialog => dialog.accept());
    await second.goto(server.url);
    await second.locator('#setup-server').click();
    await expect(second.locator('#sync-status')).toContainText('Synced with Vega, revision 1');
    await changeProtein(page, 9);
    await expect(page.locator('#sync-status')).toContainText('revision 2', { timeout: 15000 });
    await changeProtein(second, 10);
    await expect(second.locator('#sync-status')).toContainText('Conflict:', { timeout: 15000 });
    const before = await (await request.get(server.url + '/api/v1/state')).json();
    expect(before.state.foods[0].nutrients.protein).toBe(9);
    await second.locator('#sync-use-server').click();
    await expect(second.locator('#sync-status')).toContainText('revision 2');
    await second.getByRole('button', { name: 'Edit Walnuts' }).click();
    await expect(second.locator('#field-protein')).toHaveValue('9');
  } finally {
    await otherContext.close();
  }
});

test('stale editors in two tabs do not overwrite each other', async ({ page, context, request, server }) => {
  await setupStarter(page, server);
  const second = await context.newPage();
  await second.goto(server.url);
  await expect(second.locator('#sync-status')).toContainText('revision 1');
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await second.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#field-protein').fill('5');
  await page.locator('#save-food-button').click();
  await expect(page.locator('#sync-status')).toContainText('revision 2', { timeout: 15000 });
  await second.locator('#field-protein').fill('6');
  await second.locator('#save-food-button').click();
  await expect(second.locator('#toast')).toContainText('another tab', { timeout: 15000 });
  await expect(second.locator('#food-dialog')).toBeVisible();
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.state.foods[0].nutrients.protein).toBe(5);
});

test('a lost response after a committed write does not duplicate the edit', async ({ page, request, server }) => {
  await setupStarter(page, server);
  let intercepted = false;
  let committed = false;
  await page.route('**/api/v1/state', async route => {
    if (route.request().method() === 'PUT' && !intercepted) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await changeProtein(page, 23);
  await expect.poll(() => committed, { timeout: 15000 }).toBe(true);
  await expect(page.locator('#sync-status')).toContainText('Unsynced', { timeout: 15000 });
  const saved = await (await request.get(server.url + '/api/v1/state')).json();
  expect(saved.revision).toBe(2);
  expect(saved.state.foods[0].nutrients.protein).toBe(23);
  await page.unrouteAll({ behavior: 'wait' });
  await page.locator('#sync-retry').click();
  await expect(page.locator('#sync-status')).toContainText('Synced with Vega, revision 2', { timeout: 15000 });
  const after = await (await request.get(server.url + '/api/v1/state')).json();
  expect(after.revision).toBe(2);
});

test('service worker never caches mutable API responses', async ({ page, server }) => {
  await setupStarter(page, server);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const paths = [];
    for (const key of keys) {
      const entries = await (await caches.open(key)).keys();
      for (const entry of entries) paths.push(new URL(entry.url).pathname);
    }
    return paths;
  });
  expect(cached).toContain('/src/app.js');
  expect(cached).not.toContain('/api/v1/state');
  expect(cached).not.toContain('/health');
});

test('LOBO probe accepts only supported fixture and never initializes Vega', async ({ page, request, server }) => {
  await page.goto(server.url + '/probe/');
  await expect(page.getByRole('heading', { name: 'LOBO M3 integration probe' })).toBeVisible();
  await page.getByRole('button', { name: 'Supported nutrition' }).click();
  await expect(page.locator('#result-status')).toContainText('passed the consumer structure and evidence checks');
  await expect(page.locator('#nutrition-preview')).toContainText('"calories": 185');
  await expect(page.locator('#nutrition-preview')).toContainText('"protein": 4.3');
  await page.getByRole('button', { name: 'Unsupported evidence' }).click();
  await expect(page.locator('#result-status')).toContainText('Ineligible');
  await expect(page.locator('#nutrition-preview')).toContainText('No validated nutrition preview.');
  await page.getByRole('button', { name: 'Malformed response' }).click();
  await expect(page.locator('#result-status')).toContainText('Ineligible');
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote).toEqual({ revision: 0, state: null });
});

test('LOBO M3 mock cross-origin popup requires a user-approved result', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const sample = readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8');
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: mock.replace('__REPORT__', sample)
  }));
  await page.goto(server.url + '/probe/');
  await page.locator('#phone-origin').fill('https://phone.example:7869');
  await page.locator('#photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: Buffer.from('mock label bytes')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#run-probe').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#result-status')).toContainText('Waiting for LOBO');
  await popup.locator('#approve').click();
  await expect(page.locator('#result-status')).toContainText('passed the consumer structure and evidence checks', { timeout: 15000 });
  await expect(page.locator('#handoff-status')).toContainText('approved');
  expect(await (await request.get(server.url + '/api/v1/state')).json()).toEqual({ revision: 0, state: null });
});

test('confirmed LOBO result fills editable fields immediately without an automatic save', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const sample = readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8');
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: mock.replace('__REPORT__', sample)
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#field-protein').fill('9');
  await page.locator('#label-origin').fill('https://phone.example:7869');
  await page.locator('#label-photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: Buffer.from('mock label bytes')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-review')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#label-fields')).toContainText('185 kcal');
  expect(await page.evaluate(() => localStorage.getItem('wellspan.lobo.lastWorkbench/v1'))).toBe('https://phone.example:7869');
  await expect(page.locator('#label-portion-confirm')).toHaveCount(0);
  await expect(page.locator('#label-apply')).toHaveCount(0);
  await expect(page.locator('#label-fields tr')).toHaveCount(3);
  await expect(page.locator('#label-status')).toContainText('filled 2 nutrient fields');
  await expect(page.locator('#field-calories')).toHaveValue('185');
  await expect(page.locator('#field-protein')).toHaveValue('4.3');
  await page.locator('#field-protein').fill('9');
  await expect(page.locator('#field-protein')).toHaveValue('9');
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.calories).toBeNull();
  await page.locator('#cancel-button').click();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#label-origin')).toHaveValue('https://phone.example:7869');
});

test('Wellspan suggests one advertised LOBO and preserves a manual address on refresh', async ({ page, server }) => {
  const advertised = {
    status: 'available',
    devices: [{ id: 'LOBO-8207D3', host: 'goat.local', address: '192.168.1.200', port: 7869, proto: '1', path: '/v1' }]
  };
  await page.route('**/api/v1/lobo/devices', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(advertised)
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#label-device')).toHaveValue('LOBO-8207D3');
  await expect(page.locator('#label-origin')).toHaveValue('https://192.168.1.200:7869');
  await expect(page.locator('#label-discovery-status')).toContainText('Browser HTTPS trust');

  await page.locator('#label-origin').fill('https://manual.example:7869');
  await page.locator('#label-refresh-devices').click();
  await expect(page.locator('#label-discovery-status')).toContainText('Choose one or enter an address');
  await expect(page.locator('#label-origin')).toHaveValue('https://manual.example:7869');
  expect(await page.evaluate(() => localStorage.getItem('wellspan.lobo.preferredDevice/v1'))).toBeNull();
});

test('verified LOBO choice follows the same identity across a DHCP address change', async ({ page, context, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const sample = readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8');
  let address = '192.168.1.201';
  await page.route('**/api/v1/lobo/devices', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'available', devices: [
      { id: 'LOBO-8207D3', host: 'goat.local', address: '192.168.1.200', port: 7869, proto: '1', path: '/v1' },
      { id: 'LOBO-17AE84', host: 'whale.local', address, port: 7869, proto: '1', path: '/v1' }
    ] })
  }));
  await context.route('https://192.168.1.201:7869/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: mock.replace('__REPORT__', sample)
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#label-device')).toBeEnabled();
  await expect(page.locator('#label-origin')).toHaveValue('');
  await page.locator('#label-device').selectOption('LOBO-17AE84');
  await expect(page.locator('#label-origin')).toHaveValue('https://192.168.1.201:7869');
  await page.locator('#label-photo').setInputFiles({
    name: 'nutrition.png', mimeType: 'image/png', buffer: Buffer.from('mock nutrition label')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-review')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('wellspan.lobo.preferredDevice/v1'))).toBe('LOBO-17AE84');
  expect(await page.evaluate(() => localStorage.getItem('wellspan.lobo.lastWorkbench/v1'))).toBe('https://192.168.1.201:7869');

  await page.locator('#cancel-button').click();
  address = '192.168.1.222';
  await page.reload();
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#label-device')).toHaveValue('LOBO-17AE84');
  await expect(page.locator('#label-origin')).toHaveValue('https://192.168.1.222:7869');
});

test('label image picker, drop and clipboard paste share preview and reject invalid files', async ({ page, request, server }) => {
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#label-photo').setInputFiles({
    name: 'picked.png', mimeType: 'image/png', buffer: Buffer.from('picked image')
  });
  await expect(page.locator('#label-file-name')).toHaveText('picked.png');
  await expect(page.locator('#label-photo-preview')).toBeVisible();

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['dropped image'], 'dropped.png', { type: 'image/png' }));
    const zone = document.querySelector('#label-drop-zone');
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.locator('#label-file-name')).toHaveText('dropped.png');
  await expect(page.locator('#label-photo')).toHaveValue('');
  await expect(page.locator('#label-photo-preview')).toBeVisible();

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['pasted image'], 'pasted.png', { type: 'image/png' }));
    document.querySelector('#label-drop-zone').dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
    );
  });
  await expect(page.locator('#label-file-name')).toHaveText('pasted.png');
  await expect(page.locator('#label-photo-preview')).toBeVisible();

  const editablePastePrevented = await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['leave text field alone'], 'ignored.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector('#field-name').dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(editablePastePrevented).toBe(false);
  await expect(page.locator('#label-file-name')).toHaveText('pasted.png');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['image/png'], getType: async () => new Blob(['clipboard image'], { type: 'image/png' }) }] }
    });
  });
  await page.locator('#label-paste').click();
  await expect(page.locator('#label-file-name')).toHaveText('Clipboard image');

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['GIF not supported'], 'bad.gif', { type: 'image/gif' }));
    document.querySelector('#label-drop-zone').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
    );
  });
  await expect(page.locator('#label-status')).toContainText('PNG, JPEG or WebP');
  await expect(page.locator('#label-file-name')).toHaveText('No image selected');
  await expect(page.locator('#label-photo-preview')).toBeHidden();
  await expect(page.locator('#label-review')).toBeHidden();

  await page.locator('#cancel-button').click();
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.calories).toBeNull();
});

test('pasted Nutrition Facts image fills editable fields without saving automatically', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const sample = readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8');
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: mock.replace('__REPORT__', sample)
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#label-origin').fill('https://phone.example:7869');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['pasted nutrition label'], 'nutrition.png', { type: 'image/png' }));
    document.querySelector('#label-drop-zone').dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
    );
  });
  await expect(page.locator('#label-file-name')).toHaveText('nutrition.png');
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-review')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#label-fields')).toContainText('185 kcal');
  await expect(page.locator('#field-calories')).toHaveValue('185');
  await expect(page.locator('#label-apply')).toHaveCount(0);
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.calories).toBeNull();
});

test('plural carbohydrates evidence fills editable draft without saving automatically', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const report = JSON.parse(readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8'));
  const carb = report.fields.find(field => field.id === 'protein_g');
  Object.assign(carb, { id: 'carbohydrate_g', label: 'Total carbohydrate', value: 4, evidence: 'Total Carbohydrates 4g' });
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: mock.replace('__REPORT__', JSON.stringify(report))
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#label-origin').fill('https://phone.example:7869');
  await page.locator('#label-photo').setInputFiles({
    name: 'nutrition.png', mimeType: 'image/png', buffer: Buffer.from('mock label')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-review')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#field-carbs')).toHaveValue('4');
  await expect(page.locator('#label-status')).toContainText('filled 2 nutrient fields');
  await expect(page.locator('#label-status')).toHaveAttribute('data-severity', 'info');
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.carbs).toBeNull();
});

test('ambiguous optional sodium evidence is skipped without blocking other LOBO fields or saving', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const report = JSON.parse(readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8'));
  const sodium = report.fields.find(field => field.id === 'sodium_mg');
  Object.assign(sodium, { status: 'valid', value: 0, reason: null, support: 'matched', evidence: '0mg' });
  report.counts.valid += 1;
  report.counts.missing -= 1;
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: mock.replace('__REPORT__', JSON.stringify(report))
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#field-sodium').fill('42');
  await page.locator('#label-origin').fill('https://phone.example:7869');
  await page.locator('#label-photo').setInputFiles({
    name: 'nutrition.png', mimeType: 'image/png', buffer: Buffer.from('mock label')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-review')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#field-calories')).toHaveValue('185');
  await expect(page.locator('#field-protein')).toHaveValue('4.3');
  await expect(page.locator('#field-sodium')).toHaveValue('42');
  await expect(page.locator('#label-fields')).toContainText('Not imported (ambiguous quote)');
  await expect(page.locator('#label-status')).toContainText('Skipped Sodium');
  await expect(page.locator('#label-status')).toHaveAttribute('data-severity', 'error');
  await expect(page.locator('#label-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#label-status')).toHaveCSS('color', /rgb\((143, 53, 43|232, 154, 144)\)/);
  await expect(page.locator('#label-fields td[data-severity="error"]')).toHaveText('Not imported (ambiguous quote)');
  await expect(page.locator('#label-fields td[data-severity="error"]')).toHaveCSS('color', /rgb\((143, 53, 43|232, 154, 144)\)/);
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.calories).toBeNull();
});

test('not eligible extraction error is red and does not change editor values', async ({ page, context, request, server }) => {
  const mock = readFileSync(new URL('./mock-lobo.html', import.meta.url), 'utf8');
  const report = JSON.parse(readFileSync(new URL('../../probe/fixtures/supported-nutrition.json', import.meta.url), 'utf8'));
  report.fields.find(field => field.id === 'calories_kcal').evidence = 'Protein 185';
  await context.route('https://phone.example:7869/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: mock.replace('__REPORT__', JSON.stringify(report))
  }));
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await page.locator('#field-calories').fill('90');
  await page.locator('#label-origin').fill('https://phone.example:7869');
  await page.locator('#label-photo').setInputFiles({
    name: 'nutrition.png', mimeType: 'image/png', buffer: Buffer.from('mock label')
  });
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#label-run').click();
  const popup = await popupEvent;
  await expect(popup.locator('#approve')).toBeVisible({ timeout: 15000 });
  await popup.locator('#approve').click();
  await expect(page.locator('#label-status')).toContainText('LOBO extraction was not eligible');
  await expect(page.locator('#label-status')).toHaveAttribute('data-severity', 'error');
  await expect(page.locator('#label-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#label-status')).toHaveCSS('color', /rgb\((143, 53, 43|232, 154, 144)\)/);
  await expect(page.locator('#label-review')).toBeHidden();
  await expect(page.locator('#field-calories')).toHaveValue('90');
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
});

test('label assistant cannot mutate food values without a valid extraction result', async ({ page, request, server }) => {
  await setupStarter(page, server);
  await page.getByRole('button', { name: 'Edit Walnuts' }).click();
  await expect(page.locator('#label-run')).toBeVisible();
  await expect(page.locator('#label-review')).toBeHidden();
  await expect(page.locator('#label-apply')).toHaveCount(0);
  await page.locator('#field-protein').fill('9');
  await page.locator('#label-run').click();
  await expect(page.locator('#label-status')).toContainText('Cannot start LOBO');
  await expect(page.locator('#label-status')).toHaveAttribute('data-severity', 'error');
  await expect(page.locator('#label-status')).toHaveCSS('color', /rgb\((143, 53, 43|232, 154, 144)\)/);
  expect(await page.evaluate(() => localStorage.getItem('wellspan.lobo.lastWorkbench/v1'))).toBeNull();
  await expect(page.locator('#field-protein')).toHaveValue('9');
  await page.locator('#cancel-button').click();
  const remote = await (await request.get(server.url + '/api/v1/state')).json();
  expect(remote.revision).toBe(1);
  expect(remote.state.foods[0].nutrients.protein).toBeNull();
});
