import type { SpeechInterruptMode, SpeechSegment } from './speechSegmenter'
import { getSpeechStatus, textToSpeech } from '../../../services/speechApi'
import { liveMotionGeneration } from '../motion/liveGeneration'
import { dispatchMeropeSpeech } from '../speechEvents'
import {
  markTurnTraceOnce,
  noteTurnTraceCancelToSilence,
} from '../turnTrace'
import { speakableText } from './speakableText'
import { SpeechSegmenter } from './speechSegmenter'
import { TtsPipeline } from './ttsPipeline'
import { playTtsBuffer } from './ttsPlayer'
import { patchVoicePresence } from './voicePresence'

function audioFromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * One live-face TTS outlet. Synthesis may run ahead; playback stays ordered.
 */
export class SpeechPipelineHost {
  readonly pipeline: TtsPipeline
  private enabled = false
  private probed = false
  private cancelledAt: number | null = null

  constructor() {
    this.pipeline = new TtsPipeline({
      synthesize: (segment) => this.synthesize(segment),
      play: (audio, segment, onEnded) => this.play(audio, segment, onEnded),
      onCancel: (messageId) => this.emitCancel(messageId),
    })
    void this.probe()
  }

  get available(): boolean {
    return this.enabled
  }

  async probe(): Promise<boolean> {
    if (this.probed) return this.enabled
    this.probed = true
    try {
      const status = await getSpeechStatus()
      this.enabled = Boolean(status.available && status.tts_enabled)
    } catch {
      this.enabled = false
    }
    return this.enabled
  }

  feed(segments: readonly SpeechSegment[]): void {
    if (!this.enabled || segments.length === 0) return
    const mode = segments[0]!.interrupt
    this.pipeline.enqueue(segments, mode)
  }

  /**
   * One finished line through the same TTS queue as streamed Chat.
   * Returns false when TTS is off so callers may fall back to text visemes.
   */
  speakLine(input: {
    messageId: string
    text: string
    generation?: number
    interrupt?: SpeechInterruptMode
  }): boolean {
    if (!this.enabled) return false
    const text = speakableText(input.text)
    if (!text) return false
    const interrupt = input.interrupt ?? 'queue'
    const splitter = new SpeechSegmenter(input.messageId, input.generation ?? 0)
    const segments = [
      ...splitter.push(text, interrupt),
      ...splitter.end(interrupt),
    ]
    if (segments.length === 0) return false
    this.feed(segments)
    return true
  }

  cancel(messageId?: string): void {
    this.cancelledAt = nowMs()
    this.pipeline.cancel(messageId)
    patchVoicePresence({ ttsPlaying: false })
    this.noteSilence()
  }

  private async synthesize(segment: SpeechSegment): Promise<ArrayBuffer | null> {
    try {
      const result = await textToSpeech({
        text: segment.text.slice(0, 150),
        codec: 'mp3',
        sample_rate: 16000,
      })
      if (!result.success || !result.audio) return null
      return audioFromBase64(result.audio)
    } catch {
      return null
    }
  }

  private play(
    audio: ArrayBuffer,
    segment: SpeechSegment,
    onEnded: () => void,
  ): { stop: () => void } {
    const generation = liveMotionGeneration()
    const utteranceId = `tts-${segment.segmentId}`
    dispatchMeropeSpeech({
      phase: 'start',
      messageId: segment.messageId,
      source: 'reply',
      utteranceId,
      ...(generation ? { generation } : {}),
    })
    patchVoicePresence({ ttsPlaying: true })
    const handle = playTtsBuffer(audio, segment, {
      onEnergy: (energy, articulation) => {
        markTurnTraceOnce('first_audio')
        dispatchMeropeSpeech({
          phase: 'energy',
          messageId: segment.messageId,
          source: 'reply',
          utteranceId,
          energy,
          ...(generation ? { generation } : {}),
        })
        dispatchMeropeSpeech({
          phase: 'articulation',
          messageId: segment.messageId,
          source: 'reply',
          utteranceId,
          articulation,
          ...(generation ? { generation } : {}),
        })
      },
      onEnded: () => {
        onEnded()
        if (this.pipeline.playing || this.pipeline.queueLength > 0) return
        dispatchMeropeSpeech({
          phase: 'end',
          messageId: segment.messageId,
          source: 'reply',
          utteranceId,
          ...(generation ? { generation } : {}),
        })
        patchVoicePresence({ ttsPlaying: false })
        markTurnTraceOnce('speech_ended')
      },
    })
    return {
      stop: () => {
        handle.stop()
        patchVoicePresence({ ttsPlaying: false })
        this.noteSilence()
      },
    }
  }

  private noteSilence(): void {
    if (this.cancelledAt == null) return
    noteTurnTraceCancelToSilence(nowMs() - this.cancelledAt)
    this.cancelledAt = null
    markTurnTraceOnce('speech_ended')
  }

  private emitCancel(messageId: string): void {
    dispatchMeropeSpeech({
      phase: 'cancel',
      messageId,
      source: 'reply',
    })
  }
}

let host: SpeechPipelineHost | null = null

export function getSpeechPipeline(): SpeechPipelineHost {
  if (!host) host = new SpeechPipelineHost()
  return host
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
