import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  await page.route('**/playlist-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><div id="root"></div>',
  }))
  await page.goto('/playlist-test')
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/musicPlaylist.tsx', import.meta.url))}`
  await page.evaluate(async path => { const { mountPlaylist } = await import(path); mountPlaylist() }, fixture)
  await expect(page.locator('.music-playlist-item')).toHaveCount(100)
})

test('panel motion preserves playlist nodes, extent and manual scroll position', async ({ page }) => {
  await expect.poll(() => page.locator('.music-playlist-scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  const before = await page.locator('.music-playlist-scroll').evaluate(node => {
    node.scrollTop = 100
    Object.assign(window, { retainedPlaylistItem: node.firstElementChild })
    return { height: node.scrollHeight, top: node.scrollTop }
  })
  for (const event of ['gcp-animation-start', 'gcp-animation-end']) {
    await page.evaluate(name => window.dispatchEvent(new Event(name)), event)
    await page.waitForTimeout(100)
    await expect(page.locator('.music-playlist-item')).toHaveCount(100)
    const after = await page.locator('.music-playlist-scroll').evaluate(node => ({ height: node.scrollHeight, top: node.scrollTop }))
    expect(after).toEqual(before)
    expect(await page.locator('.music-playlist-scroll').evaluate(node => node.firstElementChild === (window as any).retainedPlaylistItem)).toBe(true)
  }
})

test('filtered results remain complete during motion and select the original song index', async ({ page }) => {
  await page.locator('.music-search-input').fill('Match')
  await expect(page.locator('.music-playlist-item')).toHaveCount(30)
  await page.evaluate(() => window.dispatchEvent(new Event('gcp-animation-start')))
  await page.waitForTimeout(100)
  await expect(page.locator('.music-playlist-item')).toHaveCount(30)
  await page.locator('.music-playlist-item').nth(20).click()
  await expect(page.locator('#selected')).toHaveText('20')
})

test('playlist back control keeps its compact geometry and transition', async ({ page }) => {
  const back = page.locator('.music-lyrics-back-btn')
  const icon = back.locator('.music-lyrics-back-btn__icon')
  for (const dark of [false, true]) {
    await page.evaluate(active => document.documentElement.classList.toggle('dark', active), dark)
    await expect(back).toHaveCSS('border-radius', '4.8px')
    await expect(back).toHaveCSS('font-size', '11px')
    await expect(back).toHaveCSS('flex-shrink', '0')
    await expect(back).toHaveCSS('transition-duration', '0.2s')
    expect(await icon.evaluate(node => Number.parseFloat(getComputedStyle(node).width))).toBeCloseTo(13.6, 1)
    await back.hover()
    await expect(back).toHaveCSS('transform', 'none')
  }
})
