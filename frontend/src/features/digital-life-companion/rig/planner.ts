import type { RigGestureIntent } from './director'
import type { GeneratedMotionPhase } from './generation'
import type { MotionCharacterState } from './motion'
import type { RigPerformanceSequence } from './performanceTypes'

export type MotionInterruptPolicy = 'replace' | 'queue' | 'if-lower'

export interface PlannedMotionCue {
  intent: RigGestureIntent
  atMs: number
  intensity: number
  tempo: number
  fadeInMs: number
  fadeOutMs: number
  interrupt: MotionInterruptPolicy
  variationSeed: number
  phase: GeneratedMotionPhase
  transitionMs: number
  preferredClipIds?: string[]
}

export interface CompanionMotionPlan {
  source: 'reply' | 'proactive' | 'interaction' | 'preview'
  durationHintMs: number
  cues: PlannedMotionCue[]
  performanceId?: RigPerformanceSequence['id']
}

export interface CompanionMotionPlanRequest {
  text: string
  source?: CompanionMotionPlan['source']
  state: MotionCharacterState
}

export type GeneratedMotionPhraseId =
  'warm-greeting' | 'thoughtful-reply' | 'lively-explanation'

interface TextSignals {
  greeting: boolean
  question: boolean
  uncertain: boolean
  positive: boolean
  emphatic: boolean
  apology: boolean
  farewell: boolean
  playful: boolean
}

export function planCompanionMotion(
  request: CompanionMotionPlanRequest,
): CompanionMotionPlan {
  const text = request.text.trim()
  const signals = motionTextSignals(text)
  const source = request.source || 'reply'
  const energy = unit(request.state.energy)
  const mood = signed(request.state.mood)
  const social = unit(request.state.social)
  const affection = unit(request.state.affection)
  const durationHintMs = Math.round(
    clamp(1_250 + text.length * 48, 1_400, 8_500),
  )
  const intensity = clamp(
    0.54 + energy * 0.34 + Math.max(0, mood) * 0.12 + social * 0.08,
    0.48,
    1.16,
  )
  const tempo = clamp(0.76 + energy * 0.38, 0.68, 1.2)
  const cues: PlannedMotionCue[] = []
  const performanceId = performanceForSignals(signals, request.state, source)

  const add = (
    intent: RigGestureIntent,
    atMs: number,
    scale = 1,
    interrupt: MotionInterruptPolicy = cues.length === 0 ? 'replace' : 'queue',
    phase: GeneratedMotionPhase = 'action',
  ) => {
    if (cues.some((cue) => cue.intent === intent)) return
    cues.push({
      intent,
      atMs: Math.round(clamp(atMs, 0, durationHintMs - 220)),
      intensity: clamp(intensity * scale, 0.35, 1.3),
      tempo,
      fadeInMs: Math.round(105 + (1 - energy) * 85),
      fadeOutMs: Math.round(190 + affection * 90),
      interrupt,
      variationSeed: hashMotionSeed(text, intent, cues.length),
      phase,
      transitionMs: phase === 'action' ? 280 : 340,
    })
  }

  if (source === 'proactive') {
    add('notify', 0, 0.96, 'if-lower', 'action')
  } else if (signals.greeting) {
    add('greet', 0, 1.02)
  } else if (signals.uncertain) {
    add('question', 0, 0.72, 'replace', 'anticipation')
    add('respond', durationHintMs * 0.22, 0.84, 'queue', 'action')
  } else {
    add('respond', 0, 0.86)
  }

  if (signals.positive) {
    add('delight', durationHintMs * 0.34, 0.96)
  } else if (signals.emphatic) {
    add('emphasize', durationHintMs * 0.3, 1.04)
  }
  if (signals.question) {
    add('question', durationHintMs * 0.68, 0.72, 'queue', 'settle')
  }

  const continuousCues = applyMotionCueContinuity(
    cues.sort((left, right) => left.atMs - right.atMs).slice(0, 3),
  )
  return {
    source,
    durationHintMs,
    cues: continuousCues,
    ...(performanceId ? { performanceId } : {}),
  }
}

export function previewMotionPlan(
  intent: RigGestureIntent,
  state: MotionCharacterState,
): CompanionMotionPlan {
  const energy = unit(state.energy)
  return {
    source: 'preview',
    durationHintMs: 1_600,
    cues: [
      {
        intent,
        atMs: 0,
        intensity: 0.62 + energy * 0.42,
        tempo: 0.78 + energy * 0.36,
        fadeInMs: 120,
        fadeOutMs: 220,
        interrupt: 'replace',
        variationSeed: 0,
        phase: 'action',
        transitionMs: 260,
      },
    ],
  }
}

