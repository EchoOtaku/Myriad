import type { PerformanceCue, PerformanceDirective } from '../../../services/agent/types'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import type { PerformanceIntent } from './intents'

const MIN_IDLE_MS = 8_000
const MAX_IDLE_MS = 16_000
const PULSE_MS = 1_800

export interface AutonomyClock {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (timer: unknown) => void
}

const defaultClock: AutonomyClock = {
  now: () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = globalThis.setTimeout(callback, delayMs)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    return timer
  },
  clearTimeout: (timer) => globalThis.clearTimeout(timer as number),
}

/**
 * Idle self-motion. Claims autonomy leases only; never the mouth, never
 * head/body over music. Consciousness stays off this path.
 */
export class AutonomyMotionSource {
  private handle: MotionLeaseHandle | null = null
  private intent: PerformanceIntent | null = null
  private running = false
  private waitTimer: unknown = null
  private holdTimer: unknown = null

  constructor(
    private readonly coordinator: RigMotionCoordinator,
    private readonly onChange: (intent: PerformanceIntent | null) => void,
    private readonly speechActive: () => boolean = () => false,
    private readonly clock: AutonomyClock = defaultClock,
    private readonly random: () => number = Math.random,
  ) {}

  current(): PerformanceIntent | null {
    return this.intent
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.arm()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    this.release()
  }

  /** Drive one idle pulse. Tests call this instead of waiting. */
  consider(nowMs: number = this.clock.now()): void {
    if (!this.running) return
    this.clearWait()
    this.clearHold()
    if (prefersReducedMotion() || this.speechActive()) {
      this.release()
      this.arm()
      return
    }
    const owners = this.coordinator.snapshot(nowMs).owners
    if (
      owners.mouth === 'speech' ||
      owners.expression === 'performance' ||
      owners.expression === 'preview' ||
      owners.expression === 'speech' ||
      owners.expression === 'coSpeech'
    ) {
      this.release()
      this.arm()
      return
    }
    const cue: PerformanceCue['intent'] =
      this.random() < 0.5 ? 'think' : 'listen'
    const directive = idleFaceDirective(cue)
    this.handle =
      this.coordinator.renew(this.handle, ['expression', 'gaze'], {
        nowMs,
        ttlMs: PULSE_MS,
      }) ??
      this.coordinator.claim('autonomy', ['expression', 'gaze'], {
        nowMs,
        ttlMs: PULSE_MS,
      })
    if (!this.handle) {
      this.release()
      this.arm()
      return
    }
    this.intent = { directive, startedAtMs: nowMs }
    this.onChange(this.intent)
    this.holdTimer = this.clock.setTimeout(() => {
      this.release()
      this.arm()
    }, PULSE_MS)
  }

  private arm(): void {
    if (!this.running) return
    this.clearWait()
    const span = MIN_IDLE_MS + this.random() * (MAX_IDLE_MS - MIN_IDLE_MS)
    this.waitTimer = this.clock.setTimeout(() => {
      this.consider(this.clock.now())
    }, span)
  }

  private release(): void {
    this.coordinator.release(this.handle)
    this.handle = null
    if (this.intent) {
      this.intent = null
      this.onChange(null)
    }
  }

  private clearTimers(): void {
    this.clearWait()
    this.clearHold()
  }

  private clearWait(): void {
    if (this.waitTimer == null) return
    this.clock.clearTimeout(this.waitTimer)
    this.waitTimer = null
  }

  private clearHold(): void {
    if (this.holdTimer == null) return
    this.clock.clearTimeout(this.holdTimer)
    this.holdTimer = null
  }
}

function idleFaceDirective(
  intent: Extract<PerformanceCue['intent'], 'think' | 'listen'>,
): PerformanceDirective {
  return {
    phase: 'mood',
    moodRevision: 0,
    plan: {
      baseline: {
        expression: 'steady',
        posture: 'neutral',
        motionEnergy: 0.55,
        attention: 0.45,
      },
      cues: [
        {
          intent,
          atMs: 0,
          intensity: 0.55,
          tempo: 1,
          fadeInMs: 80,
          fadeOutMs: 120,
          interrupt: 'if-lower',
        },
      ],
    },
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
