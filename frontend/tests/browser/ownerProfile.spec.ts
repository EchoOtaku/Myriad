import { expect, test } from '@playwright/test'

for (const mode of ['enabled', 'mounted']) {
  test(`late owner response cannot survive toggling ${mode}`, async ({ page }) => {
    const held = Promise.withResolvers<void>()
    let calls = 0
    await page.route('**/api/profile/user-info', async route => {
      const index = ++calls
      if (index === 1) await held.promise
      await route.fulfill({ json: { success: true, user_info: { name: index === 1 ? 'Old owner' : 'Fresh owner', avatar: null, bio: '' } } })
    })
    await page.goto('/ownerProfile.html')
    await expect.poll(() => calls).toBe(1)
    await page.getByRole('button', { name: `Toggle ${mode}` }).click()
    held.resolve()
    await page.waitForTimeout(100)
    if (mode === 'enabled') await expect(page.locator('output')).toHaveText('empty')
    else await expect(page.locator('output')).toHaveCount(0)
    await page.getByRole('button', { name: `Toggle ${mode}` }).click()
    await expect(page.locator('output')).toHaveText('Fresh owner')
    expect(calls).toBe(2)
  })
}

for (const available of [false, true]) {
  test(`copy changes update only presentation (profile available=${available})`, async ({ page }) => {
    let calls = 0
    await page.route('**/api/profile/user-info', route => {
      calls++
      return route.fulfill({ json: available
        ? { success: true, user_info: { name: 'Owner', avatar: null, bio: 'Server bio' } }
        : { success: false } })
    })
    await page.goto('/ownerProfile.html')
    await expect(page.locator('output')).toHaveText(available ? 'Owner' : 'Fallback')
    await expect(page.locator('[data-bio]')).toHaveText(available ? 'Server bio' : 'Copy A')
    await page.getByRole('button', { name: 'Toggle copy' }).click()
    await expect(page.locator('[data-bio]')).toHaveText(available ? 'Server bio' : 'Copy B')
    await page.waitForTimeout(100)
    expect(calls).toBe(1)
    await expect(page.locator('[data-epoch]')).toHaveText('0')
  })
}

test('a pending failure uses the latest fallback copy without restarting the request', async ({ page }) => {
  const held = Promise.withResolvers<void>()
  let calls = 0
  await page.route('**/api/profile/user-info', async route => {
    calls++
    await held.promise
    await route.fulfill({ json: { success: false } })
  })
  await page.goto('/ownerProfile.html')
  await expect.poll(() => calls).toBe(1)
  await page.getByRole('button', { name: 'Toggle copy' }).click()
  await expect(page.locator('output')).toHaveText('empty')
  held.resolve()
  await expect(page.locator('[data-bio]')).toHaveText('Copy B')
  expect(calls).toBe(1)
})

test('copy changes preserve a pending avatar refresh and its single remount', async ({ page }) => {
  const held = Promise.withResolvers<void>()
  let calls = 0
  await page.route('**/api/profile/user-info*', async route => {
    const index = ++calls
    if (index > 1) await held.promise
    await route.fulfill({ json: { success: true, user_info: { name: 'Owner', avatar: null, bio: index === 1 ? 'Before' : 'After' } } })
  })
  await page.goto('/ownerProfile.html')
  await expect(page.locator('[data-bio]')).toHaveText('Before')
  await page.evaluate(() => {
    window.dispatchEvent(new Event('avatar-changed'))
    window.dispatchEvent(new Event('profile-display-changed'))
  })
  await expect.poll(() => calls).toBe(2)
  await page.getByRole('button', { name: 'Toggle copy' }).click()
  held.resolve()
  await expect(page.locator('[data-bio]')).toHaveText('After')
  await expect(page.locator('[data-epoch]')).toHaveText('1')
  expect(calls).toBe(2)
})
