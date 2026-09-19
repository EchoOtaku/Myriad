import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    widgetLayoutFixture: { requests: () => number, load: (empty: boolean) => void }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/widgetLayout.html')
  await expect(page.locator('[data-widgets]')).toHaveText('cp-weather,cp-quote')
  await expect.poll(() => page.evaluate(() => window.widgetLayoutFixture.requests())).toBe(1)
})

test('edits made before configuration arrives remain authoritative', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit layout' }).click()
  await page.evaluate(() => window.widgetLayoutFixture.load(false))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.locator('[data-widgets]')).toHaveText('empty')
  await expect(page.locator('[data-rows]')).toHaveText('1')
})

test('saved empty layouts survive loading and subsequent renders', async ({ page }) => {
  await page.evaluate(() => window.widgetLayoutFixture.load(true))
  await expect(page.locator('[data-widgets]')).toHaveText('empty')
  await page.getByRole('button', { name: 'Rerender 0' }).click()
  await expect(page.locator('[data-widgets]')).toHaveText('empty')
  expect(await page.evaluate(() => window.widgetLayoutFixture.requests())).toBe(1)
})

test('unregistered TAPP tiles survive unrelated component renders', async ({ page }) => {
  await page.evaluate(() => window.widgetLayoutFixture.load(false))
  await expect(page.locator('[data-widgets]')).toHaveText('saved')
  await page.getByRole('button', { name: 'Rerender 0' }).click()
  await expect(page.locator('[data-widgets]')).toHaveText('saved')
})
