/**
 * AraelTraceDetail - 执行详情折叠区
 *
 * 折叠在已完成任务底部，展开后显示：
 * - 总耗时
 * - 每步的模型层级 + 耗时
 * - 降级/重试提示
 * - Agent 引用的记忆
 */

import type { ExecutionStep, ExecutionTrace } from '../types'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { agentService } from '../../../services/agent'

/** TraceDetail 所需的最小数据接口 */
export interface TraceableExecution {
  taskId?: string
  status: 'processing' | 'waiting' | 'completed' | 'error'
  steps: ExecutionStep[]
  executionTrace?: ExecutionTrace
  recalledMemories?: string[]
  skillName?: string
}

/** 能力分类 → 角色标签 */
function getCategoryLabel(category?: string): string {
  switch (category) {
    case 'data_read': return 'R'
    case 'data_write': return 'W'
    case 'ai_process': return 'AI'
    case 'resource_create': return 'C'
    case 'external_integration': return 'E'
    case 'ui_control': return 'UI'
    case 'system_op': return 'S'
    default: return '--'
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000)
    return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function tierLabel(tier: string): string {
  return tier === 'pro' ? 'Pro' : 'Std'
}

export interface AraelTraceDetailProps {
  task: TraceableExecution
}

export const AraelTraceDetail: React.FC<AraelTraceDetailProps> = ({ task }) => {
  const { t, format } = useI18n()
  const [trace, setTrace] = useState(task.executionTrace)
  const [loading, setLoading] = useState(false)
  const loadAttemptedRef = useRef<string | null>(null)

  const loadTrace = useCallback(async () => {
    if (trace || !task.taskId)
      return
    loadAttemptedRef.current = task.taskId
    setLoading(true)
    try {
      const detail = await agentService.getTaskWithTrace(task.taskId)
      if (detail.executionTrace) {
        setTrace({
          totalDurationMs: detail.executionTrace.totalDurationMs,
          tierUsage: detail.executionTrace.tierUsage,
          steps: detail.executionTrace.steps,
        })
      }
    }
    catch {
      // 追踪数据不可用
    }
    finally {
      setLoading(false)
    }
  }, [trace, task.taskId])

  // 组件挂载时自动加载 trace
  useEffect(() => {
    if (!trace && !loading && loadAttemptedRef.current !== task.taskId) {
      loadTrace()
    }
  }, [trace, loading, loadTrace, task.taskId])

  if (task.status !== 'completed' && task.status !== 'error')
    return null
  if (task.steps.length === 0 && !trace)
    return null

  const hasDetailData = trace || task.steps.some(s => s.tierUsed || s.durationMs)

  const proCount = trace?.tierUsage?.pro ?? trace?.tierUsage?.Pro ?? 0
  const stdCount = trace?.tierUsage?.standard ?? trace?.tierUsage?.Standard ?? 0

  return (
    <div className="arael-trace-detail">
      {(proCount > 0 || stdCount > 0) && (
        <div className="arael-trace-tiers">
          {proCount > 0 && (
            <span className="arael-tier-pro">
              Pro x
              {proCount}
            </span>
          )}
          {stdCount > 0 && (
            <span className="arael-tier-std">
              Std x
              {stdCount}
            </span>
          )}
        </div>
      )}

      <div className="arael-trace-content">
        {loading && <div className="arael-trace-loading">{t.arael.loading}</div>}

        {hasDetailData && (
            <div className="arael-trace-steps">
              {(trace?.steps ?? task.steps).map((step) => {
                const stepId = ('stepId' in step ? step.stepId : step.id) as string
                const taskStep = task.steps.find(s => s.id === stepId)
                const capId = 'capabilityId' in step ? (step as { capabilityId: string }).capabilityId : undefined
                const label = getCategoryLabel(taskStep?.capabilityCategory ?? capId?.split('.')[0])
                const tier = ('tierUsed' in step ? step.tierUsed : undefined) ?? taskStep?.tierUsed
                const duration = step.durationMs ?? taskStep?.durationMs
                const success = 'success' in step ? step.success : (taskStep?.status === 'completed')
                const degraded = ('degraded' in step ? (step as { degraded?: boolean }).degraded : false) ?? taskStep?.degraded
                const retry = taskStep?.retryAttempt

                return (
                  <div key={stepId} className={`arael-trace-step ${success ? '' : 'arael-trace-step-failed'}`}>
                    <span className="arael-trace-step-label">{label}</span>
                    <span className="arael-trace-step-name">
                      {taskStep?.name ?? capId ?? stepId}
                    </span>
                    <span className="arael-trace-step-meta">
                      {tier && (
                        <span className={`arael-tier-badge arael-tier-${tier}`}>
                          {tierLabel(tier)}
                        </span>
                      )}
                      {duration != null && duration > 0 && (
                        <span className="arael-trace-step-duration">{formatDuration(duration)}</span>
                      )}
                    </span>
                    {!success && 'error' in step && (step as { error?: string }).error && (
                      <div className="arael-trace-step-error">{(step as { error?: string }).error}</div>
                    )}
                    {degraded && (
                      <div className="arael-trace-step-note">{t.arael.autoDegraded}</div>
                    )}
                    {retry != null && retry > 0 && (
                      <div className="arael-trace-step-note">
                        {format(t.arael.retryCount, { n: retry })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {task.recalledMemories && task.recalledMemories.length > 0 && (
            <div className="arael-trace-memories">
              <span className="arael-trace-memories-label">{t.arael.recalledMemories}</span>
              {task.recalledMemories.map((mem, i) => (
                <div key={i} className="arael-trace-memory-item">{mem}</div>
              ))}
            </div>
          )}

          {task.skillName && (
            <div className="arael-trace-skill">
              <span className="arael-trace-skill-label">{t.arael.skill}</span>
              <span className="arael-trace-skill-name">{task.skillName}</span>
            </div>
          )}
      </div>
    </div>
  )
}

export default AraelTraceDetail
