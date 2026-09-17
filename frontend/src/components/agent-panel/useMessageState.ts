import type { AgentPanelMode } from './agentPanelMode'
import type { ChatMessage, ExecutionStep, TaskExecution } from './engineTypes'
import { useCallback, useRef, useState } from 'react'
import { boundMessage, retainHotMessages } from './messageBudget'

export type MessagesByMode = Record<AgentPanelMode, ChatMessage[]>

export function emptyMessagesByMode(): MessagesByMode {
  return { work: [], chat: [] }
}

export function writeModeMessages(
  bag: MessagesByMode,
  mode: AgentPanelMode,
  next: ChatMessage[],
): MessagesByMode {
  if (bag[mode] === next) return bag
  return { ...bag, [mode]: retainHotMessages(next) }
}

export function findMessageInBag(
  bag: MessagesByMode,
  messageId: string,
): ChatMessage | undefined {
  return findMessageWhereInBag(bag, (message) => message.id === messageId)
}

export function findMessageWhereInBag(
  bag: MessagesByMode,
  predicate: (message: ChatMessage) => boolean,
): ChatMessage | undefined {
  return bag.work.find(predicate) ?? bag.chat.find(predicate)
}

interface MessageChange {
  previous: readonly ChatMessage[]
  index: number
  depth: number
}
const changes = new WeakMap<readonly ChatMessage[], MessageChange>()
const indices = new WeakMap<readonly ChatMessage[], Map<string, number>>()

/** A bounded journal bridges updates React may batch before projection. */
export function changedMessageIndices(
  previous: readonly ChatMessage[],
  next: readonly ChatMessage[],
): Set<number> | null {
  const result = new Set<number>()
  let cursor = next
  while (cursor !== previous) {
    const change = changes.get(cursor)
    if (!change) return null
    result.add(change.index)
    changes.delete(cursor)
    cursor = change.previous
  }
  return result
}

export function mapMessagesById(
  bag: MessagesByMode,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): MessagesByMode {
  let next = bag
  for (const mode of ['work', 'chat'] as const) {
    const list = bag[mode]
    let index = indices.get(list)
    if (!index) {
      index = new Map(list.map((message, position) => [message.id, position]))
      indices.set(list, index)
    }
    const position = index.get(messageId)
    if (position === undefined) continue
    const rawUpdated = update(list[position])
    if (rawUpdated === list[position]) continue
    const updated = boundMessage(rawUpdated)
    const mapped = list.slice()
    mapped[position] = updated
    indices.set(mapped, index)
    const depth = (changes.get(list)?.depth ?? 0) + 1
    // Prevent an inactive mode from retaining an unbounded chain of old arrays.
    if (depth <= 32)
      changes.set(mapped, { previous: list, index: position, depth })
    next = { ...next, [mode]: mapped }
  }
  return next
}

export function useMessageState(visibleMode: AgentPanelMode) {
  const [byMode, setByMode] = useState<MessagesByMode>(emptyMessagesByMode)
  const messagesRef = useRef(byMode)
  messagesRef.current = byMode
  const messages = byMode[visibleMode]

  const setMessages = useCallback(
    (
      next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
      mode: AgentPanelMode = visibleMode,
    ) => {
      setByMode((prev) => {
        const current = prev[mode]
        const value = typeof next === 'function' ? next(current) : next
        return writeModeMessages(prev, mode, value)
      })
    },
    [visibleMode],
  )

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      setByMode((prev) =>
        mapMessagesById(prev, messageId, (message) => ({
          ...message,
          ...updates,
        })),
      )
    },
    [],
  )

  const updateMessageExecution = useCallback(
    (messageId: string, updates: Partial<TaskExecution>) => {
      setByMode((prev) =>
        mapMessagesById(prev, messageId, (message) => {
          if (!message.taskExecution) return message
          const newProgress =
            updates.progress != null
              ? Math.max(updates.progress, message.taskExecution.progress)
              : message.taskExecution.progress
          return {
            ...message,
            taskExecution: {
              ...message.taskExecution,
              ...updates,
              progress: newProgress,
            },
          }
        }),
      )
    },
    [],
  )

  const addExecutionStep = useCallback(
    (messageId: string, step: ExecutionStep) => {
      setByMode((prev) =>
        mapMessagesById(prev, messageId, (message) => {
          if (!message.taskExecution) return message
          const exists = message.taskExecution.steps.some(
            (item) => item.id === step.id,
          )
          if (exists) {
            return {
              ...message,
              taskExecution: {
                ...message.taskExecution,
                steps: message.taskExecution.steps.map((item) =>
                  item.id === step.id ? { ...item, ...step } : item,
                ),
              },
            }
          }
          return {
            ...message,
            taskExecution: {
              ...message.taskExecution,
              steps: [...message.taskExecution.steps, step],
            },
          }
        }),
      )
    },
    [],
  )

  const updateExecutionStep = useCallback(
    (messageId: string, stepId: string, updates: Partial<ExecutionStep>) => {
      setByMode((prev) =>
        mapMessagesById(prev, messageId, (message) => {
          if (!message.taskExecution) return message
          return {
            ...message,
            taskExecution: {
              ...message.taskExecution,
              steps: message.taskExecution.steps.map((item) =>
                item.id === stepId ? { ...item, ...updates } : item,
              ),
            },
          }
        }),
      )
    },
    [],
  )

  const findMessage = useCallback((messageId: string) => {
    return findMessageInBag(messagesRef.current, messageId)
  }, [])

  const findMessageWhere = useCallback(
    (predicate: (message: ChatMessage) => boolean) => {
      return findMessageWhereInBag(messagesRef.current, predicate)
    },
    [],
  )

  return {
    messages,
    setMessages,
    messagesRef,
    byMode,
    findMessage,
    findMessageWhere,
    updateMessage,
    updateMessageExecution,
    addExecutionStep,
    updateExecutionStep,
  }
}
