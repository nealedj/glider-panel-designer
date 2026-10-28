import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Tests start as a returning user (welcome seen); the onboarding test clears this itself.
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', storageState: 'e2e/onboarded.json' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: true },
});
