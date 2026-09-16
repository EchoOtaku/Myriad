import { expect, test } from '@playwright/test'

test('ten thousand list items keep bounded DOM, full extent and focused controls', async ({ page }) => {
  await page.goto('/libraryWindow.html')
  const cards = page.locator('[data-library-list-id]')
  await expect(page.locator('[data-library-list-id="0"]')).toBeVisible()
  await expect(page.getByTestId('extent')).toHaveCSS('height', '500000px')
  await page.locator('[data-library-list-id="0"]').focus()
  await page.evaluate(() => window.scrollTo(0, 200_000))
  await expect(page.locator('[data-library-list-id="4000"]')).toBeVisible()
  await expect(page.locator('[data-library-list-id="0"]')).toBeFocused()
  expect(await cards.count()).toBeLessThan(60)
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(page.locator('[data-library-list-id="0"]')).toHaveCount(0)
  await page.locator('[data-library-list-id="4000"]').focus()
  await page.evaluate(() => document.dispatchEvent(new Event('library-reindex')))
  await expect(page.getByTestId('extent')).toHaveAttribute('data-revision', '1')
  await expect(page.locator('[data-library-list-id="4000"]')).toBeFocused()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('[data-library-list-id="0"]')).toBeVisible()
  await expect(page.locator('[data-library-list-id="4000"]')).toHaveCount(0)
})

test('real library pagination recycles old cards without shrinking the scroll extent', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }),
  }))
  await page.route('**/api/library?**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, total: 240, has_more: false, preferences: { layout: 'list' },
      items: Array.from({ length: 240 }, (_, i) => ({
        id: `book_${i}`, item_type: 'book', title: `Book ${i}`, cover: null,
        platform: 'douban', metadata: {},
      })),
    }),
  }))
  await page.goto('/libraryWindow.html?grid')
  const cards = page.locator('[data-library-list-id]')
  await expect(cards.first()).toBeVisible()
  const first = await cards.first().getAttribute('data-library-list-id')
  const initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  await expect.poll(() => page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      return document.documentElement.scrollHeight
    }), { timeout: 10_000 }).toBeGreaterThan(initialHeight * 3)
  expect(await cards.count()).toBeLessThan(60)
  await expect(page.locator(`[data-library-list-id="${first}"]`)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(initialHeight * 3)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator(`[data-library-list-id="${first}"]`)).toBeVisible()
})
