import type { RigPoint, RigTransform } from './types'
import { RIG_MATRIX_CAPACITY } from './contract'

export { RIG_MATRIX_CAPACITY } from './contract'

export function writeBoneMatrices(
  output: Float32Array,
  local: Float32Array,
  world: Float32Array,
  pose: readonly RigTransform[],
  parents: readonly number[],
  pivots: readonly RigPoint[],
  order: readonly number[],
  capacity = RIG_MATRIX_CAPACITY,
): void {
  local.fill(0)
  world.fill(0)
  for (let index = 0; index < pose.length; index += 1) {
    writeTransformMatrix(local, index * 9, pose[index], pivots[index])
  }
  for (const index of order) {
    const parent = parents[index]
    if (parent >= 0) {
      multiplyMatrixInto(world, index * 9, world, parent * 9, local, index * 9)
    } else {
      const offset = index * 9
      for (let component = 0; component < 9; component += 1) {
        world[offset + component] = local[offset + component]
      }
    }
  }
  output.fill(0)
  for (let component = 0; component < pose.length * 9; component += 1) {
    output[component] = world[component]
  }
  for (let index = pose.length; index < capacity; index += 1) {
    writeIdentityMatrix(output, index * 9)
  }
}

function writeTransformMatrix(
  output: Float32Array,
  offset: number,
  transform: RigTransform,
  pivot: RigPoint,
): void {
  const cosine = Math.cos(transform.rotation)
  const sine = Math.sin(transform.rotation)
  const a = cosine * transform.scale.x
  const b = sine * transform.scale.x
  const c = -sine * transform.scale.y
  const d = cosine * transform.scale.y
  const tx = pivot.x + transform.translation.x - a * pivot.x - c * pivot.y
  const ty = pivot.y + transform.translation.y - b * pivot.x - d * pivot.y
  output[offset] = a
  output[offset + 1] = b
  output[offset + 2] = 0
  output[offset + 3] = c
  output[offset + 4] = d
  output[offset + 5] = 0
  output[offset + 6] = tx
  output[offset + 7] = ty
  output[offset + 8] = 1
}

function multiplyMatrixInto(
  output: Float32Array,
  outputOffset: number,
  left: Float32Array,
  leftOffset: number,
  right: Float32Array,
  rightOffset: number,
): void {
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      output[outputOffset + column * 3 + row] =
        left[leftOffset + row] * right[rightOffset + column * 3] +
        left[leftOffset + 3 + row] * right[rightOffset + column * 3 + 1] +
        left[leftOffset + 6 + row] * right[rightOffset + column * 3 + 2]
    }
  }
}

function writeIdentityMatrix(output: Float32Array, offset: number): void {
  output[offset] = 1
  output[offset + 1] = 0
  output[offset + 2] = 0
  output[offset + 3] = 0
  output[offset + 4] = 1
  output[offset + 5] = 0
  output[offset + 6] = 0
  output[offset + 7] = 0
  output[offset + 8] = 1
}
