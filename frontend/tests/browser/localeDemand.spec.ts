import type { Route } from '@playwright/test'
import { expect, test } from '@playwright/test'

test('settings catalogs load on demand and stale locale imports cannot replace the latest copy', async ({ page }) => {
  const pending = new Map<string, Route>()
  const requested: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('locale', 'en-US'))
  await page.route(/\/config\.(en-US|ja-JP|de-DE)\.json(?:\?|$)/, route => {
    const locale = route.request().url().match(/config\.([\w-]+)\.json/)![1]
    requested.push(locale)
    pending.set(locale, route)
  })
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  const release = async (locale: string) => {
    await expect.poll(() => pending.has(locale)).toBe(true)
    const route = pending.get(locale)!
    pending.delete(locale)
    await route.continue()
  }

  await page.goto('/localeDemand.html')
  await expect(page.getByTestId('shell')).toHaveText('Loading...')
  expect(requested).toEqual([])
  await page.getByRole('button', { name: 'Toggle settings' }).click()
  await expect(page.getByTestId('settings-loading')).toBeVisible()
  await expect.poll(() => requested).toEqual(['en-US'])
  await expect(page.getByTestId('shell')).toBeVisible()
  await release('en-US')
  await expect(page.getByTestId('settings')).toHaveAttribute('data-locale', 'en-US')
  await expect(page.getByTestId('settings').locator('h1')).toHaveText('System Configuration')
  await page.getByRole('button', { name: 'Read settings copy' }).click()
  await expect(page.getByTestId('event-copy')).toHaveText('System Configuration')

  await page.getByRole('button', { name: 'ja-JP', exact: true }).click()
  await expect(page.getByTestId('shell')).toHaveAttribute('data-locale', 'ja-JP')
  await expect(page.getByTestId('shell')).toHaveText('読み込み中...')
  await expect.poll(() => pending.has('ja-JP')).toBe(true)
  await expect(page.getByTestId('settings-loading')).toBeVisible()

  await page.getByRole('button', { name: 'de-DE', exact: true }).click()
  await expect(page.getByTestId('shell')).toHaveAttribute('data-locale', 'de-DE')
  await expect.poll(() => pending.has('de-DE')).toBe(true)
  await release('de-DE')
  await expect(page.getByTestId('settings')).toHaveAttribute('data-locale', 'de-DE')
  const germanTitle = await page.getByTestId('settings').locator('h1').textContent()
  expect(germanTitle).toBeTruthy()
  expect(germanTitle).not.toBe('System Configuration')
  await page.getByRole('button', { name: 'Read settings copy' }).click()
  await expect(page.getByTestId('event-copy')).toHaveText(germanTitle!)

  const staleLoaded = page.waitForResponse(response => /config\.ja-JP\.json/.test(response.url()))
  await release('ja-JP')
  await staleLoaded
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByTestId('shell')).toHaveAttribute('data-locale', 'de-DE')
  await expect(page.getByTestId('settings')).toHaveAttribute('data-locale', 'de-DE')
  await expect(page.getByTestId('settings').locator('h1')).toHaveText(germanTitle!)
  expect(requested).toEqual(['en-US', 'ja-JP', 'de-DE'])
  expect(errors).toEqual([])
})
