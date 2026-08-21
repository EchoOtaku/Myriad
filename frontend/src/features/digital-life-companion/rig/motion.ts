import type { SpeechArticulation, SpeechViseme } from './articulation'
import type { IdleBehaviorMode } from './director'
import type {
  CompanionRigManifest,
  RigMotionProfile,
  RigTransform,
} from './types'
import {
  anime25DBlinkClosure,
  anime25DHairSpringProfile,
  applyAnime25DMotionInto,
  buildAnime25DRuntimeIndex,
} from './anime25dRuntime'
import { resolveRigSemantics, semanticBoneIndex } from './semantics'
import { pointerGazeOwnsBone } from './transitions'

export type MotionActivity = 'idle' | 'thinking' | 'talking'

export interface MotionCharacterState {
  energy: number
  mood: number
  boredom: number
  curiosity: number
  social: number
  affection: number
}

export interface MotionStyle {
  tempo: number
  force: number
  spatialFocus: number
  fluidity: number
  expansion: number
}

export interface MotionSignals {
  breath: number
  speechEnergy: number
  speechImpulse: number
  eventImpulse: number
  slowNoise: number
  fastNoise: number
  weightShift: number
  gazeWander: number
  secondaryDrift: number
  shoulderDrift: number
  headDrift: number
  idleAccent: number
  idleGlanceX: number
  idleGlanceY: number
  restWeight: number
  microBrow: number
  microMouth: number
}

export interface MotionDebugSignals {
  restStillness: number
  breathAmplitudeScale: number
  breathPhase: number
  nextBlinkSafe: boolean
  blinkClosure: number
  locksIdle: boolean
  idleGlance: {
    x: number
    y: number
  }
  gazeSource: GazeSource | 'idle-glance' | 'ambient'
}

export type GazeSource = 'pointer' | 'camera' | 'performance'

export interface GazeTarget {
  x: number
  y: number
  attention?: number
  source?: GazeSource
}

export type MotionProfile = RigMotionProfile

interface BlinkEvent {
  start: number
  duration: number
  coordination?:
    'idle-glance' | 'ambient-double-first' | 'ambient-double-second'
  groupId?: number
}

interface SecondaryBone {
  index: number
  parentIndex: number
  parentSecondaryIndex: number
  direction: number
  frequencyHz: number
  dampingRatio: number
  response: number
  maxRotation: number
  rotation: number
  velocity: number
  driverRotation: number
  driverVelocity: number
  previousParentRotation: number
  driverInitialized: boolean
  kind: 'hair' | 'accessory' | 'cloth'
  depth: number
  restLength: number
  ambientPhase: number
  headDriven: boolean
  headVelocity: number
}

const DEFAULT_STATE: MotionCharacterState = {
  energy: 50,
  mood: 50,
  boredom: 20,
  curiosity: 50,
  social: 50,
  affection: 50,
}

const TWO_PI = Math.PI * 2
export const SPEECH_MOUTH_CLOSE_MS = 150
export const SPEECH_BREATH_RECOVERY_MS = 400
export const WAKE_FIDGET_SETTLE_MS = 2_500
const SPEECH_MOUTH_CLOSE_HOLD_MS = 280
const TALKING_BREATH_SCALE = 0.42
const HEAD_TURN_BLINK_SETTLE_SECONDS = 0.16
const GAZE_HEAD_ACQUIRE_LEAD_SECONDS = 0.14
const GAZE_HEAD_RELEASE_LEAD_SECONDS = 0.18
const EXPANSION_GAZE_HEAD_LEAD_SECONDS = 0.08
const EXPANSION_GAZE_HEAD_SETTLE_SECONDS = 0.28
const IDLE_GLANCE_ACQUIRE_SECONDS = 0.24
const IDLE_GLANCE_SETTLE_SECONDS = 0.16
const IDLE_GLANCE_RETURN_SECONDS = 0.32
const IDLE_GLANCE_POST_BLINK_HOLD_SECONDS = 0.1
const IDLE_GLANCE_HAIR_TAIL_SECONDS = 0.24
const IDLE_GLANCE_SHOULDER_WEIGHT = 0.14
const IDLE_GLANCE_MOUTH_WEIGHT = 0.18
const BLINK_BREATH_VALLEY_LIMIT = -0.55
const BLINK_BREATH_VALLEY_SETTLE_SECONDS = 0.1
const AMBIENT_DOUBLE_BLINK_QUIET_SECONDS = 0.6
const DEEP_REST_BLINK_MIN_SECONDS = 9.5
const DEEP_REST_BLINK_MAX_SECONDS = 17.5
const WAKE_FIRST_BLINK_MIN_SECONDS = 1.9
const WAKE_FIRST_BLINK_MAX_SECONDS = 3.8
const POINTER_GLANCE_RECENTER_BASE_SECONDS = 0.4
const POINTER_GLANCE_RECENTER_DISTANCE_SECONDS = 0.42
const GAZE_SOURCE_HANDOFF_SECONDS = 0.24
const GAZE_HEAD_YAW_MAX_UNITS_PER_SECOND = 3.2
const GAZE_SOURCE_PRIORITY: readonly GazeSource[] = [
  'pointer',
  'performance',
  'camera',
]

export function writeGazeTargetInto(
  target: GazeTarget,
  x: number,
  y: number,
  attention: number,
  source: GazeSource,
): GazeTarget {
  target.x = clamp(x, -1, 1)
  target.y = clamp(y, -1, 1)
  target.attention = clamp(attention, 0, 1)
  target.source = source
  return target
}

export function gazeSourceHandoffRateScale(ageSeconds: number): number {
  const handoffWeight = smootherstep(
    clamp(ageSeconds / GAZE_SOURCE_HANDOFF_SECONDS, 0, 1),
  )
  return lerp(0.38, 1, handoffWeight)
}

export function boundedGazeHeadYawFollow(
  current: number,
  target: number,
  deltaSeconds: number,
  followRate: number,
  sourceHandoffRateScale: number,
): number {
  if (deltaSeconds <= 0) return current
  const rateScale = clamp(sourceHandoffRateScale, 0, 1)
  const desiredStep =
    (target - current) *
    (1 - Math.exp(-deltaSeconds * Math.max(0, followRate) * rateScale))
  const maxStep = deltaSeconds * GAZE_HEAD_YAW_MAX_UNITS_PER_SECOND * rateScale
  return current + clamp(desiredStep, -maxStep, maxStep)
}

export function blinkBreathValleyDelaySeconds(
  phaseRadians: number,
  frequencyHz: number,
  blinkPeakOffsetSeconds: number,
): number {
  const frequency = clamp(frequencyHz, 0.01, 4)
  const angularVelocity = TWO_PI * frequency
  const peakPhase = positiveModulo(
    phaseRadians + angularVelocity * blinkPeakOffsetSeconds,
    TWO_PI,
  )
  if (Math.sin(peakPhase) > BLINK_BREATH_VALLEY_LIMIT) return 0

  // Move the lid closure past the exhale trough, then leave a small readable
  // gap before it begins. This keeps two subtle beats from collapsing into one
  // compressed facial accent without resetting either oscillator.
  const valleyExitPhase =
    TWO_PI - Math.asin(Math.abs(BLINK_BREATH_VALLEY_LIMIT))
  const phaseUntilExit = positiveModulo(valleyExitPhase - peakPhase, TWO_PI)
  return phaseUntilExit / angularVelocity + BLINK_BREATH_VALLEY_SETTLE_SECONDS
}

export function blinkBreathSequenceDelaySeconds(
  phaseRadians: number,
  frequencyHz: number,
  primaryPeakOffsetSeconds: number,
  secondaryPeakOffsetSeconds = -1,
): number {
  const frequency = clamp(frequencyHz, 0.01, 4)
  const periodSeconds = 1 / frequency
  let delay = 0

  // Resolve the complete blink group from one shared start. Moving the second
  // closure can otherwise push the first closure back into the same trough.
  // The normal path preserves the readable post-valley settling gap.
  for (let guard = 0; guard < 8; guard += 1) {
    const primaryDelay = blinkBreathValleyDelaySeconds(
      phaseRadians,
      frequency,
      delay + primaryPeakOffsetSeconds,
    )
    const secondaryDelay =
      secondaryPeakOffsetSeconds < 0
        ? 0
        : blinkBreathValleyDelaySeconds(
            phaseRadians,
            frequency,
            delay + secondaryPeakOffsetSeconds,
          )
    if (primaryDelay === 0 && secondaryDelay === 0) return delay
    delay += Math.max(primaryDelay, secondaryDelay)
    if (delay > periodSeconds * 2) break
  }

  // At unusually high authored breath rates, two post-valley settle windows
  // can cover the entire cycle even though the actual troughs do not. Search
  // one real-time period for the earliest point where both closure peaks are
  // genuinely outside the trough. This fallback is scheduler-only and does
  // not allocate on the render hot path.
  const sampleStep = periodSeconds / 256
  for (let index = 1; index <= 256; index += 1) {
    const candidate = index * sampleStep
    const primarySafe =
      blinkBreathValleyDelaySeconds(
        phaseRadians,
        frequency,
        candidate + primaryPeakOffsetSeconds,
      ) === 0
    const secondarySafe =
      secondaryPeakOffsetSeconds < 0 ||
      blinkBreathValleyDelaySeconds(
        phaseRadians,
        frequency,
        candidate + secondaryPeakOffsetSeconds,
      ) === 0
    if (primarySafe && secondarySafe) return candidate
  }

  // Two troughs occupy less than a full cycle, so the sampled search always
  // finds a safe point. Keep a finite defensive result for malformed inputs.
  return periodSeconds
}

export function translatedDoubleBlinkSecondStart(
  firstStart: number,
  secondStart: number,
  shiftedFirstStart: number,
): number {
  return shiftedFirstStart + Math.max(0, secondStart - firstStart)
}

export function speechMouthReleaseWeight(elapsedMs: number): number {
  return 1 - smootherstep(clamp(elapsedMs / SPEECH_MOUTH_CLOSE_MS, 0, 1))
}

export function speechBreathAmplitudeScale(
  current: number,
  talking: boolean,
  deltaSeconds: number,
): number {
  const recoveryRate = Math.log(100) / (SPEECH_BREATH_RECOVERY_MS / 1_000)
  return boundedStateFollow(
    current,
    talking ? TALKING_BREATH_SCALE : 1,
    deltaSeconds,
    talking ? 14 : recoveryRate,
  )
}

export function speechBreathReleaseScale(
  releaseScale: number,
  elapsedMs: number,
): number {
  const from = clamp(releaseScale, TALKING_BREATH_SCALE, 1)
  const progress = smootherstep(
    clamp(elapsedMs / SPEECH_BREATH_RECOVERY_MS, 0, 1),
  )
  return lerp(from, 1, progress)
}

export function createDefaultMotionProfile(
  manifest: CompanionRigManifest,
): MotionProfile {
  return {
    seed: hashString(
      `${manifest.defaultClip}:${manifest.bones.map((bone) => bone.id).join('|')}`,
    ),
    breath: {
      minFrequencyHz: 0.16,
      maxFrequencyHz: 0.27,
      amplitude: 0.0036,
    },
    blink: {
      minIntervalSeconds: 2.7,
      maxIntervalSeconds: 6.8,
      durationSeconds: 0.24,
      doubleChance: 0.16,
    },
    secondary: {
      enabled: true,
      frequencyHz: 2.15,
      dampingRatio: 0.52,
      response: 0.58,
    },
  }
}

export function motionStyleFromState(state: MotionCharacterState): MotionStyle {
  const energy = unit(state.energy)
  const mood = signed(state.mood)
  const curiosity = unit(state.curiosity)
  const social = unit(state.social)
  const affection = unit(state.affection)
  return {
    tempo: clamp(0.68 + energy * 0.62 + curiosity * 0.08, 0.6, 1.45),
    force: clamp(0.55 + energy * 0.56 + Math.max(0, mood) * 0.12, 0.45, 1.3),
    spatialFocus: clamp(0.42 + curiosity * 0.38 + social * 0.2, 0.25, 1),
    fluidity: clamp(0.46 + affection * 0.3 + (1 - energy) * 0.18, 0.3, 0.95),
    expansion: clamp(mood * 0.58 + (social - 0.5) * 0.28, -0.7, 0.75),
  }
}

export function idleAccentDelayMs(
  state: Pick<MotionCharacterState, 'energy' | 'mood' | 'boredom'>,
  randomUnit: number,
  behaviorMode: IdleBehaviorMode = 'idle',
): number {
  const energy = unit(state.energy)
  const boredom = unit(state.boredom)
  const positiveMood = Math.max(0, signed(state.mood))
  const baseSeconds = 31 - boredom * 15 - energy * 3 - positiveMood * 2
  const fatigueDelay = (1 - energy) * 7
  const jitter = 0.82 + unit(randomUnit * 100) * 0.36
  const highBoredom = smootherstep(clamp((boredom - 0.55) / 0.45, 0, 1))
  const modeScale =
    behaviorMode === 'fidget'
      ? lerp(0.76, 0.5, highBoredom)
      : behaviorMode === 'rest'
        ? 1.12
        : 1
  const cooldownSeconds = idleAccentCooldownMs(state, behaviorMode) / 1_000
  return Math.round(
    clamp(
      (baseSeconds + fatigueDelay) * jitter * modeScale,
      cooldownSeconds,
      42,
    ) * 1000,
  )
}

export function idleAccentCooldownMs(
  state: Pick<MotionCharacterState, 'boredom'>,
  behaviorMode: IdleBehaviorMode = 'idle',
): number {
  if (behaviorMode !== 'fidget')
    return behaviorMode === 'rest' ? 12_000 : 10_000
  const boredom = unit(state.boredom)
  const highBoredom = smootherstep(clamp((boredom - 0.55) / 0.45, 0, 1))
  // Density is allowed to rise, but every accent still gets a complete quiet
  // window. This prevents state refreshes from turning the fidget scheduler
  // into a continuous loop.
  return Math.round(lerp(8_000, 6_000, highBoredom))
}

export function idleGazeGlanceDelayMs(
  randomUnit: number,
  continuousIdleSeconds = 0,
): number {
  const idleDilation = smootherstep(
    clamp((continuousIdleSeconds - 90) / 240, 0, 1),
  )
  const intervalScale = lerp(1, 2.5, idleDilation)
  return Math.round(lerp(3_000, 8_000, clamp(randomUnit, 0, 1)) * intervalScale)
}

export function idleGazeGlanceStyle(energyScore: number): {
  amplitudeScale: number
  tempoScale: number
  headScale: number
} {
  const energy = unit(energyScore)
  const fatigue = smootherstep(clamp((0.48 - energy) / 0.14, 0, 1))
  return {
    amplitudeScale: lerp(1, 0.58, fatigue),
    tempoScale: lerp(1, 0.62, fatigue),
    headScale: lerp(1, 0.12, fatigue),
  }
}

export function nextSeededUnit(seed: number): { seed: number; value: number } {
  const next = (Math.imul(seed >>> 0, 1_664_525) + 1_013_904_223) >>> 0
  return { seed: next, value: next / 4_294_967_296 }
}

export function secondarySpringDynamics(
  restStillness: number,
  idleDampingScale: number,
  idleFrequencyScale: number,
  wakeEnvelope?: number,
): { dampingScale: number; frequencyScale: number; wakeWeight: number } {
  const wakeWeight = clamp(
    wakeEnvelope ?? secondarySpringWakeWeight(restStillness),
    0,
    1,
  )
  return {
    // Settled rest is deliberately overdamped and slow. Both controls travel
    // on the same smooth wake envelope as ambient drive, so the spring cannot
    // receive full idle energy on the first awake frame.
    dampingScale: lerp(
      Math.max(1.45, idleDampingScale),
      idleDampingScale,
      wakeWeight,
    ),
    frequencyScale: lerp(
      Math.min(0.46, idleFrequencyScale),
      idleFrequencyScale,
      wakeWeight,
    ),
    wakeWeight,
  }
}

