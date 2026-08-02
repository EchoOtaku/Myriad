/**
 * PWA install assets (manifest + icons under public/).
 * @vitest-environment node
 */
/* eslint-disable test/no-import-node-test -- node:test is the repository test runner */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('PWA assets', () => {
  it('ships an install-ready web app manifest with 192/512 PNG icons', () => {
    const manifestPath = resolve(here, '../../public/manifest.webmanifest')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string
      short_name: string
      start_url: string
      display: string
      icons: Array<{ src: string; sizes: string; type: string }>
    }

    assert.ok(manifest.name)
    assert.ok(manifest.short_name)
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.display, 'standalone')

    const sizes = new Set(manifest.icons.map((i) => i.sizes))
    assert.ok(sizes.has('192x192'), 'needs 192x192 icon for installability')
    assert.ok(sizes.has('512x512'), 'needs 512x512 icon for installability')

    for (const size of ['192x192', '512x512'] as const) {
      const icon = manifest.icons.find((i) => i.sizes === size)
      assert.ok(icon)
      assert.match(icon!.type, /png/i)
      const iconFile = resolve(
        here,
        '../../public',
        icon!.src.replace(/^\//, ''),
      )
      assert.ok(
        readFileSync(iconFile).length > 100,
        `${icon!.src} should exist and be non-empty`,
      )
    }
  })
})
