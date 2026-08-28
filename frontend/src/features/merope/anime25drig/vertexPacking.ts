export function createPackedVertices(
  positions: Float32Array,
  uvs: Float32Array,
): Float32Array {
  return packVerticesInto(
    positions,
    uvs,
    new Float32Array(positions.length * 2),
  )
}

/** Reuses one interleaved GPU upload buffer for the lifetime of a mesh. */
export function packVerticesInto(
  positions: Float32Array,
  uvs: Float32Array,
  packed: Float32Array,
): Float32Array {
  if (
    uvs.length !== positions.length ||
    packed.length !== positions.length * 2
  ) {
    throw new RangeError('Anime2.5D vertex buffers have incompatible lengths')
  }
  for (let index = 0; index < positions.length; index += 2) {
    const write = index * 2
    packed[write] = positions[index]
    packed[write + 1] = positions[index + 1]
    packed[write + 2] = uvs[index]
    packed[write + 3] = uvs[index + 1]
  }
  return packed
}
