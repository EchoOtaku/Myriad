import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    quoteContentFixture: { count: () => number, finish: (index: number, text: string) => void, refresh: () => void }
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto('/quoteContent.html')
  await expect.poll(() => page.evaluate(() => window.quoteContentFixture.count())).toBe(1)
})

test('a replaced quote request cannot overwrite the latest content or either cache', async ({ page }) => {
  await page.evaluate(() => window.quoteContentFixture.refresh())
  await expect.poll(() => page.evaluate(() => window.quoteContentFixture.count())).toBe(2)
  await page.evaluate(() => window.quoteContentFixture.finish(1, 'latest'))
  await expect(page.locator('output')).toHaveText('latest')
  await page.evaluate(() => window.quoteContentFixture.finish(0, 'obsolete'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.locator('output')).toHaveText('latest')
  const cached = await page.evaluate(() => [JSON.parse(localStorage.getItem('quote_cache')!).text, JSON.parse(localStorage.getItem('quote_data_cache')!).data.text])
  expect(cached).toEqual(['latest', 'latest'])
})

for (const action of ['Toggle', 'Preview']) {
  test(`${action} cancels live quote work and prevents late cache writes`, async ({ page }) => {
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.evaluate(() => window.quoteContentFixture.finish(0, 'obsolete'))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => localStorage.getItem('quote_cache'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('quote_data_cache'))).toBeNull()
    if (action === 'Preview') await expect(page.locator('output')).not.toHaveText('obsolete')
  })
}
