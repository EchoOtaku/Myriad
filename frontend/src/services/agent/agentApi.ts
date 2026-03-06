/**
 * Agent API 服务
 *
 * 处理与后端 Agent API 的通信
 */

import type {
  AgentResponse,
  Capability,
  ClarifyRequest,
  ConversationMessage,
  CreatePresetRequest,
  ErrorEvent,
  ProcessContext,
  ProcessRequest,
  ProgressCallback,
  ProgressEvent,
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
   * 保存到历史记录
   */
  async saveToHistory(
    input: string,
    parsedSteps?: unknown,
    intentSummary?: string,
    title?: string,
    conversationData?: ConversationMessage[],
  ): Promise<TaskPreset> {
    return this.createPreset({
      input,
      presetType: 'history',
      parsedSteps,
      intentSummary,
      title,
      conversationData,
    })
  }

  /**
   * 添加到收藏
   * 注意：收藏的任务默认使用「重新运行」模式，不保存对话历史
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
   * 更新预设的对话数据
   * 用于在对话过程中持续保存对话历史
   */
  async updatePresetConversation(
    presetId: number,
    title: string,
    conversationData: ConversationMessage[],
  ): Promise<TaskPreset> {
    return apiService.patch<TaskPreset>(`${this.baseUrl}/presets/${presetId}/conversation`, {
      title,
      conversationData,
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

  // ============ 内部方法 ============

  /**
   * 执行 SSE 请求的通用方法
   */
  private async executeSSERequest(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
    onProgress?: ProgressCallback,
  ): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      const token = TokenManager.getToken()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180000)

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
            throw new Error('无法读取响应流')
          }

          const decoder = new TextDecoder()
          let buffer = ''
          let finalResponse: AgentResponse | null = null

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
            clearTimeout(timeoutId)
          }

          if (finalResponse) {
            resolve(finalResponse)
          }
          else {
            reject(new Error('未收到完成响应'))
          }
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          if (error.name === 'AbortError') {
            reject(new Error('请求超时'))
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
