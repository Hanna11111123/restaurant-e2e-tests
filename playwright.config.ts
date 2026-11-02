import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();


export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      // API tests have no browser, a trace adds nothing here
      use: { trace: 'off' },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      use: { baseURL: process.env.UI_URL, browserName: 'chromium' },
    },
  ],
});
