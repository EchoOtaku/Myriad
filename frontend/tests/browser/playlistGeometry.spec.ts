import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    playlistGeometryFixture: { open: () => void, stop: () => void, select: (index: number) => void, snapshot: () => { calls: number, top: number } }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/playlistGeometry.html')
  await expect(page.locator('.music-playlist-item')).toHaveCount(20)
})

test('late expansion centers the active item without a retry deadline', async ({ page }) => {
  await page.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame) })
  expect((await page.evaluate(() => window.playlistGeometryFixture.snapshot())).calls).toBe(0)
  await page.evaluate(() => window.playlistGeometryFixture.open())
  await expect.poll(() => page.evaluate(() => window.playlistGeometryFixture.snapshot().top)).toBe(352)
  await page.evaluate(() => window.playlistGeometryFixture.select(3))
  await expect.poll(() => page.evaluate(() => window.playlistGeometryFixture.snapshot().top)).toBe(64)
})

test('manual scrolling survives item content changes and duplicate geometry events do not repeat scroll writes', async ({ page }) => {
  await page.evaluate(() => window.playlistGeometryFixture.open())
  await expect.poll(() => page.evaluate(() => window.playlistGeometryFixture.snapshot().top)).toBe(352)
  const before = await page.evaluate(() => window.playlistGeometryFixture.snapshot().calls)
  await page.evaluate(() => window.dispatchEvent(new Event('control-panel-content-resize')))
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame) })
  expect((await page.evaluate(() => window.playlistGeometryFixture.snapshot())).calls).toBe(before)
  await page.evaluate(() => {
    document.getElementById('playlist')!.scrollTop = 10
    const span = document.createElement('span')
    span.textContent = ' updated'
    document.querySelector('.music-playlist-item.active')!.append(span)
  })
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame) })
  expect((await page.evaluate(() => window.playlistGeometryFixture.snapshot())).top).toBe(10)
})

test('stopping cancels queued work and detaches geometry subscriptions', async ({ page }) => {
  const before = await page.evaluate(() => {
    window.playlistGeometryFixture.open()
    window.dispatchEvent(new Event('control-panel-content-resize'))
    window.playlistGeometryFixture.stop()
    document.getElementById('playlist')!.style.height = '128px'
    return window.playlistGeometryFixture.snapshot().calls
  })
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame) })
  expect((await page.evaluate(() => window.playlistGeometryFixture.snapshot())).calls).toBe(before)
})

test('returning to an unchanged page preserves manual scroll position', async ({ page }) => {
  await page.evaluate(() => window.playlistGeometryFixture.open())
  await expect.poll(() => page.evaluate(() => window.playlistGeometryFixture.snapshot().top)).toBe(352)
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
    document.getElementById('playlist')!.scrollTop = 10
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
  })
  expect((await page.evaluate(() => window.playlistGeometryFixture.snapshot())).top).toBe(10)
})
