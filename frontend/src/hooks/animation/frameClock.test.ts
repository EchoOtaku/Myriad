import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFrameClock } from './frameClock'

for (const refreshRate of [30, 60, 90, 120, 144]) {
  for (const fps of [30, 60]) {
    test(`${fps} FPS work preserves cadence on a ${refreshRate} Hz display`, () => {
      const clock = createFrameClock(fps)
      clock.reset(0)
      let frames = 0
      let elapsed = 0
      for (let index = 1; index <= refreshRate * 10; index++) {
        const time = index * 1000 / refreshRate + (index % 2 ? -0.1 : 0.1)
        const delta = clock.advance(time)
        if (delta === null) continue
        frames++
        elapsed += delta
      }
      assert.equal(frames, Math.min(fps, refreshRate) * 10)
      assert.ok(Math.abs(elapsed - 10_000) < 1)
    })
  }
}

test('a stall skips missed frames and reset excludes hidden time', () => {
  const clock = createFrameClock(60)
  clock.reset(0)
  assert.equal(clock.advance(5000), 5000)
  assert.equal(clock.advance(5000), null)
  clock.reset(10_000)
  const delta = clock.advance(10_000 + 1000 / 60)
  assert.ok(delta !== null && Math.abs(delta - 1000 / 60) < 0.01)
})
