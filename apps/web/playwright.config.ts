import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  retries: process.env.CI ? 1 : 0,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Small screens have their own tabbed layout: the desktop feature specs don't apply.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: ['mobile.spec.ts', 'smoke.spec.ts', 'pwa.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
