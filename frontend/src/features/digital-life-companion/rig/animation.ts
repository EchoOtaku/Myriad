import type {
  CompanionRigManifest,
  RigClip,
  RigTrack,
  RigTransform,
} from './types'
import { rigRuntimeIndex } from './runtimeIndex'

export const IDENTITY_TRANSFORM: RigTransform = {
  translation: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
}

export function createPoseBuffer(boneCount: number): RigTransform[] {
  return Array.from({ length: boneCount }, () => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
}

export function copyPoseInto(
  output: RigTransform[],
  source: readonly RigTransform[],
): RigTransform[] {
  for (let index = 0; index < output.length; index += 1) {
    writeTransform(output[index], source[index] || IDENTITY_TRANSFORM)
  }
  return output
}

export function clipForActivity(
  manifest: CompanionRigManifest,
  activity: 'idle' | 'thinking' | 'talking',
): RigClip {
  return (
    manifest.clips.find((clip) => clip.id === activity) ||
    manifest.clips.find((clip) => clip.id === manifest.defaultClip) ||
    manifest.clips[0]
  )
}

export function boneEvaluationOrder(manifest: CompanionRigManifest): number[] {
  return [...rigRuntimeIndex(manifest).boneOrder]
}

export function sampleClip(
  manifest: CompanionRigManifest,
  clip: RigClip,
  elapsedSeconds: number,
  indexedTracks?: readonly (RigTrack | undefined)[],
): RigTransform[] {
  return sampleClipInto(
    createPoseBuffer(manifest.bones.length),
    manifest,
    clip,
    elapsedSeconds,
    indexedTracks,
  )
}

export function sampleClipInto(
  output: RigTransform[],
  manifest: CompanionRigManifest,
  clip: RigClip,
  elapsedSeconds: number,
  indexedTracks?: readonly (RigTrack | undefined)[],
): RigTransform[] {
  const time = clip.looping
    ? elapsedSeconds % clip.duration
    : Math.min(elapsedSeconds, clip.duration)
  const tracks = indexedTracks || indexClipTracks(manifest, clip)
  for (let boneIndex = 0; boneIndex < manifest.bones.length; boneIndex += 1) {
    const track = tracks[boneIndex]
    if (!track) {
      writeTransform(output[boneIndex], IDENTITY_TRANSFORM)
      continue
    }
    const nextIndex = keyframeUpperBound(track, time)
    if (nextIndex >= track.keyframes.length) {
      writeTransform(
        output[boneIndex],
        track.keyframes[track.keyframes.length - 1].transform,
      )
      continue
    }
    if (nextIndex === 0) {
      writeTransform(
        output[boneIndex],
        track.keyframes[0].transform,
      )
      continue
    }
    const previous = track.keyframes[nextIndex - 1]
    const next = track.keyframes[nextIndex]
    const segmentAmount =
      (time - previous.time) / Math.max(0.0001, next.time - previous.time)
    const easedAmount =
      nextIndex === 1 || nextIndex === track.keyframes.length - 1
        ? smootherstep(segmentAmount)
        : segmentAmount
    curveTransformInto(
      output[boneIndex],
      track.keyframes[Math.max(0, nextIndex - 2)].transform,
      previous.transform,
      next.transform,
      track.keyframes[Math.min(track.keyframes.length - 1, nextIndex + 1)]
        .transform,
      easedAmount,
    )
  }
  return output
}

function keyframeUpperBound(track: RigTrack, time: number): number {
  let low = 0
  let high = track.keyframes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (track.keyframes[middle].time < time) low = middle + 1
    else high = middle
  }
  return low
}

export function indexClipTracks(
  manifest: CompanionRigManifest,
  clip: RigClip,
): Array<RigTrack | undefined> {
  const tracks = new Map(clip.tracks.map((track) => [track.boneId, track]))
  return manifest.bones.map((bone) => tracks.get(bone.id))
}

export function mixPose(
  from: RigTransform[],
  to: RigTransform[],
  amount: number,
): RigTransform[] {
  return mixPoseInto(
    createPoseBuffer(to.length),
    from,
    to,
    amount,
  )
}

export function mixPoseInto(
  output: RigTransform[],
  from: readonly RigTransform[],
  to: readonly RigTransform[],
  amount: number,
): RigTransform[] {
  for (let index = 0; index < output.length; index += 1) {
    mixTransformInto(
      output[index],
      from[index] || IDENTITY_TRANSFORM,
      to[index] || IDENTITY_TRANSFORM,
      amount,
    )
  }
  return output
}

export function mixPoseByMask(
  from: RigTransform[],
  to: RigTransform[],
  amount: number,
  mask: readonly boolean[],
): RigTransform[] {
  return from.map((transform, index) =>
    mask[index]
      ? mixTransform(transform, to[index] || IDENTITY_TRANSFORM, amount)
      : transform,
  )
}

