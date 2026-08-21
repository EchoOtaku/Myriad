import type { CompanionRigManifest } from './types'
import { RIG_ACTION_PRIORITY } from './transitions'

export type RigGestureIntent =
  | 'greet'
  | 'notify'
  | 'respond'
  | 'listen'
  | 'pat'
  | 'poke'
  | 'delight'
  | 'emphasize'
  | 'question'
  | 'idle-accent'

export type IdleBehaviorMode = 'idle' | 'rest' | 'fidget'

export function shouldScheduleIdleAccent(mode: IdleBehaviorMode): boolean {
  return mode !== 'rest'
}

export interface IdleAccentTimerClock {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
  now?: () => number
}

export interface IdleAccentTimerLoop {
  pause: () => void
  resume: () => void
  cancel: () => void
  remainingDelayMs: () => number | null
}

export function createIdleAccentTimerLoop(
  nextDelayMs: () => number,
  onAccent: () => boolean | void,
  clock: IdleAccentTimerClock = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer),
    now: () => performance.now(),
  },
): IdleAccentTimerLoop {
  let cancelled = false
  let paused = true
  let timer: number | null = null
  let deadline = 0
  let remaining: number | null = null
  let scheduleGeneration = 0
  const now = () => clock.now?.() ?? performance.now()

  const schedule = (delayMs: number) => {
    if (cancelled || paused) return
    const delay = Math.max(0, delayMs)
    deadline = now() + delay
    const generation = ++scheduleGeneration
    timer = clock.setTimeout(() => {
      if (generation !== scheduleGeneration) return
      timer = null
      if (cancelled || paused) return
      remaining = null
      if (onAccent() === false) {
        cancelled = true
        return
      }
      // onAccent may synchronously pause the loop after observing a collapse
      // that raced this task. In that case the due accent remains frozen at
      // zero instead of arming a hidden timer with a fresh cooldown.
      if (paused || cancelled) return
      schedule(nextDelayMs())
    }, delay)
  }

  const loop: IdleAccentTimerLoop = {
    pause: () => {
      if (cancelled || paused) return
      paused = true
      scheduleGeneration += 1
      if (timer !== null) {
        remaining = Math.max(0, deadline - now())
        clock.clearTimeout(timer)
        timer = null
      } else if (remaining === null) {
        remaining = 0
      }
    },
    resume: () => {
      if (cancelled || !paused) return
      paused = false
      const delay = remaining ?? nextDelayMs()
      remaining = null
      schedule(delay)
    },
    cancel: () => {
      if (cancelled) return
      cancelled = true
      scheduleGeneration += 1
      if (timer !== null) clock.clearTimeout(timer)
      timer = null
      remaining = null
    },
    remainingDelayMs: () => {
      if (cancelled) return null
      if (paused) return remaining
      return timer === null ? 0 : Math.max(0, deadline - now())
    },
  }
  return loop
}

export function startIdleAccentTimerLoop(
  nextDelayMs: () => number,
  onAccent: () => boolean | void,
  clock: IdleAccentTimerClock = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer),
  },
): () => void {
  const loop = createIdleAccentTimerLoop(nextDelayMs, onAccent, clock)
  loop.resume()
  return loop.cancel
}

/**
 * Chooses the long-lived idle family with separate enter/exit thresholds.
 * Runtime state arrives in coarse server ticks, so hysteresis is preferable to
 * a timer: a value hovering around one boundary cannot alternate clips.
 */
export function nextIdleBehaviorMode(
  current: IdleBehaviorMode,
  state: Pick<{ energy: number; boredom: number }, 'energy' | 'boredom'>,
): IdleBehaviorMode {
  const energy = clampScore(state.energy)
  const boredom = clampScore(state.boredom)
  if (current === 'rest' && energy < 43) return 'rest'
  if (energy <= 34) return 'rest'
  if (current === 'fidget' && boredom > 46) return 'fidget'
  if (boredom >= 56) return 'fidget'
  return 'idle'
}

