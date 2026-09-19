import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    sharedEventsFixture: { unmount: () => void, stats: () => Record<string, number> }
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/sharedEvents.html')
  await expect(page.locator('[data-width]')).toHaveText('1200')
})

test('disabling cancels pending debounce, while re-enabling reads the current viewport', async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect(page.locator('[data-immediate]')).toHaveText('1')
  await page.getByText('Toggle subscription', { exact: true }).click()
  await expect(page.locator('[data-enabled]')).toHaveText('false')
  await page.setViewportSize({ width: 900, height: 800 })
  await page.waitForTimeout(600)
  await expect(page.locator('[data-debounced]')).toHaveText('0')
  await expect(page.locator('[data-width]')).toHaveText('1200')
  await page.getByText('Toggle subscription', { exact: true }).click()
  await expect(page.locator('[data-width]')).toHaveText('900')
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect(page.locator('[data-debounced]')).toHaveText('1')
})

test('changing debounce cancels the previous pending callback and uses the new delay', async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.getByText('Change delay', { exact: true }).click()
  await page.waitForTimeout(600)
  await expect(page.locator('[data-debounced]')).toHaveText('0')
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect(page.locator('[data-debounced]')).toHaveText('1')
})

test('media-query and initial layout hooks agree across phone and desktop transitions', async ({ page }) => {
  await expect(page.locator('[data-desktop]')).toHaveText('true')
  await page.setViewportSize({ width: 390, height: 800 })
  await expect(page.locator('[data-mobile]')).toHaveText('true')
  await expect(page.locator('[data-desktop]')).toHaveText('false')
  await page.setViewportSize({ width: 1440, height: 800 })
  await expect(page.locator('[data-mobile]')).toHaveText('false')
  await expect(page.locator('[data-desktop]')).toHaveText('true')
})

test('Strict Mode remounting and unmount release all event subscriptions', async ({ page }) => {
  expect(await page.evaluate(() => window.sharedEventsFixture.stats())).toEqual({ resize: 3 })
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'))
    window.sharedEventsFixture.unmount()
  })
  expect(await page.evaluate(() => window.sharedEventsFixture.stats())).toEqual({})
})

test('changing a query reads its current state and follows the new breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(page.locator('[data-query]')).toHaveText('false')
  await page.getByRole('button', { name: 'Change query', exact: true }).click()
  await expect(page.locator('[data-query]')).toHaveText('true')
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(page.locator('[data-query]')).toHaveText('false')
  await expect(page.locator('[data-mobile]')).toHaveText('true')
})