function secondarySpringWakeWeight(restStillness: number): number {
  return smootherstep(1 - clamp(restStillness, 0, 1))
}

export function restPhaseRateScale(
  restStillness: number,
  settledRateScale: number,
): number {
  const wakeWeight = smootherstep(1 - clamp(restStillness, 0, 1))
  return lerp(clamp(settledRateScale, 0, 1), 1, wakeWeight)
}

export function restWakeAmplitudeScale(restStillness: number): number {
  return smootherstep(1 - clamp(restStillness, 0, 1))
}

export function chestBreathAmplitudeScale(
  breathAmplitudeScale: number,
  restAmount: number,
): number {
  const speechScale = clamp(breathAmplitudeScale, 0, 1)
  const restScale = lerp(1, 0.34, clamp(restAmount, 0, 1))
  // Speech recovery and rest wake are alternative reasons to restrain the
  // same chest oscillator. Multiplying them applies the restraint twice when
  // both ramps move together; the stricter single envelope preserves each
  // behavior's authored amplitude without manufacturing a third one.
  return Math.min(speechScale, restScale)
}

export function shoulderWeightShiftPhaseScale(breath: number): number {
  const distanceFromBreathPeak = 1 - Math.abs(clamp(breath, -1, 1))
  // Weight transfer lives around the breath zero-crossing. A small floor keeps
  // the slow bias continuous while preventing it from cresting with inhale or
  // exhale, so the two independent oscillators never read as one bounce.
  return lerp(0.12, 1, smootherstep(distanceFromBreathPeak))
}

export function idleLockAllowsShoulderMacro(
  expanded: boolean,
  idleLocked: boolean,
  _restStillness: number,
): boolean {
  // A queued greeting does not lock idle while wake owns the shoulders. Once
  // the greeting actually starts, its authored upper-body layer owns them even
  // if the rest envelope is still unloading.
  return expanded && !idleLocked
}

export class MotionRuntime {
  private readonly bodyIndex: number
  private readonly headIndex: number
  private readonly mouthIndex: number
  private readonly eyeIndexes: number[]
  private readonly browIndexes: number[]
  private secondaryBones: SecondaryBone[]
  private profile: MotionProfile
  private characterState = { ...DEFAULT_STATE }
  private readonly currentStyle = motionStyleFromState(DEFAULT_STATE)
  private targetStyle = motionStyleFromState(DEFAULT_STATE)
  private lastSeconds: number | null = null
  private frameElapsed = 0
  private frameDelta = 0
  private framePhaseDelta = 0
  private frameSampleAccepted = true
  private limitNextPhaseStepToCollapsedInterval = false
  private nextBlinkAt = 0
  private blinkEvents: BlinkEvent[] = []
  private nextBlinkGroupId = 1
  private pendingAmbientDoubleBlink = false
  private randomSeed: number
  private eventStartedAt = -Infinity
  private eventStrength = 0
  private eventDirection = 1
  private externalSpeechEnergy: number | null = null
  private externalSpeechUpdatedAt = -Infinity
  private speechViseme: SpeechViseme = 'rest'
  private speechVisemeAmount = 0
  private speechActive = false
  private speechReleaseStartedAt = -Infinity
  private speechReleaseViseme: SpeechViseme = 'rest'
  private speechReleaseAmount = 0
  private speechReleaseEnergy = 0
  private speechReleaseBreathScale = 1
  private breathSpeechActive = false
  private readonly gazeTargets: Partial<Record<GazeSource, GazeTarget>> = {}
  private readonly pointerGazeTarget: GazeTarget = {
    x: 0,
    y: 0,
    attention: 0,
    source: 'pointer',
  }

  private readonly cameraGazeTarget: GazeTarget = {
    x: 0,
    y: 0,
    attention: 0,
    source: 'camera',
  }

  private readonly performanceGazeTarget: GazeTarget = {
    x: 0,
    y: 0,
    attention: 0,
    source: 'performance',
  }

  private readonly pointerRecenterTarget: GazeTarget = {
    x: 0,
    y: 0,
    attention: 1,
    source: 'pointer',
  }

  private pointerRecenterActive = false
  private pointerRecenterHasTarget = false
  private pointerRecenterUntil = -Infinity
  private gazeTarget: GazeTarget | null = null
  private gazeX = 0
  private gazeY = 0
  private gazeAttention = 0.26
  private headGazeX = 0
  private headGazeY = 0
  private headGazeAttention = 0.26
  private gazeAcquiredAt = -Infinity
  private gazeSourceHandoffStartedAt = -Infinity
  private gazeReleaseStartedAt = -Infinity
  private gazePresentationWeight = 1
  private expansionGazeStartedAt = -Infinity
  private currentSpeechGazeWeight = 1
  private currentHeadGazeIntentScale = 1
  private idleGazeRandomSeed: number
  private idleGlanceIdleSince = -Infinity
  private idleGlanceNextAt = -Infinity
  private idleGlanceStartedAt = -Infinity
  private idleGlanceDuration = 0
  private idleGlanceX = 0
  private idleGlanceY = 0
  private idleGlanceBlinkQueuedFor = -Infinity
  private idleGlanceAcquireDuration = IDLE_GLANCE_ACQUIRE_SECONDS
  private idleGlanceReturnDuration = IDLE_GLANCE_RETURN_SECONDS
  private idleGlanceHeadScale = 1
  private idleGlanceHairTail = 0
  private idleGlanceLastDirection: -1 | 0 | 1 = 0
  private idleGlanceStateClear = true
  private headFollowInitialized = false
  private headFollowX = 0
  private headFollowY = 0
  private headFollowRotation = 0
  private previousHeadRotation = 0
  private headAngularVelocity = 0
  private headAngularInitialized = false
  private blinkHeadRotation = 0
  private blinkHeadGazeX = 0
  private blinkHeadGazeY = 0
  private blinkHeadInitialized = false
  private expansionBlinkContinuationUntil = -Infinity
  private blinkBlockedUntil = -Infinity
  private currentActivityScale = 1
  private currentIdleWeight = 1
  private currentRestWeight = 0
  private currentRestStillness = 0
  private idleBehaviorMode: IdleBehaviorMode | null = null
  private restExitEnvelope = 0
  private wakeGateStartedAt = -Infinity
  private wakeGateUntil = -Infinity
  private wakeHoldUntil = -Infinity
  private wakeFidgetUntil = -Infinity
  private previousIdleLocked = false
  private ambientFidgetActive = false
  private currentMicroExpressionWeight = 0
  private currentIdleGlanceMouthWeight = 1
  private currentBreathAmplitudeScale = 1
  private currentShoulderMacroWeight = 1
  private currentIdleGlanceMacroWeight = 1
  private currentSecondaryWakeWeight = 1
  private secondaryWakeInitialized = false
  private expanded = true
  private currentEnergy = unit(DEFAULT_STATE.energy)
  private currentBoredom = unit(DEFAULT_STATE.boredom)
  private previousSpeechEnergy = 0
  private breathClock = 0
  private currentBreathFrequencyHz: number
  private slowClock = 0
  private fastClock = 0
  private weightClock = 0
  private gazeClock = 0
  private secondaryClock = 0
  private macroClock = 0
  private phaseA = 0
  private phaseB = 0
  private weightPhase = 0
  private gazePhase = 0
  private secondaryPhase = 0
  private shoulderPhase = 0
  private headPhase = 0
  private accentPhase = 0
  private readonly signalsValue: MotionSignals = {
    breath: 0,
    speechEnergy: 0,
    speechImpulse: 0,
    eventImpulse: 0,
    slowNoise: 0,
    fastNoise: 0,
    weightShift: 0,
    gazeWander: 0,
    secondaryDrift: 0,
    shoulderDrift: 0,
    headDrift: 0,
    idleAccent: 0,
    idleGlanceX: 0,
    idleGlanceY: 0,
    restWeight: 0,
    microBrow: 0,
    microMouth: 0,
  }

  private readonly debugSignalsValue: MotionDebugSignals = {
    restStillness: 0,
    breathAmplitudeScale: 1,
    breathPhase: 0,
    nextBlinkSafe: true,
    blinkClosure: 0,
    locksIdle: false,
    idleGlance: { x: 0, y: 0 },
    gazeSource: 'ambient',
  }

  private readonly anime25dIndex
  private animeChestPosition = 0
  private animeChestVelocity = 0
  private animeChestInitialized = false
  private animeHandwearPosition = 0
  private animeHandwearVelocity = 0
  private animeHandwearInitialized = false

  constructor(
    private readonly manifest: CompanionRigManifest,
    profile = manifest.motionProfile || createDefaultMotionProfile(manifest),
  ) {
    this.profile = profile
    this.bodyIndex = semanticBoneIndex(manifest, 'torso') ?? -1
    this.headIndex = semanticBoneIndex(manifest, 'head') ?? -1
    this.mouthIndex = semanticBoneIndex(manifest, 'mouth') ?? -1
    this.eyeIndexes = (['left-eye', 'right-eye'] as const)
      .map((role) => semanticBoneIndex(manifest, role) ?? -1)
      .filter((index) => index >= 0)
    const authoredBrowIndexes = manifest.bones.flatMap((bone, index) =>
      /brow|eyebrow/i.test(bone.id) ? [index] : [],
    )
    // PSD rigs commonly bind eyebrow art to the eye bones. Use that pair only
    // as a tiny fallback; dedicated brow bones take precedence when present.
    this.browIndexes =
      authoredBrowIndexes.length > 0 ? authoredBrowIndexes : this.eyeIndexes
    this.anime25dIndex = buildAnime25DRuntimeIndex(manifest)
    this.secondaryBones = buildSecondaryBones(manifest, profile)
    this.randomSeed = profile.seed || 1
    this.idleGazeRandomSeed = (profile.seed || 1) ^ 1_374_857_533
    this.currentBreathFrequencyHz = profile.breath.minFrequencyHz
    this.cacheSeedPhases()
  }

  setCharacterState(state: MotionCharacterState): void {
    this.characterState = sanitizeState(state)
    this.targetStyle = motionStyleFromState(this.characterState)
    if (this.lastSeconds === null) {
      writeStyle(this.currentStyle, this.targetStyle)
      this.currentEnergy = unit(this.characterState.energy)
      this.currentBoredom = unit(this.characterState.boredom)
    }
  }

  setIdleBehaviorMode(
    mode: IdleBehaviorMode,
    nowMs = (this.lastSeconds ?? 0) * 1_000,
  ): void {
    if (mode === this.idleBehaviorMode) return
    if (mode === 'rest') {
      this.restExitEnvelope = 1
      this.resetIdleGlance(false)
    } else if (this.idleBehaviorMode === 'rest') {
      this.restExitEnvelope = restWeightFromEnergy(this.currentEnergy)
      this.holdAmbientFidgetForFullInterval(nowMs / 1_000)
    }
    this.idleBehaviorMode = mode
  }

  setAmbientFidgetActive(active: boolean): void {
    if (active === this.ambientFidgetActive) return
    this.ambientFidgetActive = active
    if (active) this.resetIdleGlance(false)
  }

  idleGlanceActive(nowMs: number): boolean {
    return this.idleGlanceIsActive(nowMs / 1_000)
  }

  setExpanded(
    expanded: boolean,
    nowMs = (this.lastSeconds ?? 0) * 1_000,
  ): void {
    if (expanded === this.expanded) return
    // The interval ending on the first expanded sample was accumulated while
    // the collapsed scheduler owned the clock. Remember that ownership across
    // the state flip: a hidden tab can otherwise turn a minute-long callback
    // gap into one visible oscillator jump even though physical followers are
    // already capped to a single 100 ms slot.
    this.limitNextPhaseStepToCollapsedInterval =
      expanded && this.lastSeconds !== null
    this.expanded = expanded
    if (!expanded) {
      // Pointer coordinates belong to the expanded hit area. Collapse can
      // replace that element before pointerleave is delivered, so invalidate
      // pointer ownership at the presentation boundary as well as in the DOM
      // handler. The eye follower may finish its return at 10 FPS, but the old
      // coordinate is no longer eligible to recruit the head on reopen.
      this.setGazeTarget(null, nowMs, 'pointer')
      this.currentMicroExpressionWeight = 0
      this.currentShoulderMacroWeight = 0
      this.resetIdleGlance()
      // Collapsed presentation keeps the eyes alive at 10 FPS while the head
      // stays still. Preserve the follower state and non-pointer targets so a
      // valid camera target can still use an eye-led expansion handoff.
      this.expansionGazeStartedAt = -Infinity
      this.cancelPointerRecenter()
    } else {
      // Pointer and camera may both have updated while the portrait was
      // collapsed. Preserve their followers and priority arbitration, but
      // reopen the head through a fresh eye-led handoff so a fully acquired
      // hidden target cannot be revealed as a first-frame head turn.
      this.expansionGazeStartedAt = nowMs / 1_000
      const elapsed = this.elapsedAt(nowMs)
      for (const event of this.blinkEvents) {
        if (event.start <= elapsed && elapsed <= event.start + event.duration) {
          this.expansionBlinkContinuationUntil = Math.max(
            this.expansionBlinkContinuationUntil,
            event.start + event.duration,
          )
        }
      }
      this.revalidateAmbientDoubleBlinkSeconds(this.elapsedAt(nowMs))
    }
  }

  requestWake(nowMs: number): boolean {
    const nowSeconds = nowMs / 1_000
    if (nowSeconds < this.wakeHoldUntil && nowSeconds >= this.wakeGateUntil) {
      this.wakeHoldUntil = Math.max(this.wakeHoldUntil, nowSeconds + 1.8)
      return false
    }
    const needsWake =
      this.idleBehaviorMode === 'rest' || this.currentRestWeight >= 0.22
    if (!needsWake) return false
    if (nowSeconds >= this.wakeGateUntil) {
      this.wakeGateStartedAt = nowSeconds
      this.wakeGateUntil = nowSeconds + 0.82
      this.holdAmbientFidgetForFullInterval(nowSeconds)
      this.rebaseBlinkScheduleForWake(nowMs)
    }
    this.wakeHoldUntil = Math.max(this.wakeHoldUntil, nowSeconds + 2.8)
    return true
  }

  prepareExpansion(nowMs: number): boolean {
    const waking = this.requestWake(nowMs)
    if (waking) this.setGazeTarget(null, nowMs)
    return waking
  }

  inputWakeWeight(nowMs: number): number {
    const nowSeconds = nowMs / 1_000
    if (nowSeconds >= this.wakeGateUntil) return 1
    return smootherstep(
      clamp((nowSeconds - this.wakeGateStartedAt - 0.12) / 0.7, 0, 1),
    )
  }

  wakeReadyDelayMs(nowMs: number): number {
    if (!Number.isFinite(this.wakeGateUntil)) return 0
    return Math.max(0, Math.ceil(this.wakeGateUntil * 1_000 - nowMs))
  }

  ambientFidgetReadyDelayMs(nowMs: number): number {
    if (!Number.isFinite(this.wakeFidgetUntil)) return 0
    return Math.max(0, Math.ceil(this.wakeFidgetUntil * 1_000 - nowMs))
  }

  private holdAmbientFidgetForFullInterval(nowSeconds: number): void {
    const intervalSeconds =
      idleAccentCooldownMs(this.characterState, 'fidget') / 1_000
    this.wakeFidgetUntil = Math.max(
      this.wakeFidgetUntil,
      nowSeconds + intervalSeconds,
    )
  }

  private rebaseBlinkScheduleForWake(nowMs: number): void {
    const elapsed = this.elapsedAt(nowMs)
    let activeGroupId: number | undefined
    let retainedGroupEnd = elapsed

    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      if (event.start <= elapsed && elapsed <= event.start + event.duration) {
        activeGroupId = event.groupId
        retainedGroupEnd = Math.max(
          retainedGroupEnd,
          event.start + event.duration,
        )
        break
      }
    }

