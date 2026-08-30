/**
 * Local voice facts for echo control and perception. Not sent as audio frames.
 */

export interface VoicePresenceState {
  listening: boolean
  ttsPlaying: boolean
  userSpeaking: boolean
  partial: string
}

const listeners = new Set<() => void>()
let state: VoicePresenceState = {
  listening: false,
  ttsPlaying: false,
  userSpeaking: false,
  partial: '',
}

export function getVoicePresence(): VoicePresenceState {
  return state
}

export function patchVoicePresence(
  patch: Partial<VoicePresenceState>,
): VoicePresenceState {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
  return state
}

export function subscribeVoicePresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function voicePresenceListenerCount(): number {
  return listeners.size
}

/** Barge-in during TTS needs a stronger local VAD so echo is not a submit. */
export function bargeInAllowed(nowSpeaking: boolean): boolean {
  if (!nowSpeaking) return false
  if (!state.ttsPlaying) return true
  return nowSpeaking
}
