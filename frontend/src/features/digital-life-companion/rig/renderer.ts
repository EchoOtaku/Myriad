import type { SpeechViseme } from './articulation'
import type { IdleBehaviorMode } from './director'
import type { GeneratedMotionInstance } from './generation'
import type { MotionCharacterState, MotionDebugSignals } from './motion'
import type { GeneratedPoseDynamics } from './posePipeline'
import type {
  CompanionActivity,
  MotionChannel,
  RigOneShotStyle,
  RigTransformVelocity,
} from './transitions'
import type {
  CompanionRigManifest,
  RigClip,
  RigMotionProfile,
  RigPoint,
  RigTrack,
  RigTransform,
} from './types'
import type { GpuPart, ShaderLocations } from './webgl'
import {
  clipForActivity,
  copyPoseInto,
  createPoseBuffer,
  mixPoseByMaskInto,
  mixPoseInto,
  sampleClipInto,
  scalePoseDeltaInto,
} from './animation'
import {
  generatedMotionProgress,
  selectDistinctMotionInstance,
} from './generation'
import { RIG_MATRIX_CAPACITY, writeBoneMatrices } from './matrices'
import { SPEECH_MOUTH_CLOSE_MS } from './motion'
import { PosePipeline } from './posePipeline'
import {
  FacialVariantMixer,
  rigPartRenderDepth,
  selectPartVariantsInto,
} from './presentation'
import { applyRigRetargetingInto } from './retarget'
import { rigRuntimeIndex } from './runtimeIndex'
import {
  activityTransitionDuration,
  activityTransitionWeight,
  ambientFidgetAllowed,
  canQueueOneShotGroup,
  canSupersedePendingWakeActions,
  composeOneShotHandoffInto,
  extrapolateDampedPoseInto,
  handoffSettleSecondsForBone,
  isAmbientFidgetPriority,
  motionChannelMasks,
  oneShotBlendWeight,
  oneShotHandoffMask,
  oneShotHandoffProfile,
  oneShotNaturalReleaseLeadSeconds,
  oneShotReleaseWeight,
  RIG_ACTION_PRIORITY,
  shouldQueueOneShot,
  transitionPresentationClip,
  writeOneShotHandoffMask,
  writePoseVelocity,
} from './transitions'
import {
  createGpuPart,
  createProgram,
  FRAGMENT_SHADER,
  loadTexture,
  requiredUniform,
  VERTEX_SHADER,
  writeRigFit,
} from './webgl'

export { writeBoneMatrices } from './matrices'
export {
  expressionAssetVariant,
  FacialVariantMixer,
  presentationIntentCoverage,
  resolveAvailablePartVariants,
  resolveExpressionChannels,
  rigPartRenderDepth,
  selectFacialVariants,
  selectPartVariants,
  selectPartVariantsInto,
} from './presentation'
export {
  activityTransitionDuration,
  activityTransitionWeight,
  ambientFidgetAllowed,
  canQueueOneShotGroup,
  canSupersedePendingWakeActions,
  composeOneShotHandoffInto,
  dampedVelocityDisplacement,
  extrapolateDampedPoseInto,
  handoffSettleSecondsForBone,
  isAmbientFidgetPriority,
  motionChannelForBone,
  motionChannelMasks,
  oneShotBlendWeight,
  oneShotHandoffMask,
  oneShotHandoffProfile,
  oneShotNaturalReleaseLeadSeconds,
  oneShotReleaseWeight,
  oneShotTransitionDuration,
  pointerGazeOwnsBone,
  RIG_ACTION_PRIORITY,
  shouldQueueOneShot,
  transitionPresentationClip,
  writeOneShotHandoffMask,
  writePoseVelocity,
} from './transitions'
export type {
  CompanionActivity,
  MotionChannel,
  RigOneShotStyle,
  RigTransformVelocity,
} from './transitions'
export { computeRigFit } from './webgl'

interface OneShotPlayback {
  clip: RigClip
  startedAt: number
  priority: number
  boneMask: boolean[]
  intensity: number
  tempo: number
  fadeInMs: number
  fadeOutMs: number
  transitionMs: number
  locksIdle: boolean
  generated: GeneratedMotionInstance
}

type OneShotCandidate = Omit<OneShotPlayback, 'startedAt'>

type QueuedOneShot = OneShotCandidate & {
  groupId: number
}

interface OutgoingOneShot {
  action: OneShotPlayback | null
  outgoingClipId: string | null
  boneMask: boolean[]
  transitionStartedAt: number
  transitionMs: number
  sourceBlend: number
  sourcePriority: number
  snapshotPose?: RigTransform[]
  snapshotVelocity?: RigTransformVelocity[]
  snapshotAt?: number
}

interface ReleasingOneShot {
  action: OneShotPlayback
  transitionStartedAt: number
  transitionMs: number
  sourceBlend: number
  blocksIncoming: boolean
  snapshotPose?: RigTransform[]
  snapshotVelocity?: RigTransformVelocity[]
  snapshotAt?: number
}

interface DeferredOneShotRequest {
  clipId: string
  priority: number
  style: RigOneShotStyle
}

const MAX_BONES = RIG_MATRIX_CAPACITY
// Matches MotionRuntime's bounded physical-follower step. Procedural breath and
// blink phases still use their real timestamps, including a missed 10 FPS frame.
export const COLLAPSED_RIG_FRAME_INTERVAL_MS = 100
export const OVERLAY_COLLAPSE_ONE_SHOT_RELEASE_MS = 420
const EMPTY_POSE: readonly RigTransform[] = []

export function anime25DOpenEyeSlot(partId: string): string | null {
  const match = /^a25d-(?:eyewhite|irides)-(left|right)(?:-\d+)?$/.exec(partId)
  return match ? `eye-${match[1]}` : null
}

export function anime25DStencilMode(partId: string): 'mask' | 'clip' | 'none' {
  if (/^a25d-eyewhite-(?:left|right)(?:-\d+)?$/.test(partId)) return 'mask'
  if (/^a25d-irides-(?:left|right)(?:-\d+)?$/.test(partId)) return 'clip'
  return 'none'
}

export function collapseOneShotReleaseDurationMs(
  wasExpanded: boolean,
  expanded: boolean,
): number | null {
  return wasExpanded && !expanded ? OVERLAY_COLLAPSE_ONE_SHOT_RELEASE_MS : null
}

export function pendingWakeActionIsCurrent(
  scheduledGeneration: number,
  currentGeneration: number,
  expanded: boolean,
): boolean {
  return scheduledGeneration === currentGeneration && expanded
}

export function deferredAmbientFidgetForPriorityTakeover<
  T extends { priority: number },
>(current: T | null, pending: Iterable<T>, incomingPriority: number): T | null {
  if (current || incomingPriority <= RIG_ACTION_PRIORITY.ambientFidget) {
    return current
  }
  for (const candidate of pending) {
    if (isAmbientFidgetPriority(candidate.priority)) return candidate
  }
  return null
}

export function collapseReleaseBlocksGreeting(
  releasingChannels: readonly MotionChannel[],
  incomingChannels: readonly MotionChannel[],
  locksIdle: boolean,
): boolean {
  return (
    locksIdle &&
    incomingChannels.some((channel) => releasingChannels.includes(channel))
  )
}

export function collapseReleaseChannelOwnsShoulderRecovery(
  channel: MotionChannel,
  blocksIncoming: boolean,
): boolean {
  return blocksIncoming && (channel === 'upper' || channel === 'full')
}

export function queuedOneShotChannelIsReady(
  activeRemainingMs: number | null,
  queuedTransitionMs: number,
  releaseBlocksIncoming: boolean,
): boolean {
  return (
    !releaseBlocksIncoming &&
    (activeRemainingMs === null || activeRemainingMs <= queuedTransitionMs)
  )
}

export function locksIdleHandoffNeedsStationarySnapshot(
  locksIdle: boolean,
  capturedVelocityHandoff: boolean,
  lastComposedAtMs: number,
): boolean {
  return locksIdle && !capturedVelocityHandoff && lastComposedAtMs > 0
}

export function shouldRenderRigFrame(
  expanded: boolean,
  nowMs: number,
  lastRenderedAtMs: number,
  urgent = false,
): boolean {
  return (
    expanded ||
    urgent ||
    lastRenderedAtMs <= 0 ||
    nowMs < lastRenderedAtMs ||
    nowMs - lastRenderedAtMs >= COLLAPSED_RIG_FRAME_INTERVAL_MS
  )
}

export function collapsedRigFrameDelayMs(
  nowMs: number,
  lastRenderedAtMs: number,
): number {
  if (lastRenderedAtMs <= 0 || nowMs < lastRenderedAtMs) return 0
  return Math.max(
    0,
    COLLAPSED_RIG_FRAME_INTERVAL_MS - (nowMs - lastRenderedAtMs),
  )
}

