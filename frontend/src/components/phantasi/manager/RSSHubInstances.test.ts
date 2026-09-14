import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('RSSHubInstances', () => {
  it('工作台选项页铺开，添加订阅仍走嵌入条', () => {
    const src = readFileSync(join(dir, 'RSSHubInstances.tsx'), 'utf8')
    const css = readFileSync(join(dir, 'RSSHubInstances.css'), 'utf8')
    const config = readFileSync(join(dir, 'RSSHubConfig.tsx'), 'utf8')
    const admin = readFileSync(join(dir, 'PhantasiWorkbenchAdmin.tsx'), 'utf8')
    assert.match(src, /layout = 'embed'/)
    assert.match(src, /layout === 'page'/)
    assert.match(src, /is-page/)
    assert.match(src, /maxHeight=\{compact \? '11rem' : undefined\}/)
    assert.match(src, /createPortal/)
    assert.match(src, /workbench-rsshub-actions/)
    assert.match(src, /CheckboxCard/)
    assert.match(css, /\.phantasi-rsshub-instances\.is-page/)
    assert.match(admin, /<RSSHubInstances layout="page"/)
    assert.doesNotMatch(config, /layout="page"/)
  })
})
