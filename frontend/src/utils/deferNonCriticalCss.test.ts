import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { deferNonCriticalCssIntegration } from '../../scripts/astro/deferNonCriticalCss.mjs'

test('defers only lazy-owned CSS using dependencies, regardless of chunk names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myriad-css-'))
  const integration = deferNonCriticalCssIntegration()
  let plugin: any
  integration.hooks['astro:config:setup']({ updateConfig(config) { plugin = config.vite.plugins[0] } })
  const chunk = (imports: string[], dynamicImports: string[], css: string[]) => ({
    type: 'chunk', imports, dynamicImports, viteMetadata: { importedCss: new Set(css) },
  })
  const bundle = {
    'assets/root.js': chunk(['assets/shared.js'], ['assets/renamed-page.js'], ['assets/root.css']),
    'assets/shared.js': chunk([], [], ['assets/shared.css']),
    'assets/renamed-page.js': chunk(['assets/shared.js', 'assets/form.js'], [], ['assets/renamed-page.css']),
    'assets/form.js': chunk([], [], ['assets/form.css']),
  }
  const links = ['root', 'shared', 'renamed-page', 'form', 'unknown'].map(name => `<link rel="stylesheet" href="/assets/${name}.css">`).join('')
  try {
    plugin.configResolved({ build: { ssr: false } })
    plugin.generateBundle({}, bundle)
    writeFileSync(join(dir, 'index.html'), `<astro-island component-url="/assets/root.js"></astro-island>${links}`)
    writeFileSync(join(dir, 'direct.html'), `<script type="module" src="/assets/renamed-page.js"></script>${links}`)
    await integration.hooks['astro:build:done']({ dir: pathToFileURL(`${dir}/`) })
    const home = readFileSync(join(dir, 'index.html'), 'utf8')
    assert.ok(home.includes('/assets/root.css'))
    assert.ok(home.includes('/assets/shared.css'))
    assert.ok(home.includes('/assets/unknown.css'), 'unowned CSS must be preserved')
    assert.ok(!home.includes('/assets/renamed-page.css'))
    assert.ok(!home.includes('/assets/form.css'))
    const direct = readFileSync(join(dir, 'direct.html'), 'utf8')
    assert.ok(direct.includes('/assets/renamed-page.css'))
    assert.ok(direct.includes('/assets/form.css'))
    await integration.hooks['astro:build:done']({ dir: pathToFileURL(`${dir}/`) })
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), home)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
