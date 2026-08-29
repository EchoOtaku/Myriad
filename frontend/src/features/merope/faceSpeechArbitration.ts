import type { AgentPanelMode } from '../../components/agent-panel/agentPanelMode'
import { getAgentPanelMode } from '../../components/agent-panel/agentPanelMode'
import type { AgentFaceChannel, ReplyUtterance } from './agentFaceChannel'

/** Visible panel mode owns the mouth; the other mode may only leave a record. */
export type FaceSpeechVerdict = 'speak' | 'record-without-speech'

export type FaceSpeechLine = {
  messageId: string
  text?: string
  source?: 'reply' | 'proactive' | 'interaction' | 'preview'
  locale?: string
  performance?: unknown
}

export type FaceDelivery = {
  surface: 'speech' | 'record'
  messageId: string
  text?: string
}

/**
 * Decide whether an incoming line may use the face right now.
 *
 * Only the currently visible mode speaks immediately. Background Work must
 * not cancel or talk over an in-progress Chat utterance; its result still
 * exists as a non-speech record (message / notification).
 */
export function arbitrateFaceSpeech(input: {
  visibleMode: AgentPanelMode
  incomingMode: AgentPanelMode
  chatUtteranceActive: boolean
}): FaceSpeechVerdict {
  if (input.incomingMode === 'work' && input.chatUtteranceActive) {
    return 'record-without-speech'
  }
  if (input.incomingMode !== input.visibleMode) {
    return 'record-without-speech'
  }
  return 'speak'
}

/** A ReplyUtterance stand-in that never touches the face protocol. */
export function silentReplyUtterance(): Pick<
  ReplyUtterance,
  'chunk' | 'end' | 'cancel'
> {
  return {
    chunk() {},
    end() {},
    cancel() {},
  }
}

/**
 * Panel→face gate. Tracks whether Chat currently owns an open utterance so
 * a finishing Work turn cannot barge in. AgentFaceChannel's start/chunk/end
 * protocol is unchanged; this only chooses whether to call it.
 */
export class FaceSpeechGate {
  chatUtteranceActive = false
  private chatMessageId: string | null = null

  constructor(private readonly visibleMode: () => AgentPanelMode = getAgentPanelMode) {}

  decide(incomingMode: AgentPanelMode): FaceSpeechVerdict {
    return arbitrateFaceSpeech({
      visibleMode: this.visibleMode(),
      incomingMode,
      chatUtteranceActive: this.chatUtteranceActive,
    })
  }

  beginIncoming(incomingMode: AgentPanelMode, messageId?: string): FaceSpeechVerdict {
    const verdict = this.decide(incomingMode)
    if (verdict === 'speak' && incomingMode === 'chat') {
      this.chatUtteranceActive = true
      this.chatMessageId = messageId ?? this.chatMessageId
    }
    return verdict
  }

  endIncoming(incomingMode: AgentPanelMode, messageId?: string): void {
    if (incomingMode === 'chat') this.releaseChat(messageId)
  }

  /** Drop Chat occupancy when the engine cancels the owning message. */
  releaseChat(messageId?: string): void {
    if (messageId && this.chatMessageId && messageId !== this.chatMessageId) {
      return
    }
    this.chatUtteranceActive = false
    this.chatMessageId = null
  }

  cancelSpeech(channel: AgentFaceChannel, messageId: string): void {
    channel.cancel(messageId)
    this.releaseChat(messageId)
  }
}

export const faceSpeechGate = new FaceSpeechGate()

/** Open a streamed reply only when the gate allows speech. */
export function openGatedReply(
  channel: AgentFaceChannel,
  gate: FaceSpeechGate,
  incomingMode: AgentPanelMode,
  messageId: string,
  locale?: string,
): Pick<ReplyUtterance, 'chunk' | 'end' | 'cancel'> {
  const verdict = gate.beginIncoming(incomingMode, messageId)
  const inner =
    verdict === 'speak'
      ? channel.openReply(messageId, locale)
      : silentReplyUtterance()
  return {
    chunk: (token: string) => inner.chunk(token),
    end: () => {
      inner.end()
      gate.endIncoming(incomingMode, messageId)
    },
    cancel: () => {
      inner.cancel()
      gate.endIncoming(incomingMode, messageId)
    },
  }
}

/** Engine-level cancel: stop the channel utterance and release Chat occupancy. */
export function cancelGatedSpeech(
  channel: AgentFaceChannel,
  gate: FaceSpeechGate,
  messageId: string,
): void {
  gate.cancelSpeech(channel, messageId)
}

/**
 * Notification-center Work completion (notify_task_status → merope ingest).
 * Incoming mode is always Work. The island/toast still records the notice
 * even when speech is gated off.
 */
export function deliverWorkNotificationFace(
  channel: AgentFaceChannel,
  gate: FaceSpeechGate,
  notification: {
    id: string
    body?: string
    performance?: unknown
    meropeState?: unknown
  },
): FaceDelivery {
  if (notification.meropeState != null) {
    channel.updateState(notification.meropeState)
  }
  return deliverGatedLine(channel, gate, 'work', {
    messageId: notification.id,
    text: notification.body,
    source: 'proactive',
    performance: notification.performance,
  })
}

/**
 * Deliver a finished line. Speech goes through AgentFaceChannel; a blocked
 * Work completion is returned as `record` so the caller still keeps the
 * message / notification surface.
 */
export function deliverGatedLine(
  channel: AgentFaceChannel,
  gate: FaceSpeechGate,
  incomingMode: AgentPanelMode,
  line: FaceSpeechLine,
): FaceDelivery {
  const text = line.text?.trim() ? line.text : undefined
  if (gate.decide(incomingMode) !== 'speak') {
    return { surface: 'record', messageId: line.messageId, text }
  }
  channel.deliver(line)
  return { surface: 'speech', messageId: line.messageId, text }
}
