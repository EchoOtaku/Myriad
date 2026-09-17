import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile('subscriptions.ts', readFileSync(new URL('./useSandboxSubscriptions.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useSandboxSubscriptions')!
const script = ts.transpile(node.getText(source).replace('export ', ''))

test('hidden lifecycle also disables host shortcuts until resume', () => {
  const active: boolean[] = []
  const events: string[] = []
  let visibility: (value: boolean) => void = () => {}
  const dependencies = {
    useEffect: (effect: () => void) => effect(), useRef: (current: unknown) => ({ current }),
    isPageVisible: () => false, onVisibility: (callback: (value: boolean) => void) => { visibility = callback },
    subscribeToTheme: () => {}, subscribeToPrimaryColor: () => {}, getPrimaryColor: () => '',
  }
  const hook = compileFunction(`${script}; return useSandboxSubscriptions;`, Object.keys(dependencies))(...Object.values(dependencies))
  hook({ current: { emit: (event: string) => events.push(event), setSurfaceActive: (value: boolean) => active.push(value) } }, true, false)
  assert.equal(active.at(-1), false)
  assert.equal(events.at(-1), 'lifecycle:pause')
  visibility(true)
  assert.equal(active.at(-1), true)
  assert.equal(events.at(-1), 'lifecycle:resume')
})
