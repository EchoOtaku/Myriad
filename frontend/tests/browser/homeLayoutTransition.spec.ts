import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    homeTransitionFixture: { frame: () => void, snapshot: () => { commits: string[], frames: number }, unmount: () => void }
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/homeLayoutTransition.html')
  await expect(page.locator('[data-phase]')).toHaveText('idle')
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'))
})

test('delayed frames do not consume the fade-in clock or replay the commit', async ({ page }) => {
  await page.locator('[data-toggle]').dispatchEvent('click')
  await page.clock.runFor(180)
  await expect(page.locator('[data-mode]')).toHaveText('free')
  await page.clock.runFor(1000)
  await expect(page.locator('[data-phase]')).toHaveText('out')
  await page.evaluate(() => window.homeTransitionFixture.frame())
  await page.evaluate(() => window.homeTransitionFixture.frame())
  await expect(page.locator('[data-phase]')).toHaveText('in')
  await page.clock.runFor(239)
  await expect(page.locator('[data-phase]')).toHaveText('in')
  await page.clock.runFor(1)
  await expect(page.locator('[data-phase]')).toHaveText('idle')
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).commits).toEqual(['old:free'])
})

test('same-tick toggles are locked and pending commits use the latest callback', async ({ page }) => {
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-toggle]')!
    button.click(); button.click()
  })
  await page.getByRole('button', { name: 'Replace callback' }).dispatchEvent('click')
  await page.clock.runFor(180)
  await expect(page.locator('[data-mode]')).toHaveText('free')
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).commits).toEqual(['new:free'])
})

test('unmount cancels both the fade deadline and frame handoff', async ({ page }) => {
  await page.locator('[data-toggle]').dispatchEvent('click')
  await page.clock.runFor(180)
  await expect(page.locator('[data-mode]')).toHaveText('free')
  await page.evaluate(() => window.homeTransitionFixture.frame())
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).frames).toBe(1)
  await page.evaluate(() => window.homeTransitionFixture.unmount())
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).frames).toBe(0)
  await page.clock.runFor(1000)
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).commits).toEqual(['old:free'])
})

test('reduced motion settles a pending handoff without leaving a fade state', async ({ page }) => {
  await page.locator('[data-toggle]').dispatchEvent('click')
  await page.clock.runFor(180)
  await expect(page.locator('[data-mode]')).toHaveText('free')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('[data-phase]')).toHaveText('idle')
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).frames).toBe(0)
  await page.locator('[data-toggle]').dispatchEvent('click')
  await expect(page.locator('[data-mode]')).toHaveText('standard')
  await expect(page.locator('[data-phase]')).toHaveText('idle')
})

test('unmount during fade-out cancels the pending mode commit', async ({ page }) => {
  await page.locator('[data-toggle]').dispatchEvent('click')
  await page.clock.runFor(100)
  await page.evaluate(() => window.homeTransitionFixture.unmount())
  await page.clock.runFor(1000)
  expect((await page.evaluate(() => window.homeTransitionFixture.snapshot())).commits).toEqual([])
})