/** Builds a short semantic performance without choosing any fixed clip IDs. */
export function generateMotionPhrase(
  phraseId: GeneratedMotionPhraseId,
  state: MotionCharacterState,
  seed: number,
): CompanionMotionPlan {
  const definitions: Record<
    GeneratedMotionPhraseId,
    readonly [RigGestureIntent, RigGestureIntent, RigGestureIntent]
  > = {
    'warm-greeting': ['greet', 'respond', 'delight'],
    'thoughtful-reply': ['question', 'respond', 'emphasize'],
    'lively-explanation': ['respond', 'emphasize', 'delight'],
  }
  const preferredClips: Record<
    GeneratedMotionPhraseId,
    readonly (readonly string[])[]
  > = {
    'warm-greeting': [
      ['nod', 'bow', 'listen'],
      ['respond', 'nod', 'proud'],
      ['happy', 'shy', 'proud'],
    ],
    'thoughtful-reply': [
      ['observe', 'listen', 'thinking'],
      ['respond', 'nod', 'sigh'],
      ['shake-head', 'nod', 'bow'],
    ],
    'lively-explanation': [
      ['respond', 'observe', 'listen'],
      ['nod', 'proud', 'surprise'],
      ['happy', 'startle-settle', 'proud'],
    ],
  }
  const phases: readonly GeneratedMotionPhase[] = [
    'anticipation',
    'action',
    'settle',
  ]
  const energy = unit(state.energy)
  const affection = unit(state.affection)
  const durationHintMs = Math.round(3_200 + (1 - energy) * 620)
  const baseIntensity = 0.58 + energy * 0.38
  const baseTempo = 0.76 + energy * 0.36
  const cueGap = durationHintMs / 3.45
  const cues = definitions[phraseId].map((intent, index) => ({
    intent,
    atMs: Math.round(index * cueGap),
    intensity: clamp(
      baseIntensity * (index === 1 ? 1.04 : index === 2 ? 0.82 : 0.88),
      0.35,
      1.3,
    ),
    tempo: clamp(baseTempo * (index === 2 ? 0.9 : 1), 0.5, 1.35),
    fadeInMs: Math.round(125 + (1 - energy) * 65),
    fadeOutMs: Math.round(220 + affection * 100),
    interrupt: (index === 0 ? 'replace' : 'queue') as MotionInterruptPolicy,
    variationSeed: hashMotionSeed(phraseId, intent, seed + index * 17),
    phase: phases[index],
    transitionMs: index === 0 ? 300 : index === 1 ? 390 : 350,
    preferredClipIds: [...preferredClips[phraseId][index]],
  }))
  return {
    source: 'preview',
    durationHintMs,
    cues: applyMotionCueContinuity(cues),
  }
}

export function motionPlanFromMessageMeta(
  meta: Record<string, unknown>,
  source: CompanionMotionPlan['source'] = 'reply',
): CompanionMotionPlan | null {
  const value = meta.motionPlan
  if (!isRecord(value)) return null
  const performanceIds = new Set<RigPerformanceSequence['id']>([
    'greeting',
    'explanation',
    'celebration',
    'thoughtful',
    'farewell',
    'encouragement',
    'apology',
    'discovery',
    'playful',
  ])
  const performanceId = performanceIds.has(
    value.performanceId as RigPerformanceSequence['id'],
  )
    ? (value.performanceId as RigPerformanceSequence['id'])
    : undefined
  const intents = new Set<RigGestureIntent>([
    'greet',
    'respond',
    'question',
    'delight',
    'emphasize',
    'listen',
    'notify',
  ])
  const interrupts = new Set<MotionInterruptPolicy>([
    'replace',
    'queue',
    'if-lower',
  ])
  const phases = new Set<GeneratedMotionPhase>([
    'anticipation',
    'action',
    'settle',
  ])
  const rawCues = Array.isArray(value.cues) ? value.cues : []
  const cues = rawCues.slice(0, 3).flatMap((candidate, cueIndex) => {
    if (!isRecord(candidate)) return []
    const intent = candidate.intent as RigGestureIntent
    const interrupt = candidate.interrupt as MotionInterruptPolicy
    const phase = phases.has(candidate.phase as GeneratedMotionPhase)
      ? (candidate.phase as GeneratedMotionPhase)
      : 'action'
    if (
      !intents.has(intent) ||
      !interrupts.has(interrupt) ||
      !finite(candidate.atMs) ||
      !finite(candidate.intensity) ||
      !finite(candidate.tempo) ||
      !finite(candidate.fadeInMs) ||
      !finite(candidate.fadeOutMs)
    ) {
      return []
    }
    return [
      {
        intent,
        atMs: Math.round(clamp(candidate.atMs, 0, 5_000)),
        intensity: clamp(candidate.intensity, 0.2, 1.4),
        tempo: clamp(candidate.tempo, 0.5, 1.6),
        fadeInMs: Math.round(clamp(candidate.fadeInMs, 40, 600)),
        fadeOutMs: Math.round(clamp(candidate.fadeOutMs, 60, 800)),
        interrupt,
        variationSeed: finite(candidate.variationSeed)
          ? Math.max(0, Math.trunc(candidate.variationSeed)) >>> 0
          : hashMotionSeed(
              String(value.performanceId || source),
              intent,
              cueIndex,
            ),
        phase,
        transitionMs: finite(candidate.transitionMs)
          ? Math.round(clamp(candidate.transitionMs, 100, 520))
          : 280,
        preferredClipIds: Array.isArray(candidate.preferredClipIds)
          ? candidate.preferredClipIds
              .filter((clipId): clipId is string => typeof clipId === 'string')
              .slice(0, 8)
          : undefined,
      },
    ]
  })
  if (cues.length === 0 && !performanceId) return null
  cues.sort((left, right) => left.atMs - right.atMs)
  return {
    source,
    durationHintMs: Math.max(
      performanceId ? 4_000 : 1_200,
      (cues.at(-1)?.atMs || 0) + 900,
    ),
    cues: applyMotionCueContinuity(cues),
    ...(performanceId ? { performanceId } : {}),
  }
}

