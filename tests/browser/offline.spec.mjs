import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
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
  await page.route('**/api/v1/state', async route => {
    if (route.request().method() === 'PUT' && !intercepted) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await changeProtein(page, 23);
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
