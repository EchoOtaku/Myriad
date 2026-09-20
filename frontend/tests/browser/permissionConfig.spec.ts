import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('saving permission config refreshes a mounted Agent gate without reloading', async ({ page }) => {
  let allowed = false
  let reads = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/permissions-probe', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.route('**/api/**', route => {
    if (route.request().url().endsWith('/csrf-token')) return route.fulfill({ json: { csrf_token: null } })
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ user_perm_ai_chat: true })
      allowed = true
      return route.fulfill({ json: { success: true } })
    }
    reads++
    return route.fulfill({ json: { success: true, config: { user: { ai_chat: allowed }, guest: { ai_chat: false } } } })
  })
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/permissionConfig.tsx', import.meta.url))}`
  await page.goto('/permissions-probe')
  await page.evaluate(async fixture => { (await import(fixture)).mount() }, fixture)
  await expect(page.locator('[data-permission]')).toHaveText('false')
  await page.getByRole('button', { name: 'Save chat permission' }).click()
  await expect(page.locator('[data-permission]')).toHaveText('true')
  expect(reads).toBe(2)
  expect(errors).toEqual([])
})
