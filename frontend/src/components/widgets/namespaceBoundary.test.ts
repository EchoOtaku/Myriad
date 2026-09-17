import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

// Widgets render on the home grid / control panel, outside the /journal and
// /tapp routes that wrap pages in I18nNamespace. Each one must therefore carry
// its own boundary, otherwise t.<namespace> is undefined and render throws.
const NAMESPACED_WIDGETS: Array<[file: string, namespace: string]> = [
  ['TappWidget.tsx', 'tapp'],
  ['MeropeWidget.tsx', 'merope'],
  ['../phantasi/tiles/PhantasiFeaturedTile.tsx', 'phantasi'],
  ['../phantasi/tiles/PhantasiSourceTile.tsx', 'phantasi'],
  ['../phantasi/tiles/PhantasiTopicTile.tsx', 'phantasi'],
]

describe('widget i18n namespace boundaries', () => {
  for (const [file, namespace] of NAMESPACED_WIDGETS) {
    it(`${file} wraps its widget in I18nNamespace names={['${namespace}']}`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      assert.match(
        source,
        new RegExp(`I18nNamespace\\s+names=\\{\\['${namespace}'\\]\\}`),
      )
    })
  }
})
