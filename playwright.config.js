import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:8093' },
  webServer: {
    command: 'python3 -m http.server 8093',
    url: 'http://localhost:8093',
    reuseExistingServer: !process.env.CI,
  },
});
