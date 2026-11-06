import { defineConfig, devices } from '@playwright/test';

// Every test runs at desktop and phone size, except ones tagged @desktop.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:8093', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grepInvert: /@desktop/ },
  ],
  webServer: {
    command: 'python3 -m http.server 8093',
    url: 'http://localhost:8093',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
