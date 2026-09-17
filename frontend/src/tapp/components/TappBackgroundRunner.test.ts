import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import React from 'react'
import ts from 'typescript'

// Execute the real orchestration with the network and React effects under test control.
const source = ts.createSourceFile('runner.tsx', readFileSync(new URL('./TappBackgroundRunner.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const body = source.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportAssignment(node)).map(node => node.getText(source).replace(/^export /, '')).join('\n')
const script = ts.transpile(body, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React })

test('background runner admits four instances and loads one at a time', async () => {
  const effects: Array<() => (() => void) | undefined> = []
  const updates: unknown[] = []
  const calls: string[] = []
  const first = Promise.withResolvers<void>()
  const tapps = Array.from({ length: 20 }, (_, i) => ({ id: String(i), manifest: { version: '1', name: String(i) } }))
  const dependencies = {
    window: { addEventListener() {}, removeEventListener() {} },
    React, useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, (value: unknown) => updates.push(value)],
    useCallback: (callback: unknown) => callback, useEffect: (effect: () => (() => void) | undefined) => effects.push(effect),
    useI18n: () => ({ t: { tapp: {} } }),
    getTappRuntime: () => ({ waitForSync: async () => {}, getBackgroundTapps: () => tapps, on: () => () => {} }),
    loadCoreResources: async (tapp: { id: string }) => { calls.push(tapp.id); if (tapp.id === '0') await first.promise; return { modules: {} } },
    TappPageSandbox: () => null,
  }
  const runner = compileFunction(`${script}; return TappBackgroundRunner;`, Object.keys(dependencies))(...Object.values(dependencies))
  runner()
  const cleanups = effects.map(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['0'])
  first.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['0', '1', '2', '3'])
  assert.equal((updates[0] as unknown[]).length, 4)
  cleanups.forEach(cleanup => cleanup?.())
})