export function blinkPeakPreservesCollapsedCadence(
  forceBlinkPeak: boolean,
  expanded: boolean,
  nowMs: number,
  lastCadenceAtMs: number,
  urgent = false,
): boolean {
  return (
    forceBlinkPeak &&
    !expanded &&
    !shouldRenderRigFrame(false, nowMs, lastCadenceAtMs, urgent)
  )
}

export function retainedExpansionPose(
  lastComposedAtMs: number,
  pose: readonly RigTransform[],
): readonly RigTransform[] | null {
  return lastComposedAtMs > 0 && pose.length > 0 ? pose : null
}

export function expansionPoseForCurrentPhase(
  lastComposedAtMs: number,
  pose: readonly RigTransform[],
  sampleAtMs: number,
  lidPhaseNeedsSample: boolean,
): readonly RigTransform[] | null {
  return lidPhaseNeedsSample || sampleAtMs > lastComposedAtMs
    ? null
    : retainedExpansionPose(lastComposedAtMs, pose)
}

export function expansionNeedsLiveLidSample(
  preciseBlinkTimerPending: boolean,
  blinkActiveAtExpansion: boolean,
  lastSampledBlinkClosure: number,
): boolean {
  return (
    preciseBlinkTimerPending ||
    blinkActiveAtExpansion ||
    lastSampledBlinkClosure > 0
  )
}

export function shouldScheduleRigAnimationFrame(
  expanded: boolean,
  nowMs: number,
  urgentRenderUntilMs: number,
): boolean {
  return expanded || (urgentRenderUntilMs > 0 && nowMs <= urgentRenderUntilMs)
}

export function activeUrgentRenderUntilMs(
  nowMs: number,
  urgentRenderUntilMs: number,
): number {
  return urgentRenderUntilMs > 0 && nowMs <= urgentRenderUntilMs
    ? urgentRenderUntilMs
    : 0
}

export function speechVisemeForPresentation(
  speechInputActive: boolean,
  viseme: SpeechViseme,
): SpeechViseme {
  return speechInputActive ? viseme : 'rest'
}

export function speechVisemeAfterEnergySample(
  current: SpeechViseme,
  energy: number | null,
): SpeechViseme {
  if (energy === null) return 'rest'
  return current === 'rest' ? 'open' : current
}

export function scheduledRigClockOwnsFrame(
  scheduledGeneration: number,
  currentGeneration: number,
  competingClockPending: boolean,
): boolean {
  return scheduledGeneration === currentGeneration && !competingClockPending
}

const RIG_ANIMATION_FRAME_SLOT_COUNT = 4

/**
 * Keeps cancelled rAF callbacks from clearing or advancing a newer clock.
 *
 * Browsers may already have copied a callback into the current frame's work
 * list when cancelAnimationFrame runs. Rotating through fixed slots gives that
 * callback immutable ownership to check without allocating a closure on every
 * frame. A collapse/expansion scheduler handoff clears the old slot; only the
 * newly scheduled slot may then consume runtime dt.
 */
export class RigAnimationFrameOwnership {
  private readonly requests = Array.from(
    { length: RIG_ANIMATION_FRAME_SLOT_COUNT },
    (): number | null => null,
  )

  private nextSlot = 0
  private pendingCount = 0

  allocateSlot(): number {
    const slot = this.nextSlot
    this.nextSlot = (slot + 1) % RIG_ANIMATION_FRAME_SLOT_COUNT
    return slot
  }

  setRequest(slot: number, requestId: number): void {
    if (this.requests[slot] === null) this.pendingCount += 1
    this.requests[slot] = requestId
  }

  claim(slot: number): boolean {
    if (this.requests[slot] === null) return false
    this.requests[slot] = null
    this.pendingCount = Math.max(0, this.pendingCount - 1)
    return true
  }

  hasPending(): boolean {
    return this.pendingCount > 0
  }

  cancelAll(cancel: (requestId: number) => void): void {
    for (let slot = 0; slot < this.requests.length; slot += 1) {
      const requestId = this.requests[slot]
      if (requestId !== null) cancel(requestId)
      this.requests[slot] = null
    }
    this.pendingCount = 0
  }
}

export function visibilityResumeStrategy(
  expanded: boolean,
): 'expanded-handoff' | 'collapsed-tick' {
  return expanded ? 'expanded-handoff' : 'collapsed-tick'
}

export function visibilityResumeSettleDurationMs(hiddenMs: number): number {
  const duration = Number.isFinite(hiddenMs) ? Math.max(0, hiddenMs) : 0
  return Math.round(300 + Math.min(220, Math.log1p(duration / 1_000) * 48))
}

