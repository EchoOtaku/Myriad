import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const fixture = `/@fs${fileURLToPath(new URL('./fixture/agentSessionStartup.tsx', import.meta.url))}`

test.beforeEach(async ({ page }) => {
  await page.route('**/session-startup-probe', route => route.fulfill({ contentType: 'text/html', body: '<div id="app-root"></div>' }))
  // Exercise import failures as well: optional warming must not leak rejections.
  await page.route('**/AgentEngine.tsx', route => route.abort())
  await page.route('**/AgentPanel.tsx', route => route.abort())
  await page.goto('/session-startup-probe')
  await page.clock.install()
  await page.evaluate(async fixture => {
    // Deterministic no-idle-API path; the automatic delay remains real application logic.
    Reflect.deleteProperty(window, 'requestIdleCallback')
    ;(window as any).sessionStartup = (await import(fixture)).mount()
  }, fixture)
  await expect(page.locator('.agent-panel-longpress')).toHaveCount(1)
})

test('automatic session startup waits for document readiness and stays mounted after wake', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.fastForward(10_000)
  await expect(page.locator('#session-ready')).toHaveCount(0)
  await page.evaluate(() => (window as any).sessionStartup.ready())
  await page.clock.fastForward(5001)
  await expect(page.locator('#session-ready')).toHaveCount(1)
  await page.clock.fastForward(10_000)
  await expect(page.locator('#session-ready')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('explicit open wakes immediately before document readiness', async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('arael-open-session')))
  await expect(page.locator('#session-ready')).toHaveCount(1)
})

test('unmount removes wake listeners and cancels automatic startup', async ({ page }) => {
  const imports: string[] = []
  page.on('request', request => {
    if (/\/Agent(?:Engine|Panel)\.tsx/.test(request.url())) imports.push(request.url())
  })
  await page.evaluate(() => (window as any).sessionStartup.ready())
  await page.evaluate(() => (window as any).sessionStartup.unmount())
  await page.clock.fastForward(10_000)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('arael-open-session')))
  await expect(page.locator('#session-ready')).toHaveCount(0)
  expect(imports).toEqual([])
})
