import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Playwright's WebKit build is an engine regression target, not native Safari.
export default defineConfig({
  ...base,
  testMatch: 'memoryGpu.spec.ts',
  timeout: 90_000,
  use: {
    ...base.use,
    browserName: 'webkit',
    launchOptions: {},
    baseURL: 'http://127.0.0.1:4193',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --port 4193',
    url: 'http://127.0.0.1:4193',
    reuseExistingServer: false,
  },
})
