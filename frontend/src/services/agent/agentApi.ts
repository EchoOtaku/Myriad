/**
 * Agent API 服务
 *
 * 处理与后端 Agent API 的通信
 */

import type {
  AgentResponse,
  Capability,
  ClarifyRequest,
  CreatePresetRequest,
  ErrorEvent,
  ExecutionTrace,
  HeartbeatTask,
  MemoryEntry,
  ProcessContext,
  ProcessRequest,
  ProgressCallback,
  ProgressEvent,
  QueueStatus,
  SessionInfo,
  SessionMessage,
  SkillInfo,
  TaskCompletedEvent,
  TaskDetail,
  TaskInfo,
  TaskPreset,
  TaskPresetListResponse,
} from './types'

import { TokenManager } from '../../utils/tokenManager'
import { apiService } from '../api'

/**
 * Agent 服务类
 *
 * 负责与后端 Agent API 通信
 */
class AgentService {
  private baseUrl = '/agent'

  /** 当前 SSE 请求的 AbortController，用于客户端侧中断 */
  private currentAbortController: AbortController | null = null

  /**
   * 中断当前正在进行的 SSE 请求（客户端侧）
   *
   * 调用后 executeSSERequest 的 Promise 将 reject 并释放连接。
   */
  abortCurrentRequest(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  /**
   * 处理自然语言请求
   */
  async process(input: string, context?: Partial<ProcessContext>): Promise<AgentResponse> {
    const request: ProcessRequest = {
      input,
      context: {
        currentRoute: window.location.pathname,
        ...context,
      },
    }

    const response = await apiService.post<AgentResponse>(`${this.baseUrl}/process`, request, {
      timeout: 120000,
    })
    return response
  }

  /**
   * 带实时进度更新的处理请求（SSE）
   */
  async processWithProgress(
    input: string,
    onProgress: ProgressCallback,
    context?: Partial<ProcessContext>,
  ): Promise<AgentResponse> {
    console.log('[AgentService] processWithProgress called with input:', input)

    const request: ProcessRequest = {
      input,
      context: {
        currentRoute: window.location.pathname,
        ...context,
      },
    }

    return this.executeSSERequest(
      `/api${this.baseUrl}/process/stream`,
      'POST',
      request,
      onProgress,
    )
  }

  /**
   * 提供澄清回答
   */
  async clarify(
    originalInput: string,
    clarificationId: string,
    answer: string,
    context?: Partial<ProcessContext>,
  ): Promise<AgentResponse> {
    const request: ClarifyRequest = {
      originalInput,
      clarificationId,
      answer,
      context,
    }

    return apiService.post<AgentResponse>(`${this.baseUrl}/clarify`, request)
  }

  /**
   * 获取任务状态
   */
  async getTask(taskId: string): Promise<TaskDetail> {
    const response = await apiService.get<{
      success: boolean
      task: TaskInfo
      results: Record<string, unknown>
      startedAt: string
      completedAt?: string
    }>(`${this.baseUrl}/tasks/${taskId}`)

    return {
      taskId: response.task.taskId,
      recipeId: '',
      status: response.task.status,
      progress: response.task.progress,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      results: response.results,
    }
  }

  /**
   * 获取用户的所有任务
   */
  async listTasks(): Promise<TaskDetail[]> {
    const response = await apiService.get<{
      success: boolean
      tasks: TaskDetail[]
      total: number
    }>(`${this.baseUrl}/tasks`)
    return response.tasks
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<{ success: boolean, message: string }> {
    return apiService.post<{ success: boolean, message: string, taskId: string }>(
      `${this.baseUrl}/tasks/${taskId}/cancel`,
    )
  }

  /**
   * 回答任务中的问题
   */
  async answerQuestion(
    taskId: string,
    questionId: string,
    answer: string,
  ): Promise<AgentResponse> {
    return apiService.post<AgentResponse>(
      `${this.baseUrl}/tasks/${taskId}/answer`,
      { questionId, answer },
    )
  }

  /**
   * 回答任务中的问题（SSE 流式，带进度回调）
   */
  async answerQuestionWithProgress(
    taskId: string,
    questionId: string,
    answer: string,
    onProgress: ProgressCallback,
  ): Promise<AgentResponse> {
    // abortPrevious=false: process_stream 的 SSE 连接仍在后端 hold 住等待回答结果，
    // 不能中断它，否则 processWithProgress 会收到 AbortError
    return this.executeSSERequest(
      `/api${this.baseUrl}/tasks/${taskId}/answer/stream`,
      'POST',
      { questionId, answer },
      onProgress,
      false,
    )
  }

  /**
   * 获取系统能力列表
   */
  async getCapabilities(): Promise<Capability[]> {
    const response = await apiService.get<{
      success: boolean
      capabilities: { capabilities: Capability[], totalCount: number }
    }>(`${this.baseUrl}/capabilities`)
    return response.capabilities.capabilities
  }

  /**
   * 健康检查
   */
  async health(): Promise<{ status: string, service: string, version: string }> {
    return apiService.get<{ status: string, service: string, version: string }>(
      `${this.baseUrl}/health`,
    )
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskUntilComplete(
    taskId: string,
    options: {
      intervalMs?: number
      timeoutMs?: number
      onProgress?: (task: TaskDetail) => void
    } = {},
  ): Promise<TaskDetail> {
    const { intervalMs = 1000, timeoutMs = 300000, onProgress } = options
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.getTask(taskId)

      if (onProgress) {
        onProgress(task)
      }

      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return task
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`)
  }

  // ============ 任务预设 API ============

  /**
   * 获取任务预设列表
   */
  async getPresets(): Promise<TaskPresetListResponse> {
    return apiService.get<TaskPresetListResponse>(`${this.baseUrl}/presets`)
  }

  /**
   * 创建或更新任务预设
   */
  async createPreset(preset: CreatePresetRequest): Promise<TaskPreset> {
    return apiService.post<TaskPreset>(`${this.baseUrl}/presets`, preset)
  }

  /**
   * 添加到收藏
   */
  async addToFavorites(
    input: string,
    parsedSteps?: unknown,
    intentSummary?: string,
  ): Promise<TaskPreset> {
    return this.createPreset({
      input,
      presetType: 'favorite',
      parsedSteps,
      intentSummary,
      // 收藏不保存对话数据，始终为「重新运行」模式
    })
  }

  /**
   * 删除任务预设
   */
  async deletePreset(presetId: number): Promise<{ success: boolean }> {
    return apiService.delete<{ success: boolean }>(`${this.baseUrl}/presets/${presetId}`)
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(presetId: number): Promise<TaskPreset> {
    return apiService.post<TaskPreset>(`${this.baseUrl}/presets/${presetId}/toggle-favorite`)
  }

  /**
   * 更新预设使用时间
   */
  async usePreset(presetId: number): Promise<TaskPreset> {
    return apiService.post<TaskPreset>(`${this.baseUrl}/presets/${presetId}/use`)
  }

  /**
   * 执行预设任务（直接执行已保存的 recipe）
   */
  async executePreset(
    presetId: number,
    onProgress?: ProgressCallback,
  ): Promise<AgentResponse> {
    return this.executeSSERequest(
      `/api${this.baseUrl}/presets/${presetId}/execute`,
      'POST',
      undefined,
      onProgress,
    )
  }

  // ============ 队列管理 (Phase 1A) ============

  /**
   * 获取队列状态
   */
  async getQueueStatus(): Promise<QueueStatus> {
    return apiService.get<QueueStatus>(`${this.baseUrl}/queue/status`)
  }

  /**
   * 中断当前会话，替换为新请求
   */
  async interruptSession(input: string): Promise<{ success: boolean, cancelled_tasks: number, response: AgentResponse }> {
    return apiService.post(`${this.baseUrl}/session/interrupt`, { input })
  }

  /**
   * 向当前会话注入转向指令
   */
  async steerSession(instruction: string): Promise<{ success: boolean, message: string }> {
    return apiService.post(`${this.baseUrl}/session/steer`, { instruction })
  }

  // ============ Heartbeat (Phase 4) ============

  /**
   * 获取 Heartbeat 任务列表
   */
  async getHeartbeatTasks(): Promise<HeartbeatTask[]> {
    const response = await apiService.get<{ tasks: HeartbeatTask[] }>(`${this.baseUrl}/heartbeat`)
    return response.tasks
  }

  /**
   * 切换 Heartbeat 任务启停
   */
  async toggleHeartbeat(taskId: string): Promise<{ task_id: string, enabled: boolean }> {
    return apiService.post(`${this.baseUrl}/heartbeat/${taskId}/toggle`)
  }

  // ============ 执行追踪 ============

  /**
   * 获取执行追踪列表
   */
  async getTraces(limit: number = 20): Promise<{ traces: ExecutionTrace[], total: number }> {
    return apiService.get(`${this.baseUrl}/traces?limit=${limit}`)
  }

  /**
   * 获取任务详情（含执行追踪）
   */
  async getTaskWithTrace(taskId: string): Promise<TaskDetail & { executionTrace?: ExecutionTrace }> {
    const response = await apiService.get<{
      success: boolean
      task: TaskInfo
      results: Record<string, unknown>
      startedAt: string
      completedAt?: string
      executionTrace?: ExecutionTrace
    }>(`${this.baseUrl}/tasks/${taskId}`)

    return {
      taskId: response.task.taskId,
      recipeId: '',
      status: response.task.status,
      progress: response.task.progress,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      results: response.results,
      executionTrace: response.executionTrace,
    }
  }

  // ============ 记忆 (Phase 3) ============

  /**
   * 获取记忆条目（通过 recall）
   */
  async getMemories(): Promise<MemoryEntry[]> {
    try {
      const response = await apiService.get<{ memories: MemoryEntry[] }>(`${this.baseUrl}/memory`)
      return response.memories
    }
    catch {
      return []
    }
  }

  /**
   * 删除记忆条目
   */
  async deleteMemory(memoryId: string): Promise<void> {
    await apiService.delete(`${this.baseUrl}/memory/${encodeURIComponent(memoryId)}`)
  }

  /**
   * 更新记忆条目内容
   */
  async updateMemory(memoryId: string, content: string): Promise<void> {
    await apiService.put(`${this.baseUrl}/memory/${encodeURIComponent(memoryId)}`, { content })
  }

  // ============ 技能 (Phase 2B) ============

  /**
   * 获取可用技能列表
   */
  async getSkills(): Promise<SkillInfo[]> {
    try {
      const response = await apiService.get<{ skills: SkillInfo[] }>(`${this.baseUrl}/skills`)
      return response.skills
    }
    catch {
      return []
    }
  }

  /**
   * 删除技能
   */
  async deleteSkill(skillId: string): Promise<void> {
    await apiService.delete(`${this.baseUrl}/skills/${encodeURIComponent(skillId)}`)
  }

  // ============ 会话管理 ============

  /**
   * 创建新会话
   */
  async createSession(): Promise<SessionInfo> {
    return apiService.post<SessionInfo>(`${this.baseUrl}/sessions`)
  }

  /**
   * 列出最近会话
   */
  async listSessions(page: number = 1, limit: number = 20): Promise<SessionInfo[]> {
    const response = await apiService.get<{ sessions: SessionInfo[] }>(
      `${this.baseUrl}/sessions?page=${page}&limit=${limit}`,
    )
    return response.sessions
  }

  /**
   * 获取会话消息
   */
  async getSessionMessages(
    sessionId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<SessionMessage[]> {
    const response = await apiService.get<{ messages: SessionMessage[] }>(
      `${this.baseUrl}/sessions/${sessionId}/messages?page=${page}&limit=${limit}`,
    )
    return response.messages
  }

  /**
   * 归档会话
   */
  async archiveSession(sessionId: string): Promise<{ success: boolean }> {
    return apiService.delete<{ success: boolean }>(`${this.baseUrl}/sessions/${sessionId}`)
  }

  /**
   * 更新会话标题
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<SessionInfo> {
    return apiService.patch<SessionInfo>(`${this.baseUrl}/sessions/${sessionId}`, { title })
  }

  /**
   * AI 生成会话标题
   */
  async generateSessionTitle(sessionId: string): Promise<{ title: string }> {
    return apiService.post<{ title: string }>(`${this.baseUrl}/sessions/${sessionId}/generate-title`, {})
  }

  // ============ 内部方法 ============

  /**
   * 执行 SSE 请求的通用方法
   *
   * @param abortPrevious - 是否中断前一个活跃请求（默认 true）。
   *   answerQuestion 场景下应传 false，因为 process_stream 的 SSE 连接
   *   仍在等待后端 done_rx 信号，中断它会导致 AbortError。
   */
  private async executeSSERequest(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
    onProgress?: ProgressCallback,
    abortPrevious = true,
  ): Promise<AgentResponse> {
    // 中断前一个活跃请求（如果有）
    if (abortPrevious) {
      this.abortCurrentRequest()
    }

    return new Promise((resolve, reject) => {
      const token = TokenManager.getToken()
      const controller = new AbortController()
      this.currentAbortController = controller
      const timeoutId = setTimeout(() => controller.abort(), 600000)

      // 请求结束后清理引用
      const cleanup = () => {
        clearTimeout(timeoutId)
        if (this.currentAbortController === controller) {
          this.currentAbortController = null
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (response) => {
          console.log('[AgentService] Response status:', response.status)

          if (!response.ok) {
            const text = await response.text()
            throw new Error(`HTTP error! status: ${response.status}, body: ${text}`)
          }

          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('Unable to read response stream')
          }

          const decoder = new TextDecoder()
          let buffer = ''
          let finalResponse: AgentResponse | null = null

          // 记录从 task_created 事件中获取的 task_id，用于流中断后 fallback 轮询
          let capturedTaskId: string | null = null

          try {
            while (true) {
              const { done, value } = await reader.read()

              if (value) {
                buffer += decoder.decode(value, { stream: !done })
              }

              const lines = buffer.split('\n')
              buffer = done ? '' : (lines.pop() || '')

              for (const line of lines) {
                if (line.startsWith('data: ') || line.startsWith('data:')) {
                  const data = line.slice(line.startsWith('data: ') ? 6 : 5).trim()
                  if (data) {
                    try {
                      const event: ProgressEvent = JSON.parse(data)

                      // 捕获 task_id，供流中断时 fallback 使用
                      if (event.type === 'task_created' && event.taskId) {
                        capturedTaskId = event.taskId
                      }

                      if (onProgress) {
                        onProgress(event)
                      }

                      if (event.type === 'task_completed') {
                        finalResponse = (event as TaskCompletedEvent).response
                      }
                      else if (event.type === 'error') {
                        reject(new Error((event as ErrorEvent).message))
                        return
                      }
                    }
                    catch (parseError) {
                      console.warn('[AgentService] Failed to parse SSE event:', parseError)
                    }
                  }
                }
              }

              if (done)
                break
            }
          }
          finally {
            reader.releaseLock()
            cleanup()
          }

          if (finalResponse) {
            resolve(finalResponse)
          }
          else if (capturedTaskId) {
            // SSE 流意外结束但任务已创建，fallback 到轮询等待结果
            console.warn('[AgentService] SSE stream ended without completion, falling back to polling for task:', capturedTaskId)
            try {
              const task = await this.pollTaskUntilComplete(capturedTaskId, {
                intervalMs: 2000,
                timeoutMs: 300000,
                onProgress: onProgress ? (t) => {
                  onProgress({ type: 'progress', progress: t.progress, completedSteps: 0, totalSteps: 0, message: '' })
                } : undefined,
              })
              if (task.status === 'completed' && task.results) {
                resolve(task.results as unknown as AgentResponse)
              }
              else {
                reject(new Error(`Task ${capturedTaskId} ended with status ${task.status}`))
              }
            }
            catch (pollError) {
              reject(pollError)
            }
          }
          else {
            reject(new Error('No completion response received'))
          }
        })
        .catch((error) => {
          cleanup()
          if (error.name === 'AbortError') {
            reject(new Error('Request timed out or interrupted'))
          }
          else {
            reject(error)
          }
        })
    })
  }
}

// 导出单例
export const agentService = new AgentService()
