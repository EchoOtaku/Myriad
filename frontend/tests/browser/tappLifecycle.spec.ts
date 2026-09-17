import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('real widget keeps its iframe and SDK state offscreen, resumes, and destroys on unmount', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/tappLifecycle.tsx', import.meta.url))}`
  let issued = 0
  let revoked = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/tapp-lifecycle-probe', route => route.fulfill({ contentType: 'text/html', body: '<style>.w-full{width:100%}.h-full{height:100%}</style><div id="root"></div>' }))
  await page.route('**/api/**', async route => {
    const request = route.request()
    if (request.url().includes('runtime-grants') && request.method() === 'DELETE') {
      revoked++
      return route.fulfill({ json: {} })
    }
    if (request.url().endsWith('/runtime-grants')) {
      issued++
      const { instanceId, kind } = request.postDataJSON()
      return route.fulfill({ json: { version: 2, token: 'fixture-token', runtimeId: 'fixture-runtime', tappId: 'fixture.lifecycle', ownerId: 1, subjectId: 0, instanceId, kind, permissions: [], expiresAt: new Date(Date.now() + 3600_000).toISOString() } })
    }
    return route.fulfill({ json: request.url().includes('csrf-token') ? { csrf_token: null } : {} })
  })
  await page.goto('/tapp-lifecycle-probe')
  await page.evaluate(async fixture => { (await import(fixture)).mount() }, fixture)
  const frame = page.frameLocator('iframe.tapp-widget-iframe')
  await expect(frame.locator('#widget-root')).toHaveText('Lifecycle ready')
  await expect.poll(() => issued).toBe(1)
  const boot = await frame.locator('body').getAttribute('data-boot')
  const identity = await page.locator('iframe').elementHandle()
  const snapshot = () => page.evaluate(async fixture => (await import(fixture)).snapshot(), fixture)
  expect(await snapshot()).toEqual({ bridges: 1, destroyed: 0, active: 1, grantRefs: 1 })
  for (let cycle = 1; cycle <= 3; cycle++) {
    await page.getByRole('button', { name: 'Toggle viewport' }).click()
    await expect.poll(async () => frame.locator('body').getAttribute('data-pauses')).toBe(String(cycle))
    expect(await page.locator('iframe').evaluate((node, original) => node === original, identity)).toBe(true)
    expect(await snapshot()).toEqual({ bridges: 1, destroyed: 0, active: 0, grantRefs: 1 })
    await page.getByRole('button', { name: 'Toggle viewport' }).click()
    await expect.poll(async () => frame.locator('body').getAttribute('data-resumes')).toBe(String(cycle))
    expect(await frame.locator('body').getAttribute('data-boot')).toBe(boot)
    expect(await snapshot()).toEqual({ bridges: 1, destroyed: 0, active: 1, grantRefs: 1 })
  }
  expect(issued).toBe(1)
  expect(revoked).toBe(0)
  await page.getByRole('button', { name: 'Unmount' }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect.poll(() => revoked).toBe(1)
  expect(await snapshot()).toEqual({ bridges: 1, destroyed: 1, active: 0, grantRefs: 0 })
  expect(errors).toEqual([])
  const evidence = testInfo.outputPath('lifecycle-evidence.json')
  await writeFile(evidence, JSON.stringify({ cycles: 3, issued, revoked, final: await snapshot(), errors }, null, 2))
  await testInfo.attach('lifecycle-evidence', { path: evidence, contentType: 'application/json' })
})
