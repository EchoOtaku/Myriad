import assert from 'node:assert/strict'
import test from 'node:test'
import { createPackedVertices, packVerticesInto } from './vertexPacking'

test('reuses the same interleaved upload buffer across frames', () => {
  const positions = new Float32Array([1, 2, 3, 4])
  const uvs = new Float32Array([0.1, 0.2, 0.3, 0.4])
  const packed = createPackedVertices(positions, uvs)
  positions[0] = 5
  const reused = packVerticesInto(positions, uvs, packed)
  assert.equal(reused, packed)
  const expected = [5, 2, 0.1, 0.2, 3, 4, 0.3, 0.4]
  expected.forEach((value, index) => {
    assert.ok(Math.abs(reused[index] - value) < 1e-6)
  })
})

test('rejects mismatched vertex buffers instead of uploading corrupt data', () => {
  assert.throws(
    () =>
      packVerticesInto(
        new Float32Array(4),
        new Float32Array(2),
        new Float32Array(8),
      ),
    RangeError,
  )
})
