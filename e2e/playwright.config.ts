import { defineConfig, devices } from '@playwright/test';

/**
 * Journey tests hit a running worker (built static apps + API).
 * Start with: `bun run build && cd apps/workspace-worker && bun run dev`
 * Override base with OPENROOM_URL.
 */
const baseURL = process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: './journeys',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Motion races assertions; reduced-motion makes stage fills instant.
    contextOptions: {
      reducedMotion: 'reduce',
    },
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