export function mixPoseByMaskInto(
  output: RigTransform[],
  from: readonly RigTransform[],
  to: readonly RigTransform[],
  amount: number,
  mask: readonly boolean[],
): RigTransform[] {
  for (let index = 0; index < output.length; index += 1) {
    if (mask[index]) {
      mixTransformInto(
        output[index],
        from[index] || IDENTITY_TRANSFORM,
        to[index] || IDENTITY_TRANSFORM,
        amount,
      )
    } else {
      writeTransform(output[index], from[index] || IDENTITY_TRANSFORM)
    }
  }
  return output
}

export function scalePoseDeltaInto(
  pose: RigTransform[],
  amount: number,
  mask?: readonly boolean[],
): RigTransform[] {
  const scale = Math.max(0, Math.min(1.4, amount))
  for (let index = 0; index < pose.length; index += 1) {
    if (mask && !mask[index]) continue
    const transform = pose[index]
    transform.translation.x *= scale
    transform.translation.y *= scale
    transform.rotation *= scale
    transform.scale.x = 1 + (transform.scale.x - 1) * scale
    transform.scale.y = 1 + (transform.scale.y - 1) * scale
  }
  return pose
}

export function mixTransform(
  from: RigTransform,
  to: RigTransform,
  amount: number,
): RigTransform {
  const output = createPoseBuffer(1)[0]
  mixTransformInto(output, from, to, amount)
  return output
}

function mixTransformInto(
  output: RigTransform,
  from: RigTransform,
  to: RigTransform,
  amount: number,
): void {
  const t = smoothstep(Math.max(0, Math.min(1, amount)))
  output.translation.x = lerp(from.translation.x, to.translation.x, t)
  output.translation.y = lerp(from.translation.y, to.translation.y, t)
  output.rotation = lerpAngle(from.rotation, to.rotation, t)
  output.scale.x = lerp(from.scale.x, to.scale.x, t)
  output.scale.y = lerp(from.scale.y, to.scale.y, t)
}

export function curveTransform(
  before: RigTransform,
  from: RigTransform,
  to: RigTransform,
  after: RigTransform,
  amount: number,
): RigTransform {
  const output = createPoseBuffer(1)[0]
  curveTransformInto(output, before, from, to, after, amount)
  return output
}

function curveTransformInto(
  output: RigTransform,
  before: RigTransform,
  from: RigTransform,
  to: RigTransform,
  after: RigTransform,
  amount: number,
): void {
  const t = Math.max(0, Math.min(1, amount))
  output.translation.x = boundedCatmullRom(
    before.translation.x,
    from.translation.x,
    to.translation.x,
    after.translation.x,
    t,
  )
  output.translation.y = boundedCatmullRom(
    before.translation.y,
    from.translation.y,
    to.translation.y,
    after.translation.y,
    t,
  )
  output.rotation = boundedCatmullRom(
    unwrapAngle(before.rotation, from.rotation),
    from.rotation,
    unwrapAngle(to.rotation, from.rotation),
    unwrapAngle(after.rotation, to.rotation),
    t,
  )
  output.scale.x = boundedCatmullRom(
    before.scale.x,
    from.scale.x,
    to.scale.x,
    after.scale.x,
    t,
  )
  output.scale.y = boundedCatmullRom(
    before.scale.y,
    from.scale.y,
    to.scale.y,
    after.scale.y,
    t,
  )
}

function writeTransform(output: RigTransform, source: RigTransform): void {
  output.translation.x = source.translation.x
  output.translation.y = source.translation.y
  output.rotation = source.rotation
  output.scale.x = source.scale.x
  output.scale.y = source.scale.y
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function lerpAngle(from: number, to: number, amount: number): number {
  const turn = Math.PI * 2
  const difference = ((to - from + Math.PI) % turn) - Math.PI
  return from + difference * amount
}

function unwrapAngle(value: number, reference: number): number {
  const turn = Math.PI * 2
  return (
    reference +
    ((((value - reference + Math.PI) % turn) + turn) % turn) -
    Math.PI
  )
}

function boundedCatmullRom(
  before: number,
  from: number,
  to: number,
  after: number,
  amount: number,
): number {
  const amountSquared = amount * amount
  const amountCubed = amountSquared * amount
  const value =
    0.5 *
    (2 * from +
      (-before + to) * amount +
      (2 * before - 5 * from + 4 * to - after) * amountSquared +
      (-before + 3 * from - 3 * to + after) * amountCubed)
  return Math.max(Math.min(from, to), Math.min(Math.max(from, to), value))
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function smootherstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}
