import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    widgetSaveFixture: {
      save: (id: string) => void
      snapshot: () => { writes: Array<{ body: string, aborted: boolean }>, reads: number, csrfWaiting: boolean }
      finish: (index: number) => void
      changeSubject: () => void
      holdCsrf: () => void
      releaseCsrf: () => void
      read: () => Promise<unknown>
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/widgetSave.html')
  await expect.poll(() => page.evaluate(() => !!window.widgetSaveFixture)).toBe(true)
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'))
})

test('saves immutable snapshots in order, coalesces pending edits, and invalidates config cache', async ({ page }) => {
  await page.evaluate(() => window.widgetSaveFixture.read())
  await page.evaluate(() => window.widgetSaveFixture.read())
  expect((await page.evaluate(() => window.widgetSaveFixture.snapshot())).reads).toBe(1)
  await page.evaluate(() => window.widgetSaveFixture.save('first'))
  await page.clock.runFor(500)
  await expect.poll(() => page.evaluate(() => window.widgetSaveFixture.snapshot().writes.length)).toBe(1)
  await page.evaluate(() => window.widgetSaveFixture.save('intermediate'))
  await page.clock.runFor(500)
  await page.evaluate(() => window.widgetSaveFixture.save('latest'))
  await page.clock.runFor(500)
  expect((await page.evaluate(() => window.widgetSaveFixture.snapshot())).writes).toHaveLength(1)
  await page.evaluate(() => window.widgetSaveFixture.finish(0))
  await expect.poll(() => page.evaluate(() => window.widgetSaveFixture.snapshot().writes.length)).toBe(2)
  const writes = (await page.evaluate(() => window.widgetSaveFixture.snapshot())).writes
  expect(writes.map(write => JSON.parse(JSON.parse(write.body).control_panel_layout)[0].id)).toEqual(['first', 'latest'])
  await page.evaluate(() => window.widgetSaveFixture.read())
  expect((await page.evaluate(() => window.widgetSaveFixture.snapshot())).reads).toBe(2)
  await page.evaluate(() => window.widgetSaveFixture.finish(1))
})

test('identity change while acquiring CSRF prevents the old write from being sent', async ({ page }) => {
  await page.evaluate(() => { window.widgetSaveFixture.holdCsrf(); window.widgetSaveFixture.save('old') })
  await page.clock.runFor(500)
  await expect.poll(() => page.evaluate(() => window.widgetSaveFixture.snapshot().csrfWaiting)).toBe(true)
  await page.evaluate(() => { window.widgetSaveFixture.changeSubject(); window.widgetSaveFixture.releaseCsrf() })
  await page.clock.runFor(1000)
  expect((await page.evaluate(() => window.widgetSaveFixture.snapshot())).writes).toEqual([])
  await page.evaluate(() => window.widgetSaveFixture.save('new'))
  await page.clock.runFor(500)
  await expect.poll(() => page.evaluate(() => window.widgetSaveFixture.snapshot().writes.length)).toBe(1)
  await page.evaluate(() => window.widgetSaveFixture.finish(0))
})

test('identity invalidation aborts the active request and drops pending edits', async ({ page }) => {
  await page.evaluate(() => window.widgetSaveFixture.save('active'))
  await page.clock.runFor(500)
  await expect.poll(() => page.evaluate(() => window.widgetSaveFixture.snapshot().writes.length)).toBe(1)
  await page.evaluate(() => { window.widgetSaveFixture.save('pending'); window.widgetSaveFixture.changeSubject() })
  await page.clock.runFor(1000)
  const state = await page.evaluate(() => window.widgetSaveFixture.snapshot())
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].aborted).toBe(true)
})
