import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))

export async function mountNoteHook<T, P>(hook: (props: P) => T, initial: P) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const root = createRoot(dom.window.document.getElementById('root'))
  let result: T
  function Harness({ value }: { value: P }) {
    result = hook(value)
    return null
  }
  async function render(props: P) {
    await act(async () => root.render(createElement(Harness, { value: props })))
  }
  await render(initial)
  return {
    get current() { return result! },
    render,
    async close() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
