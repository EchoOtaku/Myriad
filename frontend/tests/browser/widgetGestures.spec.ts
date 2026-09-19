import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    widgetGesturesFixture: { unmount: () => void, snapshot: () => { edits: number, rowChanges: string[] } }
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/widgetGestures.html')
  await expect(page.locator('[data-page]')).toHaveText('0')
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'))
})

test('closing a panel or revoking editing permission cancels pending long press', async ({ page }) => {
  for (const button of ['Toggle visibility', 'Toggle admin']) {
    await page.locator('[data-press]').dispatchEvent('mousedown')
    await page.getByRole('button', { name: button }).click()
    await page.clock.runFor(900)
    expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(0)
    await page.getByRole('button', { name: button }).click()
  }
  await page.locator('[data-press]').dispatchEvent('mousedown')
  await page.clock.runFor(799)
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(0)
  await page.clock.runFor(1)
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(1)
})

test('dragging uses the latest callback and stops when the panel closes', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('[data-drag]').dispatchEvent('mousedown', { clientY: 100 })
  await page.getByRole('button', { name: 'Change callback' }).dispatchEvent('click')
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 80 })))
  await expect(page.locator('[data-rows]')).toHaveText('1')
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).rowChanges).toEqual(['new:1'])
  await page.getByRole('button', { name: 'Toggle visibility' }).dispatchEvent('click')
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 120 })))
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).rowChanges).toEqual(['new:1'])
})

test('wheel cooldown is owned by the visible panel and unmount cancels gestures', async ({ page }) => {
  await page.locator('[data-wheel]').dispatchEvent('wheel', { deltaY: 60 })
  await expect(page.locator('[data-page]')).toHaveText('1')
  await page.locator('[data-wheel]').dispatchEvent('wheel', { deltaY: 60 })
  await expect(page.locator('[data-page]')).toHaveText('1')
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  await page.locator('[data-wheel]').dispatchEvent('wheel', { deltaY: 60 })
  await expect(page.locator('[data-page]')).toHaveText('2')
  await page.locator('[data-press]').dispatchEvent('mousedown')
  await page.evaluate(() => window.widgetGesturesFixture.unmount())
  await page.clock.runFor(1000)
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(0)
})

test('touch cancellation and focus loss release pending long presses', async ({ page }) => {
  await page.locator('[data-press]').dispatchEvent('mousedown')
  await page.locator('[data-press]').dispatchEvent('touchcancel')
  await page.clock.runFor(900)
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(0)
  await page.locator('[data-press]').dispatchEvent('mousedown')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.clock.runFor(900)
  expect((await page.evaluate(() => window.widgetGesturesFixture.snapshot())).edits).toBe(0)
})