export function applyMotionCueContinuity(
  cues: readonly PlannedMotionCue[],
): PlannedMotionCue[] {
  return cues.map((cue, index) => {
    const previous = cues[index - 1]
    if (!previous) {
      return {
        ...cue,
        transitionMs: cue.intent === 'notify' ? 180 : cue.transitionMs,
      }
    }
    const gap = Math.max(0, cue.atMs - previous.atMs)
    const conversationalHandoff =
      (previous.intent === 'question' && cue.intent === 'respond') ||
      (previous.intent === 'respond' && cue.intent === 'question')
    return {
      ...cue,
      interrupt: cue.interrupt === 'replace' ? 'queue' : cue.interrupt,
      transitionMs: conversationalHandoff
        ? 380
        : gap < 650
          ? 340
          : gap > 1_800
            ? 240
            : cue.transitionMs,
    }
  })
}

export function motionTextSignals(text: string): TextSignals {
  const normalized = text.toLowerCase()
  return {
    greeting:
      /(^|[\s，,。.!！？])(你好|您好|嗨|哈喽|早上好|晚上好|hello|hi|hey|こんにちは|こんばんは)(?=$|[\s，,。.!！？])/iu.test(
        normalized,
      ),
    question: /[?？]/u.test(text),
    uncertain:
      /也许|可能|大概|不确定|让我想想|maybe|perhaps|not sure|たぶん|かもしれ/iu.test(
        normalized,
      ),
    positive:
      /太好了|真棒|开心|喜欢|谢谢|恭喜|great|wonderful|happy|love|thanks|嬉しい|ありがとう/iu.test(
        normalized,
      ),
    emphatic:
      /[!！]+|一定|必须|非常|真的|definitely|absolutely|important|必ず|とても/iu.test(
        normalized,
      ),
    apology: /对不起|抱歉|不好意思|sorry|apologi[sz]e|すみません|ごめん/iu.test(
      normalized,
    ),
    farewell:
      /再见|回头见|晚安|拜拜|goodbye|bye|see you|おやすみ|さようなら|またね/iu.test(
        normalized,
      ),
    playful:
      /哈哈|嘿嘿|好玩|可爱|逗你|lol|haha|playful|cute|ふふ|面白い|かわいい/iu.test(
        normalized,
      ),
  }
}

function performanceForSignals(
  signals: TextSignals,
  state: MotionCharacterState,
  source: CompanionMotionPlan['source'],
): RigPerformanceSequence['id'] | undefined {
  if (source !== 'reply') return undefined
  if (signals.apology) return 'apology'
  if (signals.farewell) return 'farewell'
  if (signals.playful) return 'playful'
  if (signals.greeting) return 'greeting'
  if (signals.positive && signals.emphatic) return 'celebration'
  if (signals.positive) return 'encouragement'
  if (signals.uncertain) return 'thoughtful'
  if (signals.question && state.curiosity >= 64) return 'discovery'
  if (signals.emphatic) return 'explanation'
  return undefined
}

function unit(value: number): number {
  return clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1)
}

function signed(value: number): number {
  return unit(value) * 2 - 1
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hashMotionSeed(text: string, intent: string, index: number): number {
  let hash = 2_166_136_261 ^ index
  const value = `${text}:${intent}`
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash ^= value.charCodeAt(cursor)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
