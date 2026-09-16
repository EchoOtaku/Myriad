import { expect, test } from '@playwright/test'

test('account default survives reopening, history previews and restoration preserve current input', async ({ page }) => {
  let preference = 'visual'
  let restored = false
  await page.addInitScript(() => localStorage.setItem('locale', 'en-US'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/editor-preference')) {
      if (request.method() === 'PUT') preference = request.postDataJSON().default_view
      return route.fulfill({ json: { default_view: preference } })
    }
    if (path.endsWith('/history')) { return route.fulfill({ json: { history: [
      { revision: 5, actor_id: 2, actor_name: 'Bob', saved_at: 1700000000000, snapshot: { title: 'Previous note', content_md: 'Historical draft', topic: null, image: null, published_at: null } },
    ] } })
}
    if (path.endsWith('/restore')) {
      expect(request.postDataJSON().current.content_md).toBe('Current draft')
      expect(request.postDataJSON().revision).toBe(20)
      restored = true
      return route.fulfill({ json: { doc: { content_md: 'Historical draft' } } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/noteEditorSettings.html')
  await expect(page.locator('#note-default-view')).toHaveValue('visual')
  await page.locator('#note-default-view').selectOption('write')
  await expect.poll(() => preference).toBe('write')
  await page.reload()
  await expect(page.locator('#view')).toHaveText('write')
  await page.locator('.phantasi-note__history-entry').click()
  await expect(page.locator('.phantasi-note__history-preview pre')).toHaveText('Historical draft')
  await page.locator('.phantasi-note__history-preview button').click()
  await expect(page.locator('#content')).toHaveText('Historical draft')
  expect(restored).toBe(true)
  await page.screenshot({ path: '/tmp/myriad-note-editor-settings.png', fullPage: true })
})

test('collaborators show online and active typing on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/**', route => route.fulfill({ json: { default_view: 'visual', history: [] } }))
  await page.goto('/noteEditorSettings.html?collab=1')
  await expect(page.locator('.phantasi-note__collaborator')).toContainText('Bob')
  const online = await page.locator('.phantasi-note__collaborator').getAttribute('title')
  await page.getByRole('button', { name: 'Simulate typing' }).click()
  await expect(page.locator('.phantasi-note__collaborator')).not.toHaveAttribute('title', online!)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
