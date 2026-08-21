import type { RigGestureIntent } from './director'
import type { RigClip } from './types'

export type RigActionPresetLabel =
  | 'motionPresetCommunication'
  | 'motionPresetEmotion'
  | 'motionPresetExpression'
  | 'motionPresetAmbient'

export interface RigActionPresetGroup {
  label: RigActionPresetLabel
  clipIds: readonly string[]
}

export const RIG_PREVIEW_INTENTS: readonly RigGestureIntent[] = [
  'greet',
  'respond',
  'question',
  'delight',
  'emphasize',
  'notify',
]

export const RIG_ACTION_PRESET_GROUPS: readonly RigActionPresetGroup[] = [
  {
    label: 'motionPresetCommunication',
    clipIds: ['greet', 'nod', 'shake-head', 'bow'],
  },
  {
    label: 'motionPresetEmotion',
    clipIds: [
      'surprise',
      'shy',
      'proud',
      'sigh',
      'poke-reaction',
      'startle-settle',
    ],
  },
  {
    label: 'motionPresetExpression',
    clipIds: ['blink', 'happy', 'sad', 'sleep', 'pat-reaction'],
  },
  {
    label: 'motionPresetAmbient',
    clipIds: [
      'idle',
      'idle-accent',
      'thinking',
      'talking',
      'listen',
      'respond',
      'observe',
      'look-around',
      'deep-breath',
    ],
  },
]

const RIG_DEMO_CLIP_PRIORITY = [
  'greet',
  'nod',
  'shake-head',
  'bow',
  'startle-settle',
  'surprise',
  'shy',
  'proud',
  'thinking',
  'talking',
  'listen',
  'respond',
  'observe',
  'look-around',
  'deep-breath',
  'poke-reaction',
  'sigh',
  'idle-accent',
  'idle',
] as const

export function availableRigActionPresetGroups(
  clips: readonly RigClip[],
): RigActionPresetGroup[] {
  const availableIds = new Set(clips.map((clip) => clip.id))
  return RIG_ACTION_PRESET_GROUPS.map((group) => ({
    ...group,
    clipIds: group.clipIds.filter((clipId) => availableIds.has(clipId)),
  })).filter((group) => group.clipIds.length > 0)
}

export function labelMotionId(id: string): string {
  return id
    .replace(/^a25d-/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function sortRigClipsForDemo(clips: readonly RigClip[]): RigClip[] {
  const priority = new Map<string, number>()
  RIG_DEMO_CLIP_PRIORITY.forEach((clipId, index) => {
    priority.set(clipId, index)
  })
  return [...clips].sort(
    (left, right) =>
      (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  )
}
