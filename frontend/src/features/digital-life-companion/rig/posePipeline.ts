import type { SpeechArticulation } from './articulation'
import type { IdleBehaviorMode } from './director'
import type { GeneratedMotionInstance } from './generation'
import type {
  GazeSource,
  GazeTarget,
  MotionCharacterState,
  MotionDebugSignals,
} from './motion'
import type { PoseContinuityResult } from './poseContinuity'
import type { CompanionActivity, RigTransformVelocity } from './transitions'
import type {
  CompanionRigManifest,
  RigMotionProfile,
  RigTransform,
} from './types'
import { copyPoseInto, createPoseBuffer } from './animation'
import { applyGeneratedMotionDynamicsInto } from './generation'
import { MotionRuntime } from './motion'
import { applyOutfitSafetyEnvelopeInto } from './outfit'
import { preservePoseContinuityInto } from './poseContinuity'
import { writePoseVelocity } from './transitions'

export interface GeneratedPoseDynamics {
  clipId: string
  intensity: number
  instance: GeneratedMotionInstance
  progress: number
  blend: number
}

/**
 * Owns every final-pose stage that must run exactly once per rendered frame.
 * The renderer composes authored channels; this pipeline applies procedural
 * motion, garment policy, seam repair, and temporal continuity in one order.
 */
export class PosePipeline {
  private readonly motion: MotionRuntime
  private readonly previousPose: RigTransform[]
  private readonly lastPose: RigTransform[]
  private readonly outfitMask: boolean[]

  private readonly continuityResult: PoseContinuityResult = {
    limitedBones: 0,
    limitedChannels: 0,
    limitedAccelerationChannels: 0,
  }

  private previousAt = 0
  private lastAt = 0
  private expanded = true
  private limitNextFrameToCollapsedInterval = false

  constructor(private readonly manifest: CompanionRigManifest) {
    this.motion = new MotionRuntime(manifest)
    this.previousPose = createPoseBuffer(manifest.bones.length)
    this.lastPose = createPoseBuffer(manifest.bones.length)
    this.outfitMask = manifest.bones.map(() => true)
  }

  setCharacterState(state: MotionCharacterState): void {
    this.motion.setCharacterState(state)
  }

  setMotionProfile(profile: RigMotionProfile): void {
    this.motion.setMotionProfile(profile)
  }

  setIdleBehaviorMode(mode: IdleBehaviorMode, nowMs?: number): void {
    this.motion.setIdleBehaviorMode(mode, nowMs)
  }

  setAmbientFidgetActive(active: boolean): void {
    this.motion.setAmbientFidgetActive(active)
  }

  idleGlanceActive(nowMs: number): boolean {
    return this.motion.idleGlanceActive(nowMs)
  }

  setExpanded(expanded: boolean, nowMs?: number): void {
    this.expanded = expanded
    this.motion.setExpanded(expanded, nowMs)
  }

  requestWake(nowMs: number): boolean {
    return this.motion.requestWake(nowMs)
  }

  prepareExpansion(nowMs: number): boolean {
    // The renderer first republishes its retained collapsed pose. The next
    // sampled pose may span a missed 10 FPS callback, so keep continuity live
    // for that one catch-up frame instead of treating the gap as a reset.
    this.limitNextFrameToCollapsedInterval = this.lastAt > 0
    return this.motion.prepareExpansion(nowMs)
  }

  prepareCollapsedVisibilityResume(): void {
    // A collapsed rig resumes as one ordinary 100 ms sample. Keep the retained
    // pose history so final continuity can reject authored/one-shot phase jumps;
    // unlike an expanded resume, this path must not reset the runtime clock or
    // install a visibility handoff transition.
    this.limitNextFrameToCollapsedInterval = this.lastAt > 0
  }

  inputWakeWeight(nowMs: number): number {
    return this.motion.inputWakeWeight(nowMs)
  }

  wakeReadyDelayMs(nowMs: number): number {
    return this.motion.wakeReadyDelayMs(nowMs)
  }

  ambientFidgetReadyDelayMs(nowMs: number): number {
    return this.motion.ambientFidgetReadyDelayMs(nowMs)
  }

  debugSignals(): Readonly<MotionDebugSignals> {
    return this.motion.debugSignals()
  }

  nextBlinkPeakDelayMs(nowMs: number, horizonMs?: number): number | null {
    return this.motion.nextBlinkPeakDelayMs(nowMs, horizonMs)
  }

  blinkActiveAt(nowMs: number): boolean {
    return this.motion.blinkActiveAt(nowMs)
  }

  setSpeechEnergy(value: number | null, nowMs: number): void {
    this.motion.setSpeechEnergy(value, nowMs)
  }

  setSpeechArticulation(value: SpeechArticulation, nowMs: number): void {
    this.motion.setSpeechArticulation(value, nowMs)
  }

  setGazeTarget(
    target: GazeTarget | null,
    nowMs: number,
    source?: GazeSource,
  ): void {
    this.motion.setGazeTarget(target, nowMs, source)
  }

  releaseGazeWithBlink(nowMs: number, source?: GazeSource): void {
    this.motion.releaseGazeWithBlink(nowMs, source)
  }

  triggerImpulse(
    kind: string,
    priority: number,
    nowMs: number,
    intensity = 1,
  ): void {
    this.motion.triggerImpulse(kind, priority, nowMs, intensity)
  }

  resetClock(nowMs: number): void {
    this.motion.resetClock(nowMs)
    this.previousAt = 0
    this.lastAt = 0
    this.limitNextFrameToCollapsedInterval = false
  }

  captureHandoffInto(
    pose: RigTransform[],
    velocity: RigTransformVelocity[],
  ): boolean {
    if (this.previousAt <= 0 || this.lastAt <= this.previousAt) return false
    copyPoseInto(pose, this.lastPose)
    writePoseVelocity(
      velocity,
      this.previousPose,
      this.lastPose,
      (this.lastAt - this.previousAt) / 1_000,
    )
    return true
  }

  finalizeInto(
    pose: RigTransform[],
    nowMs: number,
    activity: CompanionActivity,
    activeMask: readonly boolean[],
    _upperPerformanceBlend: number,
    generated?: GeneratedPoseDynamics,
    activeBonePriorities?: readonly number[],
    idleLocked = false,
  ): RigTransform[] {
    if (generated) {
      applyGeneratedMotionDynamicsInto(
        pose,
        this.manifest,
        activeMask,
        generated.progress,
        generated.blend,
        generated.instance,
      )
    }
    this.motion.applyInto(
      pose,
      nowMs,
      activity,
      activeMask,
      activeBonePriorities,
      idleLocked,
    )
    applyOutfitSafetyEnvelopeInto(pose, this.manifest, this.outfitMask, 1)
    if (this.lastAt > 0) {
      const elapsedSeconds = (nowMs - this.lastAt) / 1_000
      const continuityElapsedSeconds =
        !this.expanded || this.limitNextFrameToCollapsedInterval
          ? Math.min(0.1, Math.max(0, elapsedSeconds))
          : elapsedSeconds
      preservePoseContinuityInto(
        pose,
        this.lastPose,
        this.manifest,
        continuityElapsedSeconds,
        this.previousAt > 0 ? this.previousPose : undefined,
        this.previousAt > 0
          ? (this.lastAt - this.previousAt) / 1_000
          : undefined,
        this.continuityResult,
      )
      this.limitNextFrameToCollapsedInterval = false
      copyPoseInto(this.previousPose, this.lastPose)
      this.previousAt = this.lastAt
    }
    copyPoseInto(this.lastPose, pose)
    this.lastAt = nowMs
    return pose
  }
}
