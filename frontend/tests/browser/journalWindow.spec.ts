import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

async function mount(page: Page, mode: 'list' | 'notes', count: number) {
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/journalWindow.tsx', import.meta.url))}`
  await page.route('**/journal-window-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div>',
    }),
  )
  await page.goto('/journal-window-probe')
  await page.evaluate(
    async ({ fixture, mode, count }) => {
      const { mountJournal } = await import(fixture)
      mountJournal(mode, count)
    },
    { fixture, mode, count },
  )
  await expect(page.locator('.phantasi-story').first()).toBeVisible()
}

async function wheel(page: Page, delta: number) {
  await page
    .locator('.phantasi-stories, .phantasi-notes')
    .dispatchEvent('wheel', {
      deltaX: delta,
      deltaY: 0,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    })
  await expect(page.locator('.is-rail-panning')).toHaveCount(0)
}

for (const width of [390, 1440]) {
  for (const mode of ['list', 'notes'] as const) {
    test(`${mode}: 10,000 stories remain bounded and reachable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await mount(page, mode, 10_000)
      const cards = page.locator('.phantasi-story')
      await expect.poll(() => cards.count()).toBeLessThan(64)
      await wheel(page, 4_000_000)
      const last = page.locator('[data-rail-id="10000"]')
      await expect(last).toBeInViewport()
      await expect.poll(() => cards.count()).toBeLessThan(64)
      await last.click()
      await expect(page.getByTestId('opened')).toHaveText('10000')
      await wheel(page, -4_000_000)
      await page.locator('[data-rail-id="1"]').focus()
      for (let i = 0; i < 60; i++) await page.keyboard.press('Tab')
      const focused = page.locator('.phantasi-story:focus')
      await expect(focused).toHaveAttribute('data-rail-id', '61')
      await expect(focused).toBeInViewport()
      await expect.poll(() => cards.count()).toBeLessThan(64)
    })
  }
}

test('virtual last card loads another page without resetting scroll', async ({
  page,
}) => {
  await mount(page, 'list', 24)
  await expect(page.getByTestId('requests')).toHaveText('0')
  await wheel(page, 4_000)
  await expect(page.getByTestId('requests')).toHaveText('1')
  const track = page.locator('.phantasi-stories-track')
  const before = await track.evaluate((node) => node.style.transform)
  await page
    .getByRole('button', { name: 'append page' })
    .evaluate((node) => node.click())
  await expect(track).toHaveAttribute('style', /--phantasi-story-cols: 24/)
  expect(await track.evaluate((node) => node.style.transform)).toBe(before)
  await expect(page.getByTestId('requests')).toHaveText('1')
  await wheel(page, 4_000)
  await expect(page.getByTestId('requests')).toHaveText('2')
  await page
    .getByRole('button', { name: 'end pages' })
    .evaluate((node) => node.click())
  await wheel(page, -4_000)
  await wheel(page, 4_000)
  await expect(page.getByTestId('requests')).toHaveText('2')
})

test('notes retain position during source completion and reset on category change', async ({
  page,
}) => {
  await mount(page, 'notes', 200)
  await wheel(page, 2_000)
  const track = page.locator('.phantasi-notes-track')
  const before = await track.evaluate((node) => node.style.transform)
  for (const name of ['add source', 'resolve source']) {
    await page.getByRole('button', { name }).evaluate((node) => node.click())
    await expect
      .poll(() => track.evaluate((node) => node.style.transform))
      .toBe(before)
  }
  await page
    .getByRole('button', { name: 'filter history' })
    .evaluate((node) => node.click())
  await expect(page.locator('[data-rail-id="21"]')).toBeInViewport()
  await expect(page.locator('[data-rail-id="1"]')).toHaveCount(0)
})
