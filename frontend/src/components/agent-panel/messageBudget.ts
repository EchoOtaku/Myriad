import type { ChatMessage } from './engineTypes'

export const HOT_MESSAGE_LIMIT = 120
const TEXT_LIMIT = 32768
const bounded = new WeakSet<ChatMessage>()

/** Result/debug payloads are optional UI context; never retain arbitrary tool output. */
function boundedPayload(value: unknown, limit = TEXT_LIMIT): unknown {
  let remaining = limit
  const seen = new WeakSet<object>()
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 8) return undefined
    if (typeof item === 'string') {
      const text = item.slice(0, Math.min(remaining, TEXT_LIMIT))
      remaining -= text.length
      return text
    }
    remaining -= 16
    if (!item || typeof item !== 'object') return item
    if (seen.has(item)) return undefined
    seen.add(item)
    if (Array.isArray(item)) return item.slice(0, 100).map(child => visit(child, depth + 1))
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(item)) {
      if (remaining <= 0) break
      remaining -= key.length
      result[key] = visit((item as Record<string, unknown>)[key], depth + 1)
    }
    return result
  }
  return visit(value, 0)
}

export function boundMessage(message: ChatMessage): ChatMessage {
  if (bounded.has(message)) return message
  const execution = message.taskExecution
  const result: ChatMessage = {
    ...message,
    content: message.content.slice(0, TEXT_LIMIT * 4),
    data: boundedPayload(message.data),
    ...(execution ? { taskExecution: {
      ...execution,
      steps: execution.steps.slice(-100).map(step => ({ ...step, message: step.message?.slice(0, 2000) })),
      reasoning: execution.reasoning?.slice(0, TEXT_LIMIT),
      statusMessage: execution.statusMessage?.slice(0, 2000),
      debugTrace: boundedPayload(execution.debugTrace) as typeof execution.debugTrace,
      executionTrace: boundedPayload(execution.executionTrace) as typeof execution.executionTrace,
    } } : {}),
  }
  bounded.add(result)
  return result
}

/** Backend session history remains the cold store. Keep outstanding interactions hot. */
export function retainHotMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= HOT_MESSAGE_LIMIT) return messages.map(boundMessage)
  const active = messages.filter(message => {
    const status = message.taskExecution?.status
    return status === 'processing' || status === 'waiting' || status === 'cancelling'
  }).slice(-HOT_MESSAGE_LIMIT)
  const keep = new Set(active)
  for (let i = messages.length - 1; i >= 0 && keep.size < HOT_MESSAGE_LIMIT; i--) keep.add(messages[i])
  return messages.filter(message => keep.has(message)).map(boundMessage)
}
