import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { themeBootInlineScript } from './themeBootScript.ts'

function bootTheme(options: {
  stored: string | null
  prefersDark: boolean
}) {
  const html = {
    classList: {
      tokens: new Set<string>(['light']),
      add(name: string) {
        this.tokens.add(name)
      },
      remove(name: string) {
        this.tokens.delete(name)
      },
    },
  }
  const themeColor = { content: '#f5f5f5', setAttribute(name: string, value: string) {
    if (name === 'content') this.content = value
  } }
  const sandbox = createContext({
    localStorage: {
      getItem(key: string) {
        return key === 'theme' ? options.stored : null
      },
    },
    document: {
      documentElement: html,
      querySelector(selector: string) {
        return selector === 'meta[name="theme-color"]' ? themeColor : null
      },
    },
    getComputedStyle() {
      return { getPropertyValue: () => '#94a3b8' }
    },
    MutationObserver: class {
      observe() {}
    },
    window: {
      matchMedia() {
        return {
          matches: options.prefersDark,
          addEventListener() {},
        }
      },
    },
  })
  runInContext(themeBootInlineScript(), sandbox)
  return {
    classes: [...html.classList.tokens].toSorted(),
    themeColor: themeColor.content,
  }
}

describe('themeBootInlineScript', () => {
  it('is wired into the shared SPA document as ThemeBoot', () => {
    const source = readFileSync(
      new URL('../layouts/SpaDocument.astro', import.meta.url),
      'utf8',
    )
    assert.match(source, /<ThemeBoot/)
    assert.doesNotMatch(source, /function initializeTheme/)
  })

  it('follows a stored light/dark choice and otherwise the system', () => {
    assert.deepEqual(bootTheme({ stored: 'dark', prefersDark: false }).classes, [
      'dark',
    ])
    assert.deepEqual(bootTheme({ stored: 'light', prefersDark: true }).classes, [
      'light',
    ])
    assert.deepEqual(bootTheme({ stored: null, prefersDark: true }).classes, [
      'dark',
    ])
    assert.equal(
      bootTheme({ stored: 'dark', prefersDark: false }).themeColor,
      '#94a3b8',
    )
  })
})
