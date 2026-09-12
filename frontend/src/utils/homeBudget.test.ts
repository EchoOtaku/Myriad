import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

describe('home first-paint budget', () => {
  it('keeps Agora and Config off the home module graph', () => {
    const home = readFileSync(new URL('../views/Home.tsx', import.meta.url), 'utf8')
    const routes = readFileSync(
      new URL('./codeSplitting.ts', import.meta.url),
      'utf8',
    )
    const agora = readFileSync(
      new URL('../features/merope/speech/agoraConversation.ts', import.meta.url),
      'utf8',
    )
    assert.equal(home.includes('agora-rtc-sdk-ng'), false)
    assert.equal(home.includes('agora-rtm'), false)
    assert.equal(home.includes("from '../views/Config'"), false)
    assert.match(routes, /config:\s*lazyWithPreload\(\(\) => import\('\.\.\/views\/Config'\)\)/)
    assert.match(agora, /import\('agora-rtc-sdk-ng'\)/)
    assert.match(agora, /import\('agora-rtm'\)/)
  })

  it('keeps built first-paint assets inside the gzip baseline when dist exists', async () => {
    const dist = new URL('../../dist/index.html', import.meta.url)
    if (!existsSync(fileURLToPath(dist))) {
      return
    }
    const { measureHomeBudget } = await import('../../scripts/home-budget.mjs')
    const measured = await measureHomeBudget()
    const baseline = JSON.parse(
      readFileSync(new URL('../../scripts/home-budget.baseline.json', import.meta.url), 'utf8'),
    ) as { jsGzipBytes: number; cssGzipBytes: number }
    assert.equal(measured.loadsAgora, false)
    assert.ok(
      measured.jsGzipBytes <= Math.ceil(baseline.jsGzipBytes * 1.15),
      `JS gzip ${measured.jsGzipBytes} > baseline ${baseline.jsGzipBytes} +15%`,
    )
    assert.ok(
      measured.cssGzipBytes <= Math.ceil(baseline.cssGzipBytes * 1.15),
      `CSS gzip ${measured.cssGzipBytes} > baseline ${baseline.cssGzipBytes} +15%`,
    )
  })
})
