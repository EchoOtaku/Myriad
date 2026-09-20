import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/production',
  testMatch: ['homeBudget.spec.ts', 'spaDocument.spec.ts'],
  outputDir: '/tmp/myriad-production-browser',
  timeout: 60_000,
  workers: 1,
  use: {
    channel: process.env.MYRIAD_BROWSER_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:4188',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'cross-env PORT=4188 HOST=127.0.0.1 node scripts/spa-server.mjs',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
  },
})
