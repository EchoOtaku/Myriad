import { speakableText } from './speakableText'

export type SpeechInterruptMode = 'queue' | 'replace' | 'interrupt'

export interface SpeechSegment {
  segmentId: string
  sequence: number
  text: string
  messageId: string
  generation: number
  interrupt: SpeechInterruptMode
}

const CJK_SENTENCE_END = /[。！？!?…]/
const MAX_CHARS = 120
const MIN_CHARS = 4

/**
 * Accumulates Lite tokens and emits stable speakable sentences.
 * A segment is ready at a sentence end, a newline, or the max length.
 */
export class SpeechSegmenter {
  private raw = ''
  private spokenOffset = 0
  private sequence = 0
  private readonly messageId: string
  private readonly generation: number

  constructor(messageId: string, generation = 0) {
    this.messageId = messageId
    this.generation = generation
  }

  push(token: string, interrupt: SpeechInterruptMode = 'queue'): SpeechSegment[] {
    this.raw += token
    return this.flush(false, interrupt)
  }

  end(interrupt: SpeechInterruptMode = 'queue'): SpeechSegment[] {
    return this.flush(true, interrupt)
  }

  private flush(force: boolean, interrupt: SpeechInterruptMode): SpeechSegment[] {
    const spoken = speakableText(this.raw)
    while (
      this.spokenOffset < spoken.length &&
      /\s/.test(spoken[this.spokenOffset]!)
    ) {
      this.spokenOffset += 1
    }
    const remaining = spoken.slice(this.spokenOffset)
    const cut = nextCut(remaining, force)
    if (cut <= 0) {
      if (force) {
        this.raw = ''
        this.spokenOffset = 0
      }
      return []
    }
    const text = remaining.slice(0, cut).trim()
    this.spokenOffset += cut
    if (!text) return force ? this.flush(true, interrupt) : []
    this.sequence += 1
    const segment: SpeechSegment = {
      segmentId: `${this.messageId}:${this.sequence}`,
      sequence: this.sequence,
      text,
      messageId: this.messageId,
      generation: this.generation,
      interrupt,
    }
    const more = this.flush(force, force ? 'queue' : interrupt)
    if (more.length > 0) return [segment, ...more]
    return [segment]
  }
}

function nextCut(text: string, force: boolean): number {
  if (!text) return 0
  if (text.length >= MAX_CHARS) {
    const window = text.slice(0, MAX_CHARS)
    const end = lastSentenceEnd(window)
    if (end >= MIN_CHARS) return end
    const space = window.lastIndexOf(' ')
    return space >= MIN_CHARS ? space : MAX_CHARS
  }
  const end = firstSentenceEndAtLeast(text, MIN_CHARS)
  if (end >= MIN_CHARS) return end
  const newline = firstNewlineAtLeast(text, MIN_CHARS)
  if (newline >= MIN_CHARS) return newline
  return force ? text.length : 0
}

function firstSentenceEndAtLeast(text: string, minChars: number): number {
  for (let i = 0; i < text.length; i++) {
    const end = sentenceEndAfter(text, i)
    if (end >= minChars) return end
  }
  return -1
}

function firstNewlineAtLeast(text: string, minChars: number): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n' && i + 1 >= minChars) return i + 1
  }
  return -1
}

function lastSentenceEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const end = sentenceEndAfter(text, i)
    if (end > 0) return end
  }
  return -1
}

const PERIOD_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'inc',
  'ltd',
  'fig',
  'no',
])

/** Exclusive end index, or -1. ASCII `.` needs a following space and is not a decimal. */
function sentenceEndAfter(text: string, index: number): number {
  const ch = text[index]
  if (!ch) return -1
  if (CJK_SENTENCE_END.test(ch)) {
    let end = index + 1
    while (end < text.length && /[”’"')\]]/.test(text[end]!)) end += 1
    return end
  }
  if (ch !== '.') return -1
  const prev = text[index - 1]
  const next = text[index + 1]
  if (prev && /\d/.test(prev) && next && /\d/.test(next)) return -1
  if (next && !/\s/.test(next) && !/[”’"')\]]/.test(next)) return -1
  let end = index + 1
  while (end < text.length && /[”’"')\]]/.test(text[end]!)) end += 1
  if (isPeriodAbbreviation(text, index)) return -1
  const first = text.slice(end).match(/\S/u)?.[0]
  if (first && !looksLikeSentenceStart(first)) return -1
  return end
}

function isPeriodAbbreviation(text: string, periodIndex: number): boolean {
  let start = periodIndex - 1
  while (start >= 0 && /[A-Za-z]/.test(text[start]!)) start -= 1
  const word = text.slice(start + 1, periodIndex)
  return PERIOD_ABBREVIATIONS.has(word.toLowerCase())
}

function looksLikeSentenceStart(ch: string): boolean {
  return (
    /\p{Lu}/u.test(ch) ||
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)
  )
}
