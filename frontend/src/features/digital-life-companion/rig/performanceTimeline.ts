import type {
  RigPerformancePlaybackState,
  RigPerformanceSequence,
  RigPerformanceTimelineEvent,
} from './performanceTypes'

export function buildPerformanceTimeline(
  sequence: RigPerformanceSequence,
): RigPerformanceTimelineEvent[] {
  const events = sequence.cues.flatMap((cue, cueIndex) => {
    const cueEvents: RigPerformanceTimelineEvent[] = [
      {
        atMs: Math.max(0, cue.atMs - cue.gazeLeadMs),
        type: 'gaze',
        cueIndex,
      },
      {
        atMs: Math.max(0, cue.atMs - cue.expressionLeadMs),
        type: 'expression',
        cueIndex,
      },
    ]
    for (const [actionIndex, action] of cue.actions.entries()) {
      cueEvents.push({ atMs: cue.atMs, type: 'action', cueIndex, actionIndex })
      for (const [contactIndex, contact] of action.contacts.entries()) {
        cueEvents.push({
          atMs: cue.atMs + contact.atMs,
          type: 'contact',
          cueIndex,
          actionIndex,
          contactIndex,
        })
      }
    }
    return cueEvents
  })
  events.push({
    atMs: sequence.durationMs,
    type: 'release',
    cueIndex: Math.max(0, sequence.cues.length - 1),
  })
  return events.sort(
    (left, right) =>
      left.atMs - right.atMs ||
      timelineEventOrder(left.type) - timelineEventOrder(right.type),
  )
}

export function advancePerformanceTimeline(
  events: readonly RigPerformanceTimelineEvent[],
  cursor: number,
  elapsedMs: number,
): { due: RigPerformanceTimelineEvent[]; cursor: number } {
  let nextCursor = cursor
  while (nextCursor < events.length && events[nextCursor].atMs <= elapsedMs) {
    nextCursor += 1
  }
  return { due: events.slice(cursor, nextCursor), cursor: nextCursor }
}

export function performancePlaybackState(
  sequence: RigPerformanceSequence,
  elapsedMs: number,
  running: boolean,
): RigPerformancePlaybackState {
  const boundedElapsed = Math.max(0, Math.min(sequence.durationMs, elapsedMs))
  let cueIndex = 0
  for (let index = 1; index < sequence.cues.length; index += 1) {
    if (sequence.cues[index].atMs > boundedElapsed) break
    cueIndex = index
  }
  return {
    sequenceId: sequence.id,
    elapsedMs: boundedElapsed,
    durationMs: sequence.durationMs,
    cueIndex,
    phase: sequence.cues[cueIndex]?.phase || 'settle',
    running,
  }
}

function timelineEventOrder(type: RigPerformanceTimelineEvent['type']): number {
  return ['gaze', 'expression', 'action', 'contact', 'release'].indexOf(type)
}
