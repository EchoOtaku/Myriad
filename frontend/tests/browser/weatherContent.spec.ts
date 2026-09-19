import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    weatherContentFixture: { reads: () => number, pending: () => boolean, finish: () => void }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/weatherContent.html')
  await expect.poll(() => page.evaluate(() => window.weatherContentFixture.pending())).toBe(true)
})

test('changing language leaves the weather load and cache hydration alone', async ({ page }) => {
  const reads = await page.evaluate(() => window.weatherContentFixture.reads())
  await page.getByRole('button', { name: 'Japanese' }).click()
  await expect(page.locator('[data-locale]')).toHaveText('ja-JP')
  expect(await page.evaluate(() => window.weatherContentFixture.reads())).toBe(reads)
  await page.evaluate(() => window.weatherContentFixture.finish())
  await expect(page.locator('output')).toHaveText('19°C')
})

for (const action of ['Toggle', 'Preview']) {
  test(`${action} rejects late consumer writes while the shared weather service completes`, async ({ page }) => {
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.evaluate(() => window.weatherContentFixture.finish())
    await expect.poll(() => page.evaluate(() => localStorage.getItem('weather_data_last'))).not.toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('weather_data_cache'))).toBeNull()
    if (action === 'Preview') await expect(page.locator('output')).toHaveText('24°')
  })
}

for (const failure of ['read', 'write', 'json']) {
  test(`weather remains available when its persistent cache fails: ${failure}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === 'json') {
        localStorage.setItem('weather_data_35.00,139.00', '{broken')
        localStorage.setItem('weather_time_35.00,139.00', String(Date.now()))
        return
      }
      const originalRead = Storage.prototype.getItem
      const originalWrite = Storage.prototype.setItem
      Storage.prototype.getItem = function (key) {
        if (mode === 'read' && key.startsWith('weather_')) throw new Error('storage unavailable')
        return originalRead.call(this, key)
      }
      Storage.prototype.setItem = function (key, value) {
        if (mode === 'write' && key.startsWith('weather_')) throw new Error('quota exceeded')
        return originalWrite.call(this, key, value)
      }
    }, failure)
    await page.reload()
    await expect.poll(() => page.evaluate(() => window.weatherContentFixture.pending())).toBe(true)
    await page.evaluate(() => window.weatherContentFixture.finish())
    await expect(page.locator('output')).toHaveText('19°C')
  })
}
