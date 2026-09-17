import { writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'

test('production home downloads and retained resources stay bounded', async ({ page }, testInfo) => {
  const assets = new Map<string, number>()
  const reads: Promise<void>[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (/\.js(?:\?|$)/.test(response.url())) {
      reads.push(response.body().then(body => { assets.set(response.url(), gzipSync(body).byteLength) }))
    }
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: false }
    if (path === '/api/config/ui') data = { dashboard_title: 'Budget fixture', dashboard_layout_mode: 'standard' }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.addInitScript(() => {
    const metrics = { longTasks: [] as number[], lcp: 0, interaction: 0, sockets: 0 }
    ;(window as any).__productionMetrics = metrics
    for (const type of ['longtask', 'largest-contentful-paint', 'event']) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'longtask') metrics.longTasks.push(entry.duration)
          else if (type === 'event') metrics.interaction = Math.max(metrics.interaction, entry.duration)
          else metrics.lcp = entry.startTime
        }
      }).observe({ type, buffered: true })
    }
    const Original = window.WebSocket
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        metrics.sockets++
        this.addEventListener('close', () => metrics.sockets--, { once: true })
      }
    }
  })
  await page.goto('/')
  await expect(page.locator('.home-shell__inner')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  await Promise.all(reads)
  const homeGzipBytes = [...assets.values()].reduce((sum, value) => sum + value, 0)
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  const before = await session.send('Runtime.getHeapUsage')
  for (let index = 0; index < 5; index++) {
    await page.evaluate(() => { history.pushState(null, '', '/library'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(150)
    await page.evaluate(() => { history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await expect(page.locator('.home-shell__inner')).toBeVisible()
  }
  await page.getByRole('link', { name: 'Back to Home', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await session.send('HeapProfiler.collectGarbage')
  const after = await session.send('Runtime.getHeapUsage')
  await Promise.all(reads)
  const metrics = await page.evaluate(() => (window as any).__productionMetrics)
  const gzipBytes = [...assets.values()].reduce((sum, value) => sum + value, 0)
  const report = testInfo.outputPath('production-performance.json')
  await writeFile(report, JSON.stringify({ homeGzipBytes, gzipBytes, assets: Object.fromEntries(assets), metrics, heapBefore: before.usedSize, heapAfter: after.usedSize, errors }, null, 2))
  await testInfo.attach('production-performance.json', {
    path: report,
    contentType: 'application/json',
  })
  expect(errors).toEqual([])
  expect([...assets.keys()].some(url => /\/Home-[^/]+\.js/.test(url))).toBe(true)
  expect(homeGzipBytes).toBeLessThan(1_250_000)
  expect(gzipBytes).toBeLessThan(1_500_000)
  expect(metrics.interaction).toBeLessThan(1000)
  expect(metrics.sockets).toBeLessThanOrEqual(2)
  expect(after.usedSize - before.usedSize).toBeLessThan(20 * 1024 * 1024)
  // Local fixture budgets, not field Web Vitals guarantees.
  expect(metrics.lcp).toBeGreaterThan(0)
  expect(metrics.lcp).toBeLessThan(10_000)
  expect(Math.max(0, ...metrics.longTasks)).toBeLessThan(2000)
})
