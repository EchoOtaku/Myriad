/**
 * Detects cue removal across revisions of the one global behavior plan.
 * Removing a live cue requires releasing the body controller before remaining
 * cues are restated from their wall-clock origin.
 */
export function reconcilePlayedBehaviorCues(
  played: Set<string>,
  live: readonly string[],
): boolean {
  const liveIds = new Set(live)
  const removed = [...played].some((behaviorId) => !liveIds.has(behaviorId))
  if (removed) played.clear()
  return removed
}
