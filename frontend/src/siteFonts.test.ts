import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { siteFontHead } from '../scripts/siteFonts.mjs'

import { SITE_FONTS, SITE_TITLE_FONTS } from './siteFonts.mjs'

const titleFontSource = readFileSync(
  new URL('./hooks/useTitleFont.ts', import.meta.url),
  'utf8',
)
const fontsCss = readFileSync(
  new URL('./styles/fonts.css', import.meta.url),
  'utf8',
)

describe('siteFonts', () => {
  it('registers all local faces and preloads only the body and default title', () => {
    const head = siteFontHead()
    assert.equal(SITE_FONTS.length, 11)
    assert.equal((head.css.match(/@font-face/g) || []).length, 11)
    assert.deepEqual(head.preloads, [
      SITE_FONTS[0].asset,
      SITE_TITLE_FONTS[0].asset,
    ])
    assert.match(head.css, /font-weight:400 700/)
    assert.doesNotMatch(head.css, /https?:/)
    for (const font of SITE_FONTS) {
      assert.ok(head.css.includes(font.cssVariable))
      assert.ok(head.css.includes(font.asset))
      assert.ok(head.css.includes(JSON.stringify(font.name)))
    }
    assert.match(titleFontSource, /SITE_TITLE_FONTS/)
    assert.doesNotMatch(titleFontSource, /id: 'qwitcher-grypen'/)
  })

  it('keeps title ids, weights, and css classes that fonts.css already paints', () => {
    assert.deepEqual(
      SITE_TITLE_FONTS.map((font) => [font.id, font.weights[0], font.cssClass]),
      [
        ['qwitcher-grypen', 700, 'title-font-qwitcher-grypen'],
        ['codystar', 400, 'title-font-codystar'],
        ['henny-penny', 400, 'title-font-henny-penny'],
        ['srisakdi', 700, 'title-font-srisakdi'],
        ['fleur-de-leah', 400, 'title-font-fleur-de-leah'],
        ['league-script', 400, 'title-font-league-script'],
        ['megrim', 400, 'title-font-megrim'],
        ['silkscreen', 700, 'title-font-silkscreen'],
        ['unifraktur-maguntia', 400, 'title-font-unifraktur-maguntia'],
        ['cinzel', 700, 'title-font-cinzel'],
      ],
    )
    for (const font of SITE_TITLE_FONTS) {
      assert.match(fontsCss, new RegExp(`\\.${font.cssClass}\\s*\\{`))
      assert.match(fontsCss, new RegExp(`font-weight:\\s*${font.weights[0]}`))
    }
  })
})
