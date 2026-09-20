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
    const metrics = {
      longTasks: [] as Array<{ start: number; duration: number }>,
      homeVisibleAt: 0,
      navStartedAt: 0,
      navEndedAt: 0,
      lcp: 0,
      interaction: 0,
      sockets: 0,
    }
    ;(window as any).__productionMetrics = metrics
    for (const type of ['longtask', 'largest-contentful-paint', 'event']) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'longtask') metrics.longTasks.push({ start: entry.startTime, duration: entry.duration })
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
  await page.evaluate(() => { (window as any).__productionMetrics.homeVisibleAt = performance.now() })
  await page.waitForTimeout(1500)
  await Promise.all(reads)
  const homeGzipBytes = [...assets.values()].reduce((sum, value) => sum + value, 0)
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  const before = await session.send('Runtime.getHeapUsage')
  await page.evaluate(() => { (window as any).__productionMetrics.navStartedAt = performance.now() })
  for (let index = 0; index < 5; index++) {
    await page.evaluate(() => { history.pushState(null, '', '/library'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(150)
    await page.evaluate(() => { history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await expect(page.locator('.home-shell__inner')).toBeVisible()
  }
  await page.getByRole('link', { name: 'Back to Home', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await page.evaluate(() => { (window as any).__productionMetrics.navEndedAt = performance.now() })
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
  expect(homeGzipBytes).toBeLessThan(510_000)
  expect(gzipBytes).toBeLessThan(1_500_000)
  expect(metrics.interaction).toBeLessThan(1000)
  expect(metrics.sockets).toBeLessThanOrEqual(2)
  expect(after.usedSize - before.usedSize).toBeLessThan(20 * 1024 * 1024)
  // Local fixture budgets, not field Web Vitals guarantees.
  expect(metrics.lcp).toBeGreaterThan(0)
  expect(metrics.lcp).toBeLessThan(10_000)
  const longTaskMs = metrics.longTasks.map((task: { duration: number }) => task.duration)
  expect(Math.max(0, ...longTaskMs)).toBeLessThan(1500)
  const duringNav = metrics.longTasks
    .filter((task: { start: number }) =>
      task.start >= metrics.navStartedAt && task.start < metrics.navEndedAt)
    .map((task: { duration: number }) => task.duration)
  expect(Math.max(0, ...duringNav)).toBeLessThan(400)
})

test('empty home does not load sandboxes after background startup and route warming', async ({ page }) => {
  const scripts: string[] = []
  const apiPaths = new Set<string>()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/\.js(?:\?|$)/.test(request.url())) scripts.push(request.url())
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    apiPaths.add(path)
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: false }
    if (path === '/api/config/ui') data = { dashboard_layout_mode: 'standard' }
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  await expect(page.locator('.home-shell__inner')).toBeVisible()
  // Observe actual delayed imports, so a shorter delay cannot make this pass.
  await expect.poll(() => scripts.some(url => /\/TappBackgroundRunner-[^/]+\.js/.test(url)), { timeout: 15000 }).toBe(true)
  await expect.poll(() => scripts.some(url => /\/TappStorePage-[^/]+\.js/.test(url)), { timeout: 20000 }).toBe(true)
  await page.waitForTimeout(500)
  expect([...apiPaths].some(path => path.startsWith('/api/tapps'))).toBe(true)
  expect(scripts.filter(url => /\/(?:TappWidgetSandbox|TappPageSandbox|agentApi)-[^/]+\.js/.test(url))).toEqual([])
  expect(errors).toEqual([])
})

test('scrolling does not cancel an in-progress component transition', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: false }
    if (path === '/api/config/ui') data = { dashboard_layout_mode: 'standard' }
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  await expect(page.locator('.widget-grid-item h2').first()).toBeVisible({ timeout: 20000 })
  await page.evaluate(async () => {
    const probe = document.createElement('div')
    probe.id = 'scroll-transition-probe'
    probe.className = 'transition-opacity'
    probe.style.cssText = 'position:fixed;top:0;left:0;width:10px;height:10px;opacity:0;transition:opacity 2s linear'
    document.body.append(probe)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    probe.style.opacity = '1'
  })
  const probe = page.locator('#scroll-transition-probe')
  await expect.poll(async () => Number(await probe.evaluate(node => getComputedStyle(node).opacity))).toBeGreaterThan(0)
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  // The old scroll listener zeroed transition duration until its 150 ms idle timer.
  await page.waitForTimeout(60)
  await expect(probe).toHaveCSS('transition-duration', '2s')
  const opacity = Number(await probe.evaluate(node => getComputedStyle(node).opacity))
  expect(opacity).toBeGreaterThan(0)
  expect(opacity).toBeLessThan(1)
  await expect(page.locator('body')).not.toHaveClass(/is-scrolling/)

  await probe.evaluate(node => {
    const element = node as HTMLElement
    element.style.animation = 'fade-in 2s linear infinite'
    element.style.scrollBehavior = 'smooth'
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(probe).toHaveCSS('transition-duration', '1e-05s')
  await expect(probe).toHaveCSS('animation-duration', '1e-05s')
  await expect(probe).toHaveCSS('animation-iteration-count', '1')
  await expect(probe).toHaveCSS('scroll-behavior', 'auto')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(probe).toHaveCSS('transition-duration', '2s')
  await expect(probe).toHaveCSS('animation-duration', '2s')
  await expect(probe).toHaveCSS('scroll-behavior', 'smooth')
})

for (const width of [390, 1440]) {
  test(`enabled music reserves its final shell while its UI loads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const held = Promise.withResolvers<void>()
    let loads = 0
    await page.route('**/assets/MusicPlayer-*.js', async route => {
      loads++
      await held.promise
      await route.continue()
    })
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
      if (path === '/api/setup/status') data = { is_setup_required: false }
      if (path === '/api/auth/me') data = { authenticated: false }
      if (path === '/api/config/ui') data = { music_enabled: 'true', dashboard_layout_mode: 'standard' }
      return route.fulfill({ json: data })
    })
    try {
      await page.goto('/')
      await expect(page.locator('.widget-grid-item h2').first()).toBeVisible({ timeout: 20000 })
      await expect.poll(() => loads).toBe(1)
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-control-panel')))
      const loading = page.locator('[data-music-loading]')
      await expect(loading).toBeVisible()
      await expect(page.locator('.control-bar-trigger')).not.toHaveClass(/gcp-animating/)
      await expect(loading).toHaveCSS('height', width === 390 ? '156px' : '160px')
      const before = await loading.boundingBox()
      held.resolve()
      await expect(loading).toHaveCount(0)
      await expect(page.locator('.music-no-song')).toBeVisible()
      const after = await page.locator('.music-player-container').boundingBox()
      expect(after!.height).toBeCloseTo(before!.height, 1)
      expect(after!.width).toBeCloseTo(before!.width, 1)
      await expect(page.locator('.music-view-info')).toHaveCSS('animation-duration', '0.4s')
    } finally { held.resolve() }
  })
}

test('disabled music does not load the player UI when opening the control panel', async ({ page }) => {
  let loads = 0
  page.on('request', request => { if (/\/MusicPlayer-[^/]+\.js/.test(request.url())) loads++ })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: false }
    if (path === '/api/config/ui') data = { music_enabled: 'false', dashboard_layout_mode: 'standard' }
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  await expect(page.locator('.widget-grid-item h2').first()).toBeVisible({ timeout: 20000 })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-control-panel')))
  await expect(page.locator('.control-bar-trigger')).toHaveClass(/expanded/)
  await expect(page.locator('.control-bar-trigger')).not.toHaveClass(/gcp-animating/)
  await expect(page.locator('.music-player-container')).toHaveCount(0)
  expect(loads).toBe(0)
})
