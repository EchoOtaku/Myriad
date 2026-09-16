import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('revealing older history preserves chronological order and the stationary pan anchor', async ({
  page,
}) => {
  const fixture = `/@fs${fileURLToPath(new URL('./fixture/agentHistory.tsx', import.meta.url))}`
  await page.route('**/agent-history-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div>',
    }),
  )
  await page.goto('/agent-history-probe')
  await page.evaluate(
    async (fixture) => (await import(fixture)).mountAgentHistory(),
    fixture,
  )
  const rows = page.locator('[data-message-id]')
  await expect(rows).toHaveCount(40)
  await page
    .locator('[data-message-id="79"]')
    .dispatchEvent('wheel', { deltaY: -3800 })
  await expect(rows).toHaveCount(80)
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute('data-message-id')),
    ),
  ).toEqual(Array.from({ length: 80 }, (_, i) => String(i)))
  await expect
    .poll(() => page.getByTestId('track').evaluate((el) => el.style.transform))
    .toBe('translate3d(0px, -4000px, 0px)')
  expect(
    await page
      .locator('[data-message-id="40"]')
      .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
  ).toBe(8)
})
