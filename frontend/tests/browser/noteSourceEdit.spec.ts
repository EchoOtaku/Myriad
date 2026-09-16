import { expect, test } from '@playwright/test'

test('rich paste, delete, paste, undo restores the deleted state', async ({
  page,
}) => {
  await page.goto('/noteSourceEdit.html')
  const editor = page.getByRole('textbox', { name: 'Source' })
  const paste = async () => {
    await editor.evaluate((el) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData(
        'text/html',
        '<h2>Clipboard content</h2><p>Body</p>',
      )
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  }
  await editor.focus()
  await paste()
  await expect(editor).toHaveValue('## Clipboard content\n\nBody')
  await editor.selectText()
  await editor.press('Backspace')
  await expect(editor).toHaveValue('')
  await paste()
  await expect(editor).toHaveValue('## Clipboard content\n\nBody')
  await editor.press('ControlOrMeta+z')
  await expect(editor).toHaveValue('')
  await editor.press('ControlOrMeta+Shift+z')
  await expect(editor).toHaveValue('## Clipboard content\n\nBody')
  await editor.press('ControlOrMeta+z')
  await expect(editor).toHaveValue('')
  await editor.press('ControlOrMeta+z')
  await expect(editor).toHaveValue('## Clipboard content\n\nBody')
  await editor.press('ControlOrMeta+z')
  await expect(editor).toHaveValue('')
})

test('undoing a rich paste over a selection preserves surrounding text', async ({
  page,
}) => {
  await page.goto('/noteSourceEdit.html')
  const editor = page.getByRole('textbox', { name: 'Source' })
  await editor.pressSequentially('Before remove After')
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(7, 13)
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<h2>Replacement</h2>')
    el.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect(editor).toHaveValue('Before \n\n## Replacement\n\n After')
  await editor.press('ControlOrMeta+z')
  await expect(editor).toHaveValue('Before remove After')
  await editor.press('ControlOrMeta+Shift+z')
  await expect(editor).toHaveValue('Before \n\n## Replacement\n\n After')
})
