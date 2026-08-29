/**
 * 把执行引擎那份重消息收成界面要的形状。
 *
 * 流式时通常只有最后一条在变：前面的行沿用 store 里的对象，少一次整列投影。
 */

import type { ChatMessage } from './engineTypes'
import type { AgentMessage } from './agentMessages'
import { getAgentMessagesSnapshot, setAgentMessages } from './agentMessages'

function projectState(message: ChatMessage): AgentMessage['state'] {
  if (message.taskExecution?.status === 'error') return 'error'
  if (message.taskExecution?.status === 'processing') return 'streaming'
  return undefined
}

export function projectAgentMessage(message: ChatMessage): AgentMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    state: projectState(message),
    ...(message.imageUrls?.length ? { imageUrls: message.imageUrls } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((item) => ({
            id: item.id,
            name: item.name,
            mime: item.mime,
            size: item.size,
            ...(item.previewUrl ? { previewUrl: item.previewUrl } : {}),
          })),
        }
      : {}),
    at: message.createdAt.getTime(),
    ...(message.suggestions?.length
      ? { suggestions: message.suggestions }
      : {}),
    ...(message.pendingQuestion && !message.pendingQuestion.confirmationId
      ? {
          question: {
            id: message.pendingQuestion.questionId,
            text: message.pendingQuestion.question,
            ...(message.pendingQuestion.context
              ? { context: message.pendingQuestion.context }
              : {}),
            ...(message.pendingQuestion.options?.length
              ? { options: message.pendingQuestion.options }
              : {}),
            ...(message.selectedAnswer
              ? { answered: message.selectedAnswer }
              : {}),
          },
        }
      : {}),
    ...(message.taskExecution?.steps?.length
      ? {
          steps: message.taskExecution.steps.map((step) => ({
            id: step.id,
            name: step.name,
            status:
              step.status === 'completed'
                ? ('done' as const)
                : step.status === 'error'
                  ? ('error' as const)
                  : step.status === 'running'
                    ? ('running' as const)
                    : ('pending' as const),
            ...(typeof step.durationMs === 'number'
              ? { durationMs: step.durationMs }
              : {}),
            ...(step.message ? { note: step.message } : {}),
          })),
        }
      : {}),
  }
}

function prefixIdsMatch(
  prev: readonly AgentMessage[],
  chats: readonly ChatMessage[],
): boolean {
  if (prev.length !== chats.length || prev.length === 0) return false
  const last = chats.length - 1
  if (prev[last]?.id !== chats[last]?.id) return false
  for (let i = 0; i < last; i += 1) {
    if (prev[i]?.id !== chats[i]?.id) return false
  }
  return true
}

export function syncProjectedMessages(chats: readonly ChatMessage[]): void {
  const prev = getAgentMessagesSnapshot()
  if (prefixIdsMatch(prev, chats)) {
    const last = chats[chats.length - 1]
    if (!last) {
      setAgentMessages([])
      return
    }
    setAgentMessages(prev.slice(0, -1).concat(projectAgentMessage(last)))
    return
  }
  setAgentMessages(chats.map(projectAgentMessage))
}
