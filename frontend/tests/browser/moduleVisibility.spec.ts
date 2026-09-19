import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    moduleVisibilityFixture: {
      count: () => number
      finish: (index: number, sort: string) => void
      update: (sort: string) => void
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/moduleVisibility.html')
  await expect.poll(() => page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(1)
  await page.evaluate(() => window.moduleVisibilityFixture.finish(0, 'smart'))
  await expect(page.locator('output')).toHaveText(['smart', 'smart'])
})

test('one consumer refreshing publishes the same snapshot to every mounted consumer', async ({ page }) => {
  await page.getByRole('button', { name: 'Reload a', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(2)
  await page.evaluate(() => window.moduleVisibilityFixture.finish(1, 'pinyin'))
  await expect(page.locator('output')).toHaveText(['pinyin', 'pinyin'])
})

test('stale remounts share one refresh and keep their last presentation while waiting', async ({ page }) => {
  await page.clock.install()
  await page.getByRole('button', { name: 'Toggle consumers' }).click()
  await page.clock.fastForward(61_000)
  await page.getByRole('button', { name: 'Toggle consumers' }).click()
  await expect.poll(() => page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(2)
  await expect(page.locator('output')).toHaveText(['smart', 'smart'])
  await page.evaluate(() => window.moduleVisibilityFixture.finish(1, 'update'))
  await expect(page.locator('output')).toHaveText(['update', 'update'])
})

test('updates made without consumers survive remount and an older pending refresh', async ({ page }) => {
  await page.getByRole('button', { name: 'Reload a', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(2)
  await page.getByRole('button', { name: 'Toggle consumers' }).click()
  await page.evaluate(() => {
    window.moduleVisibilityFixture.update('pinyin')
    window.moduleVisibilityFixture.finish(1, 'smart')
  })
  await page.getByRole('button', { name: 'Toggle consumers' }).click()
  await expect(page.locator('output')).toHaveText(['pinyin', 'pinyin'])
  expect(await page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(2)
})

test('legacy update events synchronize consumers and supersede an in-flight refresh', async ({ page }) => {
  await page.getByRole('button', { name: 'Reload a', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.moduleVisibilityFixture.count())).toBe(2)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('module-visibility-preferences-updated', {
      detail: { journalSourceSort: 'pinyin' },
    }))
    window.moduleVisibilityFixture.finish(1, 'smart')
  })
  await expect(page.locator('output')).toHaveText(['pinyin', 'pinyin'])
})
