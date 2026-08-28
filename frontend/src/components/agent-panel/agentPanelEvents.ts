/**
 * Quick Overlay 到执行方的一条线。
 *
 * 现阶段执行仍然在旧面板里（SSE、消息、重连都在那），所以 overlay 只负责把话
 * 递出去：发一条事件，旧面板接住、打开自己、照常发送。等 Full 层重做完，接住
 * 这条事件的换成新面板，overlay 这边一行都不用改。
 */

export const AGENT_PANEL_SUBMIT_EVENT = 'agent-panel-submit'

export interface AgentPanelSubmitDetail {
  text: string
}

export function dispatchAgentPanelSubmit(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  window.dispatchEvent(
    new CustomEvent<AgentPanelSubmitDetail>(AGENT_PANEL_SUBMIT_EVENT, {
      detail: { text: trimmed },
    }),
  )
}

export function agentPanelSubmitText(event: Event): string | null {
  const detail = (event as CustomEvent<AgentPanelSubmitDetail>).detail
  const text = typeof detail?.text === 'string' ? detail.text.trim() : ''
  return text || null
}

// 操作卡片的回话。同样只递不办 —— 真正调 /agent/confirm 的仍然是执行方。

export const AGENT_PANEL_ACTION_EVENT = 'agent-panel-action-decision'

export interface AgentPanelActionDetail {
  /** 后端的 confirmationId */
  id: string
  approved: boolean
}

export function dispatchAgentPanelAction(id: string, approved: boolean): void {
  if (!id) return
  window.dispatchEvent(
    new CustomEvent<AgentPanelActionDetail>(AGENT_PANEL_ACTION_EVENT, {
      detail: { id, approved },
    }),
  )
}

export function agentPanelActionDetail(
  event: Event,
): AgentPanelActionDetail | null {
  const detail = (event as CustomEvent<AgentPanelActionDetail>).detail
  if (!detail || typeof detail.id !== 'string' || !detail.id) return null
  return { id: detail.id, approved: detail.approved === true }
}

// 从历史里挑一条继续。取消息、重连进行中的任务都在执行方那边。

export const AGENT_PANEL_OPEN_SESSION_EVENT = 'agent-panel-open-session'

export function dispatchAgentPanelOpenSession(sessionId: string): void {
  if (!sessionId) return
  window.dispatchEvent(
    new CustomEvent<{ sessionId: string }>(AGENT_PANEL_OPEN_SESSION_EVENT, {
      detail: { sessionId },
    }),
  )
}

export function agentPanelOpenSessionId(event: Event): string | null {
  const detail = (event as CustomEvent<{ sessionId?: string }>).detail
  const id = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
  return id || null
}

// 外部（通知中心等）把面板叫出来。旧面板的 `arael-open-*` 事件也归到这里。

export const AGENT_PANEL_OPEN_EVENT = 'agent-panel-open'

export type AgentPanelOpenView = 'messages' | 'manage'

export function dispatchAgentPanelOpen(view: AgentPanelOpenView): void {
  window.dispatchEvent(
    new CustomEvent<{ view: AgentPanelOpenView }>(AGENT_PANEL_OPEN_EVENT, {
      detail: { view },
    }),
  )
}

export function agentPanelOpenView(event: Event): AgentPanelOpenView {
  const raw = (event as CustomEvent<{ view?: string }>).detail?.view
  return raw === 'manage' ? 'manage' : 'messages'
}

// 界面上的两个动作：开新对话、停下手里的活。执行方接住。

export const AGENT_PANEL_COMMAND_EVENT = 'agent-panel-command'

export type AgentPanelCommand = 'new-session' | 'interrupt'

export function dispatchAgentPanelCommand(command: AgentPanelCommand): void {
  window.dispatchEvent(
    new CustomEvent<{ command: AgentPanelCommand }>(AGENT_PANEL_COMMAND_EVENT, {
      detail: { command },
    }),
  )
}

export function agentPanelCommand(event: Event): AgentPanelCommand | null {
  const raw = (event as CustomEvent<{ command?: string }>).detail?.command
  return raw === 'new-session' || raw === 'interrupt' ? raw : null
}

// 回答助手反过来问的那句话。敏感确认走 action 那条，这条是普通提问。

export const AGENT_PANEL_ANSWER_EVENT = 'agent-panel-answer'

export interface AgentPanelAnswerDetail {
  messageId: string
  answer: string
}

export function dispatchAgentPanelAnswer(
  messageId: string,
  answer: string,
): void {
  if (!messageId || !answer.trim()) return
  window.dispatchEvent(
    new CustomEvent<AgentPanelAnswerDetail>(AGENT_PANEL_ANSWER_EVENT, {
      detail: { messageId, answer },
    }),
  )
}

export function agentPanelAnswerDetail(
  event: Event,
): AgentPanelAnswerDetail | null {
  const detail = (event as CustomEvent<AgentPanelAnswerDetail>).detail
  if (!detail?.messageId || !detail.answer) return null
  return detail
}
