import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    builtinIslandFixture: {
      stats: () => { weatherRequests: number, quoteRequests: string[] }
      weather: () => void
      quote: (locale: string, text: string) => void
      provider: typeof import('../../src/services/DynamicContentProvider').dynamicContentProvider
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en-US'))
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, authenticated: false } }))
  await page.goto('/builtinIsland.html')
  await expect(page.locator('[data-content="greeting"]')).toContainText('Fixture')
})

test('locale changes relocalize weather without refetching and discard old quote results', async ({ page }) => {
  await page.evaluate(() => window.builtinIslandFixture.weather())
  await expect(page.locator('[data-content="weather"]')).toContainText('20°C')
  const englishWeather = await page.locator('[data-content="weather"]').textContent()
  const requests = await page.evaluate(() => window.builtinIslandFixture.stats().weatherRequests)
  await page.getByText('Japanese', { exact: true }).click()
  await expect(page.locator('[data-locale]')).toHaveText('ja-JP')
  await expect(page.locator('[data-content="weather"]')).not.toHaveText(englishWeather!)
  await expect.poll(() => page.evaluate(() => window.builtinIslandFixture.stats().quoteRequests.includes('ja-JP'))).toBe(true)
  await page.evaluate(() => window.builtinIslandFixture.quote('ja-JP', '新しい引用'))
  await expect(page.locator('[data-content="quote"]')).toHaveText('新しい引用')
  await page.evaluate(() => window.builtinIslandFixture.quote('en-US', 'Old quote'))
  await expect(page.locator('[data-content="quote"]')).toHaveText('新しい引用')
  expect(await page.evaluate(() => window.builtinIslandFixture.stats().weatherRequests)).toBe(requests)
  const stored = await page.evaluate(() => window.builtinIslandFixture.provider.getProviderContents('builtin').find(item => item.type === 'quote')?.text)
  expect(stored).toBe('新しい引用')
})

test('late results after unmount do not publish and remount schedules fresh owned requests', async ({ page }) => {
  await page.getByText('Toggle mount', { exact: true }).click()
  await page.evaluate(() => {
    window.builtinIslandFixture.weather()
    window.builtinIslandFixture.quote('en-US', 'Unmounted quote')
  })
  expect(await page.evaluate(() => window.builtinIslandFixture.provider.getProviderContents('builtin').some(item => item.type === 'weather' || item.type === 'quote'))).toBe(false)
  const before = await page.evaluate(() => window.builtinIslandFixture.stats().weatherRequests)
  await page.getByText('Toggle mount', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.builtinIslandFixture.stats().weatherRequests)).toBeGreaterThan(before)
  await page.evaluate(() => window.builtinIslandFixture.weather())
  await expect(page.locator('[data-content="weather"]')).toContainText('20°C')
})

test('hidden functional updates preserve order and render the latest state on return', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByText('Many updates', { exact: true }).click()
  await expect(page.locator('[data-visible-count]')).toHaveText('0')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('[data-visible-count]')).toHaveText('100')
})
