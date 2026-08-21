import type {
  RigPerformancePlaybackState,
  RigPerformanceSequence,
  RigPerformanceTimelineEvent,
} from './performanceTypes'
import {
  advancePerformanceTimeline,
  buildPerformanceTimeline,
  performancePlaybackState,
} from './performanceTimeline'

export interface PerformanceAnimationClock {
  now: () => number
  requestFrame: (callback: (now: number) => void) => number
  cancelFrame: (frameId: number) => void
}

export interface RigPerformancePlaybackCallbacks {
  onEvent: (
    sequence: RigPerformanceSequence,
    event: RigPerformanceTimelineEvent,
  ) => void
  onProgress?: (state: RigPerformancePlaybackState) => void
}

interface ActivePerformancePlayback extends RigPerformancePlaybackCallbacks {
  id: number
  sequence: RigPerformanceSequence
  timeline: RigPerformanceTimelineEvent[]
  startedAt: number
  cursor: number
  frameId: number | null
  lastReportedAt: number
  lastReportedCue: number
}

export class RigPerformancePlayer {
  private active: ActivePerformancePlayback | null = null
  private nextPlaybackId = 1

  constructor(private readonly clock: PerformanceAnimationClock) {}

  play(
    sequence: RigPerformanceSequence,
    callbacks: RigPerformancePlaybackCallbacks,
  ): number | null {
    if (sequence.cues.length === 0) return null
    this.stop(false)
    const startedAt = this.clock.now()
    const playback: ActivePerformancePlayback = {
      ...callbacks,
      id: this.nextPlaybackId++,
      sequence,
      timeline: buildPerformanceTimeline(sequence),
      startedAt,
      cursor: 0,
      frameId: null,
      lastReportedAt: -Infinity,
      lastReportedCue: -1,
    }
    this.active = playback
    this.tick(playback.id, startedAt)
    return startedAt
  }

  stop(notify = true): void {
    const playback = this.active
    if (!playback) return
    this.active = null
    if (playback.frameId !== null) this.clock.cancelFrame(playback.frameId)
    if (notify && playback.onProgress) {
      playback.onProgress(
        performancePlaybackState(
          playback.sequence,
          this.clock.now() - playback.startedAt,
          false,
        ),
      )
    }
  }

  destroy(): void {
    this.stop(false)
  }

  private tick(playbackId: number, now: number): void {
    const playback = this.active
    if (!playback || playback.id !== playbackId) return
    const elapsedMs = Math.max(0, now - playback.startedAt)
    const advanced = advancePerformanceTimeline(
      playback.timeline,
      playback.cursor,
      elapsedMs,
    )
    playback.cursor = advanced.cursor
    for (const event of advanced.due) {
      playback.onEvent(playback.sequence, event)
      if (this.active?.id !== playbackId) return
    }

    const running = elapsedMs < playback.sequence.durationMs
    const state = performancePlaybackState(
      playback.sequence,
      elapsedMs,
      running,
    )
    if (
      !running ||
      state.cueIndex !== playback.lastReportedCue ||
      now - playback.lastReportedAt >= 50
    ) {
      playback.onProgress?.(state)
      playback.lastReportedAt = now
      playback.lastReportedCue = state.cueIndex
      if (this.active?.id !== playbackId) return
    }

    if (!running) {
      this.active = null
      return
    }
    playback.frameId = this.clock.requestFrame((frameNow) => {
      this.tick(playbackId, frameNow)
    })
  }
}

export function createBrowserPerformanceClock(): PerformanceAnimationClock {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
  }
}