    // A lid beat already on screen finishes as authored. Everything else was
    // scheduled against the slow rest clock and is no longer a wake intent.
    // Compact in place so wake-up cannot replay overdue blinks or allocate on
    // the first visible frame. If the active beat belongs to a double blink,
    // retain its complete explicit group rather than splitting the rhythm.
    let retained = 0
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      const active =
        event.start <= elapsed && elapsed <= event.start + event.duration
      const sameActiveGroup =
        activeGroupId !== undefined && event.groupId === activeGroupId
      if (!active && !sameActiveGroup) continue
      this.blinkEvents[retained] = event
      retained += 1
      retainedGroupEnd = Math.max(
        retainedGroupEnd,
        event.start + event.duration,
      )
    }
    this.blinkEvents.length = retained
    this.pendingAmbientDoubleBlink = false

    const firstWakeDelay = lerp(
      WAKE_FIRST_BLINK_MIN_SECONDS,
      WAKE_FIRST_BLINK_MAX_SECONDS,
      this.random(),
    )
    this.nextBlinkAt = Math.max(
      elapsed + firstWakeDelay,
      retainedGroupEnd + AMBIENT_DOUBLE_BLINK_QUIET_SECONDS,
      this.blinkBlockedUntil,
      this.speechBlinkBlockedUntilElapsed(),
    )
  }

  setMotionProfile(profile: MotionProfile): void {
    this.profile = profile
    this.secondaryBones = buildSecondaryBones(this.manifest, profile)
    this.randomSeed = profile.seed || 1
    this.idleGazeRandomSeed = (profile.seed || 1) ^ 1_374_857_533
    this.currentBreathFrequencyHz = profile.breath.minFrequencyHz
    this.resetIdleGlance(false)
    this.cacheSeedPhases()
    this.nextBlinkAt = 0
    this.blinkEvents = []
    this.nextBlinkGroupId = 1
    this.pendingAmbientDoubleBlink = false
    this.headAngularVelocity = 0
    this.headAngularInitialized = false
  }

  setSpeechEnergy(value: number | null, nowMs: number): void {
    const wasActive = this.speechActive
    this.externalSpeechEnergy = value === null ? null : unit(value * 100)
    this.externalSpeechUpdatedAt = nowMs / 1000
    if (value === null) {
      if (wasActive) {
        this.speechReleaseStartedAt = nowMs
        this.speechReleaseViseme = this.speechViseme
        this.speechReleaseAmount = this.speechVisemeAmount
        this.speechReleaseEnergy = this.signalsValue.speechEnergy
        this.speechReleaseBreathScale = this.currentBreathAmplitudeScale
      }
      this.speechViseme = 'rest'
      this.speechVisemeAmount = 0
      this.speechActive = false
      if (wasActive) this.schedulePostSpeechBlink(nowMs)
    } else if (this.speechViseme === 'rest') {
      this.speechViseme = 'open'
      this.speechVisemeAmount = value
      this.beginSpeech(nowMs)
    } else {
      this.beginSpeech(nowMs)
    }
  }

  setSpeechArticulation(value: SpeechArticulation, nowMs: number): void {
    this.setSpeechEnergy(value.energy, nowMs)
    this.speechViseme = value.viseme
    this.speechVisemeAmount = clamp(value.amount, 0, 1)
    if (value.energy !== null || value.viseme !== 'rest' || value.amount > 0) {
      this.beginSpeech(nowMs)
    }
  }

  private beginSpeech(nowMs: number): void {
    this.interruptIdleGlanceForSpeech(nowMs)
    this.requestWake(nowMs)
    this.speechReleaseStartedAt = -Infinity
    if (this.speechActive) return
    this.speechActive = true
    const elapsed = this.elapsedAt(nowMs)
    // Do not let an idle blink that was already queued land on the first
    // syllable. A blink already in progress is allowed to finish naturally.
    this.blinkEvents = this.blinkEvents.filter(
      (event) =>
        event.start <= elapsed && elapsed <= event.start + event.duration,
    )
    this.nextBlinkAt = Math.max(
      this.nextBlinkAt,
      elapsed + this.speechBlinkInterval(),
    )
  }

  private interruptIdleGlanceForSpeech(nowMs: number): void {
    const age = nowMs / 1_000 - this.idleGlanceStartedAt
    const hasLiveGlance =
      age >= 0 && age <= this.idleGlanceDuration + IDLE_GLANCE_HAIR_TAIL_SECONDS
    const hasCoordinatedBlink = this.blinkEvents.some(
      (event) => event.coordination === 'idle-glance',
    )
    if (!hasLiveGlance && !hasCoordinatedBlink) return

    // Speech does not wait for an ambient look to finish. Cancel every
    // authored glance residue immediately, then rebase the shared gaze
    // followers onto the same ambient phase they would have followed without
    // the glance. Secondary springs retain only their physical damping.
    this.resetIdleGlance(false)
    const ambientScale = 1 - this.currentRestStillness
    const ambientX = this.signalsValue.gazeWander * 0.5 * ambientScale
    const ambientY = this.signalsValue.fastNoise * 0.22 * ambientScale
    this.gazeX = ambientX
    this.gazeY = ambientY
    this.headGazeX = ambientX
    this.headGazeY = ambientY
    this.gazeAttention = 0.26
    this.headGazeAttention = 0.26
    this.currentHeadGazeIntentScale = 1
  }

  private schedulePostSpeechBlink(nowMs: number): void {
    const elapsed = this.elapsedAt(nowMs)
    const candidateStart = elapsed + SPEECH_MOUTH_CLOSE_MS / 1_000
    // Nothing queued before the release may close the eyes while the mouth is
    // returning to neutral. Restart with one deliberate post-speech blink once
    // that ownership window has ended.
    this.blinkEvents = this.blinkEvents.filter(
      (event) => event.start + event.duration <= elapsed,
    )
    const alreadyPending = this.blinkEvents.some(
      (event) =>
        event.start <= candidateStart + 0.08 &&
        event.start + event.duration >= elapsed,
    )
    if (alreadyPending) return
    const lowEnergy = 1 - unit(this.characterState.energy)
    const duration = this.blinkDurationSeconds() * (0.94 + lowEnergy * 0.42)
    const start = this.breathSeparatedBlinkStart(candidateStart, duration)
    this.blinkEvents.push({ start, duration })
    this.nextBlinkAt = Math.max(
      this.nextBlinkAt,
      start + duration + this.blinkInterval(),
    )
  }

  private elapsedAt(nowMs: number): number {
    if (this.lastSeconds === null) return 0
    const wallOffset = nowMs / 1_000 - this.lastSeconds
    const maxWallOffset =
      !this.expanded || this.limitNextPhaseStepToCollapsedInterval
        ? 0.1
        : Number.POSITIVE_INFINITY
    return Math.max(
      0,
      this.frameElapsed +
        (Number.isFinite(wallOffset) ? clamp(wallOffset, 0, maxWallOffset) : 0),
    )
  }

  setGazeTarget(
    target: GazeTarget | null,
    nowMs = (this.lastSeconds ?? 0) * 1_000,
    source?: GazeSource,
  ): void {
    const targetSource = target?.source ?? source ?? 'pointer'
    const pointerReleased = !target && source === 'pointer'
    if (target && targetSource === 'pointer' && !this.expanded) {
      // Low-cadence pointermove tasks can arrive after collapse has committed.
      // They cannot renew pointer ownership until the expanded hit area exists.
      return
    }
    if (target && targetSource === 'pointer') {
      const nextX = clamp(target.x, -1, 1)
      const nextY = clamp(target.y, -1, 1)
      const nextAttention = clamp(target.attention ?? 1, 0, 1)
      if (this.pointerRecenterActive) {
        this.writePendingPointerTarget(nextX, nextY, nextAttention)
        return
      }
      if (this.idleGlanceIsActive(nowMs / 1_000)) {
        this.beginPointerRecenter(nextX, nextY, nextAttention, nowMs / 1_000)
        return
      }
    } else if (!target && source === 'pointer' && this.pointerRecenterActive) {
      this.pointerRecenterHasTarget = false
      this.pointerRecenterTarget.x = 0
      this.pointerRecenterTarget.y = 0
      this.pointerRecenterTarget.attention = 0
      delete this.gazeTargets.pointer
      return
    } else if (!target && !source && this.pointerRecenterActive) {
      this.cancelPointerRecenter()
    }

    const previousTarget = this.gazeTarget
    const hadTarget = previousTarget !== null
    const previousSource = previousTarget?.source
    const previousX = previousTarget?.x ?? 0
    const previousY = previousTarget?.y ?? 0
    if (target) {
      this.gazeTargets[targetSource] = writeGazeTargetInto(
        this.gazeTargetBuffer(targetSource),
        target.x,
        target.y,
        target.attention ?? 1,
        targetSource,
      )
    } else if (source) {
      delete this.gazeTargets[source]
    } else {
      for (const targetSource of GAZE_SOURCE_PRIORITY) {
        delete this.gazeTargets[targetSource]
      }
    }
    const nextTarget = this.highestPriorityGazeTarget()
    const nextX = nextTarget?.x ?? 0
    const nextY = nextTarget?.y ?? 0
    const turnDistance = Math.hypot(nextX - this.gazeX, nextY - this.gazeY)
    const retargetDistance = hadTarget
      ? Math.hypot(nextX - previousX, nextY - previousY)
      : turnDistance
    this.gazeTarget = nextTarget
    if (pointerReleased && !nextTarget && !this.pointerRecenterActive) {
      // Pointer ownership may span longer than the ambient glance deadline it
      // interrupted. Anchor a complete new quiet interval at release so the
      // neutral gaze return cannot immediately be replaced by another glance.
      this.restartIdleGlanceQuietInterval(nowMs / 1_000)
    }
    if (nextTarget) {
      if (
        this.expanded &&
        nextTarget.source === 'pointer' &&
        previousSource !== 'pointer'
      ) {
        this.commitExpansionHeadPresentation(nowMs / 1_000)
      }
      // A meaningful retarget is a fresh look, even when the pointer never
      // left the portrait. A source handoff also restarts the lead while the
      // existing followers preserve pose continuity across arbitration.
      if (
        !hadTarget ||
        previousSource !== nextTarget.source ||
        retargetDistance > 0.16
      ) {
        this.gazeAcquiredAt = nowMs / 1_000
      }
      if (hadTarget && previousSource !== nextTarget.source) {
        this.gazeSourceHandoffStartedAt = nowMs / 1_000
      }
      this.gazeReleaseStartedAt = -Infinity
      if (turnDistance > 0.08) {
        this.deferBlinksUntil(
          this.elapsedAt(nowMs) + 0.34 + Math.min(0.24, turnDistance * 0.12),
        )
      }
    } else if (hadTarget) {
      // Use the input timestamp rather than the previous rendered frame. This
      // matters after collapsed 10 FPS sampling: otherwise up to 100 ms of the
      // eye-first return can disappear before the next frame is drawn.
      this.gazeReleaseStartedAt = nowMs / 1_000
      if (turnDistance > 0.08) {
        this.deferBlinksUntil(
          this.elapsedAt(nowMs) + 0.44 + Math.min(0.22, turnDistance * 0.1),
        )
      }
    }
  }

  private highestPriorityGazeTarget(): GazeTarget | null {
    for (const source of GAZE_SOURCE_PRIORITY) {
      const target = this.gazeTargets[source]
      if (target) return target
    }
    return null
  }

  private expansionHeadPresentationWeight(nowSeconds: number): number {
    if (!Number.isFinite(this.expansionGazeStartedAt)) return 1
    return smootherstep(
      clamp(
        (nowSeconds -
          this.expansionGazeStartedAt -
          EXPANSION_GAZE_HEAD_LEAD_SECONDS) /
          EXPANSION_GAZE_HEAD_SETTLE_SECONDS,
        0,
        1,
      ),
    )
  }

  private commitExpansionHeadPresentation(nowSeconds: number): void {
    if (!Number.isFinite(this.expansionGazeStartedAt)) return
    const presentationWeight = this.expansionHeadPresentationWeight(nowSeconds)
    this.headGazeX *= presentationWeight
    this.headGazeY *= presentationWeight
    this.expansionGazeStartedAt = -Infinity
  }

  private gazeTargetBuffer(source: GazeSource): GazeTarget {
    if (source === 'pointer') return this.pointerGazeTarget
    if (source === 'performance') return this.performanceGazeTarget
    return this.cameraGazeTarget
  }

  private writePendingPointerTarget(
    x: number,
    y: number,
    attention: number,
  ): void {
    this.pointerRecenterTarget.x = x
    this.pointerRecenterTarget.y = y
    this.pointerRecenterTarget.attention = attention
    this.pointerRecenterHasTarget = true
  }

  private beginPointerRecenter(
    x: number,
    y: number,
    attention: number,
    nowSeconds: number,
  ): void {
    const glanceDistance = Math.max(
      Math.abs(this.idleGlanceX),
      Math.abs(this.gazeX),
      Math.abs(this.headGazeX),
    )
    this.writePendingPointerTarget(x, y, attention)
    this.pointerRecenterActive = true
    this.pointerRecenterUntil =
      nowSeconds +
      POINTER_GLANCE_RECENTER_BASE_SECONDS +
      Math.min(0.14, glanceDistance * POINTER_GLANCE_RECENTER_DISTANCE_SECONDS)
    delete this.gazeTargets.pointer
    this.gazeTarget = this.highestPriorityGazeTarget()
    this.gazeReleaseStartedAt = nowSeconds - GAZE_HEAD_RELEASE_LEAD_SECONDS
    this.resetIdleGlance()
    this.deferBlinksUntil(
      this.elapsedAt(this.pointerRecenterUntil * 1_000) +
        HEAD_TURN_BLINK_SETTLE_SECONDS,
    )
  }

  private advancePointerRecenter(nowSeconds: number): void {
    if (!this.pointerRecenterActive || nowSeconds < this.pointerRecenterUntil) {
      return
    }
    this.pointerRecenterActive = false
    if (!this.pointerRecenterHasTarget) return
    this.pointerRecenterHasTarget = false
    this.gazeTargets.pointer = writeGazeTargetInto(
      this.pointerGazeTarget,
      this.pointerRecenterTarget.x,
      this.pointerRecenterTarget.y,
      this.pointerRecenterTarget.attention ?? 1,
      'pointer',
    )
    this.gazeTarget = this.highestPriorityGazeTarget()
    this.gazeAcquiredAt = nowSeconds
    this.gazeReleaseStartedAt = -Infinity
  }

  private cancelPointerRecenter(): void {
    this.pointerRecenterActive = false
    this.pointerRecenterHasTarget = false
    this.pointerRecenterUntil = -Infinity
    this.pointerRecenterTarget.x = 0
    this.pointerRecenterTarget.y = 0
    this.pointerRecenterTarget.attention = 0
    delete this.gazeTargets.pointer
    this.gazeTarget = this.highestPriorityGazeTarget()
  }

  releaseGazeWithBlink(nowMs: number, source?: GazeSource): void {
    this.setGazeTarget(null, nowMs, source)
    // A lower-priority source is still live. Handing back to it is a retarget,
    // not a release, so it must not schedule a covering blink.
    if (this.gazeTarget) return
    const nowSeconds = nowMs / 1_000
    this.gazeReleaseStartedAt = nowSeconds
    // During speech the eye release still leads the head, but the covering
    // blink waits for the post-speech beat so it cannot fight a viseme frame.
    if (this.speechActive) return
    const elapsed = this.elapsedAt(nowMs)
    const lowEnergy = 1 - unit(this.characterState.energy)
    const duration = this.blinkDurationSeconds() * (1.08 + lowEnergy * 0.6)
    // The eyes begin returning before the head. Keep the covering blink queued
    // behind that turn so a closing lid never inherits a changing head basis.
    const candidateStart = Math.max(
      elapsed + 0.44,
      this.blinkBlockedUntil,
      this.speechBlinkBlockedUntilElapsed(),
    )
    const start = this.breathSeparatedBlinkStart(candidateStart, duration)
    this.deferBlinksUntil(start)
    const alreadyBlinking = this.blinkEvents.some(
      (event) =>
        event.start <= start + duration &&
        event.start + event.duration >= start,
    )
    if (alreadyBlinking) return
    this.blinkEvents.push({ start, duration })
    this.nextBlinkAt = Math.max(
      this.nextBlinkAt,
      start + duration + this.blinkInterval(),
    )
  }

  triggerImpulse(
    kind: string,
    priority = 0,
    nowMs = performance.now(),
    intensity = 1,
  ): void {
    const normalized = kind.toLowerCase()
    const base = normalized.includes('poke')
      ? 1
      : normalized.includes('notify')
        ? 0.82
        : normalized.includes('pat')
          ? 0.62
          : normalized.includes('gift')
            ? 0.72
            : 0.42
    this.eventStrength = clamp((base + priority / 500) * intensity, 0, 1.2)
    this.eventStartedAt = nowMs / 1000
    const random = this.random()
    this.eventDirection = normalized.includes('notify')
      ? -1
      : random < 0.5
        ? -1
        : 1
  }

  resetClock(nowMs: number): void {
    const now = nowMs / 1000
    this.lastSeconds = now
    this.limitNextPhaseStepToCollapsedInterval = false
    for (const spring of this.secondaryBones) {
      spring.velocity = 0
      spring.driverVelocity = 0
      spring.driverInitialized = false
      spring.headVelocity = 0
    }
    this.headFollowInitialized = false
    this.headAngularVelocity = 0
    this.headAngularInitialized = false
    this.blinkHeadInitialized = false
    this.secondaryWakeInitialized = false
    this.animeChestInitialized = false
    this.animeChestVelocity = 0
    this.animeHandwearInitialized = false
    this.animeHandwearPosition = 0
    this.animeHandwearVelocity = 0
  }

  signals(nowMs: number, activity: MotionActivity): Readonly<MotionSignals> {
    this.evaluateSignals(nowMs, activity)
    return this.signalsValue
  }

  debugSignals(): Readonly<MotionDebugSignals> {
    return this.debugSignalsValue
  }

  nextBlinkPeakDelayMs(nowMs: number, horizonMs = 100): number | null {
    const elapsed = this.elapsedAt(nowMs)
    const horizonSeconds = Math.max(0, horizonMs) / 1_000
    let earliestDelay = Number.POSITIVE_INFINITY
    for (const event of this.blinkEvents) {
      const peak = event.start + event.duration * 0.5
      const delay = peak - elapsed
      if (delay <= 0.001 || delay >= earliestDelay || delay > horizonSeconds) {
        continue
      }
      if (this.blinkAmount(peak) <= 0) continue
      earliestDelay = delay
    }
    return Number.isFinite(earliestDelay)
      ? Math.max(1, Math.round(earliestDelay * 1_000))
      : null
  }

  blinkActiveAt(nowMs: number): boolean {
    return this.blinkAmount(this.elapsedAt(nowMs)) > 0
  }

  applyInto(
    pose: RigTransform[],
    nowMs: number,
    activity: MotionActivity,
    oneShotMask?: readonly boolean[],
    oneShotPriorities?: readonly number[],
    idleLocked = false,
  ): RigTransform[] {
    this.advanceTime(nowMs)
    if (!this.frameSampleAccepted) return pose
    const elapsed = this.frameElapsed
    const delta = this.frameDelta
    const phaseDelta = this.framePhaseDelta
    if (idleLocked && !this.previousIdleLocked) {
      this.resetIdleGlance(false)
    }
    if (this.previousIdleLocked && !idleLocked) {
      this.wakeFidgetUntil = Math.max(
        this.wakeFidgetUntil,
        nowMs / 1_000 + WAKE_FIDGET_SETTLE_MS / 1_000,
      )
      // A glance may have become due while the greeting owned the head. Start
      // a complete quiet interval at release instead of revealing that hidden
      // turn as soon as the authored layer yields.
      this.resetIdleGlance(false)
    }
    this.previousIdleLocked = idleLocked
    const signals = this.evaluateSignalsAt(
      nowMs,
      activity,
      elapsed,
      delta,
      phaseDelta,
    )
    const targetActivityScale =
      activity === 'idle' ? 1 : activity === 'thinking' ? 0.72 : 0.48
    const activityFollow =
      delta <= 0
        ? 1
        : 1 - Math.exp(-delta * (activity === 'talking' ? 12.5 : 9.5))
    this.currentActivityScale +=
      (targetActivityScale - this.currentActivityScale) * activityFollow
    const idleFollow = delta <= 0 ? 1 : 1 - Math.exp(-delta * 8.2)
    this.currentIdleWeight +=
      ((activity === 'idle' ? 1 : 0) - this.currentIdleWeight) * idleFollow
    const activityScale = this.currentActivityScale
    const ambientMotionScale = this.expanded ? 1 : 0
    const breathSpeechActive = activity === 'talking' || this.speechActive
    if (!breathSpeechActive && this.breathSpeechActive) {
      const existingReleaseAge = nowMs - this.speechReleaseStartedAt
      if (
        !Number.isFinite(existingReleaseAge) ||
        existingReleaseAge < 0 ||
        existingReleaseAge > SPEECH_BREATH_RECOVERY_MS
      ) {
        this.speechReleaseStartedAt = nowMs
        this.speechReleaseBreathScale = this.currentBreathAmplitudeScale
      }
    }
    const breathReleaseAge = nowMs - this.speechReleaseStartedAt
    this.currentBreathAmplitudeScale = breathSpeechActive
      ? speechBreathAmplitudeScale(
          this.currentBreathAmplitudeScale,
          true,
          Math.min(phaseDelta, SPEECH_BREATH_RECOVERY_MS / 1_000),
        )
      : breathReleaseAge >= 0 && breathReleaseAge <= SPEECH_BREATH_RECOVERY_MS
        ? speechBreathReleaseScale(
            this.speechReleaseBreathScale,
            breathReleaseAge,
          )
        : speechBreathAmplitudeScale(
            this.currentBreathAmplitudeScale,
            false,
            Math.min(phaseDelta, SPEECH_BREATH_RECOVERY_MS / 1_000),
          )
    this.breathSpeechActive = breathSpeechActive
    const breathAmplitudeScale =
      this.currentBreathAmplitudeScale *
      (activity === 'thinking' ? activityScale : 1)
    const energy = this.currentEnergy
    const restWeight = signals.restWeight * this.currentIdleWeight
    const restStillness = this.currentRestStillness * this.currentIdleWeight
    const restMotionScale = 1 - restStillness
    const chestBreathScale = chestBreathAmplitudeScale(
      breathAmplitudeScale,
      Math.max(restWeight, restStillness),
    )
    this.debugSignalsValue.restStillness = restStillness
    this.debugSignalsValue.breathAmplitudeScale = breathAmplitudeScale
    this.debugSignalsValue.locksIdle = idleLocked
    const shoulderMacroAllowed = idleLockAllowsShoulderMacro(
      this.expanded,
      idleLocked,
      restStillness,
    )
    const idleGlanceOwnsAttention = this.idleGlanceIsActive(nowMs / 1_000)
    this.currentShoulderMacroWeight = boundedStateFollow(
      this.currentShoulderMacroWeight,
      shoulderMacroAllowed ? 1 : 0,
      delta,
      shoulderMacroAllowed ? 4.2 : 13,
    )
    const idleGlanceMacroTarget = idleGlanceOwnsAttention
      ? IDLE_GLANCE_SHOULDER_WEIGHT
      : 1
    this.currentIdleGlanceMacroWeight = boundedStateFollow(
      this.currentIdleGlanceMacroWeight,
      idleGlanceMacroTarget,
      delta,
      idleGlanceMacroTarget < this.currentIdleGlanceMacroWeight ? 20 : 2.6,
    )
    const shoulderMacroScale = shoulderMacroAllowed
      ? this.currentShoulderMacroWeight *
        this.currentIdleGlanceMacroWeight *
        restWakeAmplitudeScale(restStillness)
      : 0
    const breathWeightShiftPhaseScale = shoulderWeightShiftPhaseScale(
      signals.breath,
    )
    const idleGlanceWeightShiftScale =
      this.currentIdleGlanceMacroWeight * breathWeightShiftPhaseScale
    const lowEnergyWeight =
      smootherstep(clamp((0.54 - energy) / 0.54, 0, 1)) * this.currentIdleWeight
    const boredom = this.currentBoredom
    let bodyMotionX = 0
    let bodyMotionY = 0
    let bodyMotionRotation = 0
    let bodyMotionScaleX = 1
    let bodyMotionScaleY = 1

    if (this.bodyIndex >= 0) {
      const body = pose[this.bodyIndex]
      const sway =
        signals.weightShift *
        (0.0025 + boredom * 0.0028) *
        activityScale *
        lerp(1, 0.42, restWeight) *
        restMotionScale *
        ambientMotionScale *
        idleGlanceWeightShiftScale
      // Fatigue is expressed as weight, not simply slower timing: the torso
      // settles lower and spends longer off-centre. The breathing term keeps
      // the low pose from looking frozen.
      bodyMotionX =
        signals.weightShift *
        (0.0014 + lowEnergyWeight * 0.0038) *
        activityScale *
        restMotionScale *
        ambientMotionScale *
        idleGlanceWeightShiftScale
      bodyMotionY =
        -signals.breath * this.profile.breath.amplitude * chestBreathScale -
        this.currentStyle.expansion * 0.0018 +
        lowEnergyWeight * (0.0062 + (1 - signals.breath) * 0.0011)
      bodyMotionRotation =
        sway +
        lowEnergyWeight *
          (0.0065 +
            signals.weightShift *
              0.0035 *
              restMotionScale *
              ambientMotionScale *
              idleGlanceWeightShiftScale) +
        signals.eventImpulse *
          this.eventDirection *
          0.014 *
          restMotionScale *
          ambientMotionScale
      body.translation.x += bodyMotionX
      body.translation.y += bodyMotionY
      body.rotation += bodyMotionRotation
      bodyMotionScaleX = 1 + this.currentStyle.expansion * 0.0022
      bodyMotionScaleY = 1 + signals.breath * 0.0021 * chestBreathScale
      body.scale.x *= bodyMotionScaleX
      body.scale.y *= bodyMotionScaleY
    }

    if (this.headIndex >= 0) {
      const head = pose[this.headIndex]
      const focusScale = 1.15 - this.currentStyle.spatialFocus * 0.35
      const bodyDriverX =
        this.bodyIndex >= 0 ? pose[this.bodyIndex].translation.x : 0
      const bodyDriverY =
        this.bodyIndex >= 0 ? pose[this.bodyIndex].translation.y : 0
      const bodyDriverRotation =
        this.bodyIndex >= 0 ? pose[this.bodyIndex].rotation : 0
      if (!this.headFollowInitialized || delta <= 0) {
        this.headFollowX = bodyDriverX
        this.headFollowY = bodyDriverY
        this.headFollowRotation = bodyDriverRotation
        this.headFollowInitialized = true
      } else {
        const followRate = lerp(13.5, 3.15, lowEnergyWeight)
        const follow = 1 - Math.exp(-delta * followRate)
        this.headFollowX += (bodyDriverX - this.headFollowX) * follow
        this.headFollowY += (bodyDriverY - this.headFollowY) * follow
        this.headFollowRotation +=
          (bodyDriverRotation - this.headFollowRotation) * follow
      }
      // Counter-transform the body's newest movement so the head arrives a
      // fraction later. Keeping some inherited motion preserves the neck
      // connection instead of producing a floating, mechanically isolated head.
      head.translation.x +=
        (this.headFollowX - bodyDriverX) * lowEnergyWeight * 0.82
      head.translation.y +=
        (this.headFollowY - bodyDriverY) * lowEnergyWeight * 0.58
      head.rotation +=
        (this.headFollowRotation - bodyDriverRotation) * lowEnergyWeight * 0.76
      head.translation.x +=
        signals.gazeWander *
        0.0024 *
        activityScale *
        focusScale *
        lerp(1, 0.3, restWeight) *
        restMotionScale *
        ambientMotionScale
      head.translation.y +=
        signals.breath *
        0.0012 *
        breathAmplitudeScale *
        lerp(1, 0.38, restWeight)
      // The macro layer is intentionally much slower than the authored idle
      // loop. It gives the head a changing resting bias instead of repeating
      // the same nod on every short clip cycle.
      head.translation.y +=
        lowEnergyWeight *
        (0.0044 + signals.idleAccent * 0.0014 * restMotionScale)
      head.rotation +=
        (signals.gazeWander *
          (0.006 + boredom * 0.005) *
          activityScale *
          focusScale *
          lerp(1, 0.3, restWeight) -
          signals.speechImpulse * 0.026 * this.currentStyle.force +
          signals.eventImpulse * this.eventDirection * 0.04) *
        restMotionScale *
        ambientMotionScale
      head.rotation +=
        (signals.headDrift * (0.004 + boredom * 0.0045) +
          signals.idleAccent * 0.006 * Math.sign(signals.headDrift || 1) +
          lowEnergyWeight *
            (0.013 +
              signals.weightShift * 0.006 * breathWeightShiftPhaseScale)) *
        this.currentIdleWeight *
        restMotionScale *
        ambientMotionScale
    }

    this.applyGaze(
      pose,
      nowMs / 1_000,
      delta,
      signals,
      restWeight,
      restStillness,
      oneShotMask,
      oneShotPriorities,
    )

    this.updateHeadTurnBlinkGate(pose, elapsed, delta)
    const blink = this.blinkAmount(elapsed)
    this.debugSignalsValue.blinkClosure = blink
    this.updateBlinkSafetyDebug(elapsed)
    if (blink > 0) {
      for (let order = 0; order < this.eyeIndexes.length; order += 1) {
        const index = this.eyeIndexes[order]
        const eye = pose[index]
        eye.translation.y += blink * 0.002
        eye.scale.y *= Math.max(0.06, 1 - blink * 0.94)
      }
    }

    const speechReleaseAge = nowMs - this.speechReleaseStartedAt
    const releasingSpeechMouth =
      speechReleaseAge >= 0 && speechReleaseAge <= SPEECH_MOUTH_CLOSE_HOLD_MS
    if (
      this.mouthIndex >= 0 &&
      (releasingSpeechMouth || !oneShotMask?.[this.mouthIndex])
    ) {
      const mouth = pose[this.mouthIndex]
      if (releasingSpeechMouth) {
        // A collapse can turn the last composed frame into a releasing
        // one-shot snapshot whose face mask outlives the 150 ms viseme close.
        // Speech already owns the live mouth; retain that ownership through
        // release so collapsed 10 FPS samples cannot hold a half-open shape.
        const releaseWeight = speechMouthReleaseWeight(speechReleaseAge)
        const shape = mouthShape(this.speechReleaseViseme)
        mouth.scale.y = lerp(
          1,
          shape.scaleY + this.speechReleaseEnergy * shape.energyY,
          releaseWeight,
        )
        mouth.scale.x = lerp(
          1,
          mouthShapeScaleX(
            shape,
            this.speechReleaseViseme,
            this.speechReleaseAmount,
          ) +
            this.speechReleaseEnergy * shape.energyX,
          releaseWeight,
        )
        mouth.translation.x =
          shape.translationX * this.speechReleaseAmount * releaseWeight
        mouth.translation.y =
          shape.translationY * this.speechReleaseAmount * releaseWeight
        mouth.rotation =
          shape.rotation * this.speechReleaseAmount * releaseWeight
      } else if (activity === 'talking' || this.speechActive) {
        const articulation = this.speechVisemeAmount
        const shape = mouthShape(this.speechViseme)
        const targetScaleY = shape.scaleY + signals.speechEnergy * shape.energyY
        const targetScaleX =
          mouthShapeScaleX(shape, this.speechViseme, articulation) +
          signals.speechEnergy * shape.energyX
        // Speech owns the mouth independently of the body wake gate. A deeply
        // resting character can lift its torso and shoulders gradually while
        // the first audible syllable still receives its full viseme shape.
        mouth.scale.y += (targetScaleY - mouth.scale.y) * 0.86
        mouth.scale.x += (targetScaleX - mouth.scale.x) * 0.72
        mouth.translation.x += shape.translationX * articulation
        mouth.translation.y += shape.translationY * articulation
        mouth.rotation += shape.rotation * articulation
      }
    }

    this.applyIdleMicroExpression(
      pose,
      activity,
      delta,
      signals,
      restStillness,
      oneShotMask,
    )

    this.applySecondaryMotion(
      pose,
      delta,
      signals,
      lowEnergyWeight,
      restStillness,
    )
    const animeChestTarget =
      signals.breath * this.profile.breath.amplitude * chestBreathScale * 0.72 -
      this.headGazeY * 0.0018 * restMotionScale * ambientMotionScale
    const animeChestBounce = this.updateAnimeChestBounce(
      animeChestTarget,
      delta,
    )
    const animeHandwearSway = this.updateAnimeHandwearSway(
      (signals.weightShift * 0.68 +
        signals.shoulderDrift * 0.16 +
        signals.idleAccent * 0.2 -
        this.headGazeX * this.headGazeAttention * 0.12) *
        shoulderMacroScale *
        breathWeightShiftPhaseScale *
        lerp(1, 0.025, restWeight),
      delta,
    )
    applyAnime25DMotionInto(pose, this.anime25dIndex, {
      headTurnX: this.headGazeX * this.headGazeAttention,
      headTurnY: this.headGazeY * this.headGazeAttention,
      breath: signals.breath,
      breathAmplitude: this.profile.breath.amplitude * chestBreathScale,
      weightShift: signals.weightShift,
      idleAccent: signals.idleAccent,
      chestBounce: animeChestBounce,
      handwearSway: animeHandwearSway,
      ambientScale: restMotionScale * ambientMotionScale,
    })
    constrainPose(pose)
    return pose
  }

  private applyGaze(
    pose: RigTransform[],
    nowSeconds: number,
    delta: number,
    signals: MotionSignals,
    restWeight: number,
    restStillness: number,
    oneShotMask?: readonly boolean[],
    oneShotPriorities?: readonly number[],
  ): void {
    const recenteringPointer = this.pointerRecenterActive
    const targetAttention = recenteringPointer
      ? 0.26
      : (this.gazeTarget?.attention ?? 0.26)
    this.gazePresentationWeight = boundedStateFollow(
      this.gazePresentationWeight,
      1,
      delta,
      7.5,
    )
    const speechReleaseAgeMs = nowSeconds * 1_000 - this.speechReleaseStartedAt
    const gazeYieldsToSpeech =
      this.speechActive ||
      (speechReleaseAgeMs >= 0 && speechReleaseAgeMs < SPEECH_MOUTH_CLOSE_MS)
    const speechGazeTargetWeight =
      gazeYieldsToSpeech &&
      (this.gazeTarget?.source === 'pointer' ||
        this.gazeTarget?.source === 'camera')
        ? this.gazeTarget.source === 'camera'
          ? 0.36
          : 0.48
        : 1
    this.currentSpeechGazeWeight = boundedStateFollow(
      this.currentSpeechGazeWeight,
      speechGazeTargetWeight,
      delta,
      speechGazeTargetWeight < this.currentSpeechGazeWeight ? 13 : 4.6,
    )
    const wakeWeight = this.inputWakeWeight(nowSeconds * 1_000)
    const ambientScale = this.gazeTarget ? 1 : 1 - restStillness
    const targetX = recenteringPointer
      ? 0
      : (this.gazeTarget?.x ?? signals.gazeWander * 0.5 + signals.idleGlanceX) *
        ambientScale *
        (this.gazeTarget ? wakeWeight : 1)
    const targetY = recenteringPointer
      ? 0
      : (this.gazeTarget?.y ?? signals.fastNoise * 0.22 + signals.idleGlanceY) *
        ambientScale *
        (this.gazeTarget ? wakeWeight : 1)
    const headTargetX = recenteringPointer
      ? 0
      : this.gazeTarget
        ? this.gazeX
        : (signals.gazeWander * 0.5 +
            signals.idleGlanceX * this.idleGlanceHeadScale) *
          ambientScale
    const headTargetY = recenteringPointer
      ? 0
      : this.gazeTarget
        ? this.gazeY
        : (signals.fastNoise * 0.22 +
            signals.idleGlanceY * this.idleGlanceHeadScale) *
          ambientScale
    const gatedTargetAttention = this.gazeTarget
      ? lerp(0.2, targetAttention, wakeWeight)
      : targetAttention
    const restFollowScale =
      this.gazeTarget && !recenteringPointer
        ? lerp(1, 0.82, restWeight)
        : lerp(1, 0.3, restWeight)
    const sourceHandoffRateScale = gazeSourceHandoffRateScale(
      nowSeconds - this.gazeSourceHandoffStartedAt,
    )
    const eyeFollow =
      delta <= 0
        ? 1
        : 1 -
          Math.exp(
            -delta *
              (recenteringPointer ? 9.2 : 4.2 + targetAttention * 7.5) *
              restFollowScale *
              sourceHandoffRateScale,
          )
    this.gazeX += (targetX - this.gazeX) * eyeFollow
    this.gazeY += (targetY - this.gazeY) * eyeFollow
    this.gazeAttention +=
      (gatedTargetAttention - this.gazeAttention) *
      (delta <= 0 ? 1 : 1 - Math.exp(-delta * 10.5))

    const releaseAge = nowSeconds - this.gazeReleaseStartedAt
    const acquisitionAge = nowSeconds - this.gazeAcquiredAt
    // Eyes acknowledge attention first. The head begins only after that beat,
    // and on release it likewise waits while the eyes start returning.
    const headCanFollow = recenteringPointer
      ? true
      : this.gazeTarget
        ? acquisitionAge >= GAZE_HEAD_ACQUIRE_LEAD_SECONDS
        : releaseAge >= GAZE_HEAD_RELEASE_LEAD_SECONDS
    if (headCanFollow) {
      const headFollowRate = recenteringPointer
        ? 6.4
        : this.gazeTarget
          ? 5.4
          : 2.35
      const headFollow =
        delta <= 0
          ? 0
          : 1 - Math.exp(-delta * headFollowRate * sourceHandoffRateScale)
      this.headGazeX = boundedGazeHeadYawFollow(
        this.headGazeX,
        headTargetX,
        delta,
        headFollowRate,
        sourceHandoffRateScale,
      )
      this.headGazeY += (headTargetY - this.headGazeY) * headFollow
      this.headGazeAttention +=
        (this.gazeAttention - this.headGazeAttention) * headFollow
    }
    if (this.gazePresentationWeight <= 0) return
    const explicitGaze = this.gazeTarget !== null && !recenteringPointer
    this.currentHeadGazeIntentScale = boundedStateFollow(
      this.currentHeadGazeIntentScale,
      this.gazeTarget?.source === 'camera' ? 0.62 : 1,
      delta,
      8.5 * sourceHandoffRateScale,
    )
    const gazeOutputWeight =
      this.gazePresentationWeight * this.currentSpeechGazeWeight
    const expansionHeadWeight = this.expansionHeadPresentationWeight(nowSeconds)
    if (
      this.expanded &&
      this.headIndex >= 0 &&
      this.gazeCanOwnBone(
        this.headIndex,
        explicitGaze,
        oneShotMask,
        oneShotPriorities,
      )
    ) {
      const head = pose[this.headIndex]
      const headRestScale = this.gazeTarget
        ? lerp(1, 0.04, restStillness)
        : 1 - restStillness
      head.rotation +=
        this.headGazeX *
        (0.012 + this.headGazeAttention * 0.018) *
        headRestScale *
        this.currentHeadGazeIntentScale *
        expansionHeadWeight *
        gazeOutputWeight
      head.translation.x +=
        this.headGazeX *
        0.0018 *
        this.headGazeAttention *
        headRestScale *
        this.currentHeadGazeIntentScale *
        expansionHeadWeight *
        gazeOutputWeight
      head.translation.y +=
        this.headGazeY *
        0.0012 *
        this.headGazeAttention *
        headRestScale *
        this.currentHeadGazeIntentScale *
        expansionHeadWeight *
        gazeOutputWeight
    }
    for (let order = 0; order < this.eyeIndexes.length; order += 1) {
      const index = this.eyeIndexes[order]
      if (
        !this.gazeCanOwnBone(
          index,
          explicitGaze,
          oneShotMask,
          oneShotPriorities,
        )
      ) {
        continue
      }
      const eye = pose[index]
      eye.translation.x +=
        this.gazeX * (0.0028 + this.gazeAttention * 0.0036) * gazeOutputWeight
      eye.translation.y +=
        this.gazeY * (0.002 + this.gazeAttention * 0.0028) * gazeOutputWeight
    }
  }

  private gazeCanOwnBone(
    index: number,
    explicitGaze: boolean,
    oneShotMask?: readonly boolean[],
    oneShotPriorities?: readonly number[],
  ): boolean {
    return (
      !oneShotMask?.[index] ||
      (explicitGaze &&
        oneShotPriorities !== undefined &&
        pointerGazeOwnsBone(oneShotPriorities[index]))
    )
  }

  private applyIdleMicroExpression(
    pose: RigTransform[],
    activity: MotionActivity,
    delta: number,
    signals: MotionSignals,
    restStillness: number,
    oneShotMask?: readonly boolean[],
  ): void {
    if (!this.expanded) {
      this.currentMicroExpressionWeight = 0
      return
    }
    const targetWeight =
      activity === 'idle' && !this.speechActive
        ? lerp(0.58, 1, unit(this.characterState.mood)) * (1 - restStillness)
        : 0
    const followRate =
      targetWeight > this.currentMicroExpressionWeight ? 0.7 : 13
    const follow = delta <= 0 ? 0 : 1 - Math.exp(-delta * followRate)
    this.currentMicroExpressionWeight +=
      (targetWeight - this.currentMicroExpressionWeight) * follow

    const browAmount =
      signals.microBrow * this.currentMicroExpressionWeight * 0.00125
    for (let order = 0; order < this.browIndexes.length; order += 1) {
      const index = this.browIndexes[order]
      if (oneShotMask?.[index]) continue
      const brow = pose[index]
      const side = order % 2 === 0 ? -1 : 1
      brow.translation.y -= browAmount * 0.24
      brow.rotation += browAmount * side * 0.7
    }

    // A live or releasing viseme owns the mouth outright. Brows may begin to
    // settle independently, but mouth micro-expression weight is exactly zero
    // until the 150 ms return-to-neutral window has completed.
    if (
      activity !== 'idle' ||
      this.speechActive ||
      this.speechMouthReleaseActive((this.lastSeconds ?? 0) * 1_000) ||
      this.mouthIndex < 0 ||
      oneShotMask?.[this.mouthIndex]
    ) {
      return
    }
    const mouth = pose[this.mouthIndex]
    const idleGlanceOwnsAttention = this.idleGlanceIsActive(
      this.lastSeconds ?? 0,
    )
    const mouthCoordinationTarget = idleGlanceOwnsAttention
      ? IDLE_GLANCE_MOUTH_WEIGHT
      : 1
    this.currentIdleGlanceMouthWeight = boundedStateFollow(
      this.currentIdleGlanceMouthWeight,
      mouthCoordinationTarget,
      delta,
      mouthCoordinationTarget < this.currentIdleGlanceMouthWeight ? 18 : 3.8,
    )
    const mouthAmount =
      signals.microMouth *
      this.currentMicroExpressionWeight *
      this.currentIdleGlanceMouthWeight
    mouth.translation.y -= mouthAmount * 0.00032
    mouth.rotation += mouthAmount * 0.0011
    mouth.scale.x *= 1 + mouthAmount * 0.006
    mouth.scale.y *= 1 - Math.abs(mouthAmount) * 0.0025
  }

  private advanceTime(nowMs: number): void {
    const previous = this.lastSeconds
    const sampledNow = Number.isFinite(nowMs) ? nowMs / 1_000 : (previous ?? 0)
    // A cancelled timer or rAF callback may already be queued when scheduler
    // ownership changes. Reject that stale sample before it can rewind the
    // clock or rebase a spring/follower with delta=0; the next live owner must
    // be the only one that consumes the overlap.
    this.frameSampleAccepted = previous === null || sampledNow >= previous
    if (!this.frameSampleAccepted) {
      this.frameDelta = 0
      this.framePhaseDelta = 0
      return
    }
    const now = sampledNow
    this.lastSeconds = now
    const rawDelta = previous === null ? 0 : Math.max(0, now - previous)
    const wallDelta = Number.isFinite(rawDelta) ? rawDelta : 0
    const physicalDelta = clamp(wallDelta, 0, 0.1)
    // Every collapsed channel consumes the measured wall-clock interval. A
    // delayed 10 FPS callback may miss a slot, but one paint must never consume
    // more than one 100 ms slot: breath/blink phase and secondary springs then
    // advance together instead of the oscillators cutting ahead of the hair.
    const phaseDelta =
      !this.expanded || this.limitNextPhaseStepToCollapsedInterval
        ? physicalDelta
        : wallDelta
    this.frameElapsed += phaseDelta
    this.frameDelta = physicalDelta
    this.framePhaseDelta = phaseDelta
    this.limitNextPhaseStepToCollapsedInterval = false
  }

  private evaluateSignals(nowMs: number, activity: MotionActivity): void {
    this.advanceTime(nowMs)
    if (!this.frameSampleAccepted) return
    this.evaluateSignalsAt(
      nowMs,
      activity,
      this.frameElapsed,
      this.frameDelta,
      this.framePhaseDelta,
    )
  }

  private evaluateSignalsAt(
    nowMs: number,
    activity: MotionActivity,
    elapsed: number,
    delta: number,
    phaseDelta: number,
  ): MotionSignals {
    const nowSeconds = nowMs / 1_000
    // State can jump from a server tick (for example 95 -> 5 energy). Keep
    // those controls monotonic and non-oscillatory before they reach posture
    // amplitudes or secondary springs. Falling energy settles a little faster
    // than recovery; boredom remains deliberately slower than either.
    const targetEnergy = unit(this.characterState.energy)
    const targetBoredom = unit(this.characterState.boredom)
    this.currentEnergy = boundedStateFollow(
      this.currentEnergy,
      targetEnergy,
      delta,
      targetEnergy < this.currentEnergy ? 3.8 : 2.1,
    )
    this.currentBoredom = boundedStateFollow(
      this.currentBoredom,
      targetBoredom,
      delta,
      targetBoredom > this.currentBoredom ? 2.6 : 1.9,
    )
    const styleMix = delta <= 0 ? 1 : 1 - Math.exp(-delta * 3.2)
    mixStyleInto(this.currentStyle, this.targetStyle, styleMix)
    const energy = this.currentEnergy
    const energyRestWeight = restWeightFromEnergy(energy)
    if (this.idleBehaviorMode !== 'rest') {
      this.restExitEnvelope = boundedStateFollow(
        this.restExitEnvelope,
        0,
        delta,
        0.28,
      )
    }
    const targetRestWeight =
      activity === 'idle'
        ? nowSeconds < this.wakeHoldUntil
          ? 0
          : this.idleBehaviorMode === null
            ? smootherstep(clamp((0.46 - energy) / 0.36, 0, 1))
            : this.idleBehaviorMode === 'rest'
              ? energyRestWeight
              : Math.min(energyRestWeight, this.restExitEnvelope)
        : 0
    const restFollowRate =
      targetRestWeight > this.currentRestWeight
        ? 1.8
        : nowSeconds < this.wakeHoldUntil
          ? 1.65
          : 0.42
    const restFollow = delta <= 0 ? 1 : 1 - Math.exp(-delta * restFollowRate)
    this.currentRestWeight +=
      (targetRestWeight - this.currentRestWeight) * restFollow
    this.signalsValue.restWeight = this.currentRestWeight
    const targetRestStillness =
      activity === 'idle' &&
      this.idleBehaviorMode === 'rest' &&
      nowSeconds >= this.wakeHoldUntil
        ? 1
        : 0
    const stillnessFollow =
      delta <= 0
        ? 1
        : 1 -
          Math.exp(
            -delta *
              (targetRestStillness > this.currentRestStillness ? 1.8 : 1.65),
          )
    this.currentRestStillness +=
      (targetRestStillness - this.currentRestStillness) * stillnessFollow
    if (this.currentRestStillness > 0.995) this.currentRestStillness = 1
    const idleTempo = lerp(0.64, 1, energy)
    const secondaryRateScale = restPhaseRateScale(
      this.currentRestStillness,
      0.12,
    )
    const macroRateScale = restPhaseRateScale(this.currentRestStillness, 0.08)
    const breathFrequency = lerp(
      this.profile.breath.minFrequencyHz,
      this.profile.breath.maxFrequencyHz,
      energy,
    )
    this.currentBreathFrequencyHz = breathFrequency
    // Integrating each clock keeps the phase continuous when energy changes.
    // A hidden-tab reset produces delta=0, so it also cannot jump these clocks.
    this.breathClock += phaseDelta * breathFrequency
    this.slowClock += phaseDelta * idleTempo
    this.fastClock += phaseDelta * idleTempo
    this.weightClock += phaseDelta * idleTempo
    this.gazeClock += phaseDelta * idleTempo
    this.secondaryClock += phaseDelta * idleTempo * secondaryRateScale
    this.macroClock += phaseDelta * lerp(0.72, 1, energy) * macroRateScale
    this.signalsValue.breath = Math.sin(this.breathClock * TWO_PI + this.phaseA)
    this.signalsValue.slowNoise =
      Math.sin(this.slowClock * TWO_PI * 0.071 + this.phaseA) * 0.62 +
      Math.sin(this.slowClock * TWO_PI * 0.113 + this.phaseB) * 0.38
    this.signalsValue.fastNoise =
      Math.sin(this.fastClock * TWO_PI * 0.19 + this.phaseB) * 0.68 +
      Math.sin(this.fastClock * TWO_PI * 0.31 + this.phaseA * 0.7) * 0.32
    this.signalsValue.weightShift =
      Math.sin(this.weightClock * TWO_PI * 0.058 + this.weightPhase) * 0.7 +
      Math.sin(this.weightClock * TWO_PI * 0.097 + this.phaseB * 0.8) * 0.3
    this.signalsValue.gazeWander =
      Math.sin(this.gazeClock * TWO_PI * 0.083 + this.gazePhase) * 0.74 +
      Math.sin(this.gazeClock * TWO_PI * 0.137 + this.phaseA * 0.55) * 0.26
    this.signalsValue.secondaryDrift =
      Math.sin(this.secondaryClock * TWO_PI * 0.127 + this.secondaryPhase) *
        0.66 +
      Math.sin(this.secondaryClock * TWO_PI * 0.181 + this.weightPhase * 0.6) *
        0.34
    this.signalsValue.shoulderDrift =
      Math.sin(this.macroClock * TWO_PI * (1 / 37) + this.shoulderPhase) *
        0.68 +
      Math.sin(this.macroClock * TWO_PI * (1 / 61) + this.phaseA) * 0.32
    this.signalsValue.headDrift =
      Math.sin(this.macroClock * TWO_PI * (1 / 53) + this.headPhase) * 0.72 +
      Math.sin(this.macroClock * TWO_PI * (1 / 31) + this.gazePhase * 0.8) *
        0.28
    const accentCarrier = Math.sin(
      this.macroClock * TWO_PI * (1 / 43) + this.accentPhase,
    )
    this.signalsValue.idleAccent =
      smootherstep(clamp((accentCarrier - 0.68) / 0.32, 0, 1)) *
      Math.tanh(this.signalsValue.shoulderDrift * 2.4)
    this.signalsValue.microBrow =
      Math.sin(this.macroClock * TWO_PI * (1 / 17) + this.headPhase * 0.74) *
        0.72 +
      Math.sin(this.macroClock * TWO_PI * (1 / 29) + this.phaseB * 0.63) * 0.28
    this.signalsValue.microMouth =
      Math.sin(this.macroClock * TWO_PI * (1 / 19) + this.accentPhase * 0.52) *
        0.68 +
      Math.sin(this.macroClock * TWO_PI * (1 / 31) + this.weightPhase * 0.71) *
        0.32
    this.advancePointerRecenter(nowSeconds)
    this.updateIdleGlance(nowSeconds, activity)
    this.debugSignalsValue.idleGlance.x = this.signalsValue.idleGlanceX
    this.debugSignalsValue.idleGlance.y = this.signalsValue.idleGlanceY
    this.debugSignalsValue.gazeSource =
      this.gazeTarget?.source ??
      (Math.abs(this.signalsValue.idleGlanceX) > 0.0001 ||
      Math.abs(this.signalsValue.idleGlanceY) > 0.0001
        ? 'idle-glance'
        : 'ambient')

    const hasExternalSpeech =
      this.externalSpeechEnergy !== null &&
      nowSeconds - this.externalSpeechUpdatedAt <= 0.24
    const speechEnergy =
      activity !== 'talking'
        ? 0
        : hasExternalSpeech
          ? this.externalSpeechEnergy || 0
          : syntheticSpeechEnergy(elapsed, this.currentStyle.tempo)
    this.signalsValue.speechEnergy = speechEnergy
    this.signalsValue.speechImpulse = Math.max(
      0,
      speechEnergy - this.previousSpeechEnergy - delta * 0.12,
    )
    this.previousSpeechEnergy = speechEnergy
    this.signalsValue.eventImpulse =
      this.eventStrength *
      Math.exp(-Math.max(0, nowSeconds - this.eventStartedAt) / 0.32)

    this.scheduleBlinks(elapsed, activity === 'talking' && this.speechActive)
    this.debugSignalsValue.blinkClosure = this.blinkAmount(elapsed)
    this.updateBlinkSafetyDebug(elapsed)
    return this.signalsValue
  }

  private updateIdleGlance(nowSeconds: number, activity: MotionActivity): void {
    const enabled =
      this.expanded &&
      activity === 'idle' &&
      this.idleBehaviorMode !== 'rest' &&
      !this.previousIdleLocked &&
      !this.ambientFidgetActive &&
      !this.speechActive &&
      !this.pointerRecenterActive &&
      this.gazeTarget === null
    if (!enabled) {
      this.resetIdleGlance()
      return
    }
    this.idleGlanceStateClear = false
    if (!Number.isFinite(this.idleGlanceIdleSince)) {
      this.idleGlanceIdleSince = nowSeconds
    }
    if (!Number.isFinite(this.idleGlanceNextAt)) {
      this.idleGlanceNextAt =
        nowSeconds + this.nextIdleGlanceDelaySeconds(nowSeconds)
    }
    let guard = 0
    while (nowSeconds >= this.idleGlanceNextAt && guard < 16) {
      let activeBlink: BlinkEvent | null = null
      for (let index = 0; index < this.blinkEvents.length; index += 1) {
        const event = this.blinkEvents[index]
        if (
          this.frameElapsed >= event.start &&
          this.frameElapsed <= event.start + event.duration
        ) {
          activeBlink = event
          break
        }
      }
      if (activeBlink) {
        // A glance never launches underneath a closing lid. Preserve the due
        // intent, but wait for the current blink to reopen and settle first.
        this.idleGlanceNextAt =
          nowSeconds +
          (activeBlink.start + activeBlink.duration - this.frameElapsed) +
          IDLE_GLANCE_SETTLE_SECONDS
        break
      }
      this.idleGlanceStartedAt = this.idleGlanceNextAt
      const glanceStyle = idleGazeGlanceStyle(this.currentEnergy * 100)
      const sampledDirection: -1 | 1 = this.nextIdleGazeUnit() < 0.5 ? -1 : 1
      const direction: -1 | 1 =
        this.idleGlanceLastDirection === 0
          ? sampledDirection
          : this.idleGlanceLastDirection === -1
            ? 1
            : -1
      this.idleGlanceLastDirection = direction
      this.idleGlanceX =
        direction *
        lerp(0.18, 0.32, this.nextIdleGazeUnit()) *
        glanceStyle.amplitudeScale
      this.idleGlanceY =
        lerp(-0.12, -0.04, this.nextIdleGazeUnit()) * glanceStyle.amplitudeScale
      this.idleGlanceAcquireDuration =
        IDLE_GLANCE_ACQUIRE_SECONDS / glanceStyle.tempoScale
      this.idleGlanceReturnDuration =
        IDLE_GLANCE_RETURN_SECONDS / glanceStyle.tempoScale
      this.idleGlanceHeadScale = glanceStyle.headScale
      const lowEnergy = 1 - unit(this.characterState.energy)
      const blinkDuration =
        this.blinkDurationSeconds() * (0.82 + lowEnergy * 0.24)
      const settledHold = lerp(0.08, 0.2, this.nextIdleGazeUnit())
      this.idleGlanceDuration =
        this.idleGlanceAcquireDuration +
        IDLE_GLANCE_SETTLE_SECONDS +
        blinkDuration +
        IDLE_GLANCE_POST_BLINK_HOLD_SECONDS +
        settledHold +
        this.idleGlanceReturnDuration
      this.queueIdleGlanceBlink(nowSeconds)
      this.idleGlanceNextAt =
        this.idleGlanceStartedAt +
        this.nextIdleGlanceDelaySeconds(this.idleGlanceStartedAt)
      guard += 1
    }
    if (nowSeconds >= this.idleGlanceNextAt) {
      this.idleGlanceNextAt =
        nowSeconds + this.nextIdleGlanceDelaySeconds(nowSeconds)
    }
    const age = nowSeconds - this.idleGlanceStartedAt
    const returnStartedAt =
      this.idleGlanceDuration - this.idleGlanceReturnDuration
    const returnWeight = smootherstep(
      clamp(
        (age - returnStartedAt) /
          Math.max(0.001, this.idleGlanceReturnDuration),
        0,
        1,
      ),
    )
    const tailRelease =
      1 -
      smootherstep(
        clamp(
          (age - this.idleGlanceDuration) / IDLE_GLANCE_HAIR_TAIL_SECONDS,
          0,
          1,
        ),
      )
    this.idleGlanceHairTail = this.idleGlanceX * returnWeight * tailRelease
    if (
      age < 0 ||
      age > this.idleGlanceDuration + IDLE_GLANCE_HAIR_TAIL_SECONDS
    ) {
      this.signalsValue.idleGlanceX = 0
      this.signalsValue.idleGlanceY = 0
      this.idleGlanceHairTail = 0
      return
    }
    if (age > this.idleGlanceDuration) {
      this.signalsValue.idleGlanceX = 0
      this.signalsValue.idleGlanceY = 0
      return
    }
    const weight =
      smootherstep(clamp(age / this.idleGlanceAcquireDuration, 0, 1)) *
      smootherstep(
        clamp(
          (this.idleGlanceDuration - age) / this.idleGlanceReturnDuration,
          0,
          1,
        ),
      )
    this.signalsValue.idleGlanceX = this.idleGlanceX * weight
    this.signalsValue.idleGlanceY = this.idleGlanceY * weight
  }

  private idleGlanceIsActive(nowSeconds: number): boolean {
    const age = nowSeconds - this.idleGlanceStartedAt
    return age >= 0 && age <= this.idleGlanceDuration
  }

  private queueIdleGlanceBlink(nowSeconds: number): void {
    if (this.idleGlanceBlinkQueuedFor === this.idleGlanceStartedAt) return
    this.idleGlanceBlinkQueuedFor = this.idleGlanceStartedAt
    const lowEnergy = 1 - unit(this.characterState.energy)
    const duration = this.blinkDurationSeconds() * (0.82 + lowEnergy * 0.24)
    const candidateStart = this.elapsedAt(
      (this.idleGlanceStartedAt +
        this.idleGlanceAcquireDuration +
        IDLE_GLANCE_SETTLE_SECONDS) *
        1_000,
    )
    const start = this.breathSeparatedBlinkStart(candidateStart, duration)
    this.idleGlanceDuration += start - candidateStart
    if (start + duration <= this.elapsedAt(nowSeconds * 1_000)) return
    this.blinkEvents.push({
      start,
      duration,
      coordination: 'idle-glance',
    })
    const glanceEnd = this.elapsedAt(
      (this.idleGlanceStartedAt + this.idleGlanceDuration) * 1_000,
    )
    // Consume the ambient blink slot around this glance. The coordinated blink
    // lands only after the gaze follower has stopped, and the next natural
    // blink cannot overlap the return sweep.
    this.nextBlinkAt = Math.max(this.nextBlinkAt, glanceEnd + 2.2)
  }

  private resetIdleGlance(preserveActiveBlink = true): void {
    let hasCoordinatedBlink = false
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      if (this.blinkEvents[index].coordination === 'idle-glance') {
        hasCoordinatedBlink = true
        break
      }
    }
    if (this.idleGlanceStateClear && !hasCoordinatedBlink) return

    const elapsed = this.frameElapsed
    let retained = 0
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      const keep =
        event.coordination !== 'idle-glance' ||
        (preserveActiveBlink &&
          event.start <= elapsed &&
          elapsed <= event.start + event.duration)
      if (!keep) continue
      this.blinkEvents[retained] = event
      retained += 1
    }
    this.blinkEvents.length = retained
    this.idleGlanceIdleSince = -Infinity
    this.idleGlanceNextAt = -Infinity
    this.idleGlanceStartedAt = -Infinity
    this.idleGlanceDuration = 0
    this.idleGlanceX = 0
    this.idleGlanceY = 0
    this.idleGlanceBlinkQueuedFor = -Infinity
    this.idleGlanceAcquireDuration = IDLE_GLANCE_ACQUIRE_SECONDS
    this.idleGlanceReturnDuration = IDLE_GLANCE_RETURN_SECONDS
    this.idleGlanceHeadScale = 1
    this.idleGlanceHairTail = 0
    this.signalsValue.idleGlanceX = 0
    this.signalsValue.idleGlanceY = 0
    this.debugSignalsValue.idleGlance.x = 0
    this.debugSignalsValue.idleGlance.y = 0
    this.debugSignalsValue.gazeSource = this.gazeTarget?.source ?? 'ambient'
    this.idleGlanceStateClear = true
  }

  private restartIdleGlanceQuietInterval(nowSeconds: number): void {
    this.resetIdleGlance()
    this.idleGlanceIdleSince = nowSeconds
    this.idleGlanceNextAt =
      nowSeconds + this.nextIdleGlanceDelaySeconds(nowSeconds)
    this.idleGlanceStateClear = false
  }

  private nextIdleGazeUnit(): number {
    const result = nextSeededUnit(this.idleGazeRandomSeed)
    this.idleGazeRandomSeed = result.seed
    return result.value
  }

  private nextIdleGlanceDelaySeconds(atSeconds: number): number {
    const continuousIdleSeconds = Number.isFinite(this.idleGlanceIdleSince)
      ? Math.max(0, atSeconds - this.idleGlanceIdleSince)
      : 0
    return (
      idleGazeGlanceDelayMs(this.nextIdleGazeUnit(), continuousIdleSeconds) /
      1_000
    )
  }

  private scheduleBlinks(elapsed: number, speechActive: boolean): void {
    if (this.eyeIndexes.length === 0) return
    this.revalidateAmbientDoubleBlinkSeconds(elapsed)
    const blockedUntil = this.speechBlinkBlockedUntilElapsed()
    if (this.nextBlinkAt <= 0) {
      this.nextBlinkAt =
        elapsed +
        (speechActive ? this.speechBlinkInterval() : this.blinkInterval())
    }
    this.nextBlinkAt = Math.max(
      this.nextBlinkAt,
      blockedUntil,
      this.blinkBlockedUntil,
    )
    let guard = 0
    while (elapsed >= this.nextBlinkAt && guard < 4) {
      const lowEnergy = 1 - unit(this.characterState.energy)
      const duration = this.blinkDurationSeconds() * (1 + lowEnergy * 0.7)
      const accentChance =
        Math.abs(this.signalsValue.idleAccent) *
        0.24 *
        (1 - this.currentRestStillness)
      const doubleBlink =
        this.pendingAmbientDoubleBlink ||
        (!speechActive &&
          this.random() < this.profile.blink.doubleChance + accentChance)
      const secondDuration = duration * 0.78
      const secondStartOffset = duration * 1.18
      const start = this.breathSeparatedBlinkStart(
        this.nextBlinkAt,
        duration,
        doubleBlink ? secondStartOffset : -1,
        secondDuration,
      )
      if (start > elapsed) {
        // Keep a valley-delayed ambient blink as scheduler state rather than a
        // future event. A rest/gaze/speech ownership change can then replace
        // it cleanly instead of inheriting a stale queued closure.
        this.nextBlinkAt = start
        this.pendingAmbientDoubleBlink = doubleBlink
        break
      }
      this.pendingAmbientDoubleBlink = false
      const groupId = doubleBlink ? this.nextBlinkGroupId++ : undefined
      this.blinkEvents.push({
        start,
        duration,
        coordination: doubleBlink ? 'ambient-double-first' : undefined,
        groupId,
      })
      if (doubleBlink) {
        this.blinkEvents.push({
          start: start + secondStartOffset,
          duration: secondDuration,
          coordination: 'ambient-double-second',
          groupId,
        })
      }
      this.nextBlinkAt =
        start +
        (speechActive ? this.speechBlinkInterval() : this.blinkInterval())
      guard += 1
    }
    let retained = 0
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      if (elapsed > event.start + event.duration + 0.05) continue
      this.blinkEvents[retained] = event
      retained += 1
    }
    this.blinkEvents.length = retained
  }

  private breathSeparatedBlinkStart(
    candidateStart: number,
    duration: number,
    secondStartOffset = -1,
    secondDuration = 0,
  ): number {
    const phase = this.breathClock * TWO_PI + this.phaseA
    const relativeStart = candidateStart - this.frameElapsed
    return (
      candidateStart +
      blinkBreathSequenceDelaySeconds(
        phase,
        this.currentBreathFrequencyHz,
        relativeStart + duration * 0.5,
        secondStartOffset < 0
          ? -1
          : relativeStart + secondStartOffset + secondDuration * 0.5,
      )
    )
  }

  private revalidateAmbientDoubleBlinkSeconds(elapsed: number): void {
    const phase = this.breathClock * TWO_PI + this.phaseA
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      if (
        event.coordination !== 'ambient-double-second' ||
        event.start <= elapsed
      ) {
        continue
      }
      const first = this.pairedAmbientDoubleBlinkEvent(
        event,
        'ambient-double-first',
      )
      if (first) {
        if (first.start > elapsed) {
          const secondStartOffset = event.start - first.start
          const shiftedFirstStart = this.breathSeparatedBlinkStart(
            first.start,
            first.duration,
            secondStartOffset,
            event.duration,
          )
          if (shiftedFirstStart > first.start) {
            event.start = translatedDoubleBlinkSecondStart(
              first.start,
              event.start,
              shiftedFirstStart,
            )
            first.start = shiftedFirstStart
          }
        }
        // Once the first lid beat has begun, its authored gap is perceptual
        // state. Rechecking only the second beat would turn one double into two
        // unrelated blinks, so later gates can move the pair only before this
        // boundary.
        this.nextBlinkAt = Math.max(
          this.nextBlinkAt,
          event.start + event.duration + AMBIENT_DOUBLE_BLINK_QUIET_SECONDS,
        )
        continue
      }
      const delay = blinkBreathValleyDelaySeconds(
        phase,
        this.currentBreathFrequencyHz,
        event.start - elapsed + event.duration * 0.5,
      )
      if (delay > 0) event.start += delay
      // If a live phase recheck pushes the second closure past the group's
      // original ambient deadline, move that deadline with it. No later blink
      // group may interleave with the retained second beat.
      this.nextBlinkAt = Math.max(
        this.nextBlinkAt,
        event.start + event.duration + AMBIENT_DOUBLE_BLINK_QUIET_SECONDS,
      )
    }
  }

  private blinkInterval(): number {
    const attention = unit(this.characterState.curiosity)
    const lowEnergy = 1 - this.currentEnergy
    const boredom = this.currentBoredom
    const minimum = Math.max(
      2.2,
      this.profile.blink.minIntervalSeconds +
        attention * 0.35 +
        lowEnergy * 0.48 -
        boredom * 0.24,
    )
    const maximum = Math.max(
      minimum + 1.4,
      this.profile.blink.maxIntervalSeconds + lowEnergy * 0.85 - boredom * 0.6,
    )
    const activeInterval = lerp(minimum, maximum, this.random())
    // Deep rest is sparse, never absent. Keeping a finite authored ceiling is
    // important because the wake handoff rebases from this deadline rather
    // than manufacturing catch-up blinks for every quiet slot.
    const restInterval = lerp(
      DEEP_REST_BLINK_MIN_SECONDS,
      DEEP_REST_BLINK_MAX_SECONDS,
      this.random(),
    )
    return lerp(activeInterval, restInterval, this.currentRestStillness)
  }

  private speechBlinkInterval(): number {
    // Speech blinks are intentional phrase-level beats, not idle noise.
    return lerp(6.4, 10.8, this.random())
  }

  private blinkDurationSeconds(): number {
    // The generic layered profile was authored around a compact 240 ms
    // blink. Anime2.5DRig keeps the same profile control but scales its default
    // to the upstream 580 ms close/hold/reopen sequence.
    return (
      this.profile.blink.durationSeconds *
      (this.anime25dIndex.enabled ? 0.58 / 0.24 : 1)
    )
  }

  private blinkAmount(elapsed: number): number {
    if (
      elapsed > this.expansionBlinkContinuationUntil &&
      (elapsed < this.speechBlinkBlockedUntilElapsed() ||
        elapsed < this.blinkBlockedUntil)
    ) {
      return 0
    }
    let amount = 0
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      const progress = (elapsed - event.start) / event.duration
      if (progress < 0 || progress > 1) continue
      amount = Math.max(
        amount,
        this.anime25dIndex.enabled
          ? anime25DBlinkClosure(progress)
          : Math.sin(progress * Math.PI) ** 0.72,
      )
    }
    return amount
  }

  private updateBlinkSafetyDebug(elapsed: number): void {
    const phase = this.breathClock * TWO_PI + this.phaseA
    this.debugSignalsValue.breathPhase = positiveModulo(phase, TWO_PI) / TWO_PI

    let nextEvent: BlinkEvent | null = null
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const event = this.blinkEvents[index]
      if (event.start + event.duration < elapsed) continue
      if (!nextEvent || event.start < nextEvent.start) nextEvent = event
    }
    const peakOffset = nextEvent
      ? nextEvent.start - elapsed + nextEvent.duration * 0.5
      : this.blinkDurationSeconds() * 0.5
    this.debugSignalsValue.nextBlinkSafe =
      blinkBreathValleyDelaySeconds(
        phase,
        this.currentBreathFrequencyHz,
        peakOffset,
      ) === 0
  }

  private deferBlinksUntil(until: number): void {
    if (!Number.isFinite(until) || until <= this.blinkBlockedUntil) return
    const elapsed = this.elapsedAt((this.lastSeconds ?? 0) * 1_000)
    this.blinkBlockedUntil = until
    for (const event of this.blinkEvents) {
      if (event.start + event.duration < elapsed) continue
      if (event.start <= elapsed && elapsed <= event.start + event.duration) {
        continue
      }
      if (event.coordination === 'ambient-double-first') {
        const second = this.pairedAmbientDoubleBlinkEvent(
          event,
          'ambient-double-second',
        )
        if (second && second.start > elapsed) {
          const secondStartOffset = second.start - event.start
          const shiftedFirstStart = this.breathSeparatedBlinkStart(
            Math.max(event.start, until),
            event.duration,
            secondStartOffset,
            second.duration,
          )
          second.start = translatedDoubleBlinkSecondStart(
            event.start,
            second.start,
            shiftedFirstStart,
          )
          event.start = shiftedFirstStart
          continue
        }
      }
      if (event.coordination === 'ambient-double-second') {
        const futureFirst = this.pairedAmbientDoubleBlinkEvent(
          event,
          'ambient-double-first',
        )
        if (futureFirst && futureFirst.start > elapsed) continue
      }
      event.start = this.breathSeparatedBlinkStart(
        Math.max(event.start, until),
        event.duration,
      )
    }
    this.nextBlinkAt = Math.max(this.nextBlinkAt, until)
  }

  private pairedAmbientDoubleBlinkEvent(
    event: BlinkEvent,
    coordination: 'ambient-double-first' | 'ambient-double-second',
  ): BlinkEvent | null {
    if (event.groupId === undefined) return null
    for (let index = 0; index < this.blinkEvents.length; index += 1) {
      const candidate = this.blinkEvents[index]
      if (
        candidate.groupId === event.groupId &&
        candidate.coordination === coordination
      ) {
        return candidate
      }
    }
    return null
  }

  private updateHeadTurnBlinkGate(
    pose: readonly RigTransform[],
    elapsed: number,
    delta: number,
  ): void {
    if (this.headIndex < 0) return
    const rotation = pose[this.headIndex].rotation
    if (!this.blinkHeadInitialized || delta <= 0) {
      this.blinkHeadRotation = rotation
      this.blinkHeadGazeX = this.headGazeX
      this.blinkHeadGazeY = this.headGazeY
      this.blinkHeadInitialized = true
      return
    }
    const rotationVelocity =
      Math.abs(angleDelta(rotation, this.blinkHeadRotation)) / delta
    // Pointer gaze can be a vertical-only target. In that case the head follows
    // through translation without rotating, so rotation alone is not a valid
    // stillness signal. Measure the gaze follower itself rather than final head
    // translation, which also contains breathing and authored idle motion.
    const gazeTranslationVelocity =
      Math.max(
        Math.abs(this.headGazeX - this.blinkHeadGazeX) * 0.0018,
        Math.abs(this.headGazeY - this.blinkHeadGazeY) * 0.0012,
      ) / delta
    const velocity = Math.max(rotationVelocity, gazeTranslationVelocity * 18)
    this.blinkHeadRotation = rotation
    this.blinkHeadGazeX = this.headGazeX
    this.blinkHeadGazeY = this.headGazeY
    // Ambient drift sits well below this threshold. Pointer gaze, authored
    // turns, and handoff rotation all cross it and extend the gate until their
    // final settling tail has passed.
    if (velocity > 0.035) {
      this.deferBlinksUntil(elapsed + HEAD_TURN_BLINK_SETTLE_SECONDS)
    }
  }

  private speechMouthReleaseActive(nowMs: number): boolean {
    const age = nowMs - this.speechReleaseStartedAt
    return age >= 0 && age <= SPEECH_MOUTH_CLOSE_HOLD_MS
  }

  private speechBlinkBlockedUntilElapsed(): number {
    if (!Number.isFinite(this.speechReleaseStartedAt)) return -Infinity
    return this.elapsedAt(this.speechReleaseStartedAt + SPEECH_MOUTH_CLOSE_MS)
  }

  private applySecondaryMotion(
    pose: RigTransform[],
    delta: number,
    signals: MotionSignals,
    lowEnergyWeight: number,
    restStillness: number,
  ): void {
    if (this.secondaryBones.length === 0) return
    const outfitScale = this.manifest.outfitProfile?.secondaryMotionScale ?? 1
    const idleDampingScale = 0.8 + this.currentStyle.fluidity * 0.45
    const idleFrequencyScale = lerp(1, 0.62, lowEnergyWeight)
    const targetWakeWeight = secondarySpringWakeWeight(restStillness)
    if (!this.secondaryWakeInitialized) {
      this.currentSecondaryWakeWeight = targetWakeWeight
      this.secondaryWakeInitialized = true
    } else {
      this.currentSecondaryWakeWeight = boundedStateFollow(
        this.currentSecondaryWakeWeight,
        targetWakeWeight,
        delta,
        targetWakeWeight > this.currentSecondaryWakeWeight ? 4.2 : 8,
      )
    }
    const secondaryWakeWeight = this.currentSecondaryWakeWeight
    // Rest damping, natural frequency, ambient drive, and inertial drive all
    // leave rest through one envelope. Using raw restStillness for the solver
    // here would loosen the spring before its drive was ready after a long
    // collapsed interval, producing a single stiff-looking wake frame.
    const { dampingScale, frequencyScale } = secondarySpringDynamics(
      restStillness,
      idleDampingScale,
      idleFrequencyScale,
      secondaryWakeWeight,
    )
    const headRotation = this.headIndex >= 0 ? pose[this.headIndex].rotation : 0
    if (!this.headAngularInitialized || delta <= 0) {
      this.previousHeadRotation = headRotation
      this.headAngularVelocity = 0
      this.headAngularInitialized = true
    } else {
      const rawHeadVelocity = clamp(
        angleDelta(headRotation, this.previousHeadRotation) / delta,
        -8,
        8,
      )
      const largeTurnWeight = smootherstep(
        clamp((Math.abs(rawHeadVelocity) - 0.18) / 1.6, 0, 1),
      )
      const trackedHeadVelocity =
        rawHeadVelocity * lerp(0.55, 1, largeTurnWeight)
      const followRate =
        Math.abs(trackedHeadVelocity) > Math.abs(this.headAngularVelocity)
          ? 26
          : 5.8
      this.headAngularVelocity +=
        (trackedHeadVelocity - this.headAngularVelocity) *
        (1 - Math.exp(-delta * followRate))
      this.previousHeadRotation = headRotation
    }
    for (let index = 0; index < this.secondaryBones.length; index += 1) {
      const spring = this.secondaryBones[index]
      const parent = pose[spring.parentIndex]
      const parentSpring =
        spring.parentSecondaryIndex < 0
          ? undefined
          : this.secondaryBones[spring.parentSecondaryIndex]
      const parentRotation = parent.rotation + (parentSpring?.rotation || 0)
      if (!spring.driverInitialized || delta <= 0) {
        spring.driverRotation = parentRotation
        spring.driverVelocity = 0
        spring.previousParentRotation = parentRotation
        spring.driverInitialized = true
      } else {
        const kindFollow =
          spring.kind === 'cloth' ? 4.2 : spring.kind === 'hair' ? 6.4 : 7.6
        const fatigueFollow = lerp(1, 0.58, lowEnergyWeight)
        const depthFollow =
          (kindFollow * fatigueFollow) / (1 + spring.depth * 0.48)
        const driverFollow = 1 - Math.exp(-delta * depthFollow)
        spring.driverRotation +=
          (parentRotation - spring.driverRotation) * driverFollow
        const parentVelocity = clamp(
          angleDelta(parentRotation, spring.previousParentRotation) / delta,
          -6,
          6,
        )
        const velocityFollowRate =
          spring.kind === 'cloth' ? 5.4 : spring.kind === 'hair' ? 7.2 : 10.5
        const velocityFollow = 1 - Math.exp(-delta * velocityFollowRate)
        spring.driverVelocity +=
          (parentVelocity - spring.driverVelocity) * velocityFollow
        spring.previousParentRotation = parentRotation
      }
      const eventDrive =
        signals.eventImpulse * spring.direction * 0.075 * secondaryWakeWeight
      if (spring.headDriven) {
        const headVelocityFollowRate =
          (spring.kind === 'hair'
            ? 18
            : spring.kind === 'accessory'
              ? 11
              : 7.5) /
          (1 + spring.depth * 0.42)
        spring.headVelocity +=
          (this.headAngularVelocity - spring.headVelocity) *
          (1 - Math.exp(-delta * headVelocityFollowRate))
      }
      const ambient =
        (Math.sin(
          this.secondaryClock *
            TWO_PI *
            (0.16 - Math.min(0.055, spring.depth * 0.018)) +
            spring.direction +
            spring.depth * 0.62 +
            spring.ambientPhase,
        ) *
          0.012 *
          lerp(1, 0.62, lowEnergyWeight) +
          signals.secondaryDrift * 0.006 * lerp(1, 0.68, lowEnergyWeight)) *
        secondaryWakeWeight
      const rotationLimit = spring.maxRotation * outfitScale
      const recoverableLimit = rotationLimit * 0.82
      const inertialTailSeconds =
        (spring.kind === 'cloth'
          ? 0.09
          : spring.kind === 'hair'
            ? 0.065
            : 0.04) *
        (1 + spring.depth * 0.2)
      const target = clamp(
        (-spring.driverRotation * spring.response +
          -spring.driverVelocity * inertialTailSeconds * spring.response +
          -spring.headVelocity *
            (spring.kind === 'hair'
              ? 0.075
              : spring.kind === 'accessory'
                ? 0.11
                : 0.13) *
            (1 + spring.depth * 0.2) *
            spring.response) *
          secondaryWakeWeight +
          (spring.kind === 'hair' && spring.headDriven
            ? this.idleGlanceHairTail *
              0.014 *
              spring.response *
              secondaryWakeWeight
            : 0) +
          (eventDrive + ambient) * outfitScale,
        -recoverableLimit,
        recoverableLimit,
      )
      stepDampedSpring(spring, target, delta, dampingScale, frequencyScale)
      const velocityLimit = Math.max(
        0.16,
        recoverableLimit * TWO_PI * spring.frequencyHz * 1.25,
      )
      if (
        !Number.isFinite(spring.rotation) ||
        !Number.isFinite(spring.velocity)
      ) {
        spring.rotation = 0
        spring.velocity = 0
      } else {
        spring.velocity = clamp(spring.velocity, -velocityLimit, velocityLimit)
        spring.rotation = clamp(
          spring.rotation,
          -recoverableLimit * 1.08,
          recoverableLimit * 1.08,
        )
        if (
          Math.abs(spring.rotation) >= recoverableLimit &&
          spring.rotation * spring.velocity > 0
        ) {
          spring.velocity *= 0.28
        }
      }
      const colliderIndex =
        spring.kind === 'hair' ? this.headIndex : this.bodyIndex
      const springPivot = this.manifest.bones[spring.index].pivot
      const colliderPivot =
        colliderIndex >= 0
          ? this.manifest.bones[colliderIndex].pivot
          : undefined
      if (springPivot && colliderPivot) {
        spring.rotation = resolveSecondaryCollision(
          spring.rotation,
          springPivot,
          spring.restLength,
          colliderPivot,
          spring.kind === 'hair' ? 0.09 : 0.13,
        )
      }
      spring.rotation = clamp(
        spring.rotation,
        -rotationLimit * 0.94,
        rotationLimit * 0.94,
      )
      const transform = pose[spring.index]
      transform.rotation += spring.rotation
      transform.translation.x += spring.rotation * 0.012 * spring.direction
      transform.translation.y += Math.abs(spring.rotation) * 0.004
    }
  }

  private updateAnimeChestBounce(target: number, delta: number): number {
    if (!this.anime25dIndex.enabled || this.anime25dIndex.chestIndex < 0)
      return 0
    if (!this.animeChestInitialized || delta <= 0) {
      this.animeChestPosition = target
      this.animeChestVelocity = 0
      this.animeChestInitialized = true
      return 0
    }
    const step = Math.min(0.05, delta)
    const acceleration =
      -118 * (this.animeChestPosition - target) - 7.2 * this.animeChestVelocity
    this.animeChestVelocity = clamp(
      this.animeChestVelocity + acceleration * step,
      -0.08,
      0.08,
    )
    this.animeChestPosition += this.animeChestVelocity * step
    if (!Number.isFinite(this.animeChestPosition)) {
      this.animeChestPosition = target
      this.animeChestVelocity = 0
    }
    return clamp(-(this.animeChestPosition - target) * 1.35, -0.008, 0.008)
  }

  private updateAnimeHandwearSway(target: number, delta: number): number {
    if (!this.anime25dIndex.enabled || this.anime25dIndex.handwearIndex < 0) {
      return 0
    }
    const boundedTarget = clamp(target, -1, 1)
    if (!this.animeHandwearInitialized) {
      this.animeHandwearPosition = 0
      this.animeHandwearVelocity = 0
      this.animeHandwearInitialized = true
      return 0
    }
    if (delta <= 0) return this.animeHandwearPosition
    const step = Math.min(0.05, delta)
    const frequency = 1.55 * TWO_PI
    const damping = 0.76
    const acceleration =
      frequency * frequency * (boundedTarget - this.animeHandwearPosition) -
      2 * damping * frequency * this.animeHandwearVelocity
    this.animeHandwearVelocity = clamp(
      this.animeHandwearVelocity + acceleration * step,
      -5,
      5,
    )
    this.animeHandwearPosition = clamp(
      this.animeHandwearPosition + this.animeHandwearVelocity * step,
      -1,
      1,
    )
    if (
      !Number.isFinite(this.animeHandwearPosition) ||
      !Number.isFinite(this.animeHandwearVelocity)
    ) {
      this.animeHandwearPosition = 0
      this.animeHandwearVelocity = 0
    }
    return this.animeHandwearPosition
  }

  private cacheSeedPhases(): void {
    const seed = this.profile.seed
    this.phaseA = seedPhase(seed, 11)
    this.phaseB = seedPhase(seed, 29)
    this.weightPhase = seedPhase(seed, 43)
    this.gazePhase = seedPhase(seed, 61)
    this.secondaryPhase = seedPhase(seed, 83)
    this.shoulderPhase = seedPhase(seed, 97)
    this.headPhase = seedPhase(seed, 109)
    this.accentPhase = seedPhase(seed, 127)
  }

  private random(): number {
    const result = nextSeededUnit(this.randomSeed)
    this.randomSeed = result.seed
    return result.value
  }
}

