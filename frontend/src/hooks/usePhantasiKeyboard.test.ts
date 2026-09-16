import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function keyboardHarness() {
  const source = readFileSync(new URL('./usePhantasiKeyboard.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let keydown: ((event: KeyboardEvent) => void) | undefined
  let marked = 0
  const exports: {
    usePhantasiKeyboard?: (options: Record<string, unknown>) => void
    PHANTASI_SHORTCUTS?: Array<{ key: string }>
  } = {}
  runInNewContext(js, {
    exports,
    require: (id: string) => {
      assert.equal(id, 'react')
      return {
        useRef: (current: unknown) => ({ current }),
        useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => unknown) => effect(),
      }
    },
    window: {
      addEventListener: (type: string, listener: typeof keydown) => {
        assert.equal(type, 'keydown')
        keydown = listener
      },
    },
    document: { querySelectorAll: () => [] },
    HTMLElement: class {},
    Iterator,
  })
  exports.usePhantasiKeyboard!({
    items: [],
    selectedItem: null,
    onSelectItem: () => {},
    onMarkAllRead: () => marked++,
  })
  return {
    shortcuts: exports.PHANTASI_SHORTCUTS!,
    press(key: string, shiftKey = false) {
      let prevented = false
      keydown!({ key, shiftKey, preventDefault: () => { prevented = true } } as KeyboardEvent)
      return { prevented, marked }
    },
  }
}

for (const key of ['r', 'a']) {
  test(`unregistered ${key} shortcut leaves the keyboard event untouched`, () => {
    const keyboard = keyboardHarness()
    assert.deepEqual(keyboard.press(key), { prevented: false, marked: 0 })
    assert.equal(keyboard.shortcuts.some(shortcut => shortcut.key === key), false)
  })
}

test('Shift+A continues to mark all read', () => {
  const keyboard = keyboardHarness()
  assert.deepEqual(keyboard.press('A', true), { prevented: true, marked: 1 })
  assert.equal(keyboard.shortcuts.some(shortcut => shortcut.key === 'Shift + A'), true)
})
