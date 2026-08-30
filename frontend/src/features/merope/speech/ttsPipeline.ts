import type { SpeechInterruptMode, SpeechSegment } from './speechSegmenter'

export interface TtsAudioHandle {
  stop: () => void
}

export interface TtsPipelineHost {
  synthesize: (segment: SpeechSegment) => Promise<ArrayBuffer | null>
  play: (
    audio: ArrayBuffer,
    segment: SpeechSegment,
    onEnded: () => void,
  ) => TtsAudioHandle
  onCancel?: (messageId: string) => void
}

const MAX_SYNTH = 2

interface ReadySlot {
  segment: SpeechSegment
  audio: ArrayBuffer | null
}

/**
 * Synthesize up to two segments at once; play strictly by sequence.
 * A failed synth skips that segment and does not fail the text reply.
 */
export class TtsPipeline {
  private epoch = 0
  private nextSequence = 1
  private inflight = 0
  private readonly pending: SpeechSegment[] = []
  private readonly ready = new Map<number, ReadySlot>()
  private handle: TtsAudioHandle | null = null
  private playingMessageId: string | null = null

  constructor(private readonly host: TtsPipelineHost) {}

  get playing(): boolean {
    return this.handle != null
  }

  enqueue(
    segments: readonly SpeechSegment[],
    mode: SpeechInterruptMode = 'queue',
  ): void {
    if (segments.length === 0) return
    const messageId = segments[0]!.messageId
    if (mode === 'interrupt') this.cancel()
    else if (mode === 'replace') this.replaceMessage(messageId)
    for (const segment of segments) this.pending.push(segment)
    this.pumpSynth()
  }

  cancel(messageId?: string): void {
    if (messageId && this.playingMessageId && this.playingMessageId !== messageId) {
      this.dropMessage(messageId)
      return
    }
    this.epoch += 1
    this.stopPlayback()
    this.pending.length = 0
    this.ready.clear()
    this.nextSequence = 1
    this.inflight = 0
    const id = messageId ?? this.playingMessageId
    this.playingMessageId = null
    if (id) this.host.onCancel?.(id)
  }

  private replaceMessage(messageId: string): void {
    this.dropMessage(messageId)
    if (this.playingMessageId === messageId) this.stopPlayback()
  }

  private dropMessage(messageId: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]?.messageId === messageId) this.pending.splice(i, 1)
    }
    for (const [sequence, slot] of [...this.ready]) {
      if (slot.segment.messageId === messageId) this.ready.delete(sequence)
    }
  }

  private pumpSynth(): void {
    while (this.inflight < MAX_SYNTH && this.pending.length > 0) {
      const segment = this.pending.shift()!
      const epoch = this.epoch
      this.inflight += 1
      void this.host
        .synthesize(segment)
        .catch(() => null)
        .then((audio) => {
          this.inflight = Math.max(0, this.inflight - 1)
          if (epoch !== this.epoch) {
            this.pumpSynth()
            return
          }
          this.ready.set(segment.sequence, { segment, audio })
          this.tryPlay()
          this.pumpSynth()
        })
    }
  }

  private tryPlay(): void {
    if (this.handle) return
    const slot = this.ready.get(this.nextSequence)
    if (!slot) return
    this.ready.delete(this.nextSequence)
    this.nextSequence += 1
    if (!slot.audio) {
      this.tryPlay()
      return
    }
    this.playingMessageId = slot.segment.messageId
    const epoch = this.epoch
    this.handle = this.host.play(slot.audio, slot.segment, () => {
      if (epoch !== this.epoch) return
      this.handle = null
      this.tryPlay()
    })
  }

  private stopPlayback(): void {
    this.handle?.stop()
    this.handle = null
  }
}