interface GestureDefinition {
  candidates: string[]
  priority: number
  intensity: number
  tempo: number
}

const GESTURES: Record<RigGestureIntent, GestureDefinition> = {
  greet: {
    candidates: ['greet', 'nod', 'bow', 'listen'],
    priority: RIG_ACTION_PRIORITY.greeting,
    intensity: 0.92,
    tempo: 1,
  },
  notify: {
    candidates: ['notify', 'attention', 'startle-settle', 'surprise', 'nod'],
    priority: 100,
    intensity: 1.08,
    tempo: 1.12,
  },
  respond: {
    candidates: ['respond', 'nod', 'proud', 'agree'],
    priority: 60,
    intensity: 0.72,
    tempo: 0.96,
  },
  listen: {
    candidates: ['look-around', 'listen', 'thinking', 'nod', 'acknowledge'],
    priority: 50,
    intensity: 0.62,
    tempo: 0.86,
  },
  pat: {
    candidates: ['pat-reaction', 'shy', 'happy', 'nod'],
    priority: 75,
    intensity: 0.82,
    tempo: 0.9,
  },
  poke: {
    candidates: [
      'startle-settle',
      'poke-reaction',
      'surprise',
      'observe',
      'shake-head',
    ],
    priority: 76,
    intensity: 1.08,
    tempo: 1.08,
  },
  delight: {
    candidates: ['happy', 'proud', 'surprise'],
    priority: 68,
    intensity: 0.94,
    tempo: 1.06,
  },
  emphasize: {
    candidates: ['emphasize', 'attention', 'nod'],
    priority: 66,
    intensity: 0.9,
    tempo: 1.04,
  },
  question: {
    candidates: ['shake-head', 'question', 'observe', 'listen'],
    priority: 58,
    intensity: 0.66,
    tempo: 0.88,
  },
  'idle-accent': {
    candidates: ['deep-breath', 'look-around', 'sigh', 'idle-accent', 'blink'],
    priority: 10,
    intensity: 0.55,
    tempo: 0.82,
  },
}

export function resolveRigStateGesture(
  manifest: CompanionRigManifest,
  state: { energy: number; mood: number; boredom: number },
  selection: RigGestureSelection = {},
): ResolvedRigGesture | null {
  const fidgetCandidates =
    selection.behaviorMode === 'fidget'
      ? fidgetCandidateRotation(state, selection.fidgetSequence ?? 0)
      : null
  const candidates =
    selection.behaviorMode === 'rest' ||
    (selection.behaviorMode === undefined && state.energy <= 24)
      ? ['deep-breath', 'sigh', 'shy', 'sleep', 'sad', 'idle-accent', 'blink']
      : selection.behaviorMode === 'fidget'
        ? fidgetCandidates!.fallback
        : state.mood <= 34
          ? ['shy', 'sigh', 'sad', 'observe', 'idle-accent', 'blink']
          : state.mood >= 76 && state.boredom <= 40
            ? ['proud', 'happy', 'idle-accent']
            : state.boredom >= 62
              ? ['look-around', 'observe', 'deep-breath', 'idle-accent']
              : ['deep-breath', 'idle-accent', 'proud', 'blink']
  const primaryFidgetClip = fidgetCandidates
    ? selectAvailableClip(manifest, fidgetCandidates.primary, selection)
    : null
  // A lane with only one authored clip must not defeat the global recency
  // guard. Fall back to another fidget family when it would repeat the last
  // action; repetition is allowed only when the rig exposes no alternative.
  const clip =
    primaryFidgetClip && primaryFidgetClip.id !== selection.avoid?.[0]
      ? primaryFidgetClip
      : selectAvailableClip(manifest, candidates, selection)
  if (!clip) return null
  const energy = clamp01(state.energy / 100)
  const moodDistance = Math.abs(state.mood - 50) / 50
  return {
    clipId: clip.id,
    priority: RIG_ACTION_PRIORITY.ambientFidget,
    intensity: 0.46 + energy * 0.34 + moodDistance * 0.16,
    tempo: 0.72 + energy * 0.42,
  }
}

