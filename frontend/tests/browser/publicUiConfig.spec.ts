import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    publicUiFixture: {
      count: () => number
      finish: (index: number, value: string, failed?: boolean) => void
      reload: () => void
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/publicUiConfig.html')
  await expect.poll(() => page.evaluate(() => window.publicUiFixture.count())).toBe(1)
})

test('shared consumers reject an older response after a newer configuration arrives', async ({ page }) => {
  await page.evaluate(() => window.publicUiFixture.reload())
  await expect.poll(() => page.evaluate(() => window.publicUiFixture.count())).toBe(2)
  await page.evaluate(() => window.publicUiFixture.finish(1, 'new'))
  await expect(page.locator('output')).toHaveText(['new', 'new'])
  await page.evaluate(() => window.publicUiFixture.finish(0, 'old'))
  // Flush all response parsing and React work before checking the retained value.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.locator('output')).toHaveText(['new', 'new'])
})

test('failed refreshes preserve the displayed config and a later refresh recovers', async ({ page }) => {
  await page.evaluate(() => window.publicUiFixture.finish(0, 'usable'))
  await expect(page.locator('output')).toHaveText(['usable', 'usable'])
  await page.evaluate(() => window.publicUiFixture.reload())
  await expect.poll(() => page.evaluate(() => window.publicUiFixture.count())).toBe(2)
  await page.evaluate(() => window.publicUiFixture.finish(1, '', true))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.locator('output')).toHaveText(['usable', 'usable'])
  await page.evaluate(() => window.publicUiFixture.reload())
  await expect.poll(() => page.evaluate(() => window.publicUiFixture.count())).toBe(3)
  await page.evaluate(() => window.publicUiFixture.finish(2, 'recovered'))
  await expect(page.locator('output')).toHaveText(['recovered', 'recovered'])
})

test('unmounted consumers remove event subscriptions; remounts own their new results', async ({ page }) => {
  await page.getByRole('button').click()
  await page.evaluate(() => window.publicUiFixture.reload())
  expect(await page.evaluate(() => window.publicUiFixture.count())).toBe(1)
  await page.getByRole('button').click()
  await expect.poll(() => page.evaluate(() => window.publicUiFixture.count())).toBe(2)
  await page.evaluate(() => window.publicUiFixture.finish(0, 'disposed'))
  await expect(page.locator('output')).toHaveText(['initial', 'initial'])
  await page.evaluate(() => window.publicUiFixture.finish(1, 'remounted'))
  await expect(page.locator('output')).toHaveText(['remounted', 'remounted'])
})
