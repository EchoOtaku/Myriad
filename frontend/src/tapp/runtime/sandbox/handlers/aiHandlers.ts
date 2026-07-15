/**
 * AI 与报告处理器
 */

import type {
  AIQuotaStatus,
  AITaskRequest,
  AIUsageSnapshot,
  TappInstance,
} from '../../../types'
import type { TappBridge } from '../../TappBridge'
import * as TappApiService from '../../../services/TappApiService'

function toCompatibleQuotaStatus(usage: AIUsageSnapshot): AIQuotaStatus {
  return {
    daily: {
      limit: usage.calls.limit ?? Infinity,
      used: usage.calls.used,
      resetsAt: usage.calls.resetsAt,
    },
    tokens: {
      limit: usage.tokens.limit ?? Infinity,
      used: usage.tokens.used,
      resetsAt: usage.tokens.resetsAt,
    },
    cooldown: {
      required: usage.cooldown.requiredSeconds,
      remaining: usage.cooldown.remainingSeconds,
    },
    restricted: usage.restricted,
    restrictionReason: usage.restrictionReason,
    unlimited: usage.unlimited,
    userRole: usage.role,
  }
}

/**
 * 注册 AI 处理器
 */
export function registerAIHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance,
): () => void {
  const taskStreams = new Map<string, AbortController>()

  bridge.registerHandler('ai.getQuota', async () => {
    try {
      const usage = await TappApiService.getAIUsage(
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: toCompatibleQuotaStatus(usage) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI usage failed',
      }
    }
  })

  bridge.registerHandler('ai.canGenerate', async () => {
    try {
      const usage = await TappApiService.getAIUsage(
        await bridge.getRuntimeGrant(),
      )
      return {
        success: true,
        data: {
          allowed: !usage.restricted,
          reason: usage.restrictionReason,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI usage failed',
      }
    }
  })

  bridge.registerHandler('ai.generate', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    if (!request) return { success: false, error: 'Request required' }

    try {
      const response = await TappApiService.aiGenerate(
        tappInstance.id,
        request as Parameters<typeof TappApiService.aiGenerate>[1],
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: response }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI generation failed',
      }
    }
  })

  bridge.registerHandler('ai.analyze', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    if (!request) return { success: false, error: 'Request required' }

    try {
      const response = await TappApiService.aiAnalyze(
        tappInstance.id,
        request as Parameters<typeof TappApiService.aiAnalyze>[1],
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: response }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI analysis failed',
      }
    }
  })

  bridge.registerHandler('ai.image', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    const req = request as { prompt?: string } | undefined
    if (!req?.prompt) return { success: false, error: 'Prompt required' }

    try {
      const response = await TappApiService.aiImageGenerate(
        tappInstance.id,
        request as Parameters<typeof TappApiService.aiImageGenerate>[1],
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: response }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI image failed',
      }
    }
  })

  bridge.registerHandler('ai.chat', async (message) => {
    const [params] = (message.payload as { args: unknown[] }).args || []
    const { messages, context, options, preferPro } = (params || {}) as {
      messages?: Array<{
        role: 'user' | 'assistant' | 'system'
        content: string
      }>
      context?: Record<string, unknown>
      options?: Record<string, unknown>
      preferPro?: boolean
    }
    try {
      const result = await TappApiService.aiChat(
        {
          tappId: tappInstance.id,
          messages: messages || [],
          context,
          options,
          preferPro,
        },
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI chat failed',
      }
    }
  })

  bridge.registerHandler('ai.tasks.create', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    if (!request) return { success: false, error: 'Request required' }
    try {
      const task = await TappApiService.createAITask(
        request as AITaskRequest,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: task }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'AI task creation failed',
      }
    }
  })

  bridge.registerHandler('ai.tasks.get', async (message) => {
    const [taskId] = (message.payload as { args: unknown[] }).args || []
    if (typeof taskId !== 'string') {
      return { success: false, error: 'Task ID required' }
    }
    try {
      const task = await TappApiService.getAITask(
        taskId,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: task }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI task lookup failed',
      }
    }
  })

  bridge.registerHandler('ai.tasks.cancel', async (message) => {
    const [taskId] = (message.payload as { args: unknown[] }).args || []
    if (typeof taskId !== 'string') {
      return { success: false, error: 'Task ID required' }
    }
    try {
      const result = await TappApiService.cancelAITask(
        taskId,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'AI task cancellation failed',
      }
    }
  })

  bridge.registerHandler('ai.tasks.usage', async () => {
    try {
      const usage = await TappApiService.getAIV2Usage(
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: usage }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI usage failed',
      }
    }
  })

  bridge.registerHandler('ai.tasks.subscribe', async (message) => {
    const [taskId] = (message.payload as { args: unknown[] }).args || []
    if (typeof taskId !== 'string') {
      return { success: false, error: 'Task ID required' }
    }
    if (taskStreams.has(taskId)) return { success: true, data: true }

    const controller = new AbortController()
    taskStreams.set(taskId, controller)
    void TappApiService.streamAITaskEvents(
      taskId,
      await bridge.getRuntimeGrant(),
      (event) => bridge.emit('aiTaskEvent', { taskId, ...event }),
      controller.signal,
    )
      .catch((error) => {
        if (!controller.signal.aborted) {
          bridge.emit('aiTaskEvent', {
            taskId,
            event: 'error',
            data: {
              code: 'AI_TASK_STREAM_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          })
        }
      })
      .finally(() => taskStreams.delete(taskId))
    return { success: true, data: true }
  })

  bridge.registerHandler('ai.tasks.unsubscribe', async (message) => {
    const [taskId] = (message.payload as { args: unknown[] }).args || []
    if (typeof taskId !== 'string') {
      return { success: false, error: 'Task ID required' }
    }
    taskStreams.get(taskId)?.abort()
    taskStreams.delete(taskId)
    return { success: true, data: true }
  })

  return () => {
    taskStreams.forEach((controller) => controller.abort())
    taskStreams.clear()
  }
}

/**
 * 注册报告处理器
 */
export function registerReportHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance,
  options: { readOnly?: boolean } = {},
): void {
  bridge.registerHandler('report.listReports', async () => {
    try {
      const reports = await TappApiService.listReports(
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: reports }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      }
    }
  })

  bridge.registerHandler('report.getReport', async (message) => {
    const [reportId] = (message.payload as { args: unknown[] }).args || []
    if (!reportId) return { success: false, error: 'Report ID required' }
    try {
      const report = await TappApiService.getReport(
        reportId as string,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: report }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      }
    }
  })

  bridge.registerHandler('report.getPlatformReport', async (message) => {
    const [platform] = (message.payload as { args: unknown[] }).args || []
    if (!platform) return { success: false, error: 'Platform required' }
    try {
      const report = await TappApiService.getPlatformReport(
        platform as string,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: report }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      }
    }
  })

  if (!options.readOnly) {
    bridge.registerHandler('report.create', async (message) => {
      const [params] = (message.payload as { args: unknown[] }).args || []
      const { title, reportType, content, metadata } = (params || {}) as {
        title?: string
        reportType?: string
        content?: unknown
        metadata?: unknown
      }
      try {
        const result = await TappApiService.createTappReport(
          {
            tappId: tappInstance.id,
            title: title || '',
            reportType: (reportType || 'custom') as
              'custom' | 'platform' | 'comprehensive',
            content,
            metadata,
          },
          await bridge.getRuntimeGrant(),
        )
        return { success: true, data: result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed',
        }
      }
    })
  }

  bridge.registerHandler('report.list', async () => {
    try {
      const result = await TappApiService.listTappReports(
        tappInstance.id,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      }
    }
  })

  bridge.registerHandler('report.get', async (message) => {
    const [params] = (message.payload as { args: unknown[] }).args || []
    const { reportId } = (params || {}) as { reportId?: string }
    if (!reportId) return { success: false, error: 'Report ID required' }
    try {
      const result = await TappApiService.getTappReport(
        tappInstance.id,
        reportId,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      }
    }
  })

  if (!options.readOnly) {
    bridge.registerHandler('report.update', async (message) => {
      const [params] = (message.payload as { args: unknown[] }).args || []
      const { reportId, title, content, metadata } = (params || {}) as {
        reportId?: string
        title?: string
        content?: unknown
        metadata?: unknown
      }
      if (!reportId) return { success: false, error: 'Report ID required' }
      try {
        const result = await TappApiService.updateTappReport(
          tappInstance.id,
          reportId,
          { title, content, metadata },
          await bridge.getRuntimeGrant(),
        )
        return { success: true, data: result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed',
        }
      }
    })

    bridge.registerHandler('report.delete', async (message) => {
      const [params] = (message.payload as { args: unknown[] }).args || []
      const { reportId } = (params || {}) as { reportId?: string }
      if (!reportId) return { success: false, error: 'Report ID required' }
      try {
        const result = await TappApiService.deleteTappReport(
          tappInstance.id,
          reportId,
          await bridge.getRuntimeGrant(),
        )
        return { success: true, data: result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed',
        }
      }
    })
  }
}
