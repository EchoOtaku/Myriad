import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/homeEdit.html')
  await expect(page.getByTestId('editing')).toHaveText('true')
  await expect(page.locator('.widget-library-island')).toHaveAttribute(
    'data-library-stage',
    'parked',
  )
})

test('grid blank toggles the dock without making widgets or outside clicks reopen it', async ({
  page,
}) => {
  const dock = page.locator('.widget-library-island')
  await page.getByTestId('blank').click()
  await expect(dock).not.toHaveAttribute('data-library-stage', 'parked')
  await page.locator('.widget-library-title').click()
  await expect(dock).not.toHaveAttribute('data-library-stage', 'parked')
  await page.getByTestId('blank').click()
  await expect(dock).toHaveAttribute('data-library-stage', 'parked')
  await expect(page.locator('.widget-library-stage-hit')).toBeVisible()
  await page.waitForTimeout(700)
  await page.getByTestId('widget').click()
  await expect(dock).toHaveAttribute('data-library-stage', 'parked')
  await page.getByTestId('outside').click()
  await expect(dock).toHaveAttribute('data-library-stage', 'parked')
  await page.getByTestId('blank').click()
  await expect(dock).not.toHaveAttribute('data-library-stage', 'parked')
})

test('stationary widget long press opens component settings without starting drag', async ({
  page,
}) => {
  const box = await page.getByTestId('widget').boundingBox()
  if (!box) throw new Error('settings widget has no layout box')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(550)
  await expect(page.getByTestId('settings-opens')).toHaveText('1')
  await expect(page.getByTestId('drag-starts')).toHaveText('0')
  await page.mouse.up()
})

test('moving a settings widget preserves a non-center grab point', async ({
  page,
}) => {
  const box = await page.getByTestId('widget').locator('..').boundingBox()
  if (!box) throw new Error('settings widget has no layout box')

  const x = box.x + box.width * 0.15
  const y = box.y + box.height * 0.25
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 12, y)
  await page.mouse.up()
  await expect(page.getByTestId('drag-starts')).toHaveText('1')
  await expect(page.getByTestId('drag-grab')).toHaveText(/^0\.15,0\.2[45]$/)
  await page.waitForTimeout(550)
  await expect(page.getByTestId('settings-opens')).toHaveText('0')
})

for (const expanded of [false, true]) {
  test(`Escape confirms exit with the dock ${expanded ? 'expanded' : 'parked'}`, async ({
    page,
  }) => {
    if (expanded) {
      await page.locator('.widget-library-stage-badge').click()
      await expect(page.locator('.widget-library-island')).not.toHaveAttribute(
        'data-library-stage',
        'parked',
      )
    }
    let confirmations = 0
    let accept = false
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      confirmations++
      if (accept) await dialog.accept()
      else await dialog.dismiss()
    })
    await page.keyboard.press('Escape')
    await expect.poll(() => confirmations).toBe(1)
    await expect(page.getByTestId('editing')).toHaveText('true')
    if (!expanded) {
      await expect(page.locator('.widget-library-island')).toHaveAttribute(
        'data-library-stage',
        'parked',
      )
    }
    accept = true
    await page.keyboard.press('Escape')
    await expect.poll(() => confirmations).toBe(2)
    await expect(page.getByTestId('editing')).toHaveText('false')
    await expect(page.locator('.widget-library-island')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(confirmations).toBe(2)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByTestId('editing')).toHaveText('true')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editing')).toHaveText('false')
    expect(confirmations).toBe(3)
  })
}

test('Escape consumed by an inner editor does not ask to exit or open the dock', async ({
  page,
}) => {
  let confirmations = 0
  page.on('dialog', async (dialog) => {
    confirmations++
    await dialog.dismiss()
  })
  await page.getByRole('textbox', { name: 'Inner editor' }).press('Escape')
  await expect(page.locator('.widget-library-island')).toHaveAttribute(
    'data-library-stage',
    'parked',
  )
  await expect(page.getByTestId('editing')).toHaveText('true')
  expect(confirmations).toBe(0)
})

test('drag completion keeps the dock parked until the grid blank is clicked', async ({
  page,
}) => {
  await page.locator('.widget-library-stage-badge').click()
  await page.getByRole('button', { name: 'Start drag' }).click()
  await expect(page.locator('.widget-library-island')).toHaveAttribute(
    'data-library-stage',
    'parked',
  )
  await page.getByRole('button', { name: 'End drag' }).click()
  await page.waitForTimeout(700)
  await page.getByTestId('blank').click()
  await expect(page.locator('.widget-library-island')).not.toHaveAttribute(
    'data-library-stage',
    'parked',
  )
})