export function fidgetCandidateRotation(
  state: Pick<{ energy: number; boredom: number }, 'energy' | 'boredom'>,
  sequence: number,
): { primary: readonly string[]; fallback: readonly string[] } {
  const energy = clampScore(state.energy)
  const boredom = clampScore(state.boredom)
  const lanes =
    energy < 48
      ? [
          ['look-around', 'observe'],
          ['sigh', 'deep-breath'],
          ['idle-accent', 'blink'],
        ]
      : boredom >= 74
        ? [
            ['deep-breath', 'sigh'],
            ['look-around', 'observe'],
            ['idle-accent', 'blink'],
            ['proud', 'happy'],
          ]
        : [
            ['look-around', 'observe'],
            ['deep-breath', 'sigh'],
            ['idle-accent', 'blink'],
            ['proud', 'nod'],
          ]
  const index =
    ((Math.trunc(Number.isFinite(sequence) ? sequence : 0) % lanes.length) +
      lanes.length) %
    lanes.length
  const primary = lanes[index]
  return {
    primary,
    fallback: [
      ...primary,
      ...lanes.filter((_, laneIndex) => laneIndex !== index).flat(),
      'idle-accent',
    ],
  }
}

export interface ResolvedRigGesture {
  clipId: string
  priority: number
  intensity: number
  tempo: number
}

export interface RigGestureSelection {
  seed?: number
  avoid?: readonly string[]
  prefer?: readonly string[]
  behaviorMode?: IdleBehaviorMode
  fidgetSequence?: number
}

export function resolveRigGesture(
  manifest: CompanionRigManifest,
  intent: RigGestureIntent,
  selection: RigGestureSelection = {},
): ResolvedRigGesture | null {
  const definition = GESTURES[intent]
  const preferred = selection.prefer?.length
    ? selectAvailableClip(manifest, selection.prefer, selection)
    : null
  const clip =
    preferred || selectAvailableClip(manifest, definition.candidates, selection)
  return clip
    ? {
        clipId: clip.id,
        priority: definition.priority,
        intensity: definition.intensity,
        tempo: definition.tempo,
      }
    : null
}

function selectAvailableClip(
  manifest: CompanionRigManifest,
  candidates: readonly string[],
  selection: RigGestureSelection,
) {
  const available = candidates.flatMap((id) => {
    const clip = manifest.clips.find((candidate) => candidate.id === id)
    return clip && !clip.looping ? [clip] : []
  })
  if (available.length === 0) return null
  const history = selection.avoid || []
  const recency = new Map(history.map((clipId, index) => [clipId, index]))
  const fresh = available.filter((clip) => !recency.has(clip.id))
  const oldestSeenIndex = Math.max(
    -1,
    ...available.map((clip) => recency.get(clip.id) ?? -1),
  )
  const pool =
    fresh.length > 0
      ? fresh
      : available.filter((clip) => recency.get(clip.id) === oldestSeenIndex)
  const seed = Number.isFinite(selection.seed)
    ? Math.trunc(selection.seed || 0)
    : 0
  return pool[gestureSelectionIndex(seed, pool.length)]
}

export function gestureSelectionIndex(
  seed: number,
  poolLength: number,
): number {
  if (poolLength <= 1) return 0
  const integer = Number.isFinite(seed) ? Math.trunc(seed) : 0
  if (Math.abs(integer) <= 1) {
    return ((integer % poolLength) + poolLength) % poolLength
  }
  let mixed = (integer + 2_654_435_769) >>> 0
  mixed ^= mixed >>> 16
  mixed = Math.imul(mixed, 569_420_461)
  mixed ^= mixed >>> 15
  mixed = Math.imul(mixed, 1_935_289_751)
  mixed ^= mixed >>> 15
  mixed = (mixed ^ (integer >>> 0)) >>> 0
  return mixed % poolLength
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5))
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50))
}
