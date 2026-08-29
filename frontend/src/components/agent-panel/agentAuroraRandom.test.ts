/**
 * 思考流光抽签：同一种子可复现，换种子不能得到同一条谱。
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { paintAuroraPrism } from './agentAuroraRandom'

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function huesOf(paint: ReturnType<typeof paintAuroraPrism>): number[] {
  return [...paint.ribbon.matchAll(/(\d+(?:\.\d+)?)deg/g)].map((match) =>
    Number(match[1]),
  )
}

const STOP =
  /(color-mix\(in oklab, oklch\([^)]+\) \d+%, var\(--color-[a-z]+\))\) (\d+\.\d+)%/g

function ribbonStops(
  ribbon: string,
): { color: string; pos: number }[] {
  return [...ribbon.matchAll(STOP)].map((match) => ({
    color: match[1] ?? '',
    pos: Number(match[2]),
  }))
}

describe('aurora prism paint', () => {
  it('loops the ribbon by repeating a period at 0 / 50 / 100', () => {
    const paint = paintAuroraPrism(mulberry32(7))
    assert.match(paint.ribbon, /^linear-gradient\(90deg in oklch,/)
    const stops = ribbonStops(paint.ribbon)
    assert.ok(stops.length >= 8)
    const at = (pos: number) => stops.find((stop) => stop.pos === pos)?.color
    assert.equal(at(0), at(50))
    assert.equal(at(50), at(100))
  })

  it('keeps stop positions non-decreasing', () => {
    const stops = ribbonStops(paintAuroraPrism(mulberry32(19)).ribbon)
    assert.ok(stops.length >= 8)
    for (let i = 1; i < stops.length; i += 1) {
      assert.ok(
        stops[i].pos >= stops[i - 1].pos,
        `${stops[i - 1].pos} -> ${stops[i].pos}`,
      )
    }
  })

  it('draws more than three hues and does not reuse one recipe', () => {
    const a = paintAuroraPrism(mulberry32(3))
    const b = paintAuroraPrism(mulberry32(11))
    const unique = new Set([...huesOf(a), ...huesOf(b)])
    assert.ok(unique.size > 3)
    assert.notEqual(a.ribbon, b.ribbon)
    assert.notEqual(a.blobs, b.blobs)
    assert.notEqual(a.width, b.width)
  })

  it('paints random blobs as radial gradients', () => {
    const paint = paintAuroraPrism(mulberry32(5))
    assert.match(paint.blobs, /radial-gradient\(/)
    assert.match(paint.width, /%$/)
    assert.match(paint.ribbonMs, /s$/)
    assert.match(paint.wanderMs, /s$/)
  })
})
