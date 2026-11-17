import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    serviceWorkers: 'allow'
  }
});
