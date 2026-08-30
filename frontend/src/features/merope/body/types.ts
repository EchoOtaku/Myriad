/**
 * Body is the live face the site actually has. Semantic only — no drivers.
 */

export interface BodyCapabilities {
  semantic: readonly string[]
}

export interface BodyIntent {
  speechText?: string
  messageId?: string
  performance?: unknown
}

export interface BodyState {
  expression: string
  posture: string
  acting: string | null
  speaking: boolean
  faceVisible: boolean
  capabilities: readonly string[]
}

export interface BodyAdapter {
  capabilities: () => BodyCapabilities
  state: () => BodyState
  intend: (intent: BodyIntent) => void
}

export interface PerceptionAdapter {
  capture: (input: {
    route: string
    page: unknown
    pageConsent: boolean
    selection?: string
  }) => unknown[]
}
