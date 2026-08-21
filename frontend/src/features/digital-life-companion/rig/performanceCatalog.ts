import type { GazeTarget } from './motion'
import type {
  PerformanceExpression,
  PerformancePhase,
  RigPerformanceAction,
  RigPerformanceContact,
  RigPerformanceCue,
  RigPerformanceSequence,
} from './performanceTypes'
import type { CompanionRigManifest, RigClip } from './types'

interface TemplateAction extends Omit<
  RigPerformanceAction,
  'clipId' | 'contacts'
> {
  candidates: readonly string[]
}

interface TemplateCue extends Omit<RigPerformanceCue, 'actions'> {
  actions: readonly TemplateAction[]
}

interface SequenceTemplate extends Omit<RigPerformanceSequence, 'cues'> {
  cues: readonly TemplateCue[]
}

const TEMPLATES: readonly SequenceTemplate[] = [
  {
    id: 'greeting',
    durationMs: 3_800,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(-0.35, -0.08, 0.55),
        'neutral',
        action(
          ['observe', 'idle-accent', 'listen'],
          'anticipation',
          0.6,
          0.86,
        ),
      ),
      beat(
        650,
        'action',
        gaze(0, -0.12, 1),
        'warm',
        action(
          ['greet', 'nod', 'bow', 'respond'],
          'action',
          0.92,
          0.98,
        ),
      ),
      beat(
        1_800,
        'action',
        gaze(0.22, -0.08, 0.9),
        'playful',
        action(
          ['happy', 'proud', 'startle-settle', 'nod'],
          'action',
          0.86,
          1,
        ),
      ),
      beat(
        2_950,
        'settle',
        gaze(0, 0, 0.72),
        'neutral',
        action(['nod', 'bow', 'respond'], 'settle', 0.62, 0.86),
      ),
    ],
  },
  {
    id: 'explanation',
    durationMs: 4_200,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(-0.18, -0.04, 0.72),
        'focused',
        action(
          ['listen', 'observe', 'thinking'],
          'anticipation',
          0.54,
          0.82,
        ),
      ),
      beat(
        700,
        'action',
        gaze(0, -0.08, 0.95),
        'focused',
        action(['respond', 'proud', 'nod'], 'action', 0.8, 0.9),
        layer(['nod', 'respond'], 'action', 0.48, 0.86),
      ),
      beat(
        1_900,
        'action',
        gaze(-0.52, -0.1, 1),
        'neutral',
        action(
          ['nod', 'observe', 'respond', 'proud'],
          'action',
          0.88,
          0.96,
        ),
        layer(['observe', 'listen'], 'action', 0.44, 0.82),
      ),
      beat(
        3_200,
        'settle',
        gaze(0, 0, 0.7),
        'neutral',
        action(['bow', 'nod', 'sigh'], 'settle', 0.56, 0.82),
      ),
    ],
  },
  {
    id: 'celebration',
    durationMs: 3_850,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(0, -0.18, 1),
        'surprise',
        action(
          ['startle-settle', 'surprise', 'happy'],
          'anticipation',
          0.82,
          0.98,
        ),
      ),
      beat(
        480,
        'action',
        gaze(0, -0.2, 1),
        'happy',
        action(
          ['surprise', 'happy', 'proud', 'nod'],
          'action',
          1.06,
          1.04,
        ),
      ),
      beat(
        1_550,
        'action',
        gaze(0.2, -0.12, 0.92),
        'happy',
        action(
          ['happy', 'proud', 'nod'],
          'action',
          0.98,
          1.06,
        ),
      ),
      beat(
        3_000,
        'settle',
        gaze(0, -0.04, 0.76),
        'happy',
        action(['proud', 'nod', 'happy'], 'settle', 0.68, 0.86),
      ),
    ],
  },
  {
    id: 'thoughtful',
    durationMs: 4_300,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(0.34, -0.34, 0.78),
        'focused',
        action(
          ['thinking', 'observe', 'listen'],
          'anticipation',
          0.5,
          0.74,
        ),
      ),
      beat(
        900,
        'action',
        gaze(-0.22, -0.18, 0.82),
        'concerned',
        action(
          ['shake-head', 'sigh', 'observe'],
          'action',
          0.62,
          0.8,
        ),
      ),
      beat(
        2_200,
        'action',
        gaze(0, -0.08, 0.94),
        'neutral',
        action(['respond', 'nod', 'listen'], 'action', 0.72, 0.88),
        layer(['observe', 'listen'], 'action', 0.38, 0.78),
      ),
      beat(
        3_400,
        'settle',
        gaze(0, 0, 0.64),
        'neutral',
        action(['sigh', 'nod', 'bow'], 'settle', 0.48, 0.76),
      ),
    ],
  },
  {
    id: 'farewell',
    durationMs: 4_000,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(-0.16, -0.04, 0.68),
        'neutral',
        action(
          ['look-around', 'observe', 'listen'],
          'anticipation',
          0.5,
          0.8,
        ),
      ),
      beat(
        700,
        'action',
        gaze(0, -0.12, 0.98),
        'happy',
        action(
          ['look-around', 'observe', 'listen'],
          'action',
          0.62,
          0.9,
        ),
        layer(['nod', 'bow', 'respond'], 'action', 0.88, 0.94),
      ),
      beat(
        2_150,
        'action',
        gaze(0.3, -0.08, 0.82),
        'happy',
        action(
          ['greet', 'nod', 'bow', 'respond'],
          'action',
          0.7,
          0.88,
        ),
      ),
      beat(
        3_100,
        'settle',
        gaze(0, 0.04, 0.62),
        'neutral',
        action(['bow', 'nod', 'sigh'], 'settle', 0.58, 0.8),
      ),
    ],
  },
  {
    id: 'encouragement',
    durationMs: 4_200,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(-0.12, -0.02, 0.82),
        'warm',
        action(
          ['listen', 'observe', 'thinking'],
          'anticipation',
          0.5,
          0.8,
        ),
      ),
      beat(
        760,
        'action',
        gaze(0, -0.1, 1),
        'warm',
        action(
          ['respond', 'greet', 'nod'],
          'action',
          0.76,
          0.9,
        ),
        layer(['nod', 'bow'], 'action', 0.48, 0.88),
      ),
      beat(
        2_000,
        'action',
        gaze(0.1, -0.16, 1),
        'happy',
        action(
          ['happy', 'proud', 'nod'],
          'action',
          0.92,
          0.98,
        ),
      ),
      beat(
        3_250,
        'settle',
        gaze(0, -0.02, 0.72),
        'happy',
        action(['proud', 'bow', 'happy'], 'settle', 0.62, 0.82),
      ),
    ],
  },
  {
    id: 'apology',
    durationMs: 4_300,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(-0.28, 0.12, 0.62),
        'concerned',
        action(
          ['shy', 'sigh', 'observe'],
          'anticipation',
          0.48,
          0.74,
        ),
      ),
      beat(
        900,
        'action',
        gaze(0, 0.05, 0.82),
        'concerned',
        action(['bow', 'shake-head', 'sigh'], 'action', 0.72, 0.78),
      ),
      beat(
        2_200,
        'action',
        gaze(-0.08, -0.02, 0.86),
        'sad',
        action(['sigh', 'respond', 'nod'], 'action', 0.56, 0.76),
      ),
      beat(
        3_400,
        'settle',
        gaze(0, 0, 0.7),
        'neutral',
        action(['nod', 'respond', 'bow'], 'settle', 0.48, 0.78),
      ),
    ],
  },
  {
    id: 'discovery',
    durationMs: 4_200,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(0.34, -0.22, 0.78),
        'neutral',
        action(
          ['look-around', 'observe', 'thinking', 'listen'],
          'anticipation',
          0.5,
          0.78,
        ),
      ),
      beat(
        720,
        'action',
        gaze(-0.42, -0.18, 1),
        'surprise',
        action(
          ['startle-settle', 'surprise', 'poke-reaction', 'happy'],
          'action',
          0.88,
          0.94,
        ),
      ),
      beat(
        1_850,
        'action',
        gaze(-0.55, -0.1, 1),
        'happy',
        action(
          ['nod', 'proud', 'surprise'],
          'action',
          0.84,
          0.94,
        ),
        layer(['observe', 'listen'], 'action', 0.48, 0.86),
      ),
      beat(
        3_200,
        'settle',
        gaze(0, -0.04, 0.76),
        'happy',
        action(['nod', 'proud', 'happy'], 'settle', 0.62, 0.84),
      ),
    ],
  },
  {
    id: 'playful',
    durationMs: 4_000,
    cues: [
      beat(
        0,
        'anticipation',
        gaze(0.26, -0.12, 0.76),
        'playful',
        action(
          ['deep-breath', 'idle-accent', 'shy', 'observe'],
          'anticipation',
          0.58,
          0.9,
        ),
      ),
      beat(
        650,
        'action',
        gaze(0, -0.14, 1),
        'playful',
        action(
          ['shy', 'happy', 'idle-accent'],
          'action',
          0.76,
          1,
        ),
        layer(['nod', 'proud'], 'action', 0.82, 1.02),
      ),
      beat(
        1_950,
        'action',
        gaze(0.12, -0.12, 1),
        'happy',
        action(
          ['happy', 'proud', 'nod'],
          'action',
          0.9,
          1.02,
        ),
      ),
      beat(
        3_100,
        'settle',
        gaze(0, -0.02, 0.72),
        'happy',
        action(['proud', 'nod', 'happy'], 'settle', 0.6, 0.86),
      ),
    ],
  },
]