export function boundedStateFollow(
  current: number,
  target: number,
  deltaSeconds: number,
  rate: number,
): number {
  const from = clamp(current, 0, 1)
  const to = clamp(target, 0, 1)
  if (deltaSeconds <= 0) return from
  const amount = 1 - Math.exp(-Math.max(0, deltaSeconds) * Math.max(0, rate))
  const next = from + (to - from) * amount
  return to < from ? clamp(next, to, from) : clamp(next, from, to)
}

export function restWeightFromEnergy(energy: number): number {
  // Rest stays fully weighted through the enter threshold, then yields across
  // a broad recovery band. The separate behavior hysteresis may switch clips
  // inside this band without changing the posture target discontinuously.
  return 1 - smootherstep(clamp((energy - 0.32) / 0.24, 0, 1))
}

export function syntheticSpeechEnergy(elapsed: number, tempo: number): number {
  const syllable = Math.max(0, Math.sin(elapsed * TWO_PI * 3.45 * tempo + 0.4))
  const consonant = Math.max(0, Math.sin(elapsed * TWO_PI * 5.1 * tempo - 0.9))
  const phrase =
    0.42 + Math.max(0, Math.sin(elapsed * TWO_PI * 0.37 - 0.3)) * 0.58
  return clamp((syllable * 0.76 + consonant * 0.24) * phrase, 0, 1)
}

