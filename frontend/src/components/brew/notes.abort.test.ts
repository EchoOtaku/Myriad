import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('note editor abort', () => {
  it('draft load and preview pass AbortSignal', () => {
    const editor = readFileSync(join(dir, 'notes/NoteEditor.tsx'), 'utf8')
    const api = readFileSync(join(dir, '../../services/brewApi.ts'), 'utf8')
    assert.match(api, /export async function getNoteDraft\(\s*id: number,\s*signal\?: AbortSignal/)
    assert.match(editor, /openNoteCloudDoc\(/)
    assert.match(editor, /previewNote\([^,]+, controller\.signal\)/)
    assert.match(editor, /prepareNoteReaderHtml\(/)
    assert.match(editor, /setHtml\(markdownToVisualHtml\(source\)\)/)
    assert.match(editor, /controller\.abort\(\)/)
    assert.match(editor, /pane !== 'preview'/)
    assert.match(editor, /textareaSupportsFieldSizing\(\)/)
    assert.match(editor, /growTextarea\(/)
  })

  it('发布载荷带主题、封面和发布时间', () => {
    const editor = readFileSync(join(dir, 'notes/NoteEditor.tsx'), 'utf8')
    assert.match(editor, /toNoteWritePayload\(/)
    assert.match(editor, /noteFieldError\(/)
    assert.match(editor, /publishNoteDoc\(/)
    assert.match(editor, /scheduleNoteDoc\(/)
    assert.match(editor, /noteDocWsUrl\(/)
    assert.match(editor, /contentEditable/)
    assert.match(editor, /markdownToVisualHtml\(/)
    assert.match(editor, /previewNote\([^,]+, controller\.signal\)/)
  })

  it('外壳是编辑器：薄顶栏、浮动条、底栏、发布抽屉；不进口 brewApi', () => {
    const chrome = readFileSync(join(dir, 'notes/NoteEditorChrome.tsx'), 'utf8')
    const controls = readFileSync(join(dir, 'notes/NoteControls.tsx'), 'utf8')
    const editor = readFileSync(join(dir, 'notes/NoteEditor.tsx'), 'utf8')
    // 编辑器用自己的控件，不借设置页的。
    assert.doesNotMatch(chrome, /from ['"][^'"]*settings\//)
    assert.doesNotMatch(controls, /from ['"][^'"]*settings\//)
    for (const control of ['NoteButton', 'NoteSwitch', 'NoteSelect', 'NoteDateInput', 'NoteField']) {
      assert.match(controls, new RegExp(`export function ${control}\\b`))
      assert.match(chrome, new RegExp(`<${control}\\b`))
    }
    assert.match(chrome, /notePublishSettings/)
    for (const part of ['NoteTopBar', 'NoteBubble', 'NoteGutter', 'NoteFootBar', 'NoteSettingsDrawer', 'NoteByline']) {
      assert.match(chrome, new RegExp(`export function ${part}\\(`))
      assert.match(editor, new RegExp(`<${part}\\b`))
    }
    assert.doesNotMatch(chrome, /InputItem/)
    assert.doesNotMatch(chrome, /from ['"].*brewApi['"]/)
    assert.match(editor, /brew-note__title/)
    assert.match(editor, /useNoteSelection\(/)
    assert.match(editor, /showNoteNotice\(/)
    assert.doesNotMatch(chrome, /brew-note__alert/)
    assert.doesNotMatch(editor, /error=\{error\}/)
  })
})