export function buildRigPerformanceSequences(
  manifest: CompanionRigManifest,
): RigPerformanceSequence[] {
  const clipsById = new Map(manifest.clips.map((clip) => [clip.id, clip]))
  return TEMPLATES.flatMap((template) => {
    const used = new Set<string>()
    const cues = template.cues.flatMap((templateCue) => {
      const claimed = new Set<string>()
      const resolved = templateCue.actions.map(
        ({ candidates, ...definition }, actionIndex) => {
          const clipId = candidates.find(
            (candidate) =>
              clipsById.has(candidate) &&
              !used.has(candidate) &&
              !claimed.has(candidate),
          )
          if (!clipId) return null
          claimed.add(clipId)
          const clip = clipsById.get(clipId)
          if (!clip) return null
          const clipDurationMs = (clip.duration * 1_000) / definition.tempo
          const remainingSequenceMs = template.durationMs - templateCue.atMs
          return {
            ...definition,
            clipId,
            variationSeed: performanceSeed(
              template.id,
              clipId,
              templateCue.atMs,
            ),
            exclusive: actionIndex === 0 && definition.exclusive,
            contacts: contactsForClip(clip, definition.tempo).filter(
              (contact) =>
                contact.atMs < clipDurationMs &&
                contact.atMs < remainingSequenceMs,
            ),
          }
        },
      )
      if (!resolved[0]) return []
      const actions = resolved.filter(
        (action): action is NonNullable<typeof action> => action !== null,
      )
      for (const action of actions) used.add(action.clipId)
      return [{ ...templateCue, actions }]
    })
    return cues.length >= 3 ? [{ ...template, cues }] : []
  })
}

