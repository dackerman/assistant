import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid OpenCode conflicts
  reporter: 'html',
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: 'http://localhost:7653',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm run test:opencode',
      port: 4096,
      timeout: 30 * 1000,
      reuseExistingServer: true, // Use existing OpenCode if running
    },
    {
      command: 'pnpm run dev',
      url: 'http://localhost:7653',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
