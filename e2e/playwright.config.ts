import { defineConfig, devices } from '@playwright/test';

const CLIENT_URL = process.env.E2E_CLIENT_URL ?? 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // the suites share one database
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: CLIENT_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport covers the responsive-navigation requirement (QA 7.2).
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  // Started only when not already running, so `npm run e2e` works locally too.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: 'npm --prefix ../server run dev',
          url: `${API_URL}/api/v1/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'pipe',
        },
        {
          command: 'npm --prefix ../client run dev',
          url: CLIENT_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'pipe',
        },
      ],
});