interface MouthShape {
  scaleX: number
  scaleY: number
  energyX: number
  energyY: number
  translationX: number
  translationY: number
  rotation: number
}

const MOUTH_SHAPES: Readonly<Record<SpeechViseme, Readonly<MouthShape>>> = {
  rest: {
    scaleX: 1,
    scaleY: 0.76,
    energyX: 0.02,
    energyY: 0.34,
    translationX: 0,
    translationY: 0,
    rotation: 0,
  },
  closed: {
    scaleX: 1.04,
    scaleY: 0.48,
    energyX: 0.015,
    energyY: 0.05,
    translationX: 0,
    translationY: -0.0005,
    rotation: 0,
  },
  wide: {
    scaleX: 1.08,
    scaleY: 0.74,
    energyX: 0.08,
    energyY: 0.24,
    translationX: 0,
    translationY: 0,
    rotation: 0,
  },
  round: {
    scaleX: 0.8,
    scaleY: 0.9,
    energyX: 0.03,
    energyY: 0.42,
    translationX: 0,
    translationY: 0.001,
    rotation: 0,
  },
  narrow: {
    scaleX: 0.94,
    scaleY: 0.68,
    energyX: 0.04,
    energyY: 0.2,
    translationX: 0.001,
    translationY: 0,
    rotation: -0.012,
  },
  open: {
    scaleX: 0.98,
    scaleY: 0.82,
    energyX: 0.03,
    energyY: 0.52,
    translationX: 0,
    translationY: 0.0015,
    rotation: 0,
  },
}

