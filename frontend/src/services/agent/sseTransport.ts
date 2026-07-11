/**
 * Agent SSE 订阅传输层。
 *
 * 只负责读取/重连后端 run 事件；它不会创建、取消或拥有任务生命周期。
 */
import type {
  AgentResponse,
  ErrorEvent,
  ProgressCallback,
  ProgressEvent,
  TaskCompletedEvent,
  TaskDetail,
  TaskInfo,
} from './types'

import { getCSRFToken } from '../../utils/csrf'

interface ExecuteSseOptions {
  url: string
  method: 'GET' | 'POST'
  body?: unknown
  onProgress?: ProgressCallback
  abortPrevious: boolean
  activeControllers: Set<AbortController>
  pollTaskUntilComplete: (
    taskId: string,
    options: {
      intervalMs: number
      timeoutMs: number
      onProgress?: (task: TaskDetail) => void
    },
  ) => Promise<TaskDetail>
}

export function abortSseSubscriptions(
  activeControllers: Set<AbortController>,
): void {
  for (const controller of activeControllers) controller.abort()
  activeControllers.clear()
}

export async function executeSSERequest({
  url,
  method,
  body,
  onProgress,
  abortPrevious,
  activeControllers,
  pollTaskUntilComplete,
}: ExecuteSseOptions): Promise<AgentResponse> {
  if (abortPrevious) abortSseSubscriptions(activeControllers)

  const csrfToken = method === 'POST' ? await getCSRFToken() : null

  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    activeControllers.add(controller)
    const timeoutId = setTimeout(() => controller.abort(), 600000)
    const cleanup = () => {
      clearTimeout(timeoutId)
      activeControllers.delete(controller)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text()
          throw new Error(
            `HTTP error! status: ${response.status}, body: ${text}`,
          )
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('Unable to read response stream')

        const decoder = new TextDecoder()
        let buffer = ''
        let finalResponse: AgentResponse | null = null
        let streamError: unknown = null
        let capturedTaskId: string | null = null
        let capturedRunId: string | null = null

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (value) buffer += decoder.decode(value, { stream: !done })

            const lines = buffer.split('\n')
            buffer = done ? '' : lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              const data = line.slice(line.startsWith('data: ') ? 6 : 5).trim()
              if (!data) continue

              try {
                const event: ProgressEvent = JSON.parse(data)
                if (event.type === 'run_started' && event.runId) {
                  capturedRunId = event.runId
                }
                if (event.type === 'task_created' && event.taskId) {
                  capturedTaskId = event.taskId
                }

                onProgress?.(event)
                if (event.type === 'task_completed') {
                  finalResponse = (event as TaskCompletedEvent).response
                } else if (event.type === 'error') {
                  reject(new Error((event as ErrorEvent).message))
                  return
                }
              } catch (parseError) {
                console.warn(
                  '[AgentService] Failed to parse SSE event:',
                  parseError,
                )
              }
            }
            if (done) break
          }
        } catch (error) {
          streamError = error
        } finally {
          reader.releaseLock()
          cleanup()
        }

        if (finalResponse) {
          resolve(finalResponse)
        } else if (capturedRunId) {
          // 只重新订阅同一个后端 run，绝不重放 POST 用户请求。
          try {
            resolve(
              await executeSSERequest({
                url: `/api/agent/runs/${encodeURIComponent(capturedRunId)}/stream`,
                method: 'GET',
                onProgress,
                abortPrevious: false,
                activeControllers,
                pollTaskUntilComplete,
              }),
            )
          } catch (resumeError) {
            reject(resumeError)
          }
        } else if (capturedTaskId) {
          try {
            const task = await pollTaskUntilComplete(capturedTaskId, {
              intervalMs: 2000,
              timeoutMs: 300000,
              onProgress: onProgress
                ? (current) => {
                    onProgress({
                      type: 'progress',
                      progress: current.progress,
                      completedSteps: 0,
                      totalSteps: 0,
                      message: '',
                    })
                  }
                : undefined,
            })
            if (task.status === 'completed' && task.results) {
              resolve(buildPolledResponse(task))
            } else {
              reject(
                new Error(
                  `Task ${capturedTaskId} ended with status ${task.status}`,
                ),
              )
            }
          } catch (pollError) {
            reject(pollError)
          }
        } else if (streamError) {
          reject(streamError)
        } else {
          reject(new Error('No completion response received'))
        }
      })
      .catch((error) => {
        cleanup()
        if (error.name === 'AbortError') {
          reject(new Error('Request timed out or interrupted'))
        } else {
          reject(error)
        }
      })
  })
}

function buildPolledResponse(task: TaskDetail): AgentResponse {
  const stepResults = Object.values(task.results ?? {}) as Array<{
    success?: boolean
    output?: unknown
    error?: string
  }>
  const data =
    stepResults.filter((result) => result.success).at(-1)?.output ??
    task.results
  const dataObject =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : undefined
  const message =
    ['message', 'reply', 'summary', 'analysis']
      .map((key) => dataObject?.[key])
      .find((value): value is string => typeof value === 'string') ??
    (task.status === 'completed'
      ? 'Task completed'
      : stepResults.find((result) => result.error)?.error ||
        `Task ${task.status}`)

  return {
    success: task.status === 'completed',
    responseType: task.status === 'completed' ? 'task_completed' : 'error',
    message,
    data,
    suggestions: [],
    task: {
      taskId: task.taskId,
      status: task.status as TaskInfo['status'],
      progress: task.progress,
    },
  }
}
