export interface MotionRegressionResult {
  changedRatio: number
  meanDifference: number
  floorShift: number
  silhouetteShift: number
  detachedRatio: number
  passed: boolean
}

export interface RigSilhouetteMetrics {
  opaquePixels: number
  componentCount: number
  detachedRatio: number
  centerX: number
  floorY: number
}

export function compareRigPixels(
  baseline: Uint8ClampedArray,
  candidate: Uint8ClampedArray,
  threshold = 24,
): MotionRegressionResult {
  if (baseline.length !== candidate.length || baseline.length === 0) {
    return {
      changedRatio: 1,
      meanDifference: 255,
      floorShift: 1,
      silhouetteShift: 1,
      detachedRatio: 1,
      passed: false,
    }
  }
  let changed = 0
  let difference = 0
  let pixels = 0
  for (let index = 0; index < baseline.length; index += 4) {
    const delta =
      (Math.abs(baseline[index] - candidate[index]) +
        Math.abs(baseline[index + 1] - candidate[index + 1]) +
        Math.abs(baseline[index + 2] - candidate[index + 2]) +
        Math.abs(baseline[index + 3] - candidate[index + 3])) /
      4
    difference += delta
    if (delta > threshold) changed += 1
    pixels += 1
  }
  const changedRatio = changed / pixels
  return {
    changedRatio,
    meanDifference: difference / pixels,
    floorShift: 0,
    silhouetteShift: 0,
    detachedRatio: 0,
    passed: changedRatio <= 0.035,
  }
}

export function analyzeRigSilhouette(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RigSilhouetteMetrics {
  if (width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    return {
      opaquePixels: 0,
      componentCount: 0,
      detachedRatio: 1,
      centerX: 0.5,
      floorY: 0,
    }
  }
  const occupied = new Uint8Array(width * height)
  let opaquePixels = 0
  let sumX = 0
  let floor = -1
  for (let pixel = 0; pixel < occupied.length; pixel += 1) {
    if (pixels[pixel * 4 + 3] <= 20) continue
    occupied[pixel] = 1
    opaquePixels += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    sumX += x
    floor = Math.max(floor, y)
  }
  if (opaquePixels === 0) {
    return {
      opaquePixels: 0,
      componentCount: 0,
      detachedRatio: 1,
      centerX: 0.5,
      floorY: 0,
    }
  }
  const visited = new Uint8Array(occupied.length)
  let componentCount = 0
  let largestComponent = 0
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let cursor = 0
    let size = 0
    while (cursor < queue.length) {
      const pixel = queue[cursor++]
      size += 1
      const x = pixel % width
      const neighbours = [pixel - width, pixel + width]
      if (x > 0) neighbours.push(pixel - 1)
      if (x < width - 1) neighbours.push(pixel + 1)
      for (const neighbour of neighbours) {
        if (
          neighbour >= 0 &&
          neighbour < occupied.length &&
          occupied[neighbour] &&
          !visited[neighbour]
        ) {
          visited[neighbour] = 1
          queue.push(neighbour)
        }
      }
    }
    if (size >= 3) componentCount += 1
    largestComponent = Math.max(largestComponent, size)
  }
  return {
    opaquePixels,
    componentCount,
    detachedRatio: 1 - largestComponent / opaquePixels,
    centerX: sumX / opaquePixels / Math.max(1, width - 1),
    floorY: floor / Math.max(1, height - 1),
  }
}

export function compareRigFrames(
  baseline: Uint8ClampedArray,
  candidate: Uint8ClampedArray,
  width: number,
  height: number,
): MotionRegressionResult {
  const pixels = compareRigPixels(baseline, candidate)
  if (
    baseline.length !== candidate.length ||
    baseline.length !== width * height * 4
  ) {
    return pixels
  }
  const left = analyzeRigSilhouette(baseline, width, height)
  const right = analyzeRigSilhouette(candidate, width, height)
  const floorShift = Math.abs(left.floorY - right.floorY)
  const silhouetteShift = Math.abs(left.centerX - right.centerX)
  const detachedRatio = right.detachedRatio
  const silhouettePassed =
    right.opaquePixels > 0 &&
    floorShift <= 0.025 &&
    silhouetteShift <= 0.06 &&
    detachedRatio <= Math.max(0.018, left.detachedRatio + 0.008)
  return {
    ...pixels,
    floorShift,
    silhouetteShift,
    detachedRatio,
    passed: pixels.passed && silhouettePassed,
  }
}

export async function compareRigDataUrls(
  baseline: string,
  candidate: string,
): Promise<MotionRegressionResult> {
  const [left, right] = await Promise.all([
    loadImage(baseline),
    loadImage(candidate),
  ])
  const width = Math.max(1, Math.min(left.width, right.width, 512))
  const height = Math.max(1, Math.min(left.height, right.height, 512))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.drawImage(left, 0, 0, width, height)
  const leftPixels = context.getImageData(0, 0, width, height).data
  context.clearRect(0, 0, width, height)
  context.drawImage(right, 0, 0, width, height)
  const rightPixels = context.getImageData(0, 0, width, height).data
  return compareRigFrames(leftPixels, rightPixels, width, height)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Could not decode captured rig frame'))
    image.src = url
  })
}
