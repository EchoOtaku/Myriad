import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { getDefaultLocale } from '../../../i18n'
import { loadShellNamespace } from '../../../i18n/loadLocale'
import { annotationChrome } from './annotationChrome.ts'

const dir = dirname(fileURLToPath(import.meta.url))

describe('annotation chrome', () => {
  it('falls unknown types back to term colors', async () => {
    await loadShellNamespace('phantasi', getDefaultLocale())
    const term = annotationChrome('term')
    const unknown = annotationChrome('not-a-type')
    assert.equal(unknown.color, term.color)
    assert.equal(unknown.bgColor, term.bgColor)
    assert.equal(unknown.label, term.label)
    assert.ok(term.label.length > 0)
  })

  it('reader chrome uses the shared helper, not phantasiaiApi type tables', () => {
    for (const name of [
      'ReaderLeftPanel.tsx',
      'MobileReaderBar.tsx',
      'ReaderTooltips.tsx',
    ]) {
      const src = readFileSync(join(dir, name), 'utf8')
      assert.match(src, /annotationChrome\(/)
      assert.doesNotMatch(src, /ANNOTATION_TYPE_CONFIG/)
      assert.doesNotMatch(src, /annotationTypeLabel\(/)
    }
  })
})
