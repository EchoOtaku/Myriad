import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    controlPanelContentFixture: { provider: typeof import('../../src/services/DynamicContentProvider').dynamicContentProvider, unmount: () => void, notify: (title: string, userId?: number) => void, connected: () => boolean }
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install()
  await page.goto('/controlPanelContent.html')
  await expect(page.locator('[data-index]')).toHaveText('0')
  await expect(page.locator('[data-text]')).toHaveClass(/scrolling/)
})

test('pausing during the fade restores visible content and cancels the pending swap', async ({ page }) => {
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.clock.runFor(6050)
  await expect(page.locator('[data-transition]')).toHaveText('true')
  await page.getByText('Toggle pause', { exact: true }).click()
  await expect(page.locator('[data-transition]')).toHaveText('false')
  await page.clock.runFor(16000)
  await expect(page.locator('[data-index]')).toHaveText('0')
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.clock.runFor(6400)
  await expect(page.locator('[data-index]')).toHaveText('1')
  await expect(page.locator('[data-transition]')).toHaveText('false')
  await page.getByText('Shrink', { exact: true }).click()
  await expect(page.locator('[data-index]')).toHaveText('0')
})

test('hiding during a swap does not leave the carousel faded out on return', async ({ page }) => {
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.clock.runFor(6050)
  await expect(page.locator('[data-transition]')).toHaveText('true')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(20000)
  await expect(page.locator('[data-transition]')).toHaveText('false')
  await expect(page.locator('[data-index]')).toHaveText('0')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(2400)
  await expect(page.locator('[data-index]')).toHaveText('1')
  await expect(page.locator('[data-transition]')).toHaveText('false')
})

test('replacing lyrics removes the temporary fade and stale scroll work', async ({ page }) => {
  await page.getByText('Next lyric', { exact: true }).click()
  await page.getByText('Short text', { exact: true }).click()
  await expect(page.locator('[data-text]')).not.toHaveClass(/lyric-transition|scrolling/)
  await expect(page.locator('[data-text]')).toHaveCSS('opacity', '1')
  expect(await page.locator('[data-text]').evaluate(element => (element as HTMLElement).style.getPropertyValue('--scroll-distance'))).toBe('')
  await page.getByText('Next lyric', { exact: true }).click()
  await page.getByText('Toggle pause', { exact: true }).click()
  await expect(page.locator('[data-text]')).not.toHaveClass(/scrolling/)
  await page.waitForTimeout(150)
  await expect(page.locator('[data-text]')).not.toHaveClass(/scrolling/)
})

test('notification delivery replaces its transient content and expires independently of panel motion', async ({ page }) => {
  await page.evaluate(() => window.controlPanelContentFixture.notify('First notice'))
  await expect(page.locator('[data-notification]')).toHaveText('First notice')
  await page.clock.runFor(10000)
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.evaluate(() => window.controlPanelContentFixture.notify('Second notice'))
  await page.clock.runFor(11000)
  await expect(page.locator('[data-notification]')).toHaveText('Second notice')
  await expect(page.locator('[data-notification-count]')).toHaveText('2')
  await page.clock.runFor(9100)
  await expect(page.locator('[data-notification]')).toHaveText('none')
  await page.evaluate(() => window.controlPanelContentFixture.unmount())
  expect(await page.evaluate(() => window.controlPanelContentFixture.connected())).toBe(false)
})

test('account changes clear transient notifications and cancel the previous account expiry', async ({ page }) => {
  await page.evaluate(() => window.controlPanelContentFixture.notify('Old account'))
  await expect(page.locator('[data-notification]')).toHaveText('Old account')
  await page.clock.runFor(10000)
  await page.getByText('Switch account', { exact: true }).click()
  await expect(page.locator('[data-user]')).toHaveText('2')
  await expect(page.locator('[data-notification]')).toHaveText('none')
  await page.evaluate(() => window.controlPanelContentFixture.notify('New account', 2))
  await expect(page.locator('[data-notification]')).toHaveText('New account')
  await page.clock.runFor(11000)
  await expect(page.locator('[data-notification]')).toHaveText('New account')
  await page.clock.runFor(9100)
  await expect(page.locator('[data-notification]')).toHaveText('none')
})

test('TAPP contents follow source removal and language changes without a panel mirror', async ({ page }) => {
  await page.evaluate(() => {
    const provider = window.controlPanelContentFixture.provider
    provider.setLocale('en-US')
    provider.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'raw', i18n: { text: { 'en-US': 'Hello', 'ja-JP': 'こんにちは' } } })
  })
  await expect(page.locator('[data-tapp-contents]')).toHaveText('Hello')
  await page.evaluate(() => window.controlPanelContentFixture.provider.setLocale('ja-JP'))
  await expect(page.locator('[data-tapp-contents]')).toHaveText('こんにちは')
  await page.evaluate(() => window.controlPanelContentFixture.provider.unregisterTappProvider('demo'))
  await expect(page.locator('[data-tapp-contents]')).toHaveText('')
})

test('background updates collapse to the latest source state and expiration refreshes the UI', async ({ page }) => {
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    const provider = window.controlPanelContentFixture.provider
    for (let i = 0; i < 30; i++) provider.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: String(i), expiresAt: Date.now() + 1000 })
  })
  await expect(page.locator('[data-tapp-contents]')).toHaveText('')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('[data-tapp-contents]')).toHaveText('29')
  await page.clock.runFor(1100)
  await expect(page.locator('[data-tapp-contents]')).toHaveText('')
})

test('returning from suspended browser timers removes content that expired while hidden', async ({ page }) => {
  await page.getByText('Toggle pause', { exact: true }).click()
  await page.evaluate(() => window.controlPanelContentFixture.provider.setTappContent('demo', {
    type: 'tapp-demo', icon: 'demo', text: 'temporary', expiresAt: Date.now() + 1000,
  }))
  await expect(page.locator('[data-tapp-contents]')).toHaveText('temporary')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const now = await page.evaluate(() => Date.now())
  // Jump wall time without delivering the queued timeout, as during suspension.
  await page.clock.setSystemTime(now + 5000)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('[data-tapp-contents]')).toHaveText('')
})
