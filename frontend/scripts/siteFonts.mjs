import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SITE_FONTS } from '../src/siteFonts.mjs'

/** Shared HTML head data: no provider, network access, or React dependency. */
export function siteFontHead() {
  const faces = []
  const variables = []
  const preloads = []
  for (const font of SITE_FONTS) {
    const file = fileURLToPath(
      new URL(`../public${font.asset}`, import.meta.url),
    )
    const bytes = readFileSync(file)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    if (bytes.subarray(0, 4).toString() !== 'wOF2' || !font.asset.endsWith(`-${hash}.woff2`)) {
      throw new Error(`Invalid site font: ${font.asset}`)
    }
    const family = JSON.stringify(font.name)
    const weights = [...font.weights].sort((a, b) => a - b)
    const weight =
      weights.length === 1 ? weights[0] : `${weights[0]} ${weights.at(-1)}`
    faces.push(
      `@font-face{font-family:${family};font-style:normal;font-weight:${weight};font-display:swap;src:url("${font.asset}") format("woff2");unicode-range:${font.unicodeRange}}`,
    )
    variables.push(
      `${font.cssVariable}:${family},${font.fallbacks.map((fallback) => (fallback.includes(' ') ? JSON.stringify(fallback) : fallback)).join(',')}`,
    )
    if (font.preload) preloads.push(font.asset)
  }
  return { css: `${faces.join('\n')}\n:root{${variables.join(';')}}`, preloads }
}
