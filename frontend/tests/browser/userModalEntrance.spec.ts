import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.goto('/userModalEntrance.html') })

test('suspended content cannot consume the entrance before it commits', async ({ page }) => {
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText('Loading')).toBeVisible()
  await page.waitForTimeout(100)
  await expect(page.locator('output')).toHaveText('0')
  await page.getByRole('button', { name: 'Release', exact: true }).click()
  await expect(page.locator('[data-content]')).toBeVisible()
  await expect(page.locator('output')).toHaveText('1')
})

test('closing a pending modal prevents a late entrance callback', async ({ page }) => {
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Release', exact: true }).click()
  await page.waitForTimeout(100)
  await expect(page.locator('output')).toHaveText('0')
  await expect(page.locator('[data-content]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.locator('output')).toHaveText('1')
})
