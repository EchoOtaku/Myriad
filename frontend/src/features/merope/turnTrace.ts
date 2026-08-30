/**
 * Local end-to-end IO trace. Ring + counters only — never the run hub,
 * never volume frames, never mouth samples.
 */

export const TURN_TRACE_SPANS = [
  'input_started',
  'input_final',
  'request_sent',
  'reaction_ready',
  'llm_first_token',
  'first_sentence',
  'tts_queued',
  'tts_ready',
  'playback_started',
  'first_audio',
  'speech_ended',
  'turn_completed',
] as const

export type TurnTraceSpan = (typeof TURN_TRACE_SPANS)[number]

export type TurnTraceDropReason =
  | 'stale_generation'
  | 'superseded'
  | 'hidden_face'
  | 'gated_record'
  | 'tts_unavailable'
  | 'synth_failed'
  | 'queue_replaced'
  | 'cancelled'
  | 'lease_conflict'

export type TurnTraceExtra = Record<string, string | number | boolean>

export interface TurnTraceMark {
  span: string
  t: number
  turnId: string
  extra?: TurnTraceExtra
}

export interface TurnTraceCounters {
  staleGenerationDrops: number
  leaseConflicts: number
  leaseExpiries: number
  droppedFrames: number
  ttsQueuePeak: number
  ttsQueueLength: number
  cancelToSilenceMs: number
  asrMs: number
  ttsSynthMs: number
  llmFirstTokenMs: number
  frameCpuMs: number
  audioContexts: number
  voiceListeners: number
  liveLeases: number
}

const RING = 96

function emptyCounters(): TurnTraceCounters {
  return {
    staleGenerationDrops: 0,
    leaseConflicts: 0,
    leaseExpiries: 0,
    droppedFrames: 0,
    ttsQueuePeak: 0,
    ttsQueueLength: 0,
    cancelToSilenceMs: 0,
    asrMs: 0,
    ttsSynthMs: 0,
    llmFirstTokenMs: 0,
    frameCpuMs: 0,
    audioContexts: 0,
    voiceListeners: 0,
    liveLeases: 0,
  }
}

let turnId = ''
const firsts = new Set<string>()
const marks: TurnTraceMark[] = []
let counters = emptyCounters()
const pending = new Map<TurnTraceSpan, { t: number; extra?: TurnTraceExtra }>()

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function emit(mark: TurnTraceMark): void {
  if (typeof window === 'undefined') return
  if (typeof console.debug !== 'function') return
  console.debug(
    JSON.stringify({
      src: 'merope.trace',
      span: mark.span,
      t: Math.round(mark.t),
      turn: mark.turnId,
      ...(mark.extra ?? {}),
    }),
  )
}

function record(mark: TurnTraceMark): void {
  marks.push(mark)
  if (marks.length > RING) marks.shift()
  emit(mark)
  if (mark.span === 'input_final') {
    counters.asrMs = delayBetween('input_started', 'input_final') ?? counters.asrMs
  }
  if (mark.span === 'llm_first_token') {
    counters.llmFirstTokenMs =
      delayBetween('request_sent', 'llm_first_token') ?? counters.llmFirstTokenMs
  }
}

function delayBetween(from: string, to: string): number | null {
  const start = lastMark(from)
  const end = lastMark(to)
  if (!start || !end) return null
  return Math.max(0, Math.round(end.t - start.t))
}

function lastMark(span: string): TurnTraceMark | undefined {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]
    if (mark && mark.span === span && mark.turnId === turnId) return mark
  }
  return undefined
}

export function beginTurnTrace(id: string): void {
  turnId = id
  firsts.clear()
  for (const span of TURN_TRACE_SPANS) {
    const held = pending.get(span)
    if (!held) continue
    firsts.add(`${turnId}:${span}`)
    record({ span, t: held.t, turnId, extra: held.extra })
  }
  pending.clear()
}

/** Stamp a span before the owning turn exists (ASR start, VAD). */
export function stampTurnTrace(span: TurnTraceSpan, extra?: TurnTraceExtra): void {
  if (turnId) {
    markTurnTraceOnce(span, extra)
    return
  }
  if (!pending.has(span)) pending.set(span, { t: now(), extra })
}

export function markTurnTrace(span: string, extra?: TurnTraceExtra): void {
  record({ span, t: now(), turnId, extra })
}

export function markTurnTraceOnce(
  span: TurnTraceSpan | string,
  extra?: TurnTraceExtra,
): void {
  const key = `${turnId}:${span}`
  if (firsts.has(key)) return
  firsts.add(key)
  markTurnTrace(span, extra)
}

export function noteTurnTraceDrop(reason: TurnTraceDropReason): void {
  if (reason === 'stale_generation') counters.staleGenerationDrops += 1
  if (reason === 'lease_conflict') {
    counters.leaseConflicts += 1
    return
  }
  markTurnTrace('drop', { reason })
}

export function noteTurnTraceQueue(length: number): void {
  const value = Math.max(0, Math.trunc(length))
  counters.ttsQueueLength = value
  if (value > counters.ttsQueuePeak) counters.ttsQueuePeak = value
}

export function noteTurnTraceDelay(
  kind: 'asr' | 'tts' | 'llm',
  ms: number,
): void {
  const value = Math.max(0, Math.round(ms))
  if (kind === 'asr') counters.asrMs = value
  else if (kind === 'tts') counters.ttsSynthMs = value
  else counters.llmFirstTokenMs = value
}

export function noteTurnTraceCancelToSilence(ms: number): void {
  counters.cancelToSilenceMs = Math.max(0, Math.round(ms))
}

export function noteTurnTraceLeaseExpiry(count = 1): void {
  counters.leaseExpiries += Math.max(0, Math.trunc(count))
}

export function noteTurnTraceFrame(input: {
  dropped: boolean
  cpuMs?: number
}): void {
  if (input.dropped) counters.droppedFrames += 1
  if (input.cpuMs != null && Number.isFinite(input.cpuMs)) {
    counters.frameCpuMs = Math.max(0, input.cpuMs)
  }
}

export function noteTurnTraceLeaks(sample: {
  audioContexts: number
  voiceListeners: number
  leases: number
}): void {
  counters.audioContexts = Math.max(0, Math.trunc(sample.audioContexts))
  counters.voiceListeners = Math.max(0, Math.trunc(sample.voiceListeners))
  counters.liveLeases = Math.max(0, Math.trunc(sample.leases))
}

export function snapshotTurnTrace(): {
  turnId: string
  marks: readonly TurnTraceMark[]
  counters: TurnTraceCounters
  delays: {
    asrMs: number
    llmFirstTokenMs: number
    ttsSynthMs: number
    cancelToSilenceMs: number
  }
} {
  return {
    turnId,
    marks: marks.slice(),
    counters: { ...counters },
    delays: {
      asrMs: counters.asrMs,
      llmFirstTokenMs: counters.llmFirstTokenMs,
      ttsSynthMs: counters.ttsSynthMs,
      cancelToSilenceMs: counters.cancelToSilenceMs,
    },
  }
}

export function resetTurnTraceForTest(): void {
  turnId = ''
  firsts.clear()
  marks.length = 0
  counters = emptyCounters()
  pending.clear()
}
