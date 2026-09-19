import { expect, test } from '@playwright/test'

test.use({ timezoneId: 'Asia/Tokyo' })

test('welcome calendar updates across midnight and greeting boundaries without remount', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-19T23:59:59+09:00') })
  await page.goto('/welcomeTime.html')
  await expect(page.locator('output')).toHaveText('19:night')
  await page.clock.runFor(1000)
  await expect(page.locator('output')).toHaveText('20:lateNight')
  await page.clock.fastForward(6 * 60 * 60 * 1000)
  await expect(page.locator('output')).toHaveText('20:morning')
})

test('hidden time is reconciled immediately on return', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-19T11:59:00+09:00') })
  await page.goto('/welcomeTime.html')
  await expect(page.locator('output')).toHaveText('19:morning')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(3 * 60 * 60 * 1000)
  await expect(page.locator('output')).toHaveText('19:morning')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('output')).toHaveText('19:afternoon')
})

test('focus reconciles a changed wall clock and remount reads current time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-19T11:30:00+09:00') })
  await page.goto('/welcomeTime.html')
  await expect(page.locator('output')).toHaveText('19:morning')
  await page.clock.setSystemTime(new Date('2026-09-19T22:30:00+09:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('output')).toHaveText('19:night')
  await page.getByRole('button').click()
  await page.clock.fastForward(12 * 60 * 60 * 1000)
  await page.getByRole('button').click()
  await expect(page.locator('output')).toHaveText('20:morning')
})
