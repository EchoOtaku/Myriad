import process from 'node:process'
import { defineConfig } from '@playwright/test'
import production from './playwright.production.config'

if (!process.env.MYRIAD_PERF_API_ORIGIN) {
  throw new Error('Set MYRIAD_PERF_API_ORIGIN to a read-only test backend; no synthetic data is substituted.')
}

export default defineConfig({
  ...production,
  testMatch: 'livePerformance.spec.ts',
  outputDir: '/tmp/myriad-live-performance',
  timeout: 120_000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
