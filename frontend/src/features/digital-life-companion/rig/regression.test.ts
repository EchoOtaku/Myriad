import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeRigSilhouette,
  compareRigFrames,
  compareRigPixels,
} from './regression'

test('passes stable frames and measures changed pixel ratios', () => {
  const baseline = new Uint8ClampedArray(400).fill(20)
  assert.equal(compareRigPixels(baseline, baseline).passed, true)
  const candidate = baseline.slice()
  for (let index = 0; index < 40; index += 4) candidate[index] = 255
  const result = compareRigPixels(baseline, candidate)
  assert.equal(result.passed, false)
  assert.equal(result.changedRatio, 0.1)
  assert.ok(result.meanDifference > 0)
})

test('rejects incomparable frame dimensions', () => {
  const result = compareRigPixels(
    new Uint8ClampedArray(4),
    new Uint8ClampedArray(8),
  )
  assert.equal(result.passed, false)
  assert.equal(result.changedRatio, 1)
})

test('detects detached silhouette islands and planted-floor drift', () => {
  const width = 8
  const height = 8
  const baseline = new Uint8ClampedArray(width * height * 4)
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 3; x <= 4; x += 1) baseline[(y * width + x) * 4 + 3] = 255
  }
  const candidate = baseline.slice()
  candidate[(1 * width + 7) * 4 + 3] = 255
  candidate[(1 * width + 6) * 4 + 3] = 255
  candidate[(2 * width + 7) * 4 + 3] = 255
  const silhouette = analyzeRigSilhouette(candidate, width, height)
  assert.equal(silhouette.componentCount, 2)
  assert.ok(silhouette.detachedRatio > 0.2)
  assert.equal(
    compareRigFrames(baseline, candidate, width, height).passed,
    false,
  )
})