function mouthShape(viseme: SpeechViseme): Readonly<MouthShape> {
  return MOUTH_SHAPES[viseme]
}

function mouthShapeScaleX(
  shape: Readonly<MouthShape>,
  viseme: SpeechViseme,
  amount: number,
): number {
  return viseme === 'wide'
    ? shape.scaleX + clamp(amount, 0, 1) * 0.16
    : shape.scaleX
}

function stepDampedSpring(
  spring: Pick<
    SecondaryBone,
    'frequencyHz' | 'dampingRatio' | 'rotation' | 'velocity'
  >,
  target: number,
  delta: number,
  dampingScale = 1,
  frequencyScale = 1,
): void {
  if (delta <= 0) return
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)))
  const step = delta / steps
  const omega = TWO_PI * spring.frequencyHz * frequencyScale
  for (let index = 0; index < steps; index += 1) {
    const acceleration =
      omega * omega * (target - spring.rotation) -
      2 * spring.dampingRatio * dampingScale * omega * spring.velocity
    spring.velocity += acceleration * step
    spring.rotation += spring.velocity * step
  }
}

function constrainPose(pose: RigTransform[]): void {
  for (let index = 0; index < pose.length; index += 1) {
    const transform = pose[index]
    transform.translation.x = clamp(transform.translation.x, -0.25, 0.25)
    transform.translation.y = clamp(transform.translation.y, -0.25, 0.25)
    transform.rotation = clamp(transform.rotation, -Math.PI, Math.PI)
    transform.scale.x = clamp(transform.scale.x, 0.05, 3)
    transform.scale.y = clamp(transform.scale.y, 0.05, 3)
  }
}

