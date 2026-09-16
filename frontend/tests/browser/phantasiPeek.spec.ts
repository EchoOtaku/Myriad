import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  await page.route('https://test.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="blue"/></svg>' }))
  await page.goto('/phantasiPeek.html')
})

test('first mount, no-cover handoff and leaving the rail obey one session', async ({ page }) => {
  const first = page.locator('.phantasi-story[data-rail-id="1"]')
  await first.hover()
  await expect(first).toHaveClass(/is-peek/)
  await expect(page.locator('#face')).toHaveText('Story 1')
  await expect(first.locator('.phantasi-story__title')).toHaveCSS('opacity', '1')
  await expect(first.locator('.phantasi-story__thumb')).toHaveCSS('opacity', '1')
  await expect(first.locator('.phantasi-story__peek')).toHaveCount(0)
  await page.locator('.phantasi-story[data-rail-id="2"]').hover()
  await expect(first).not.toHaveClass(/is-peek/)
  await expect(page.locator('#face')).toHaveText('none')
  await first.hover()
  await page.locator('#route').hover()
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await expect(page.locator('#face')).toHaveText('none')
})

test('route replacement under a stationary pointer restores a fresh card', async ({ page }) => {
  const first = page.locator('.phantasi-story[data-rail-id="1"]')
  await first.hover()
  await expect(page.locator('#face')).toHaveText('Story 1')
  await page.locator('#route').evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.locator('.phantasi-view-lane')).toHaveAttribute('data-phantasi-view', 'notes')
  await expect(first).toHaveClass(/is-peek/)
  await expect(page.locator('#face')).toHaveText('Story 1')
  await page.locator('#reader').evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await expect(page.locator('#face')).toHaveText('none')
})

test('touch never leaves a sticky summary', async ({ page }) => {
  const first = page.locator('.phantasi-story[data-rail-id="1"]')
  await first.hover()
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true })
  await first.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true })
  await expect(first).not.toHaveClass(/is-peek/)
  await expect(page.locator('#face')).toHaveText('none')
  await expect(first.locator('.phantasi-story__peek')).toHaveCount(0)
})

test('gaps and dragging end the card session', async ({ page }) => {
  const first = page.locator('.phantasi-story[data-rail-id="1"]')
  await first.hover()
  await expect(page.locator('#face')).toHaveText('Story 1')
  const box = (await first.boundingBox())!
  await page.mouse.move(box.x + box.width + 5, box.y + box.height / 2)
  await expect(page.locator('#face')).toHaveText('none')
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await first.hover()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 6 })
  await expect(page.locator('#face')).toHaveText('none')
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await page.mouse.up()
})

test('mobile hides search and never activates preview, including focus and route changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('input[type="search"]')).toHaveCount(0)
  const first = page.locator('.phantasi-story[data-rail-id="1"]')
  await first.hover()
  await first.focus()
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await expect(page.locator('#face')).toHaveText('none')
  await page.locator('#route').evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.locator('.phantasi-view-lane')).toHaveAttribute('data-phantasi-view', 'notes')
  await first.hover()
  await expect(page.locator('#face')).toHaveText('none')
})

test('shrinking to mobile clears an existing preview and removes search', async ({ page }) => {
  await expect(page.locator('input[type="search"]')).toHaveCount(1)
  await page.locator('.phantasi-story[data-rail-id="1"]').hover()
  await expect(page.locator('#face')).toHaveText('Story 1')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#face')).toHaveText('none')
  await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
  await expect(page.locator('input[type="search"]')).toHaveCount(0)
})

test.describe('touch devices', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } })
  test('wide touch screens cannot trigger preview through focus or synthetic mouse events', async ({ page }) => {
    const first = page.locator('.phantasi-story[data-rail-id="1"]')
    await first.focus()
    await first.dispatchEvent('pointerover', { pointerType: 'mouse', bubbles: true })
    await expect(page.locator('.phantasi-story.is-peek')).toHaveCount(0)
    await expect(page.locator('#face')).toHaveText('none')
  })
})