function beat(
  atMs: number,
  phase: PerformancePhase,
  target: GazeTarget | null,
  expression: PerformanceExpression,
  ...actions: readonly TemplateAction[]
): TemplateCue {
  return {
    atMs,
    phase,
    actions,
    gaze: target,
    gazeLeadMs: phase === 'action' ? 160 : 110,
    expression,
    expressionLeadMs: phase === 'action' ? 110 : 75,
  }
}

function action(
  candidates: readonly string[],
  phase: PerformancePhase,
  intensity: number,
  tempo: number,
): TemplateAction {
  return actionStyle(candidates, phase, intensity, tempo, true)
}

function layer(
  candidates: readonly string[],
  phase: PerformancePhase,
  intensity: number,
  tempo: number,
): TemplateAction {
  return actionStyle(candidates, phase, intensity, tempo, false)
}

function actionStyle(
  candidates: readonly string[],
  phase: PerformancePhase,
  intensity: number,
  tempo: number,
  exclusive: boolean,
): TemplateAction {
  return {
    candidates,
    phase,
    priority: exclusive ? 210 : 205,
    intensity,
    tempo,
    fadeInMs: phase === 'action' ? 130 : 210,
    fadeOutMs: phase === 'settle' ? 420 : 300,
    transitionMs: phase === 'action' ? 280 : 360,
    interrupt: 'replace',
    exclusive,
  }
}

function performanceSeed(
  sequenceId: string,
  clipId: string,
  atMs: number,
): number {
  let hash = 2_166_136_261 ^ atMs
  for (const character of `${sequenceId}:${clipId}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function contactsForClip(
  clip: RigClip,
  tempo: number,
): RigPerformanceContact[] {
  return (clip.events ?? []).map((event) => ({
    kind: event.kind,
    intensity: event.intensity,
    atMs: Math.round(
      (event.progress * clip.duration * 1_000) / Math.max(0.5, tempo),
    ),
  }))
}

function gaze(x: number, y: number, attention: number): GazeTarget {
  return { x, y, attention }
}
