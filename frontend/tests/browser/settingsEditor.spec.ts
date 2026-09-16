import { expect, test } from '@playwright/test'

interface SettingsFixture {
  bagEffectIds: () => { id: string; after?: string[] }[]
  refreshSpeech: () => Promise<void>
  writes: string[]
  refreshes: string[]
  results: unknown[]
  notices: string[]
  leave: () => void
  changeAccount: () => void
  settled: () => Promise<void>
  failSecond: (value: boolean) => void
  deferFirst: () => void
  release: () => void
  save: () => Promise<void>
  reset: () => Promise<void>
}
declare global {
  interface Window {
    settingsFixture: SettingsFixture
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  const query = testInfo.title.startsWith('an unavailable independent domain')
    ? '?failedLoad=1'
    : ''
  await page.goto(`/settingsEditor.html${query}`)
  await expect(page.getByLabel('First', { exact: true })).toHaveValue('saved')
})

test('leaving an editor stops queued writes and suppresses late completion events', async ({
  page,
}) => {
  await page.getByLabel('First', { exact: true }).fill('first edit')
  await page.getByLabel('Second', { exact: true }).fill('second edit')
  await page.evaluate(() => {
    window.settingsFixture.deferFirst()
    void window.settingsFixture.save()
    window.settingsFixture.leave()
  })
  await expect(page.getByTestId('left-editor')).toBeVisible()
  await page.evaluate(async () => {
    window.settingsFixture.release()
    await window.settingsFixture.settled()
  })
  const actual = await page.evaluate(() => ({
    writes: window.settingsFixture.writes.length,
    refreshes: window.settingsFixture.refreshes,
    results: window.settingsFixture.results,
  }))
  expect(actual).toEqual({ writes: 1, refreshes: [], results: [] })
})

test('switching accounts isolates the new editor from an in-flight old save', async ({
  page,
}) => {
  await page.getByLabel('First', { exact: true }).fill('old account')
  await page.getByLabel('Second', { exact: true }).fill('must not be submitted')
  await page.evaluate(() => {
    window.settingsFixture.deferFirst()
    void window.settingsFixture.save()
    window.settingsFixture.changeAccount()
  })
  await expect(page.getByLabel('First', { exact: true })).toHaveValue('saved')
  await page.evaluate(async () => {
    window.settingsFixture.release()
    await window.settingsFixture.settled()
  })
  expect(await page.evaluate(() => window.settingsFixture.writes.length)).toBe(
    1,
  )
  expect(await page.evaluate(() => window.settingsFixture.results)).toEqual([])
  await expect(page.getByTestId('message')).toHaveText('')
  await page.getByLabel('First', { exact: true }).fill('new account')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('dirty')).toHaveText('false')
  expect(await page.evaluate(() => window.settingsFixture.results.length)).toBe(
    1,
  )
  await page
    .getByLabel('First', { exact: true })
    .fill('unsaved same-account edit')
  await page.evaluate(() => window.settingsFixture.changeAccount())
  await expect(page.getByLabel('First', { exact: true })).toHaveValue('saved')
  await expect(page.getByTestId('dirty')).toHaveText('false')
})

test('an in-flight reset protects page unload even when the draft was clean', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.settingsFixture.deferFirst()
    void window.settingsFixture.reset()
  })
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)
  await page.evaluate(() => window.settingsFixture.release())
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled()
})

test('independent save failure preserves retry and refreshes the acknowledged domain', async ({
  page,
}) => {
  await page.evaluate(() => window.settingsFixture.failSecond(true))
  await page.getByLabel('First', { exact: true }).fill('first edit')
  await page.getByLabel('Second', { exact: true }).fill('second edit')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('message')).toContainText(
    'Second endpoint unavailable',
  )
  await expect(page.getByTestId('dirty')).toHaveText('true')
  expect(await page.evaluate(() => window.settingsFixture.refreshes)).toEqual([
    'first',
  ])
  await page.evaluate(() => window.settingsFixture.failSecond(false))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('dirty')).toHaveText('false')
  expect(
    await page.evaluate(() =>
      window.settingsFixture.writes.map((value) => value.split(':')[0]),
    ),
  ).toEqual(['first', 'second', 'second'])
})