export class CompanionRigRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly locations: ShaderLocations
  private readonly parts: GpuPart[]
  private readonly boneParents: number[]
  private readonly bonePivots: RigPoint[]
  private readonly boneOrder: number[]
  private readonly facialBoneIndexes: Record<string, number>
  private readonly hasHeadExpressionSlot: boolean
  private readonly clipTracks: ReadonlyMap<
    RigClip,
    readonly (RigTrack | undefined)[]
  >

  private readonly boneMatrices = new Float32Array(MAX_BONES * 9)
  private readonly localBoneMatrices = new Float32Array(MAX_BONES * 9)
  private readonly worldBoneMatrices = new Float32Array(MAX_BONES * 9)
  private readonly fitVector = new Float32Array(4)
  private readonly pose: RigTransform[]
  private readonly scratchPose: RigTransform[]
  private readonly outgoingPose: RigTransform[]
  private readonly transitionPose: RigTransform[]
  private readonly previousComposedPose: RigTransform[]
  private readonly lastComposedPose: RigTransform[]
  private readonly visibilityRetainedPose: RigTransform[]
  private readonly activeBoneMask: boolean[]
  private readonly activeBonePriorities: number[]
  private readonly handoffSettleSeconds: number[]
  private readonly handoffBoneMasks: Record<MotionChannel, boolean[]>
  private readonly queuedGroupIds = new Set<number>()
  private readonly posePipeline: PosePipeline
  private readonly facialVariantMixer = new FacialVariantMixer()
  private readonly partVariants: Record<string, string> = {}
  private fittedWidth = 0
  private fittedHeight = 0
  private cssWidth = 1
  private cssHeight = 1
  private activity: CompanionActivity = 'idle'
  private pendingActivity: {
    activity: CompanionActivity
    startsAt: number
  } | null = null

  private baseClip: RigClip
  private baseStartedAt = performance.now()
  private baseTransitionClip: RigClip | null = null
  private baseTransitionClipStartedAt = 0
  private baseTransitionSnapshotPose: RigTransform[] | null = null
  private baseTransitionSnapshotVelocity: RigTransformVelocity[] | null = null
  private baseTransitionSnapshotAt = 0
  private readonly baseClipEpochs = new Map<string, number>()
  private transitionStartedAt = 0
  private transitionDurationMs = 0
  private previousComposedAt = 0
  private lastComposedAt = 0
  private visibilityRetained = false
  private hiddenAt = 0
  private readonly activeOneShots = new Map<MotionChannel, OneShotPlayback>()
  private readonly queuedOneShots = new Map<MotionChannel, QueuedOneShot>()
  private readonly outgoingOneShots = new Map<MotionChannel, OutgoingOneShot>()
  private readonly releasingOneShots = new Map<
    MotionChannel,
    ReleasingOneShot
  >()

  private readonly presentedClipIds = new Set<string>()
  private readonly presentedClipProgress = new Map<string, number>()
  private readonly generatedHistory = new Map<string, GeneratedMotionInstance>()
  private motionState: MotionCharacterState = {
    energy: 50,
    mood: 50,
    boredom: 50,
    curiosity: 50,
    social: 50,
    affection: 50,
  }

  private performanceExpression: string | null = null
  private nextOneShotGroupId = 1
  private sampledOneShotElapsed = 0
  private sampledOneShotDuration = 0
  private sampledOneShotProgress = 0
  private generatedPoseDynamics: GeneratedPoseDynamics | undefined
  private speechViseme: SpeechViseme = 'rest'
  private speechInputActive = false
  private urgentRenderUntil = 0
  private readonly animationFrameOwnership = new RigAnimationFrameOwnership()

  private readonly animationFrameCallbacks = [
    (now: number) => this.runScheduledAnimationFrame(0, now),
    (now: number) => this.runScheduledAnimationFrame(1, now),
    (now: number) => this.runScheduledAnimationFrame(2, now),
    (now: number) => this.runScheduledAnimationFrame(3, now),
  ]

  private collapsedFrameTimer = 0
  private frameScheduleGeneration = 0
  private running = false
  private expanded = true
  private idleBehaviorMode: IdleBehaviorMode | null = null
  private lastRenderedAt = 0
  private lastCollapsedCadenceAt = 0
  private collapsedFrameIsBlinkPeak = false
  private readonly wakeTimers = new Map<number, DeferredOneShotRequest>()
  private deferredAmbientFidget: DeferredOneShotRequest | null = null
  private wakeActionGeneration = 0
  private destroyed = false
  private readonly reducedMotion: boolean
  private readonly onContextLost: () => void
  private readonly resizeObserver: ResizeObserver | null

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: CompanionRigManifest,
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    locations: ShaderLocations,
    parts: GpuPart[],
    onContextLost: () => void,
  ) {
    this.gl = gl
    this.program = program
    this.locations = locations
    this.parts = parts
    this.hasHeadExpressionSlot = parts.some(
      (part) => part.slot === 'head-expression',
    )
    this.onContextLost = onContextLost
    this.baseClip = clipForActivity(manifest, 'idle')
    this.baseClipEpochs.set(this.baseClip.id, this.baseStartedAt)
    const runtimeIndex = rigRuntimeIndex(manifest)
    const boneIndexes = runtimeIndex.boneById
    this.boneParents = [...runtimeIndex.boneParents]
    this.bonePivots = manifest.bones.map((bone) => bone.pivot)
    this.facialBoneIndexes = Object.fromEntries(
      ['left-eye', 'right-eye'].map((id) => [id, boneIndexes.get(id) ?? -1]),
    )
    this.pose = createPoseBuffer(manifest.bones.length)
    this.scratchPose = createPoseBuffer(manifest.bones.length)
    this.outgoingPose = createPoseBuffer(manifest.bones.length)
    this.transitionPose = createPoseBuffer(manifest.bones.length)
    this.previousComposedPose = createPoseBuffer(manifest.bones.length)
    this.lastComposedPose = createPoseBuffer(manifest.bones.length)
    this.visibilityRetainedPose = createPoseBuffer(manifest.bones.length)
    this.activeBoneMask = manifest.bones.map(() => false)
    this.activeBonePriorities = manifest.bones.map(
      () => Number.NEGATIVE_INFINITY,
    )
    this.handoffSettleSeconds = manifest.bones.map((bone) =>
      handoffSettleSecondsForBone(bone.id),
    )
    this.handoffBoneMasks = createChannelMaskBuffers(manifest.bones.length)
    this.posePipeline = new PosePipeline(manifest)
    this.boneOrder = [...runtimeIndex.boneOrder]
    this.clipTracks = runtimeIndex.tracksByClip
    this.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    this.updateCanvasMetrics()
    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            this.cssWidth = Math.max(1, entry.contentRect.width)
            this.cssHeight = Math.max(1, entry.contentRect.height)
            this.resizeCanvas()
            if (this.reducedMotion && !this.destroyed) {
              this.render(performance.now())
            }
          })
    this.resizeObserver?.observe(this.canvas)
    window.addEventListener('resize', this.handleWindowResize)
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost)
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  static async create(
    canvas: HTMLCanvasElement,
    manifest: CompanionRigManifest,
    onContextLost: () => void,
  ): Promise<CompanionRigRenderer> {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is unavailable')
    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    const locations: ShaderLocations = {
      fit: requiredUniform(gl, program, 'u_fit'),
      bones: requiredUniform(gl, program, 'u_bones[0]'),
      opacity: requiredUniform(gl, program, 'u_opacity'),
      alphaCutoff: requiredUniform(gl, program, 'u_alpha_cutoff'),
      texture: requiredUniform(gl, program, 'u_texture'),
    }
    const textures = new Map<string, WebGLTexture>()
    await Promise.all(
      manifest.textures.map(async (texture) => {
        textures.set(texture.id, await loadTexture(gl, texture.url))
      }),
    )
    const parts = [...manifest.parts]
      .sort((left, right) => rigPartRenderDepth(left) - rigPartRenderDepth(right))
      .map((part, stableIndex) => {
        const texture = textures.get(part.textureId)
        if (!texture) throw new Error(`Missing rig texture: ${part.textureId}`)
        return createGpuPart(
          gl,
          program,
          part,
          texture,
          stableIndex,
          rigPartRenderDepth(part),
        )
      })
    gl.useProgram(program)
    gl.uniform1i(locations.texture, 0)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    )
    return new CompanionRigRenderer(
      canvas,
      manifest,
      gl,
      program,
      locations,
      parts,
      onContextLost,
    )
  }

  start(): void {
    this.stop()
    this.running = true
    if (this.reducedMotion) {
      this.render(performance.now())
      return
    }
    this.scheduleFrame()
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return
    const now = performance.now()
    // Capture timer ownership before setExpanded/restartFrameSchedule changes
    // the scheduler. A pending analytic peak belongs to the same lid event and
    // must be sampled at `now` before rAF takes over; replaying the retained
    // 10 FPS pose here can otherwise show a partial reopen before that event
    // closes again on the next frame.
    const preciseBlinkTimerPending = expanded && this.collapsedFrameIsBlinkPeak
    const collapseReleaseMs = collapseOneShotReleaseDurationMs(
      this.expanded,
      expanded,
    )
    this.expanded = expanded
    this.posePipeline.setExpanded(expanded, now)
    if (!expanded) {
      // Preserve zero for a never-painted collapsed rig so start() schedules
      // its first frame immediately. A live expanded rig anchors collapse to
      // its most recent paint and then continues on the 100 ms cadence.
      this.lastCollapsedCadenceAt = this.lastRenderedAt
      this.cancelPendingWakeActions()
      // Collapse keeps the current pose and measured transform velocity, then
      // settles it through the same release path as a natural one-shot ending.
      // A greeting requested by a reopen must wait for this retained release;
      // otherwise both clips would briefly claim the same shoulders.
      if (collapseReleaseMs !== null) this.stopOneShots(collapseReleaseMs, true)
    }
    if (expanded && !this.destroyed) {
      if (this.posePipeline.prepareExpansion(now)) {
        this.stopOneShotsBelow(RIG_ACTION_PRIORITY.wake, 420)
      }
      // Sample the click timestamp through the same runtime clock before rAF
      // takes over. Replaying the last 10 FPS pose here leaves the chest on an
      // older breath sample and then exposes the whole gap on the next frame.
      // A single live sample advances breath, blink, and secondary springs once
      // from their shared collapsed phase; the generation handoff prevents the
      // cancelled collapsed timer from consuming that interval again.
      this.render(
        now,
        expansionPoseForCurrentPhase(
          this.lastComposedAt,
          this.lastComposedPose,
          now,
          expansionNeedsLiveLidSample(
            preciseBlinkTimerPending,
            this.posePipeline.blinkActiveAt(now),
            this.posePipeline.debugSignals().blinkClosure,
          ),
        ),
      )
    }
    if (this.running) this.restartFrameSchedule()
  }

  setActivity(activity: CompanionActivity): void {
    const now = performance.now()
    if (activity === 'idle') {
      this.cancelPendingWakeActions()
      this.pendingActivity = null
      this.commitActivity(activity, now)
      return
    }
    if (this.activity === activity && !this.pendingActivity) return
    if (this.posePipeline.requestWake(now)) {
      const startsAt = Math.min(
        this.pendingActivity?.startsAt ?? Number.POSITIVE_INFINITY,
        now + 460,
      )
      this.pendingActivity = { activity, startsAt }
      this.stopOneShotsBelow(RIG_ACTION_PRIORITY.wake, 520)
      return
    }
    this.commitActivity(activity, now)
  }

  private commitActivity(activity: CompanionActivity, now: number): void {
    this.pendingActivity = null
    if (this.activity === activity) return
    this.baseTransitionClip = this.baseClip
    this.baseTransitionClipStartedAt = this.baseStartedAt
    const snapshotPose = createPoseBuffer(this.manifest.bones.length)
    const snapshotVelocity = createVelocityBuffer(this.manifest.bones.length)
    if (this.captureComposedHandoffInto(snapshotPose, snapshotVelocity)) {
      this.baseTransitionSnapshotPose = snapshotPose
      this.baseTransitionSnapshotVelocity = snapshotVelocity
      this.baseTransitionSnapshotAt = this.lastComposedAt
    } else {
      this.baseTransitionSnapshotPose = null
      this.baseTransitionSnapshotVelocity = null
      this.baseTransitionSnapshotAt = 0
    }
    this.transitionStartedAt = now
    this.transitionDurationMs = activityTransitionDuration(
      this.activity,
      activity,
    )
    this.activity = activity
    this.baseClip = clipForActivity(this.manifest, activity)
    this.baseStartedAt = this.baseClipEpochs.get(this.baseClip.id) ?? now
    this.baseClipEpochs.set(this.baseClip.id, this.baseStartedAt)
  }

  setMotionState(state: MotionCharacterState): void {
    this.motionState = { ...state }
    this.posePipeline.setCharacterState(this.motionState)
  }

  setIdleBehaviorMode(mode: IdleBehaviorMode): void {
    if (mode === this.idleBehaviorMode) return
    const enteringRest = mode === 'rest'
    this.idleBehaviorMode = mode
    this.posePipeline.setIdleBehaviorMode(mode, performance.now())
    if (enteringRest) {
      this.deferredAmbientFidget = null
      this.stopAmbientFidgetsForRest()
    }
  }

  setMotionProfile(profile: RigMotionProfile): void {
    this.posePipeline.setMotionProfile(profile)
  }

  setSpeechEnergy(value: number | null): void {
    const now = performance.now()
    if (value === null) {
      this.beginSpeechMouthRelease(now)
      this.speechInputActive = false
    } else {
      this.speechInputActive = true
    }
    this.speechViseme = speechVisemeAfterEnergySample(this.speechViseme, value)
    this.posePipeline.setSpeechEnergy(value, now)
  }

  setSpeechArticulation(
    value: Parameters<PosePipeline['setSpeechArticulation']>[0],
  ): void {
    const now = performance.now()
    const active =
      value.energy !== null || value.viseme !== 'rest' || value.amount > 0
    if (!active) this.beginSpeechMouthRelease(now)
    this.speechInputActive = active
    this.speechViseme = value.viseme
    this.posePipeline.setSpeechArticulation(value, now)
  }

  private beginSpeechMouthRelease(now: number): void {
    if (!this.speechInputActive) return
    // Collapsed rigs normally render at 10 FPS. Briefly sample every rAF so the
    // 150 ms closure is actually painted before the 180 ms visible deadline.
    this.urgentRenderUntil = Math.max(
      this.urgentRenderUntil,
      now + SPEECH_MOUTH_CLOSE_MS + 17,
    )
    if (this.running) this.restartFrameSchedule()
  }

  setGazeTarget(
    target: Parameters<PosePipeline['setGazeTarget']>[0],
    source?: Parameters<PosePipeline['setGazeTarget']>[2],
  ): void {
    const now = performance.now()
    this.posePipeline.setGazeTarget(target, now, source)
  }

  setPerformanceExpression(expression: string | null): void {
    this.performanceExpression =
      expression &&
      [
        'happy',
        'surprise',
        'sad',
        'warm',
        'concerned',
        'focused',
        'playful',
      ].includes(expression)
        ? expression
        : null
  }

  releasePerformance(transitionMs = 420): void {
    const now = performance.now()
    this.cancelPendingWakeActions(false)
    this.performanceExpression = null
    this.posePipeline.releaseGazeWithBlink(now, 'performance')
    this.stopOneShots(transitionMs)
  }

  triggerPerformanceImpulse(kind: string, intensity = 1): void {
    this.posePipeline.triggerImpulse(kind, 200, performance.now(), intensity)
  }

  captureFrame(): string | null {
    if (this.destroyed) return null
    this.render(performance.now())
    if (this.running && !this.expanded) this.restartFrameSchedule()
    try {
      return this.canvas.toDataURL('image/png')
    } catch {
      return null
    }
  }

  readMotionSignals(): Readonly<MotionDebugSignals> {
    return this.posePipeline.debugSignals()
  }

  cancelPendingWakeActions(clearDeferredAmbientFidget = true): void {
    this.wakeActionGeneration += 1
    for (const timer of this.wakeTimers.keys()) window.clearTimeout(timer)
    this.wakeTimers.clear()
    if (clearDeferredAmbientFidget) this.deferredAmbientFidget = null
  }

  private deferAmbientFidget(
    clipId: string,
    priority: number,
    style: RigOneShotStyle,
  ): void {
    if (this.deferredAmbientFidget || !this.expanded) return
    this.deferredAmbientFidget = { clipId, priority, style: { ...style } }
  }

  private preservePendingAmbientFidget(incomingPriority: number): void {
    this.deferredAmbientFidget = deferredAmbientFidgetForPriorityTakeover(
      this.deferredAmbientFidget,
      this.wakeTimers.values(),
      incomingPriority,
    )
  }

  private tryStartDeferredAmbientFidget(now: number): void {
    const deferred = this.deferredAmbientFidget
    if (!deferred || !this.expanded || this.idleBehaviorMode === 'rest') return
    let higherPriorityWakePending = false
    for (const pending of this.wakeTimers.values()) {
      if (pending.priority <= deferred.priority) continue
      higherPriorityWakePending = true
      break
    }
    if (
      higherPriorityWakePending ||
      !ambientFidgetAllowed(
        this.posePipeline.inputWakeWeight(now),
        this.posePipeline.ambientFidgetReadyDelayMs(now),
        this.greetingOwnsIdle(),
        this.posePipeline.idleGlanceActive(now),
        this.posePipeline.debugSignals().restStillness,
      )
    ) {
      return
    }
    this.deferredAmbientFidget = null
    this.playOneShot(deferred.clipId, deferred.priority, {
      ...deferred.style,
      wakeBefore: false,
    })
  }

  stopOneShots(transitionMs = 260, blocksIncoming = false): void {
    const now = performance.now()
    const duration = Math.max(100, Math.min(520, transitionMs))
    this.queuedOneShots.clear()
    for (const [channel, release] of this.releasingOneShots) {
      const progress = Math.max(
        0,
        Math.min(1, (now - release.transitionStartedAt) / release.transitionMs),
      )
      const retainedBlend = oneShotReleaseWeight(release.sourceBlend, progress)
      if (retainedBlend <= 0) {
        this.releasingOneShots.delete(channel)
        continue
      }
      release.sourceBlend = retainedBlend
      const snapshotPose = createPoseBuffer(this.manifest.bones.length)
      const snapshotVelocity = createVelocityBuffer(this.manifest.bones.length)
      if (this.captureComposedHandoffInto(snapshotPose, snapshotVelocity)) {
        release.sourceBlend = 1
        release.snapshotPose = snapshotPose
        release.snapshotVelocity = snapshotVelocity
        release.snapshotAt = this.lastComposedAt
      }
      release.transitionStartedAt = now
      release.transitionMs = duration
      release.blocksIncoming ||= blocksIncoming
    }
    for (const channel of Array.from(this.activeOneShots.keys())) {
      this.beginChannelRelease(channel, now, duration, blocksIncoming)
    }
  }

  private stopOneShotsBelow(priority: number, transitionMs: number): void {
    const now = performance.now()
    const duration = Math.max(100, Math.min(520, transitionMs))
    for (const [channel, queued] of this.queuedOneShots) {
      if (queued.priority < priority) this.queuedOneShots.delete(channel)
    }
    for (const [channel, active] of this.activeOneShots) {
      if (active.priority < priority) {
        this.beginChannelRelease(channel, now, duration)
      }
    }
  }

  private stopAmbientFidgetsForRest(): void {
    const now = performance.now()
    const transitionMs = 100
    for (const [channel, queued] of this.queuedOneShots) {
      if (isAmbientFidgetPriority(queued.priority)) {
        this.queuedOneShots.delete(channel)
      }
    }
    for (const [channel, active] of this.activeOneShots) {
      if (isAmbientFidgetPriority(active.priority)) {
        this.beginChannelRelease(channel, now, transitionMs)
      }
    }
    for (const release of this.releasingOneShots.values()) {
      if (!isAmbientFidgetPriority(release.action.priority)) continue
      const progress = Math.max(
        0,
        Math.min(1, (now - release.transitionStartedAt) / release.transitionMs),
      )
      release.sourceBlend = oneShotReleaseWeight(release.sourceBlend, progress)
      release.transitionStartedAt = now
      release.transitionMs = transitionMs
    }
  }

  playOneShot(clipId: string, priority = 0, style: RigOneShotStyle = {}): void {
    const clip = this.manifest.clips.find(
      (candidate) =>
        candidate.id === clipId && (style.allowLooping || !candidate.looping),
    )
    if (!clip || this.reducedMotion) return
    const requestedAt = performance.now()
    if (priority <= RIG_ACTION_PRIORITY.ambientFidget) {
      const wakeWeight = this.posePipeline.inputWakeWeight(requestedAt)
      const settleDelayMs =
        this.posePipeline.ambientFidgetReadyDelayMs(requestedAt)
      const greetingActive = this.greetingOwnsIdle()
      if (
        !ambientFidgetAllowed(
          wakeWeight,
          settleDelayMs,
          greetingActive,
          this.posePipeline.idleGlanceActive(requestedAt),
          this.idleBehaviorMode === 'rest'
            ? 1
            : this.posePipeline.debugSignals().restStillness,
        )
      ) {
        if (
          this.expanded &&
          this.idleBehaviorMode !== 'rest' &&
          (wakeWeight < 1 || settleDelayMs > 0 || greetingActive)
        ) {
          this.deferAmbientFidget(clipId, priority, style)
        }
        return
      }
    }
    if (style.locksIdle) {
      this.preservePendingAmbientFidget(priority)
      for (const [channel, queued] of this.queuedOneShots) {
        if (queued.priority <= RIG_ACTION_PRIORITY.ambientFidget) {
          this.deferAmbientFidget(queued.clip.id, queued.priority, {
            intensity: queued.intensity,
            tempo: queued.tempo,
            fadeInMs: queued.fadeInMs,
            fadeOutMs: queued.fadeOutMs,
            transitionMs: queued.transitionMs,
          })
          this.queuedOneShots.delete(channel)
        }
      }
      for (const [channel, active] of this.activeOneShots) {
        if (active.priority <= RIG_ACTION_PRIORITY.ambientFidget) {
          this.beginChannelRelease(channel, requestedAt, 260)
        }
      }
    }
    if (
      style.wakeBefore &&
      !canSupersedePendingWakeActions(
        [...this.wakeTimers.values()].map((pending) => pending.priority),
        priority,
      )
    ) {
      return
    }
    if (style.wakeBefore) {
      if (style.locksIdle) this.preservePendingAmbientFidget(priority)
      this.cancelPendingWakeActions(false)
    }
    if (style.wakeBefore && this.posePipeline.requestWake(requestedAt)) {
      this.stopOneShotsBelow(RIG_ACTION_PRIORITY.wake, 420)
      const wakeDelayMs = this.posePipeline.wakeReadyDelayMs(requestedAt)
      const generation = this.wakeActionGeneration
      const timer = window.setTimeout(() => {
        this.wakeTimers.delete(timer)
        if (
          !pendingWakeActionIsCurrent(
            generation,
            this.wakeActionGeneration,
            this.expanded,
          )
        ) {
          return
        }
        this.playOneShot(clipId, priority, { ...style, wakeBefore: false })
      }, wakeDelayMs)
      this.wakeTimers.set(timer, {
        clipId,
        priority,
        style: { ...style },
      })
      return
    }
    const intensity = Math.max(0.2, Math.min(1.4, style.intensity ?? 1))
    const tempo = Math.max(0.5, Math.min(1.6, style.tempo ?? 1))
    const interrupt = style.interrupt || 'if-lower'
    const now = performance.now()
    const resolvedStyle = style
    const channelMasks = motionChannelMasks(this.manifest, clip)
    const handoffProfile = oneShotHandoffProfile(
      clip.id,
      channelMasks.map(({ channel }) => channel),
      resolvedStyle,
    )
    const { fadeInMs, fadeOutMs, transitionMs } = handoffProfile
    const incomingChannels = channelMasks.map(({ channel }) => channel)
    const blockingReleaseChannels = Array.from(this.releasingOneShots)
      .filter(([, release]) => release.blocksIncoming)
      .map(([channel]) => channel)
    const shouldQueueGroup =
      collapseReleaseBlocksGreeting(
        blockingReleaseChannels,
        incomingChannels,
        resolvedStyle.locksIdle ?? false,
      ) ||
      channelMasks.some(({ channel }) => {
        const active = this.activeOneShots.get(channel)
        return shouldQueueOneShot(active?.priority ?? null, priority, interrupt)
      })
    if (
      shouldQueueGroup &&
      !canQueueOneShotGroup(
        channelMasks.map(
          ({ channel }) => this.queuedOneShots.get(channel)?.priority ?? null,
        ),
        priority,
      )
    ) {
      return
    }
    if (style.exclusive && !shouldQueueGroup) {
      const incomingChannels = new Set(
        channelMasks.map(({ channel }) => channel),
      )
      this.queuedOneShots.clear()
      for (const channel of this.activeOneShots.keys()) {
        if (!incomingChannels.has(channel)) {
          this.beginChannelRelease(channel, now, transitionMs)
        }
      }
    }
    const groupId = this.nextOneShotGroupId
    this.nextOneShotGroupId += 1
    const generated = selectDistinctMotionInstance({
      clipId,
      seed: style.variationSeed ?? groupId,
      phase: style.phase,
      state: this.motionState,
      maxAmplitudeScale: clip.generation?.maxAmplitudeScale,
      previous: this.generatedHistory.get(clipId),
    })
    this.generatedHistory.set(clipId, generated)
    const supersededGroups = new Set<number>()
    for (const { channel } of channelMasks) {
      const queued = this.queuedOneShots.get(channel)
      if (queued && priority >= queued.priority)
        supersededGroups.add(queued.groupId)
    }
    if (supersededGroups.size > 0) {
      for (const [channel, queued] of this.queuedOneShots) {
        if (supersededGroups.has(queued.groupId))
          this.queuedOneShots.delete(channel)
      }
    }
    let started = false
    for (const { channel, mask } of channelMasks) {
      const candidate = {
        clip,
        priority,
        boneMask: mask,
        intensity,
        tempo: Math.max(0.5, Math.min(1.6, tempo * generated.tempoScale)),
        fadeInMs,
        fadeOutMs,
        transitionMs,
        locksIdle: resolvedStyle.locksIdle ?? false,
        generated,
      }
      if (shouldQueueGroup) {
        const queued = this.queuedOneShots.get(channel)
        if (!queued || priority >= queued.priority) {
          this.queuedOneShots.set(channel, { ...candidate, groupId })
        }
        continue
      }
      this.beginChannelHandoff(channel, candidate, now)
      started = true
    }
    if (started)
      this.posePipeline.triggerImpulse(clipId, priority, now, intensity)
  }

  private beginChannelHandoff(
    channel: MotionChannel,
    candidate: OneShotCandidate,
    now: number,
  ): void {
    this.releasingOneShots.delete(channel)
    const active = this.activeOneShots.get(channel)
    if (active) {
      const elapsed = Math.max(0, (now - active.startedAt) / 1_000)
      const duration = active.clip.duration / active.tempo
      const sourceBlend = oneShotBlendWeight(
        elapsed,
        duration,
        active.fadeInMs,
        active.fadeOutMs,
      )
      if (sourceBlend > 0) {
        const outgoing: OutgoingOneShot = {
          action: active,
          outgoingClipId: active.clip.id,
          boneMask: writeOneShotHandoffMask(
            this.handoffBoneMasks[channel],
            candidate.boneMask,
            active.boneMask,
          ),
          transitionStartedAt: now,
          transitionMs: candidate.transitionMs,
          sourceBlend,
          sourcePriority: active.priority,
        }
        const snapshotPose = createPoseBuffer(this.manifest.bones.length)
        const snapshotVelocity = createVelocityBuffer(
          this.manifest.bones.length,
        )
        if (this.captureComposedHandoffInto(snapshotPose, snapshotVelocity)) {
          outgoing.sourceBlend = 1
          outgoing.snapshotPose = snapshotPose
          outgoing.snapshotVelocity = snapshotVelocity
          outgoing.snapshotAt = this.lastComposedAt
        }
        this.outgoingOneShots.set(channel, outgoing)
      } else {
        this.outgoingOneShots.delete(channel)
      }
    } else {
      const snapshotPose = createPoseBuffer(this.manifest.bones.length)
      const snapshotVelocity = createVelocityBuffer(this.manifest.bones.length)
      const capturedVelocityHandoff = this.captureComposedHandoffInto(
        snapshotPose,
        snapshotVelocity,
      )
      if (
        locksIdleHandoffNeedsStationarySnapshot(
          candidate.locksIdle,
          capturedVelocityHandoff,
          this.lastComposedAt,
        )
      ) {
        // Expansion can publish one retained collapsed pose before a greeting
        // starts, leaving no second sample from which to measure velocity. The
        // retained pose still forms a valid C0 handoff; its explicitly-zero
        // velocity makes the greeting's head takeover C1 at that boundary
        // instead of letting procedural gaze own one frame and then yield.
        copyPoseInto(snapshotPose, this.lastComposedPose)
      }
      if (
        capturedVelocityHandoff ||
        locksIdleHandoffNeedsStationarySnapshot(
          candidate.locksIdle,
          capturedVelocityHandoff,
          this.lastComposedAt,
        )
      ) {
        this.outgoingOneShots.set(channel, {
          action: null,
          outgoingClipId: null,
          boneMask: writeOneShotHandoffMask(
            this.handoffBoneMasks[channel],
            candidate.boneMask,
          ),
          transitionStartedAt: now,
          transitionMs: candidate.transitionMs,
          sourceBlend: 1,
          sourcePriority: Number.NEGATIVE_INFINITY,
          snapshotPose,
          snapshotVelocity,
          snapshotAt: this.lastComposedAt,
        })
      } else {
        this.outgoingOneShots.delete(channel)
      }
    }
    this.activeOneShots.set(channel, { ...candidate, startedAt: now })
  }

  private greetingOwnsIdle(): boolean {
    if (
      this.activeOneShots.size === 0 &&
      this.releasingOneShots.size === 0 &&
      this.outgoingOneShots.size === 0
    ) {
      return false
    }
    for (const action of this.activeOneShots.values()) {
      if (action.locksIdle) return true
    }
    for (const release of this.releasingOneShots.values()) {
      if (release.action.locksIdle) return true
    }
    for (const outgoing of this.outgoingOneShots.values()) {
      if (outgoing.action?.locksIdle) return true
    }
    return false
  }

  private collapseReleaseOwnsShoulderRecovery(): boolean {
    for (const [channel, release] of this.releasingOneShots) {
      if (
        collapseReleaseChannelOwnsShoulderRecovery(
          channel,
          release.blocksIncoming,
        )
      ) {
        return true
      }
    }
    return false
  }

  private ambientFidgetOwnsIdle(): boolean {
    for (const action of this.activeOneShots.values()) {
      if (isAmbientFidgetPriority(action.priority)) return true
    }
    for (const release of this.releasingOneShots.values()) {
      if (isAmbientFidgetPriority(release.action.priority)) {
        return true
      }
    }
    for (const outgoing of this.outgoingOneShots.values()) {
      if (
        outgoing.action &&
        isAmbientFidgetPriority(outgoing.action.priority)
      ) {
        return true
      }
    }
    return false
  }

  private beginChannelRelease(
    channel: MotionChannel,
    now: number,
    transitionMs: number,
    blocksIncoming = false,
  ): void {
    const active = this.activeOneShots.get(channel)
    if (!active) return
    const elapsed = Math.max(0, (now - active.startedAt) / 1_000)
    const sourceBlend = oneShotBlendWeight(
      elapsed,
      active.clip.duration / active.tempo,
      active.fadeInMs,
      active.fadeOutMs,
    )
    if (sourceBlend > 0) {
      const release: ReleasingOneShot = {
        action: active,
        transitionStartedAt: now,
        transitionMs,
        sourceBlend,
        blocksIncoming,
      }
      const snapshotPose = createPoseBuffer(this.manifest.bones.length)
      const snapshotVelocity = createVelocityBuffer(this.manifest.bones.length)
      if (this.captureComposedHandoffInto(snapshotPose, snapshotVelocity)) {
        release.sourceBlend = 1
        release.snapshotPose = snapshotPose
        release.snapshotVelocity = snapshotVelocity
        release.snapshotAt = this.lastComposedAt
      }
      this.releasingOneShots.set(channel, release)
    }
    this.activeOneShots.delete(channel)
    this.outgoingOneShots.delete(channel)
  }

  private queuedGroupReady(groupId: number, now: number): boolean {
    let found = false
    for (const [channel, queued] of this.queuedOneShots) {
      if (queued.groupId !== groupId) continue
      found = true
      const release = this.releasingOneShots.get(channel)
      const active = this.activeOneShots.get(channel)
      const activeRemainingMs = active
        ? (active.clip.duration / active.tempo -
            Math.max(0, (now - active.startedAt) / 1_000)) *
          1_000
        : null
      if (
        !queuedOneShotChannelIsReady(
          activeRemainingMs,
          queued.transitionMs,
          release?.blocksIncoming ?? false,
        )
      ) {
        return false
      }
    }
    return found
  }

  private beginQueuedGroup(groupId: number, now: number): void {
    const entries = Array.from(this.queuedOneShots).filter(
      ([, queued]) => queued.groupId === groupId,
    )
    if (entries.length === 0) return
    for (const [channel, queued] of entries) {
      const { groupId: _, ...candidate } = queued
      this.beginChannelHandoff(channel, candidate, now)
      this.queuedOneShots.delete(channel)
    }
    const action = entries[0][1]
    this.posePipeline.triggerImpulse(
      action.clip.id,
      action.priority,
      now,
      action.intensity,
    )
  }

  private sampleOneShotInto(
    output: RigTransform[],
    action: OneShotPlayback,
    now: number,
  ): void {
    const elapsed = Math.max(0, (now - action.startedAt) / 1_000)
    const duration = action.clip.duration / action.tempo
    const progress = Math.max(
      0,
      Math.min(1, elapsed / Math.max(0.001, duration)),
    )
    const authoredProgress = generatedMotionProgress(progress, action.generated)
    sampleClipInto(
      output,
      this.manifest,
      action.clip,
      authoredProgress * action.clip.duration,
      this.clipTracks.get(action.clip),
    )
    scalePoseDeltaInto(
      output,
      action.intensity * action.generated.amplitudeScale,
      action.boneMask,
    )
    applyRigRetargetingInto(output, this.manifest, action.boneMask)
    this.sampledOneShotElapsed = elapsed
    this.sampledOneShotDuration = duration
    this.sampledOneShotProgress = progress
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    this.cancelPendingWakeActions()
    this.resizeObserver?.disconnect()
    window.removeEventListener('resize', this.handleWindowResize)
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    for (const part of this.parts) {
      this.gl.deleteVertexArray(part.vao)
      this.gl.deleteBuffer(part.vertexBuffer)
      this.gl.deleteBuffer(part.indexBuffer)
    }
    const textures = new Set(this.parts.map((part) => part.texture))
    textures.forEach((texture) => this.gl.deleteTexture(texture))
    this.gl.deleteProgram(this.program)
  }

  private readonly frame = (now: number, forceBlinkPeak = false): void => {
    if (this.destroyed || !this.running) return
    this.urgentRenderUntil = activeUrgentRenderUntilMs(
      now,
      this.urgentRenderUntil,
    )
    const lastCadenceAt = this.lastCollapsedCadenceAt || this.lastRenderedAt
    const urgent = now <= this.urgentRenderUntil
    const cadenceDue = shouldRenderRigFrame(
      this.expanded,
      now,
      lastCadenceAt,
      urgent,
    )
    const preserveCadence = blinkPeakPreservesCollapsedCadence(
      forceBlinkPeak,
      this.expanded,
      now,
      lastCadenceAt,
      urgent,
    )
    if (forceBlinkPeak || cadenceDue) {
      this.render(now)
      if (!this.expanded && !preserveCadence) {
        this.lastCollapsedCadenceAt = now
      }
    }
    this.scheduleFrame()
  }

  private runScheduledAnimationFrame(slot: number, now: number): void {
    if (!this.animationFrameOwnership.claim(slot)) return
    this.frame(now)
  }

  private collapsedFrame(scheduleGeneration: number): void {
    if (scheduleGeneration !== this.frameScheduleGeneration) return
    this.collapsedFrameTimer = 0
    if (
      !scheduledRigClockOwnsFrame(
        scheduleGeneration,
        this.frameScheduleGeneration,
        this.animationFrameOwnership.hasPending(),
      )
    ) {
      return
    }
    const forceBlinkPeak = this.collapsedFrameIsBlinkPeak
    this.collapsedFrameIsBlinkPeak = false
    this.frame(performance.now(), forceBlinkPeak)
  }

  private scheduleFrame(): void {
    if (
      !this.running ||
      this.destroyed ||
      this.reducedMotion ||
      document.hidden ||
      this.animationFrameOwnership.hasPending() ||
      this.collapsedFrameTimer
    ) {
      return
    }
    const now = performance.now()
    this.urgentRenderUntil = activeUrgentRenderUntilMs(
      now,
      this.urgentRenderUntil,
    )
    if (
      shouldScheduleRigAnimationFrame(
        this.expanded,
        now,
        this.urgentRenderUntil,
      )
    ) {
      const slot = this.animationFrameOwnership.allocateSlot()
      this.animationFrameOwnership.setRequest(
        slot,
        requestAnimationFrame(this.animationFrameCallbacks[slot]),
      )
      return
    }
    const cadenceDelay = collapsedRigFrameDelayMs(
      now,
      this.lastCollapsedCadenceAt || this.lastRenderedAt,
    )
    const blinkPeakDelay = this.posePipeline.nextBlinkPeakDelayMs(
      now,
      cadenceDelay,
    )
    this.collapsedFrameIsBlinkPeak =
      blinkPeakDelay !== null && blinkPeakDelay < cadenceDelay
    const nextDelay =
      this.collapsedFrameIsBlinkPeak && blinkPeakDelay !== null
        ? blinkPeakDelay
        : cadenceDelay
    const scheduleGeneration = this.frameScheduleGeneration
    this.collapsedFrameTimer = window.setTimeout(
      () => this.collapsedFrame(scheduleGeneration),
      nextDelay,
    )
  }

  private restartFrameSchedule(): void {
    this.cancelFrameSchedule()
    this.scheduleFrame()
  }

  private render(
    now: number,
    retainedPose: readonly RigTransform[] | null = null,
  ): void {
    this.lastRenderedAt = now
    this.resizeCanvas()
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearStencil(0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.useProgram(this.program)
    const pose = this.reducedMotion
      ? copyPoseInto(this.pose, EMPTY_POSE)
      : retainedPose
        ? copyPoseInto(this.pose, retainedPose)
        : this.currentPose(now)
    writeBoneMatrices(
      this.boneMatrices,
      this.localBoneMatrices,
      this.worldBoneMatrices,
      pose,
      this.boneParents,
      this.bonePivots,
      this.boneOrder,
    )
    gl.uniformMatrix3fv(this.locations.bones, false, this.boneMatrices)
    gl.uniform4fv(this.locations.fit, this.fit())
    gl.activeTexture(gl.TEXTURE0)
    const addedExpression = Boolean(
      this.performanceExpression &&
      !this.presentedClipIds.has(this.performanceExpression),
    )
    if (this.performanceExpression) {
      this.presentedClipIds.add(this.performanceExpression)
    }
    const presentedSpeechViseme = speechVisemeForPresentation(
      this.speechInputActive,
      this.speechViseme,
    )
    selectPartVariantsInto(
      this.partVariants,
      this.presentedClipIds,
      presentedSpeechViseme,
      pose,
      this.facialBoneIndexes,
      this.hasHeadExpressionSlot,
      this.manifest,
      this.presentedClipProgress,
    )
    if (addedExpression && this.performanceExpression) {
      this.presentedClipIds.delete(this.performanceExpression)
    }
    if (this.facialVariantMixer.update(this.partVariants, now)) {
      this.parts.sort((left, right) => {
        if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex
        if (
          left.slot &&
          left.slot === right.slot &&
          left.variant &&
          right.variant
        ) {
          return (
            this.facialVariantMixer.drawOrder(left.slot, left.variant) -
            this.facialVariantMixer.drawOrder(right.slot, right.variant)
          )
        }
        return left.stableIndex - right.stableIndex
      })
    }
    for (const part of this.parts) {
      const coupledEyeSlot = anime25DOpenEyeSlot(part.id)
      const variantOpacity =
        part.slot && part.variant
          ? this.facialVariantMixer.opacity(part.slot, part.variant, now)
          : coupledEyeSlot
            ? this.facialVariantMixer.opacity(coupledEyeSlot, 'open', now)
            : 1
      gl.uniform1f(this.locations.opacity, part.opacity * variantOpacity)
      gl.bindTexture(gl.TEXTURE_2D, part.texture)
      gl.bindVertexArray(part.vao)
      const stencilMode = anime25DStencilMode(part.id)
      if (stencilMode === 'mask') {
        gl.enable(gl.STENCIL_TEST)
        gl.stencilMask(255)
        gl.stencilFunc(gl.ALWAYS, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
        gl.uniform1f(this.locations.alphaCutoff, 0.25)
      } else if (stencilMode === 'clip') {
        gl.enable(gl.STENCIL_TEST)
        gl.stencilMask(0x00)
        gl.stencilFunc(gl.EQUAL, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
        gl.uniform1f(this.locations.alphaCutoff, 0)
      } else {
        gl.disable(gl.STENCIL_TEST)
        gl.stencilMask(255)
        gl.uniform1f(this.locations.alphaCutoff, 0)
      }
      gl.drawElements(gl.TRIANGLES, part.indexCount, gl.UNSIGNED_SHORT, 0)
    }
    gl.disable(gl.STENCIL_TEST)
    gl.stencilMask(255)
    gl.bindVertexArray(null)
  }

  private currentPose(now: number): RigTransform[] {
    this.tryStartDeferredAmbientFidget(now)
    if (this.pendingActivity && now >= this.pendingActivity.startsAt) {
      this.commitActivity(this.pendingActivity.activity, now)
    }
    sampleClipInto(
      this.pose,
      this.manifest,
      this.baseClip,
      (now - this.baseStartedAt) / 1000,
      this.clipTracks.get(this.baseClip),
    )
    if (this.baseTransitionClip) {
      if (
        this.baseTransitionSnapshotPose &&
        this.baseTransitionSnapshotVelocity
      ) {
        extrapolateDampedPoseInto(
          this.transitionPose,
          this.baseTransitionSnapshotPose,
          this.baseTransitionSnapshotVelocity,
          (now - this.baseTransitionSnapshotAt) / 1_000,
          this.handoffSettleSeconds,
        )
      } else {
        sampleClipInto(
          this.transitionPose,
          this.manifest,
          this.baseTransitionClip,
          (now - this.baseTransitionClipStartedAt) / 1_000,
          this.clipTracks.get(this.baseTransitionClip),
        )
      }
      const amount =
        (now - this.transitionStartedAt) /
        Math.max(1, this.transitionDurationMs)
      mixPoseInto(
        this.pose,
        this.transitionPose,
        this.pose,
        activityTransitionWeight(amount),
      )
      if (amount >= 1) {
        this.baseTransitionClip = null
        this.baseTransitionSnapshotPose = null
        this.baseTransitionSnapshotVelocity = null
        this.baseTransitionSnapshotAt = 0
      }
    }
    if (this.queuedOneShots.size > 0) {
      this.queuedGroupIds.clear()
      for (const queued of this.queuedOneShots.values()) {
        this.queuedGroupIds.add(queued.groupId)
      }
      for (const groupId of this.queuedGroupIds) {
        if (this.queuedGroupReady(groupId, now))
          this.beginQueuedGroup(groupId, now)
      }
    }
    if (this.activeOneShots.size > 0) {
      for (const [channel, action] of this.activeOneShots) {
        if (this.outgoingOneShots.has(channel)) continue
        const elapsed = Math.max(0, (now - action.startedAt) / 1_000)
        const duration = action.clip.duration / action.tempo
        const releaseLead = oneShotNaturalReleaseLeadSeconds(
          duration,
          action.fadeOutMs,
        )
        if (elapsed < duration - releaseLead) continue
        this.beginChannelRelease(
          channel,
          now,
          Math.max(action.fadeOutMs, action.transitionMs),
        )
      }
    }
    const activeMask = this.activeBoneMask
    activeMask.fill(false)
    const activePriorities = this.activeBonePriorities
    activePriorities.fill(Number.NEGATIVE_INFINITY)
    this.presentedClipIds.clear()
    this.presentedClipProgress.clear()
    let upperPerformanceBlend = 0
    let generatedAction: OneShotPlayback | undefined
    let generatedProgress = 0
    let generatedBlend = 0
    if (this.releasingOneShots.size > 0) {
      for (const [channel, release] of this.releasingOneShots) {
        const progress = Math.max(
          0,
          Math.min(
            1,
            (now - release.transitionStartedAt) / release.transitionMs,
          ),
        )
        if (progress >= 1) {
          this.releasingOneShots.delete(channel)
          continue
        }
        if (release.snapshotPose && release.snapshotVelocity) {
          extrapolateDampedPoseInto(
            this.scratchPose,
            release.snapshotPose,
            release.snapshotVelocity,
            (now - (release.snapshotAt ?? release.transitionStartedAt)) / 1_000,
            this.handoffSettleSeconds,
          )
        } else {
          this.sampleOneShotInto(this.scratchPose, release.action, now)
        }
        const releaseBlend = oneShotReleaseWeight(release.sourceBlend, progress)
        if (releaseBlend <= 0) continue
        mixPoseByMaskInto(
          this.pose,
          this.pose,
          this.scratchPose,
          releaseBlend,
          release.action.boneMask,
        )
        const releaseClipProgress = clampUnit(
          Math.max(0, (now - release.action.startedAt) / 1_000) /
            (release.action.clip.duration / release.action.tempo),
        )
        if (progress < 0.5)
          this.presentClip(release.action.clip.id, releaseClipProgress)
        for (
          let index = 0;
          index < release.action.boneMask.length;
          index += 1
        ) {
          if (!release.action.boneMask[index]) continue
          activeMask[index] = true
          activePriorities[index] = Math.max(
            activePriorities[index],
            release.action.priority,
          )
        }
        if (channel === 'upper') {
          upperPerformanceBlend = Math.max(upperPerformanceBlend, releaseBlend)
        }
        if (!generatedAction || releaseBlend > generatedBlend) {
          const elapsed = Math.max(0, (now - release.action.startedAt) / 1_000)
          generatedAction = release.action
          generatedProgress = clampUnit(
            elapsed / (release.action.clip.duration / release.action.tempo),
          )
          generatedBlend = releaseBlend
        }
      }
    }
    if (this.activeOneShots.size > 0) {
      for (const [channel, action] of this.activeOneShots) {
        this.sampleOneShotInto(this.scratchPose, action, now)
        const elapsed = this.sampledOneShotElapsed
        const duration = this.sampledOneShotDuration
        const progress = this.sampledOneShotProgress
        if (elapsed >= duration) {
          this.activeOneShots.delete(channel)
          this.outgoingOneShots.delete(channel)
          continue
        }
        let actionBlend = oneShotBlendWeight(
          elapsed,
          duration,
          action.fadeInMs,
          action.fadeOutMs,
        )
        const outgoing = this.outgoingOneShots.get(channel)
        let blendMask: readonly boolean[] =
          outgoing?.boneMask || action.boneMask
        let outgoingPriority =
          outgoing?.sourcePriority ?? Number.NEGATIVE_INFINITY
        if (outgoing) {
          const transitionProgress = Math.max(
            0,
            Math.min(
              1,
              (now - outgoing.transitionStartedAt) / outgoing.transitionMs,
            ),
          )
          blendMask = oneShotHandoffMask(
            action.boneMask,
            outgoing.boneMask,
            transitionProgress,
          )
          if (transitionProgress >= 1) {
            this.outgoingOneShots.delete(channel)
            // The union mask has already brought interrupted-only bones back to
            // base. Drop it on this same frame so identity clip deltas cannot
            // flash over those bones before procedural ownership resumes.
            outgoingPriority = Number.NEGATIVE_INFINITY
            if (actionBlend >= 0.35) this.presentClip(action.clip.id, progress)
          } else {
            if (outgoing.snapshotPose && outgoing.snapshotVelocity) {
              extrapolateDampedPoseInto(
                this.outgoingPose,
                outgoing.snapshotPose,
                outgoing.snapshotVelocity,
                (now - (outgoing.snapshotAt ?? outgoing.transitionStartedAt)) /
                  1_000,
                this.handoffSettleSeconds,
              )
            } else if (outgoing.action) {
              this.sampleOneShotInto(this.outgoingPose, outgoing.action, now)
            } else {
              copyPoseInto(this.outgoingPose, this.pose)
            }
            composeOneShotHandoffInto(
              this.scratchPose,
              this.outgoingPose,
              this.pose,
              this.outgoingPose,
              this.scratchPose,
              outgoing.sourceBlend,
              transitionProgress,
              blendMask,
              action.boneMask,
            )
            actionBlend = 1
            const presentationClipId = transitionPresentationClip(
              outgoing.outgoingClipId,
              action.clip.id,
              transitionProgress,
            )
            const outgoingProgress = outgoing.action
              ? clampUnit(
                  Math.max(0, (now - outgoing.action.startedAt) / 1_000) /
                    (outgoing.action.clip.duration / outgoing.action.tempo),
                )
              : 0
            this.presentClip(
              presentationClipId,
              presentationClipId === action.clip.id
                ? progress
                : outgoingProgress,
            )
          }
        } else if (actionBlend >= 0.35) {
          this.presentClip(action.clip.id, progress)
        }
        if (actionBlend > 0) {
          mixPoseByMaskInto(
            this.pose,
            this.pose,
            this.scratchPose,
            actionBlend,
            blendMask,
          )
          for (let index = 0; index < blendMask.length; index += 1) {
            if (!blendMask[index]) continue
            activeMask[index] = true
            activePriorities[index] = Math.max(
              activePriorities[index],
              action.priority,
              outgoingPriority,
            )
          }
          if (channel === 'upper') {
            upperPerformanceBlend = Math.max(upperPerformanceBlend, actionBlend)
          }
          if (!generatedAction || actionBlend > generatedBlend) {
            generatedAction = action
            generatedProgress = progress
            generatedBlend = actionBlend
          }
        }
      }
    }
    let generated: GeneratedPoseDynamics | undefined
    if (generatedAction) {
      generated = this.generatedPoseDynamics
      if (!generated) {
        generated = {
          clipId: generatedAction.clip.id,
          intensity: generatedAction.intensity,
          instance: generatedAction.generated,
          progress: generatedProgress,
          blend: generatedBlend,
        }
        this.generatedPoseDynamics = generated
      } else {
        generated.clipId = generatedAction.clip.id
        generated.intensity = generatedAction.intensity
        generated.instance = generatedAction.generated
        generated.progress = generatedProgress
        generated.blend = generatedBlend
      }
    }
    this.posePipeline.setAmbientFidgetActive(this.ambientFidgetOwnsIdle())
    const finalizedPose = this.posePipeline.finalizeInto(
      this.pose,
      now,
      this.activity,
      activeMask,
      upperPerformanceBlend,
      generated,
      activePriorities,
      this.greetingOwnsIdle() || this.collapseReleaseOwnsShoulderRecovery(),
    )
    // Handoffs must inherit the velocity of the pose that was actually drawn,
    // including procedural motion and the final constraint/continuity stages.
    this.recordComposedPose(now)
    return finalizedPose
  }

  private presentClip(clipId: string, progress: number): void {
    this.presentedClipIds.add(clipId)
    this.presentedClipProgress.set(clipId, clampUnit(progress))
  }

  private captureComposedHandoffInto(
    pose: RigTransform[],
    velocity: RigTransformVelocity[],
  ): boolean {
    if (
      this.previousComposedAt <= 0 ||
      this.lastComposedAt <= this.previousComposedAt
    ) {
      return false
    }
    copyPoseInto(pose, this.lastComposedPose)
    writePoseVelocity(
      velocity,
      this.previousComposedPose,
      this.lastComposedPose,
      (this.lastComposedAt - this.previousComposedAt) / 1_000,
    )
    return true
  }

  private recordComposedPose(now: number): void {
    if (this.lastComposedAt > 0) {
      copyPoseInto(this.previousComposedPose, this.lastComposedPose)
      this.previousComposedAt = this.lastComposedAt
    }
    copyPoseInto(this.lastComposedPose, this.pose)
    this.lastComposedAt = now
  }

  private resizeCanvas(): void {
    // Small companion canvases alias noticeably on 1x displays. A modest
    // supersampling floor preserves line art while retaining the 2x cap.
    const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2)
    const width = Math.max(1, Math.round(this.cssWidth * pixelRatio))
    const height = Math.max(1, Math.round(this.cssHeight * pixelRatio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private fit(): Float32Array {
    if (
      this.fittedWidth !== this.canvas.width ||
      this.fittedHeight !== this.canvas.height
    ) {
      writeRigFit(
        this.fitVector,
        this.canvas.width,
        this.canvas.height,
        this.manifest.canvas.width,
        this.manifest.canvas.height,
      )
      this.fittedWidth = this.canvas.width
      this.fittedHeight = this.canvas.height
    }
    return this.fitVector
  }

  private stop(): void {
    this.running = false
    this.cancelFrameSchedule()
  }

  private cancelFrameSchedule(): void {
    this.frameScheduleGeneration += 1
    this.animationFrameOwnership.cancelAll(cancelAnimationFrame)
    if (this.collapsedFrameTimer) window.clearTimeout(this.collapsedFrameTimer)
    this.collapsedFrameTimer = 0
    this.collapsedFrameIsBlinkPeak = false
  }

  private readonly handleVisibility = (): void => {
    if (document.hidden) {
      if (this.lastComposedAt > 0) {
        copyPoseInto(this.visibilityRetainedPose, this.lastComposedPose)
        this.visibilityRetained = true
      }
      this.hiddenAt = performance.now()
      this.stop()
    } else {
      const now = performance.now()
      if (visibilityResumeStrategy(this.expanded) === 'collapsed-tick') {
        this.visibilityRetained = false
        this.hiddenAt = 0
        this.posePipeline.prepareCollapsedVisibilityResume()
        this.start()
        return
      }
      if (this.visibilityRetained) {
        // The retained pose already contains every active channel. Release the
        // old channel bookkeeping so it is not composed a second time on top
        // of the visibility handoff; the snapshot itself now owns the settle.
        this.activeOneShots.clear()
        this.queuedOneShots.clear()
        this.outgoingOneShots.clear()
        this.releasingOneShots.clear()
        this.baseTransitionClip = this.baseClip
        this.baseTransitionClipStartedAt = this.baseStartedAt
        this.baseTransitionSnapshotPose = copyPoseInto(
          createPoseBuffer(this.manifest.bones.length),
          this.visibilityRetainedPose,
        )
        this.baseTransitionSnapshotVelocity = createVelocityBuffer(
          this.manifest.bones.length,
        )
        this.baseTransitionSnapshotAt = now
        this.transitionStartedAt = now
        this.transitionDurationMs = visibilityResumeSettleDurationMs(
          Math.max(0, now - this.hiddenAt),
        )
      }
      this.visibilityRetained = false
      this.hiddenAt = 0
      this.posePipeline.resetClock(now)
      this.previousComposedAt = 0
      this.lastComposedAt = 0
      this.start()
    }
  }

  private readonly handleWindowResize = (): void => {
    this.updateCanvasMetrics()
    this.resizeCanvas()
  }

  private updateCanvasMetrics(): void {
    const bounds = this.canvas.getBoundingClientRect()
    this.cssWidth = Math.max(1, bounds.width)
    this.cssHeight = Math.max(1, bounds.height)
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.stop()
    this.onContextLost()
  }
}

function createVelocityBuffer(boneCount: number): RigTransformVelocity[] {
  return Array.from({ length: boneCount }, () => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 0, y: 0 },
  }))
}

function createChannelMaskBuffers(
  boneCount: number,
): Record<MotionChannel, boolean[]> {
  const mask = (): boolean[] => Array.from({ length: boneCount }, () => false)
  return {
    face: mask(),
    head: mask(),
    upper: mask(),
    full: mask(),
  }
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}
