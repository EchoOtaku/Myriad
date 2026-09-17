import type { ChatMessage } from './engineTypes'

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
      const text = item.slice(0, Math.min(remaining, TEXT_LIMIT))
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
            reasoning: execution.reasoning?.slice(0, TEXT_LIMIT),
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
  retainedBytes.set(result, JSON.stringify(result).length * 2)
  return result
}

/** Backend session history remains the cold store. Keep outstanding interactions hot. */
export function retainHotMessages(messages: ChatMessage[]): ChatMessage[] {
  const rows = messages.map(boundMessage)
  const active = rows.filter(message => {
    const status = message.taskExecution?.status
    return status === 'processing' || status === 'waiting' || status === 'cancelling'
  }).slice(-HOT_MESSAGE_LIMIT)
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
