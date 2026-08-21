import type { GeneratedMotionPhase } from './generation'
import type { GazeTarget } from './motion'
import type { MotionInterruptPolicy } from './planner'

export type PerformancePhase = 'anticipation' | 'action' | 'settle'
export type PerformanceExpression =
  | 'neutral'
  | 'happy'
  | 'surprise'
  | 'sad'
  | 'warm'
  | 'concerned'
  | 'focused'
  | 'playful'

export interface RigPerformanceContact {
  atMs: number
  kind: string
  intensity: number
}

export interface RigPerformanceAction {
  clipId: string
  priority: number
  intensity: number
  tempo: number
  fadeInMs: number
  fadeOutMs: number
  transitionMs: number
  interrupt: MotionInterruptPolicy
  exclusive: boolean
  contacts: RigPerformanceContact[]
  phase: GeneratedMotionPhase
  variationSeed?: number
}

export interface RigPerformanceCue {
  atMs: number
  phase: PerformancePhase
  actions: RigPerformanceAction[]
  gaze: GazeTarget | null
  gazeLeadMs: number
  expression: PerformanceExpression
  expressionLeadMs: number
}

export interface RigPerformanceSequence {
  id:
    | 'greeting'
    | 'explanation'
    | 'celebration'
    | 'thoughtful'
    | 'farewell'
    | 'encouragement'
    | 'apology'
    | 'discovery'
    | 'playful'
  durationMs: number
  cues: RigPerformanceCue[]
}

export type RigPerformanceTimelineEvent =
  | { atMs: number; type: 'gaze'; cueIndex: number }
  | { atMs: number; type: 'expression'; cueIndex: number }
  | { atMs: number; type: 'action'; cueIndex: number; actionIndex: number }
  | {
      atMs: number
      type: 'contact'
      cueIndex: number
      actionIndex: number
      contactIndex: number
    }
  | { atMs: number; type: 'release'; cueIndex: number }

export interface RigPerformancePlaybackState {
  sequenceId: RigPerformanceSequence['id']
  elapsedMs: number
  durationMs: number
  cueIndex: number
  phase: PerformancePhase
  running: boolean
}
