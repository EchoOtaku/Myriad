import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('lyrics metadata updates without replacing its cover and survives hiding', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  await page.route('**/lyrics-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><div id="root"></div>',
  }))
  await page.goto('/lyrics-test')
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/musicPlaylist.tsx', import.meta.url))}`
  await page.evaluate(async path => { const { mountLyrics } = await import(path); mountLyrics() }, fixture)
  const cover = page.locator('.music-lyrics-cover img')
  await expect(cover).toBeVisible()
  await cover.evaluate(node => Object.assign(window, { retainedLyricsCover: node }))
  await expect(page.locator('.music-vip-badge')).toHaveCount(0)
  await page.getByRole('button', { name: 'Update VIP' }).click()
  await expect(page.locator('.music-vip-badge')).toHaveText('VIP')
  await page.getByRole('button', { name: 'Update trial' }).click()
  await expect(page.locator('.music-vip-badge')).toHaveClass(/trial/)
  await page.getByRole('button', { name: 'Toggle lyrics' }).click()
  await expect(page.locator('.music-view-lyrics')).toBeHidden()
  await page.getByRole('button', { name: 'Toggle lyrics' }).click()
  await expect(cover).toBeVisible()
  expect(await cover.evaluate(node => node === (window as any).retainedLyricsCover)).toBe(true)
  await page.locator('.music-back-btn').click()
  await expect(page.locator('#view')).toHaveText('info')
})