function secondaryBoneKind(id: string): 'hair' | 'accessory' | 'cloth' | null {
  const normalized = id.toLowerCase()
  if (/hair|ahoge|bang|braid/.test(normalized)) return 'hair'
  if (/accessory|ribbon|earring|tail|scarf/.test(normalized)) return 'accessory'
  if (/cloth|skirt|coat|sleeve|cape/.test(normalized)) return 'cloth'
  return null
}

function buildSecondaryBones(
  manifest: CompanionRigManifest,
  profile: MotionProfile,
): SecondaryBone[] {
  if (!profile.secondary.enabled) return []
  const indexes = new Map(manifest.bones.map((bone, index) => [bone.id, index]))
  const headIndex = semanticBoneIndex(manifest, 'head') ?? -1
  const explicitSecondaryBones = new Set(
    resolveRigSemantics(manifest).secondaryBoneIds,
  )
  const secondaryBones = manifest.bones.flatMap((bone, index) => {
    const kind =
      secondaryBoneKind(bone.id) ??
      (explicitSecondaryBones.has(bone.id) ? 'cloth' : null)
    if (!kind) return []
    const parentIndex =
      bone.parent === null ? -1 : (indexes.get(bone.parent) ?? -1)
    if (parentIndex < 0) return []
    const direction = hashString(bone.id) % 2 === 0 ? 1 : -1
    const parent = manifest.bones[parentIndex]
    const bonePivot = bone.pivot || { x: 0, y: 0 }
    const parentPivot = parent.pivot || { x: 0, y: 0 }
    const restLength = Math.hypot(
      bonePivot.x - parentPivot.x,
      bonePivot.y - parentPivot.y,
    )
    let headDriven = false
    let ancestryCursor = bone.parent
    let ancestryGuard = 0
    while (ancestryCursor !== null && ancestryGuard < manifest.bones.length) {
      const ancestryIndex = indexes.get(ancestryCursor) ?? -1
      if (ancestryIndex === headIndex) {
        headDriven = true
        break
      }
      ancestryCursor = manifest.bones[ancestryIndex]?.parent ?? null
      ancestryGuard += 1
    }
    let depth = 0
    let cursor = bone.parent
    while (cursor !== null && depth < manifest.bones.length) {
      const parentBone = manifest.bones[indexes.get(cursor) ?? -1]
      if (
        !parentBone ||
        (!secondaryBoneKind(parentBone.id) &&
          !explicitSecondaryBones.has(parentBone.id))
      ) {
        break
      }
      depth += 1
      cursor = parentBone.parent
    }
    const animeHair = anime25DHairSpringProfile(bone.id)
    return [
      {
        index,
        parentIndex,
        parentSecondaryIndex: -1,
        direction,
        frequencyHz:
          profile.secondary.frequencyHz *
          (animeHair?.frequencyScale ??
            (kind === 'hair' ? 0.88 : kind === 'cloth' ? 0.68 : 0.96)),
        dampingRatio:
          profile.secondary.dampingRatio *
          (animeHair?.dampingScale ??
            (kind === 'hair' ? 0.92 : kind === 'cloth' ? 1.14 : 1.02)),
        response:
          profile.secondary.response *
          (animeHair?.responseScale ??
            (kind === 'hair' ? 1 : kind === 'cloth' ? 0.88 : 0.8)),
        maxRotation:
          animeHair?.maxRotation ??
          (kind === 'hair' ? 0.28 : kind === 'cloth' ? 0.22 : 0.2),
        rotation: 0,
        velocity: 0,
        driverRotation: 0,
        driverVelocity: 0,
        previousParentRotation: 0,
        driverInitialized: false,
        kind,
        depth,
        restLength: clamp(restLength, 0.025, 0.28),
        ambientPhase: seedPhase(profile.seed, 101 + index),
        headDriven,
        headVelocity: 0,
      },
    ]
  })
  const secondaryByBone = new Map(
    secondaryBones.map((spring, index) => [spring.index, index]),
  )
  for (const spring of secondaryBones) {
    spring.parentSecondaryIndex = secondaryByBone.get(spring.parentIndex) ?? -1
  }
  return secondaryBones
}

