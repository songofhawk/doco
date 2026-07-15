import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4199',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4199',
    url: 'http://127.0.0.1:4199',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
