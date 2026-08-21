import type {
  RigClip,
  RigClipPresentation,
  RigPresentationKeyframe,
} from './types'

export interface PresentationEnvelopeAuthoringOptions {
  enter?: number
  holdUntil?: number
}

/**
 * Expands a clip's intended presentation into a normalized, portable envelope.
 * The static values remain the canonical apex intent and therefore continue to
 * work in older runtimes; keyframes add anticipation and settle timing.
 */
export function authorPresentationEnvelope(
  clip: RigClip,
  options: PresentationEnvelopeAuthoringOptions = {},
): RigClip {
  const presentation = clip.presentation
  if (!presentation || !hasStaticPresentation(presentation)) {
    throw new Error(`Clip ${clip.id} has no static presentation intent`)
  }
  const enter = options.enter ?? 0.16
  const holdUntil = options.holdUntil ?? 0.82
  if (!(enter > 0 && enter < holdUntil && holdUntil < 1)) {
    throw new Error(
      'Presentation envelope must satisfy 0 < enter < holdUntil < 1',
    )
  }
  const inactive = presentationKeyframe(0, presentation, false)
  const activeEnter = presentationKeyframe(enter, presentation, true)
  const activeHold = presentationKeyframe(holdUntil, presentation, true)
  const settled = presentationKeyframe(1, presentation, false)
  return {
    ...clip,
    presentation: {
      ...presentation,
      keyframes: [inactive, activeEnter, activeHold, settled],
    },
  }
}

function hasStaticPresentation(presentation: RigClipPresentation): boolean {
  return Boolean(presentation.expression)
}

function presentationKeyframe(
  progress: number,
  presentation: RigClipPresentation,
  active: boolean,
): RigPresentationKeyframe {
  return {
    progress,
    ...(presentation.expression
      ? { expression: active ? presentation.expression : 'neutral' }
      : {}),
  }
}
