import { expect, test } from '@playwright/test'

declare global {
  interface Window { islandMusicThemeFixture: { getIsDarkMode: () => boolean } }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/islandMusicTheme.html')
  await expect(page.locator('[data-theme="a"]')).toHaveText('auto')
})

test('repeated lyrics update their song metadata and timing; opening the panel pauses presentation', async ({ page }) => {
  await expect(page.locator('[data-song]')).toHaveText('First - Artist A')
  await expect(page.locator('[data-duration]')).toHaveText('3')
  await page.getByText('Toggle panel', { exact: true }).click()
  await page.getByText('Next song', { exact: true }).click()
  await page.getByText('Next line', { exact: true }).click()
  await expect(page.locator('[data-song]')).toHaveText('First - Artist A')
  await page.getByText('Toggle panel', { exact: true }).click()
  await expect(page.locator('[data-song]')).toHaveText('Second - Artist B')
  await expect(page.locator('[data-duration]')).toHaveText('7')
})

test('theme controls share their current preference across rapid updates', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-cycle="a"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-cycle="b"]')!.click()
  })
  await expect(page.locator('[data-theme="a"]')).toHaveText('dark')
  await expect(page.locator('[data-theme="b"]')).toHaveText('dark')
  await expect(page.locator('[data-dark="a"]')).toHaveText('true')
  await expect(page.locator('html')).toHaveClass('dark')
})

test('auto follows the system and cross-tab preference changes update both controls and DOM', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('[data-dark="a"]')).toHaveText('true')
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light')
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'light' }))
  })
  await expect(page.locator('[data-theme="a"]')).toHaveText('light')
  await expect(page.locator('[data-theme="b"]')).toHaveText('light')
  await expect(page.locator('html')).toHaveClass('light')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('[data-dark="b"]')).toHaveText('false')
})

test('theme reads stay fresh when DOM changes with no active subscribers', async ({ page }) => {
  await page.getByText('Toggle themes', { exact: true }).click()
  await page.evaluate(() => { document.documentElement.className = 'dark' })
  expect(await page.evaluate(() => window.islandMusicThemeFixture.getIsDarkMode())).toBe(true)
  await page.getByText('Toggle themes', { exact: true }).click()
  await expect(page.locator('[data-dark="a"]')).toHaveText('true')
})
