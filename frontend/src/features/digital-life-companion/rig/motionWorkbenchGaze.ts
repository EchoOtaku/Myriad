import type { MotionDebugSignals } from './motion'

export const MOTION_GAZE_SOURCE_REVEAL_MS = 240

export function motionWorkbenchGazeSource(
  source: MotionDebugSignals['gazeSource'],
  revealReady: boolean,
): MotionDebugSignals['gazeSource'] | 'none' {
  return revealReady ? source : 'none'
}
