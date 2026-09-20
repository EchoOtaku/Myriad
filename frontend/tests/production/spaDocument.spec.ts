import { expect, test } from '@playwright/test'
import { SITE_FONTS } from '../../src/siteFonts.mjs'

test('document boots before React, removes only the SPA bypass, and loads every local font', async ({ page }) => {
  const remoteFonts: string[] = []
  page.on('request', request => {
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) remoteFonts.push(request.url())
  })
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: false }
    if (path === '/api/config/ui') data = { dashboard_title: 'Font fixture', dashboard_layout_mode: 'standard' }
    return route.fulfill({ json: data })
  })
  await page.goto('/?_spa=1&keep=yes#anchor')
  await expect(page).toHaveURL(/\/\?keep=yes#anchor$/)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('#app-root')).toHaveClass(/app-ready/)
  await expect(page.locator('#app-root')).toHaveCSS('opacity', '1')
  await expect(page.locator('#page-loader')).toHaveAttribute('aria-busy', 'false')
  for (const font of SITE_FONTS) {
    const result = await page.evaluate(async ({ cssVariable, weight }) => {
      const family = getComputedStyle(document.documentElement).getPropertyValue(cssVariable).split(',')[0].trim()
      const faces = await document.fonts.load(`${weight} 16px ${family}`)
      return { count: faces.length, ready: faces.every(face => face.status === 'loaded') }
    }, { cssVariable: font.cssVariable, weight: font.weights[0] })
    expect(result.count, font.name).toBeGreaterThan(0)
    expect(result.ready, font.name).toBe(true)
  }
  const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(preloads).toEqual([SITE_FONTS[0].asset, SITE_FONTS[1].asset])
  expect(remoteFonts).toEqual([])
})

test('deep links share one document and missing assets remain 404', async ({ request }) => {
  const home = await request.get('/')
  const shell = await home.text()
  for (const path of ['/journal/articles/12', '/tapp/run/abc', '/agent/settings', '/config']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(await response.text()).toBe(shell)
    expect(response.headers()['permissions-policy']).toContain('microphone=(self)')
    expect(response.headers()['cache-control']).toBe('no-cache')
  }
  expect((await request.get('/assets/missing.js')).status()).toBe(404)
  const font = await request.get(SITE_FONTS[0].asset)
  expect(font.headers()['cache-control']).toContain('immutable')
  expect(font.headers()['content-type']).toBe('font/woff2')
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache')
})

test('no-JavaScript document exposes the fallback and hides the loading screen', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4188/')
    await expect(page.locator('#noscript-enable-js')).toBeVisible()
    await expect(page.locator('#page-loader')).toBeHidden()
  } finally { await context.close() }
})