test('save and reset share one lock, and in-flight edits remain dirty', async ({
  page,
}) => {
  await page.getByLabel('First', { exact: true }).fill('submitted')
  await page.evaluate(() => {
    window.settingsFixture.deferFirst()
    void window.settingsFixture.save()
    void window.settingsFixture.save()
    void window.settingsFixture.reset()
  })
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('First', { exact: true }).fill('new edit')
  await page.evaluate(() => window.settingsFixture.release())
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled()
  await expect(page.getByTestId('dirty')).toHaveText('true')
  await expect(page.getByLabel('First', { exact: true })).toHaveValue(
    'new edit',
  )
  expect(await page.evaluate(() => window.settingsFixture.writes.length)).toBe(
    1,
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('dirty')).toHaveText('false')
})

test('page reset persists only the selected fields and leaves siblings dirty', async ({
  page,
}) => {
  await page.getByLabel('First', { exact: true }).fill('old edit')
  await page.getByLabel('Sibling', { exact: true }).fill('unsaved sibling')
  await page.getByRole('button', { name: 'Reset first', exact: true }).click()
  await expect(page.getByLabel('First', { exact: true })).toHaveValue('default')
  await expect(page.getByLabel('Sibling', { exact: true })).toHaveValue(
    'unsaved sibling',
  )
  await expect(page.getByTestId('dirty')).toHaveText('true')
  await expect(page.getByTestId('saved')).toHaveText(
    '{"one":"default","two":"saved"}',
  )
})

test('default notices are scoped to their provider and apply through the field callback', async ({
  page,
}) => {
  await expect(
    page.getByTestId('plain').locator('.setting-title-tag'),
  ).toHaveCount(0)
  const tag = page.getByTestId('injected').locator('.setting-title-tag').first()
  await expect(tag).toBeVisible()
  await tag.locator('.setting-title-tag-main').click()
  await expect(page.getByLabel('First', { exact: true })).toHaveValue(
    'new-default',
  )
  await expect(page.getByTestId('dirty')).toHaveText('true')
  await expect(
    page.getByTestId('injected').locator('.setting-title-tag'),
  ).toHaveCount(0)
})

test('bag changes schedule wallpaper and persona refresh, with runtime dependency', async ({
  page,
}) => {
  const effects = await page.evaluate(() =>
    window.settingsFixture.bagEffectIds(),
  )
  expect(effects.map((effect) => effect.id)).toEqual(
    expect.arrayContaining(['runtime', 'wallpaper', 'persona-name']),
  )
  expect(effects.find((effect) => effect.id === 'persona-name')?.after).toEqual(
    ['runtime'],
  )
  const ids = await page
    .locator('input[id]')
    .evaluateAll((inputs) => inputs.map((input) => input.id))
  expect(new Set(ids).size).toBe(ids.length)
})

test('an unavailable independent domain does not block saving a loaded page', async ({
  page,
}) => {
  await expect(page.getByTestId('second-ready')).toHaveText('false')
  await expect(page.getByTestId('message')).toContainText(
    'Second load unavailable',
  )
  await page.getByLabel('First', { exact: true }).fill('available edit')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('dirty')).toHaveText('false')
  expect(
    await page.evaluate(() =>
      window.settingsFixture.writes.map((value) => value.split(':')[0]),
    ),
  ).toEqual(['first'])
})

test('the real bag speech refresh rejects an unavailable status and accepts a disabled status on retry', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/speech/status', async (route) => {
    requests++
    await route.fulfill({
      status: requests === 1 ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        requests === 1
          ? { error: 'Speech status unavailable' }
          : {
              available: true,
              tts_enabled: true,
              persona_speech_enabled: false,
            },
      ),
    })
  })
  await expect(
    page.evaluate(() => window.settingsFixture.refreshSpeech()),
  ).rejects.toThrow()
  await page.evaluate(() => window.settingsFixture.refreshSpeech())
  expect(requests).toBe(2)
})