export function resolveSecondaryCollision(
  rotation: number,
  pivot: { x: number; y: number },
  length: number,
  collider: { x: number; y: number },
  radius: number,
): number {
  const dx = pivot.x + Math.sin(rotation) * length - collider.x
  const dy = pivot.y + Math.cos(rotation) * length - collider.y
  const distance = Math.hypot(dx, dy)
  if (distance >= radius || distance < 0.0001) return rotation
  const outward = Math.atan2(dx, dy)
  const difference = Math.atan2(
    Math.sin(outward - rotation),
    Math.cos(outward - rotation),
  )
  return rotation + difference * (1 - distance / radius) * 0.72
}

function sanitizeState(state: MotionCharacterState): MotionCharacterState {
  return {
    energy: score(state.energy),
    mood: score(state.mood),
    boredom: score(state.boredom),
    curiosity: score(state.curiosity),
    social: score(state.social),
    affection: score(state.affection),
  }
}

function mixStyleInto(
  target: MotionStyle,
  to: MotionStyle,
  amount: number,
): void {
  target.tempo = lerp(target.tempo, to.tempo, amount)
  target.force = lerp(target.force, to.force, amount)
  target.spatialFocus = lerp(target.spatialFocus, to.spatialFocus, amount)
  target.fluidity = lerp(target.fluidity, to.fluidity, amount)
  target.expansion = lerp(target.expansion, to.expansion, amount)
}

function writeStyle(target: MotionStyle, source: MotionStyle): void {
  target.tempo = source.tempo
  target.force = source.force
  target.spatialFocus = source.spatialFocus
  target.fluidity = source.fluidity
  target.expansion = source.expansion
}

function seedPhase(seed: number, salt: number): number {
  return ((hashString(`${seed}:${salt}`) % 10_000) / 10_000) * TWO_PI
}

function hashString(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function score(value: number): number {
  return clamp(Number.isFinite(value) ? value : 50, 0, 100)
}

function unit(value: number): number {
  return score(value) / 100
}

function signed(value: number): number {
  return unit(value) * 2 - 1
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function angleDelta(to: number, from: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
