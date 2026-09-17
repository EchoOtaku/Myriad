import type { ChatMessage } from './engineTypes'
import { BODY_INLINE_CHARS, detachedPrefix } from './messageBody'

export const HOT_MESSAGE_LIMIT = 120
const TEXT_LIMIT = 32768
const bounded = new WeakSet<ChatMessage>()
const retainedBytes = new WeakMap<ChatMessage, number>()
const HOT_MESSAGE_BYTES = 4 * 1024 * 1024

/** Result/debug payloads are optional UI context; never retain arbitrary tool output. */
function boundedPayload(value: unknown, limit = TEXT_LIMIT): unknown {
  let remaining = limit
  const seen = new WeakSet<object>()
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 8) return undefined
    if (typeof item === 'string') {
      const text = detachedPrefix(item, Math.min(remaining, TEXT_LIMIT))
      remaining -= text.length
      return text
    }
    remaining -= 16
    if (!item || typeof item !== 'object') return item
    if (seen.has(item)) return undefined
    seen.add(item)
    if (Array.isArray(item))
      return item.slice(0, 100).map((child) => visit(child, depth + 1))
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
    content: detachedPrefix(message.content, BODY_INLINE_CHARS),
    ...(message.content.length > BODY_INLINE_CHARS && !message.body ? { bodyUnavailable: true } : {}),
    data: boundedPayload(message.data),
    ...(execution
      ? {
          taskExecution: {
            ...execution,
            steps: execution.steps
              .slice(-100)
              .map((step) => ({
                ...step,
                message: step.message?.slice(0, 2000),
              })),
            reasoning: execution.reasoning === undefined ? undefined : detachedPrefix(execution.reasoning, BODY_INLINE_CHARS),
            statusMessage: execution.statusMessage?.slice(0, 2000),
            debugTrace: execution.debugTrace
              ? {
                  plannerDecision: execution.debugTrace.plannerDecision
                    ? {
                        ...execution.debugTrace.plannerDecision,
                        reasoning:
                          execution.debugTrace.plannerDecision.reasoning?.slice(
                            0,
                            TEXT_LIMIT,
                          ),
                        userRequest:
                          execution.debugTrace.plannerDecision.userRequest.slice(
                            0,
                            2000,
                          ),
                        steps: execution.debugTrace.plannerDecision.steps
                          .slice(0, 50)
                          .map((step) => ({
                            ...step,
                            params: boundedPayload(
                              step.params,
                              2000,
                            ) as typeof step.params,
                          })),
                      }
                    : undefined,
                  stepDebugEntries: execution.debugTrace.stepDebugEntries
                    .slice(-50)
                    .map((step) => ({
                      ...step,
                      params: boundedPayload(
                        step.params,
                        2000,
                      ) as typeof step.params,
                      directive: step.directive?.slice(0, 2000),
                      userRequest: step.userRequest?.slice(0, 2000),
                      outputPreview: step.outputPreview?.slice(0, 2000),
                      error: step.error?.slice(0, 2000),
                    })),
                }
              : undefined,
            executionTrace: execution.executionTrace
              ? {
                  ...execution.executionTrace,
                  plannerDecision: execution.executionTrace.plannerDecision
                    ? {
                        ...execution.executionTrace.plannerDecision,
                        reasoning:
                          execution.executionTrace.plannerDecision.reasoning?.slice(
                            0,
                            TEXT_LIMIT,
                          ),
                        plannedSteps:
                          execution.executionTrace.plannerDecision.plannedSteps
                            .slice(0, 50)
                            .map((step) => ({
                              ...step,
                              params: boundedPayload(
                                step.params,
                                2000,
                              ) as typeof step.params,
                            })),
                      }
                    : undefined,
                  steps: execution.executionTrace.steps
                    .slice(-50)
                    .map((step) => ({
                      ...step,
                      params: boundedPayload(
                        step.params,
                        2000,
                      ) as typeof step.params,
                      outputPreview: step.outputPreview?.slice(0, 2000),
                      error: step.error?.slice(0, 2000),
                    })),
                }
              : undefined,
          },
        }
      : {}),
  }
  bounded.add(result)
  retainedBytes.set(result, estimateMessageBytes(result))
  return result
}

/** Backend session history remains the cold store. Keep outstanding interactions hot. */
export function retainHotMessages(messages: ChatMessage[]): ChatMessage[] {
  const rows = messages.map(boundMessage)
  let active = rows.filter(message => {
    const status = message.taskExecution?.status
    return status === 'processing' || status === 'waiting' || status === 'cancelling'
  }).slice(-HOT_MESSAGE_LIMIT)
  if (active.reduce((sum, message) => sum + (retainedBytes.get(message) ?? 0), 0) > HOT_MESSAGE_BYTES) {
    active = active.map(message => {
      const execution = message.taskExecution!
      const compact = { ...message, data: undefined, dataDisplay: undefined, taskExecution: {
        taskId: execution.taskId, runId: execution.runId, status: execution.status, progress: execution.progress,
        steps: [], reasoning: execution.reasoning, reasoningBody: execution.reasoningBody,
      } }
      retainedBytes.set(compact, estimateMessageBytes(compact))
      bounded.add(compact)
      const index = rows.indexOf(message)
      rows[index] = compact
      return compact
    })
  }
  const keep = new Set(active)
  let bytes = active.reduce((sum, message) => sum + (retainedBytes.get(message) ?? 0), 0)
  for (let i = rows.length - 1; i >= 0 && keep.size < HOT_MESSAGE_LIMIT; i--) {
    const message = rows[i]
    if (keep.has(message)) continue
    const size = retainedBytes.get(message) ?? 0
    if (bytes + size + 256 > HOT_MESSAGE_BYTES && keep.size > 0) break
    keep.add(message)
    bytes += size + 2
  }
  return rows.filter(message => keep.has(message))
}

/** Count bounded state without allocating a JSON copy of the original text. */
export function estimateMessageBytes(value: unknown): number {
  const seen = new WeakSet<object>()
  const size = (item: unknown): number => {
    if (typeof item === 'string') return item.length * 2
    if (!item || typeof item !== 'object') return 16
    if (seen.has(item)) return 0
    seen.add(item)
    if (Array.isArray(item)) return item.reduce((sum, child) => sum + size(child), 16)
    let bytes = 16
    for (const key in item) { if (Object.hasOwn(item, key)) bytes += key.length * 2 + size((item as Record<string, unknown>)[key])
}
    return bytes
  }
  return size(value)
}
