/**
 * 执行引擎 —— 助手真正干活的地方，一个像素都不画。
 *
 * 会话持久化、SSE 流式进度、断线重连、敏感操作确认、错误兜底都在这里；结果全部
 * 写进 store，由 `AgentPanel` 那一层去画。**分开是因为这两件事的变更节奏完全不同**：
 * 界面会一改再改，而这套状态机是跑通过的，不该被布局调整牵连。
 *
 * 它挂在 App 根上，跟面板开没开无关 —— 面板收起来的时候任务照样跑完。
 */

import type React from 'react'

import type {
  AgentResponse,
  FrontendAction,
  MeropeStateChangedEvent,
  PerformancePlanEvent,
  PlannerDecisionEvent,
  ProgressEvent,
  ProgressUpdateEvent,
  StepCompletedEvent,
  StepDebugEvent,
  StepStartedEvent,
  SummaryTokenEvent,
  TaskCreatedEvent,
  ThinkingTokenEvent,
} from '../../services/agent'
import type { AgentAttachment } from './agentAttachments'
import {
  type ChatMessage,
  type ChatSession,
  type ExecutionTrace,
  type PendingQuestion,
  type TaskExecution,
  executionStepsFromHistory,
} from './engineTypes'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { usePageContentOptional } from '../../contexts/PageContentContext'
import { agentFace } from '../../features/merope/agentFaceChannel'
import { agentService, executeFrontendAction } from '../../services/agent'
import {
  collectReattachCandidates,
  isNonTerminalTaskStatus,
} from '../../services/agent/reattach'
import { userFacingError } from '../../utils/userFacingError'
import {
  errorCode,
  generationFailureMessage,
} from '../agent/onboarding/generationError'
import { buildAgentPendingAction } from './agentAction'
import { attachmentsForRequest } from './agentAttachments'
import { getAgentContextConsent } from './agentContextConsent'
import { peelThoughtFromContent, splitThinkContent } from './agentThinking'
import { setAgentSessionId } from './agentMessages'
import { syncProjectedMessages } from './projectAgentMessage'
import {
  AGENT_PANEL_ACTION_EVENT,
  AGENT_PANEL_ANSWER_EVENT,
  AGENT_PANEL_COMMAND_EVENT,
  AGENT_PANEL_OPEN_SESSION_EVENT,
  AGENT_PANEL_SUBMIT_EVENT,
  agentPanelActionDetail,
  agentPanelAnswerDetail,
  agentPanelCommand,
  agentPanelOpenSessionId,
  agentPanelSubmitDetail,
  dispatchAgentPanelOpen,
} from './agentPanelEvents'
import {
  clearAgentPendingAction,
  pushAgentStatusEvent,
  resetAgentStatus,
  setAgentPendingAction,
  setAgentStatusAwaitingConfirmation,
  setAgentStatusThinking,
  setAgentUndoOffer,
} from './agentStatusStore'

import { planAgentUndo } from './agentUndo'
import { useMessageState } from './useMessageState'

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

/**
 * 执行一条 Agent 给的前端操作，顺带记下它能不能退回去。
 *
 * 用真实发生的路由变化来判断，不看指令声明的目标 —— 指令可能被处理器改写，也
 * 可能压根没跳成，给一个不管用的撤销比不给更糟。
 */
async function runFrontendAction(action: FrontendAction): Promise<unknown> {
  const beforePath = currentPath()
  const result = await executeFrontendAction(action)
  const offer = planAgentUndo({
    action,
    beforePath,
    afterPath: currentPath(),
    nowMs: Date.now(),
  })
  if (offer) setAgentUndoOffer(offer)
  return result
}

export const AgentEngine: React.FC = () => {
  const location = useLocation()
  const { t, format, locale } = useI18n()
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  // 页面内容上下文
  const pageContentContext = usePageContentOptional()

  const [isLoading, setIsLoading] = useState(false)

  // 对话系统核心状态

  // 消息状态（提取到 useMessageState hook）
  const {
    messages,
    setMessages,
    messagesRef,
    updateMessage,
    updateMessageExecution,
    addExecutionStep,
    updateExecutionStep,
  } = useMessageState()

  // 当前会话 ID（服务端持久化）
  const [sessionId, setSessionId] = useState<string | null>(null)

  const handleSendRef =
    useRef<
      (text: string, attachments?: readonly AgentAttachment[]) => Promise<void>
    >(null)

  // 把对话同步给新 UI 的 Full 层。只送「谁说的、说了什么、说完没有」，执行追踪
  // 那一堆留在这边 —— 新 UI 不该认识旧面板的消息模型。
  useLayoutEffect(() => {
    syncProjectedMessages(messages)
  }, [messages])

  // Refs
  const handleAgentResponseRef =
    useRef<(messageId: string, response: AgentResponse) => Promise<void>>(null)
  const createProgressHandlerRef = useRef<
    ((assistantMessageId: string) => (event: ProgressEvent) => void) | null
  >(null)
  const answerQuestionRef =
    useRef<(messageId: string, answer: string) => void>(null)
  const sessionTitleSetRef = useRef(false)
  const handledResponseKeysRef = useRef(new Set<string>())
  const loadingMessageIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  // 检测是否有待回答的问题（用于将主输入框路由到回答逻辑）
  const pendingAnswerMsg = useMemo(() => {
    // 从后往前找第一个有 pendingQuestion 且未回答的消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (
        m.pendingQuestion &&
        !m.selectedAnswer &&
        m.taskExecution?.status === 'waiting'
      ) {
        return m
      }
    }
    return null
  }, [messages])

  // 会话管理

  const startNewSession = useCallback(async () => {
    // 新建会话只切换前端视图。旧任务由后端 run 持续执行，并通过通知中心报告状态。
    if (loadingMessageIdRef.current) {
      agentFace.cancel(loadingMessageIdRef.current)
    }
    loadingMessageIdRef.current = null
    setIsLoading(false)
    resetAgentStatus()
    setSessionId(null)
    setMessages([])
    sessionTitleSetRef.current = false
  }, [])

  /**
   * 将已加载会话中的非终态任务重新挂到 UI，并订阅 run 进度流。
   * 不重新 POST process；仅 GET run stream / task 状态。
   * Candidate 合并逻辑见 `collectReattachCandidates`（跨消息补 runId、runId-only 通知）。
   */
  const reattachLiveWork = useCallback(
    async (
      messagesToScan: ChatMessage[],
      hints?: { runId?: string; taskId?: string },
    ) => {
      const candidates = collectReattachCandidates(
        messagesToScan.map((m) => ({
          id: m.id,
          role: m.role,
          taskId: m.taskExecution?.taskId,
          runId: m.taskExecution?.runId,
        })),
        hints,
      )

      for (const candidate of candidates) {
        try {
          const taskId = candidate.taskId
          const runId = candidate.runId
          let progress = 0
          let isWaiting = false
          let pendingQ: PendingQuestion | undefined

          if (taskId) {
            const task = await agentService.getTask(taskId)
            if (!isNonTerminalTaskStatus(task.status)) continue
            isWaiting = task.status === 'waiting_for_input'
            progress = task.progress ?? 0
            if (task.pendingQuestion) {
              pendingQ = {
                questionId: task.pendingQuestion.questionId,
                questionType: task.pendingQuestion.questionType,
                question: task.pendingQuestion.question,
                context: task.pendingQuestion.context,
                options: task.pendingQuestion.options,
                required: task.pendingQuestion.required,
                defaultValue: task.pendingQuestion.defaultValue,
              }
            }
          } else if (!runId) {
            continue
          }

          // runId-only：没有 task 时也挂 processing，靠 SSE 回放补全
          updateMessage(candidate.messageId, {
            pendingQuestion: pendingQ,
            taskExecution: {
              taskId: taskId || '',
              runId,
              status: isWaiting ? 'waiting' : 'processing',
              progress,
              steps: [],
            },
          })

          if (!runId) continue

          loadingMessageIdRef.current = candidate.messageId
          setIsLoading(true)
          setAgentStatusThinking()
          const onProgress = createProgressHandlerRef.current?.(
            candidate.messageId,
          )
          if (!onProgress) continue
          void agentService
            .subscribeRun(runId, onProgress)
            .then((response) => {
              handleAgentResponseRef.current?.(candidate.messageId, response)
            })
            .catch((error) => {
              agentFace.cancel(candidate.messageId)
              console.warn('[AgentEngine] reattach stream ended:', error)
            })
            .finally(() => {
              if (loadingMessageIdRef.current === candidate.messageId) {
                loadingMessageIdRef.current = null
                setIsLoading(false)
              }
            })
          // 同一时刻只恢复一条 live stream
          break
        } catch (error) {
          console.warn('[AgentEngine] reattach task probe failed:', error)
        }
      }
    },
    [updateMessage],
  )

  const loadSession = useCallback(
    async (
      session: ChatSession,
      reattachHints?: { runId?: string; taskId?: string },
    ) => {
      setSessionId(session.id)
      sessionTitleSetRef.current = !!session.title

      try {
        const sessionMessages = await agentService.getSessionMessages(
          session.id,
          1,
          50,
        )
        const loaded: ChatMessage[] = sessionMessages.map((m, idx) => {
          const meta = m.metadata as Record<string, unknown> | undefined
          const data = meta?.data as Record<string, unknown> | undefined
          const imageUrls: string[] = []
          if (data && typeof data.imageUrl === 'string') {
            imageUrls.push(data.imageUrl)
          }
          const stepHistory = (
            meta?.task as Record<string, unknown> | undefined
          )?.stepHistory as Array<Record<string, unknown>> | undefined
          if (stepHistory) {
            for (const s of stepHistory) {
              if (
                typeof s.imageUrl === 'string' &&
                !imageUrls.includes(s.imageUrl)
              ) {
                imageUrls.push(s.imageUrl)
              }
            }
          }

          const metaTaskId =
            (typeof meta?.taskId === 'string' && meta.taskId) ||
            (typeof meta?.task_id === 'string' && meta.task_id) ||
            m.taskId ||
            undefined
          const metaRunId =
            (typeof meta?.runId === 'string' && meta.runId) ||
            (typeof meta?.run_id === 'string' && meta.run_id) ||
            undefined
          const taskMeta = meta?.task as Record<string, unknown> | undefined
          const statusFromMeta =
            typeof taskMeta?.status === 'string' ? taskMeta.status : undefined
          const historySteps = executionStepsFromHistory(stepHistory)

          let taskExecution: TaskExecution | undefined
          if (metaTaskId || metaRunId || historySteps.length) {
            const waiting =
              statusFromMeta === 'waiting_for_input' ||
              !!taskMeta?.pendingQuestion
            taskExecution = {
              taskId: metaTaskId || '',
              runId: metaRunId,
              status: waiting ? 'waiting' : 'completed',
              progress:
                typeof taskMeta?.progress === 'number'
                  ? (taskMeta.progress as number)
                  : waiting
                    ? 50
                    : 100,
              steps: historySteps,
            }
          }

          // 从持久化 metadata 恢复等待中的问题（reattach 会再与后端对齐）
          let pendingQuestion: PendingQuestion | undefined
          const pq =
            (meta?.pendingQuestion as Record<string, unknown> | undefined) ||
            (taskMeta?.pendingQuestion as Record<string, unknown> | undefined)
          if (pq && typeof pq.question === 'string') {
            pendingQuestion = {
              questionId: String(pq.questionId ?? pq.question_id ?? ''),
              questionType: String(
                pq.questionType ?? pq.question_type ?? 'free_text',
              ),
              question: pq.question,
              context: typeof pq.context === 'string' ? pq.context : undefined,
              options: pq.options as PendingQuestion['options'],
              required:
                typeof pq.required === 'boolean' ? pq.required : undefined,
              defaultValue:
                typeof pq.defaultValue === 'string'
                  ? pq.defaultValue
                  : typeof pq.default_value === 'string'
                    ? pq.default_value
                    : undefined,
            }
            if (taskExecution) taskExecution.status = 'waiting'
          }

          return {
            id: `loaded_${m.id}_${idx}`,
            sessionId: session.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            createdAt: new Date(m.createdAt),
            suggestions: meta?.suggestions as string[] | undefined,
            data: data ?? undefined,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            taskExecution,
            pendingQuestion,
          }
        })
        setMessages(loaded)
        // 刷新 / 通知打开：探测非终态任务并 re-subscribe
        void reattachLiveWork(loaded, reattachHints)
      } catch (error) {
        console.error('[AgentEngine] 加载会话消息失败:', error)
      }
    },
    [reattachLiveWork],
  )

  // 外部打开指定会话（通知中心点击任务通知跳转，可带 runId/taskId）
  useEffect(() => {
    const handleOpenSession = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        sessionId?: string
        runId?: string
        taskId?: string
      } | null
      const sid = detail?.sessionId
      // 通知中心还在发这条旧事件：改成把新面板叫出来，会话仍然由这边去取
      dispatchAgentPanelOpen('messages')
      if (typeof sid !== 'string' || !sid) return
      void import('../../utils/analyticsEvents').then(
        ({ trackProductEvent, AnalyticsEvents }) => {
          trackProductEvent(AnalyticsEvents.AGENT_OPEN, {
            target: 'session',
            throttleMs: 5000,
          })
        },
      )
      void loadSession(
        {
          id: sid,
          title: null,
          messageCount: 0,
          lastActiveAt: '',
        },
        {
          runId: typeof detail?.runId === 'string' ? detail.runId : undefined,
          taskId:
            typeof detail?.taskId === 'string' ? detail.taskId : undefined,
        },
      )
    }
    window.addEventListener('arael-open-session', handleOpenSession)
    return () =>
      window.removeEventListener('arael-open-session', handleOpenSession)
  }, [loadSession])

  useEffect(() => {
    const handleOpenManage = () => {
      dispatchAgentPanelOpen('manage')
      void import('../../utils/analyticsEvents').then(
        ({ trackProductEvent, AnalyticsEvents }) => {
          trackProductEvent(AnalyticsEvents.AGENT_OPEN, {
            target: 'manage',
            throttleMs: 5000,
          })
        },
      )
      // 具体看哪一面由 AgentPanel 那边的 requestedView 决定
    }
    window.addEventListener('arael-open-manage', handleOpenManage)
    return () =>
      window.removeEventListener('arael-open-manage', handleOpenManage)
  }, [])

  // Quick Overlay 只负责把话递过来，执行仍然在这边：打开自己，照常发送。
  // 等 Full 层重做完，接住这条事件的换成新面板，overlay 那边不用改。
  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const detail = agentPanelSubmitDetail(event)
      if (!detail) return
      // 不再把自己显示出来 —— 新 UI 的 Full 层已经在画这段对话了，
      // 两个面板同时开着只会让人不知道该看哪个。这边只管跑。
      void handleSendRef.current?.(detail.text, detail.attachments)
    }
    window.addEventListener(AGENT_PANEL_SUBMIT_EVENT, handleSubmit)
    return () =>
      window.removeEventListener(AGENT_PANEL_SUBMIT_EVENT, handleSubmit)
  }, [])

  // 操作卡片上按的那一下。卡片只递决定，真正调 /agent/confirm 的仍然是这里，
  // 过期校验、进度流、失败兜底都在原来那条路上。
  useEffect(() => {
    const handleDecision = (event: Event) => {
      const detail = agentPanelActionDetail(event)
      if (!detail) return
      clearAgentPendingAction(detail.id)
      const target = messagesRef.current.find(
        (message) =>
          message.pendingQuestion?.confirmationId === detail.id &&
          !message.selectedAnswer,
      )
      if (!target) return
      answerQuestionRef.current?.(
        target.id,
        detail.approved ? 'confirm' : 'cancel',
      )
    }
    window.addEventListener(AGENT_PANEL_ACTION_EVENT, handleDecision)
    return () =>
      window.removeEventListener(AGENT_PANEL_ACTION_EVENT, handleDecision)
  }, [messagesRef])

  // 界面上点的那个选项。走的是和打字回答同一条路。
  useEffect(() => {
    const handleAnswer = (event: Event) => {
      const detail = agentPanelAnswerDetail(event)
      if (!detail) return
      answerQuestionRef.current?.(detail.messageId, detail.answer)
    }
    window.addEventListener(AGENT_PANEL_ANSWER_EVENT, handleAnswer)
    return () =>
      window.removeEventListener(AGENT_PANEL_ANSWER_EVENT, handleAnswer)
  }, [])

  // 新 UI 的历史列表挑了一条。取消息、重连进行中的任务都还是这边的活。
  useEffect(() => {
    const handleOpenSession = (event: Event) => {
      const id = agentPanelOpenSessionId(event)
      if (!id) return
      void loadSession({
        id,
        title: null,
        messageCount: 0,
        lastActiveAt: '',
      })
    }
    window.addEventListener(AGENT_PANEL_OPEN_SESSION_EVENT, handleOpenSession)
    return () =>
      window.removeEventListener(
        AGENT_PANEL_OPEN_SESSION_EVENT,
        handleOpenSession,
      )
  }, [loadSession])

  // 当前是哪一条会话，历史列表要靠它标出「就是这条」
  useEffect(() => {
    setAgentSessionId(sessionId)
  }, [sessionId])

  // 中断

  const interruptCurrentTask = useCallback(async () => {
    // 用户意图中断：标记 abort intent=user，SSE 层不会 re-subscribe 同一 run
    agentService.abortCurrentRequest()

    const processingMsgs = messages.filter(
      (m) =>
        m.taskExecution?.status === 'processing' ||
        m.taskExecution?.status === 'waiting' ||
        m.taskExecution?.status === 'cancelling',
    )
    for (const msg of processingMsgs) {
      agentFace.cancel(msg.id)
      const taskId = msg.taskExecution?.taskId
      // 先进入 cancelling，避免乐观地显示 error 而后端仍在跑
      updateMessageExecution(msg.id, { status: 'cancelling' })
      if (taskId && !taskId.startsWith('confirmation:')) {
        try {
          await agentService.cancelTask(taskId)
          updateMessage(msg.id, {
            taskExecution: msg.taskExecution
              ? { ...msg.taskExecution, status: 'error' }
              : undefined,
            content: msg.content || t.agentPanel.interrupted,
          })
        } catch {
          updateMessage(msg.id, {
            taskExecution: msg.taskExecution
              ? { ...msg.taskExecution, status: 'error' }
              : undefined,
            content:
              msg.content ||
              `${t.agentPanel.interrupted} (${t.agentPanel.cancelFailed})`,
          })
        }
      } else {
        updateMessage(msg.id, {
          taskExecution: msg.taskExecution
            ? { ...msg.taskExecution, status: 'error' }
            : undefined,
          content: msg.content || t.agentPanel.interrupted,
        })
      }
    }
    loadingMessageIdRef.current = null
    setIsLoading(false)
    resetAgentStatus()
  }, [messages, updateMessage, updateMessageExecution])
  // 界面上按的「开新对话」「停下」。真正的动作在这边，界面只递一个意思。
  useEffect(() => {
    const handleCommand = (event: Event) => {
      const command = agentPanelCommand(event)
      if (command === 'new-session') void startNewSession()
      if (command === 'interrupt') void interruptCurrentTask()
    }
    window.addEventListener(AGENT_PANEL_COMMAND_EVENT, handleCommand)
    return () =>
      window.removeEventListener(AGENT_PANEL_COMMAND_EVENT, handleCommand)
  }, [startNewSession, interruptCurrentTask])

  // SSE 进度处理

  const createProgressHandler = useCallback(
    (assistantMessageId: string) => {
      let streamedSummary = ''
      let streamedThinking = ''
      const utterance = agentFace.openReply(assistantMessageId, locale)

      const publishThinking = (text: string) => {
        streamedThinking = text
        updateMessageExecution(assistantMessageId, { reasoning: text })
      }

      return (event: ProgressEvent) => {
        // 岛与面板读同一份状态：这里是唯一的入口，别处不再解读 SSE
        pushAgentStatusEvent(event)
        // 记录关键 SSE 事件到调试日志
        switch (event.type) {
          case 'run_started': {
            if (event.sessionId) {
              setSessionId(event.sessionId)
              sessionIdRef.current = event.sessionId
            }
            if (event.runId) {
              updateMessageExecution(assistantMessageId, {
                runId: event.runId,
              })
            }
            break
          }

          case 'session_created': {
            setSessionId(event.sessionId)
            // 同步更新 ref，确保后续同帧事件能立即读到
            sessionIdRef.current = event.sessionId
            break
          }

          case 'session_title_updated': {
            // 后端并行 AI 生成的标题通过 SSE 推送
            if (event.title) {
              sessionTitleSetRef.current = true
            }
            break
          }

          case 'task_created': {
            const tcEvent = event as TaskCreatedEvent
            const execUpdates: Partial<TaskExecution> = {
              taskId: tcEvent.taskId,
              progress: 5,
            }
            if (tcEvent.skillId) {
              execUpdates.skillId = tcEvent.skillId
              execUpdates.skillName = tcEvent.skillName
            }
            if (tcEvent.queuePosition != null && tcEvent.queuePosition > 0) {
              execUpdates.queuePosition = tcEvent.queuePosition
            }

            // 存储计划步骤描述（用于前端显示执行计划概览）
            if (
              tcEvent.stepDescriptions &&
              tcEvent.stepDescriptions.length > 0
            ) {
              execUpdates.planStepDescriptions = tcEvent.stepDescriptions
            }

            updateMessageExecution(assistantMessageId, execUpdates)
            // content 留空 — 进度信息由 live steps 展示，避免与步骤进度重复
            break
          }

          case 'task_assigned': {
            const assignEvent =
              event as import('../../services/agent/types').TaskAssignedEvent
            updateMessageExecution(assistantMessageId, {
              assignment: assignEvent.assignment,
            })
            break
          }

          case 'step_started': {
            utterance.end()
            streamedSummary = '' // ai_summarize 从零开始，替换 announce_plan
            const stepEvent = event as StepStartedEvent
            addExecutionStep(assistantMessageId, {
              id: stepEvent.stepId,
              name: stepEvent.description,
              status: 'running',
              stepIndex: stepEvent.stepIndex,
              totalSteps: stepEvent.totalSteps,
              capabilityCategory: stepEvent.capabilityCategory,
              retryAttempt: stepEvent.retryAttempt,
            })
            updateMessageExecution(assistantMessageId, {
              queuePosition: 0,
            })
            break
          }

          case 'step_completed': {
            const stepEvent = event as StepCompletedEvent
            updateExecutionStep(assistantMessageId, stepEvent.stepId, {
              status: stepEvent.success ? 'completed' : 'error',
              message: stepEvent.outputSummary,
              tierUsed: stepEvent.tierUsed,
              degraded: stepEvent.degraded,
              durationMs: stepEvent.durationMs,
              imageUrl: stepEvent.imageUrl,
            })
            if (stepEvent.imageUrl) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        imageUrls: [
                          ...(m.imageUrls || []).filter(
                            (u) => u !== stepEvent.imageUrl,
                          ),
                          stepEvent.imageUrl!,
                        ],
                      }
                    : m,
                ),
              )
            }
            break
          }

          case 'step_retrying': {
            const retryEvent =
              event as import('../../services/agent/types').StepRetryingEvent
            // 更新步骤状态为重试中
            updateExecutionStep(assistantMessageId, retryEvent.stepId, {
              status: 'running',
              message: `${retryEvent.reason} (${retryEvent.retryCount}/${retryEvent.maxRetries})`,
              retryAttempt: retryEvent.retryCount,
            })
            break
          }

          case 'progress': {
            const progressEvent = event as ProgressUpdateEvent
            updateMessageExecution(assistantMessageId, {
              progress: progressEvent.progress,
              ...(progressEvent.message?.trim()
                ? { statusMessage: progressEvent.message }
                : {}),
            })
            break
          }

          case 'waiting_for_input': {
            const wEvent =
              event as import('../../services/agent/types').WaitingForInputEvent
            const pendingQ: import('./engineTypes').PendingQuestion = {
              questionId: wEvent.questionId,
              questionType: wEvent.questionType,
              question: wEvent.question,
              context: wEvent.context,
              options: wEvent.options,
              required: wEvent.required,
              defaultValue: wEvent.defaultValue,
            }
            updateMessage(assistantMessageId, {
              pendingQuestion: pendingQ,
              selectedAnswer: undefined,
            })
            updateMessageExecution(assistantMessageId, {
              status: 'waiting',
              taskId: wEvent.taskId,
            })
            break
          }

          case 'error':
            utterance.cancel()
            updateMessageExecution(assistantMessageId, { status: 'error' })
            updateMessage(assistantMessageId, { content: event.message })
            break

          case 'thinking_token': {
            const tokenEvent = event as ThinkingTokenEvent
            if (!tokenEvent.done && tokenEvent.token) {
              publishThinking(streamedThinking + tokenEvent.token)
            }
            break
          }

          case 'summary_token': {
            const tokenEvent = event as SummaryTokenEvent
            if (tokenEvent.done) {
              const split = splitThinkContent(streamedSummary)
              if (split.thought && split.thought !== streamedThinking) {
                publishThinking(split.thought)
              }
              const body = peelThoughtFromContent(
                split.content,
                streamedThinking,
              )
              if (body) {
                updateMessageExecution(assistantMessageId, {
                  statusMessage: body,
                })
                updateMessage(assistantMessageId, { content: body })
              }
              utterance.end()
            } else {
              streamedSummary += tokenEvent.token
              const split = splitThinkContent(streamedSummary)
              if (split.thought && split.thought !== streamedThinking) {
                publishThinking(split.thought)
              }
              const body = peelThoughtFromContent(
                split.content,
                streamedThinking,
              )
              if (body) {
                utterance.chunk(tokenEvent.token)
                updateMessage(assistantMessageId, { content: body })
              }
            }
            break
          }

          case 'merope_state_changed': {
            const stateEvent = event as MeropeStateChangedEvent
            agentFace.updateState({
              mood: stateEvent.mood,
              activity: stateEvent.activity,
            })
            break
          }

          case 'performance_plan': {
            const performanceEvent = event as PerformancePlanEvent
            agentFace.deliver({
              messageId: assistantMessageId,
              performance: performanceEvent.performance,
            })
            break
          }

          case 'task_completed': {
            utterance.end()
            // 检查任务是否真正完成（多轮问答时可能仍在等待用户输入）
            const completedEvent =
              event as import('../../services/agent/types').TaskCompletedEvent
            const taskInfo = completedEvent.response?.task as
              Record<string, unknown> | undefined
            const isStillWaiting = taskInfo?.status === 'waiting_for_input'

            if (!isStillWaiting) {
              // 任务真正完成：清除 pendingQuestion、更新状态、确保 isLoading 归位
              updateMessage(assistantMessageId, {
                pendingQuestion: undefined,
                selectedAnswer: undefined,
              })
              updateMessageExecution(assistantMessageId, {
                status: completedEvent.success ? 'completed' : 'error',
                progress: 100,
              })
              if (loadingMessageIdRef.current === assistantMessageId) {
                loadingMessageIdRef.current = null
                setIsLoading(false)
              }
            }
            break
          }

          case 'planner_decision': {
            const pdEvent = event as PlannerDecisionEvent
            if (pdEvent.reasoning && !streamedThinking) {
              publishThinking(pdEvent.reasoning)
            }
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId || !m.taskExecution) return m
                const existing = m.taskExecution.debugTrace ?? {
                  stepDebugEntries: [],
                }
                const planned =
                  m.taskExecution.planStepDescriptions ??
                  pdEvent.steps
                    .map((step) => (step.action || step.capabilityId).trim())
                    .filter(Boolean)
                return {
                  ...m,
                  taskExecution: {
                    ...m.taskExecution,
                    ...(planned.length
                      ? { planStepDescriptions: planned }
                      : {}),
                    debugTrace: {
                      ...existing,
                      plannerDecision: {
                        status: pdEvent.status,
                        reasoning: pdEvent.reasoning,
                        confidence: pdEvent.confidence,
                        steps: pdEvent.steps,
                        userRequest: pdEvent.userRequest,
                      },
                    },
                  },
                }
              }),
            )
            break
          }

          case 'step_debug': {
            const sdEvent = event as StepDebugEvent
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId || !m.taskExecution) return m
                const existing = m.taskExecution.debugTrace ?? {
                  stepDebugEntries: [],
                }
                const entries = [...existing.stepDebugEntries]

                if (sdEvent.phase === 'start') {
                  entries.push({
                    stepId: sdEvent.stepId,
                    capabilityId: sdEvent.capabilityId,
                    isDynamic: sdEvent.isDynamic,
                    directive: sdEvent.directive,
                    userRequest: sdEvent.userRequest,
                    params: sdEvent.params,
                  })
                } else if (sdEvent.phase === 'complete') {
                  const idx = entries.findIndex(
                    (e) => e.stepId === sdEvent.stepId,
                  )
                  if (idx >= 0) {
                    entries[idx] = {
                      ...entries[idx],
                      outputPreview: sdEvent.outputPreview,
                      durationMs: sdEvent.durationMs,
                      success: sdEvent.success,
                      error: sdEvent.error,
                    }
                  } else {
                    entries.push({
                      stepId: sdEvent.stepId,
                      capabilityId: sdEvent.capabilityId,
                      isDynamic: sdEvent.isDynamic,
                      outputPreview: sdEvent.outputPreview,
                      durationMs: sdEvent.durationMs,
                      success: sdEvent.success,
                      error: sdEvent.error,
                    })
                  }
                }

                return {
                  ...m,
                  taskExecution: {
                    ...m.taskExecution,
                    debugTrace: { ...existing, stepDebugEntries: entries },
                  },
                }
              }),
            )
            break
          }
        }
      }
    },
    [
      updateMessage,
      updateMessageExecution,
      addExecutionStep,
      updateExecutionStep,
      locale,
    ],
  )

  createProgressHandlerRef.current = createProgressHandler

  // 发送消息

  const handleSend = useCallback(
    async (text: string, attachments: readonly AgentAttachment[] = []) => {
      const messageText = text.trim()
      if (!messageText && attachments.length === 0) return
      const requestText =
        messageText ||
        format(t.agentPanel.attach.fallback, {
          names: attachments.map((item) => item.name).join(', '),
        })

      void import('../../utils/analyticsEvents').then(
        ({ trackProductEvent, AnalyticsEvents }) => {
          trackProductEvent(AnalyticsEvents.AGENT_SEND, {
            target: location.pathname.split('/').filter(Boolean)[0] || 'home',
            throttleMs: 2000,
          })
        },
      )

      // 游客可开面板（guest visible / guest_perm_ai_chat），但 BE Agent 全线要 JWT。
      // 发消息前引导登录，避免必 401。
      if (!isAuthenticated) {
        const loginHint = t.agentPanel.loginRequiredHint
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_guest_hint_${Date.now()}`,
            sessionId: sessionId || '',
            role: 'assistant',
            content: loginHint,
            createdAt: new Date(),
          },
        ])
        window.setTimeout(() => {
          navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)
        }, 600)
        return
      }

      // 如果有待回答的问题，将输入路由到 answerQuestion（即使 isLoading 也允许）
      if (pendingAnswerMsg && answerQuestionRef.current) {
        answerQuestionRef.current(pendingAnswerMsg.id, requestText)
        return
      }

      if (isLoading) {
        const activeTaskMessage = [...messages]
          .reverse()
          .find(
            (message) =>
              message.taskExecution?.status === 'processing' &&
              !!message.taskExecution.taskId &&
              !message.taskExecution.taskId.startsWith('confirmation:'),
          )
        if (!activeTaskMessage?.taskExecution?.taskId) return

        const userMessage: ChatMessage = {
          id: `msg_user_steer_${Date.now()}`,
          sessionId: sessionId || '',
          role: 'user',
          content: messageText,
          createdAt: new Date(),
          ...(attachments.length ? { attachments: [...attachments] } : {}),
        }
        setMessages((prev) => [...prev, userMessage])
        try {
          const result = await agentService.steerSession(
            requestText,
            activeTaskMessage.taskExecution.taskId,
          )
          updateMessageExecution(activeTaskMessage.id, {
            statusMessage: result.message,
          })
        } catch (error) {
          const errorMessage = userFacingError(
            error,
            t.errors.agentSteeringFailed,
          )
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_assistant_steer_error_${Date.now()}`,
              sessionId: sessionId || '',
              role: 'assistant',
              content: format(t.agentPanel.errorWithDetail, {
                error: errorMessage,
              }),
              createdAt: new Date(),
            },
          ])
        }
        return
      }

      // 切回对话视图

      // 1. 创建 user 消息
      const userMsgId = `msg_user_${Date.now()}`
      const userMessage: ChatMessage = {
        id: userMsgId,
        sessionId: sessionId || '',
        role: 'user',
        content: messageText,
        createdAt: new Date(),
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      }

      // 2. 创建 placeholder assistant 消息
      const assistantMsgId = `msg_assistant_${Date.now()}`
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        sessionId: sessionId || '',
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        taskExecution: {
          taskId: '',
          status: 'processing',
          progress: 0,
          steps: [],
        },
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      loadingMessageIdRef.current = assistantMsgId
      setIsLoading(true)
      setAgentStatusThinking()

      try {
        // 构建上下文
        const context: Record<string, unknown> = {
          currentRoute: location.pathname,
        }

        if (sessionId) {
          context.sessionId = sessionId
        }

        // 页面内容
        const customData: Record<string, unknown> = {}
        // 用户关掉「读当前页」之后就真的不读 —— 界面上说了不看，请求里也不能捎上
        if (getAgentContextConsent() && pageContentContext?.hasContent) {
          const contentForAgent = pageContentContext.getContentForAgent()
          if (contentForAgent) {
            customData.pageContent = contentForAgent
          }
        }
        if (attachments.length) {
          customData.attachments = attachmentsForRequest(attachments)
        }
        if (Object.keys(customData).length > 0) {
          context.customData = customData
        }

        const response = await agentService.processWithProgress(
          requestText,
          createProgressHandler(assistantMsgId),
          context,
        )

        if (handleAgentResponseRef.current) {
          handleAgentResponseRef.current(assistantMsgId, response)
        }
      } catch (error) {
        agentFace.cancel(assistantMsgId)
        // A budget rejection arrives on the same channel as a real failure and
        // reads as "出错了" without this: the stream is already HTTP 200 by then,
        // so the quota code on the error event is the only signal.
        const errorMsg = generationFailureMessage(
          error,
          t.agentPanel.executionFailed,
          t.agentPanel.requestTimeout,
          {
            AI_COOLDOWN_ACTIVE: t.agentPanel.quotaCooldown,
            AI_DAILY_CALL_LIMIT: t.agentPanel.quotaExhausted,
            AI_ANONYMOUS_DAILY_CALL_LIMIT: t.agentPanel.quotaExhausted,
            AI_DAILY_TOKEN_LIMIT: t.agentPanel.quotaExhausted,
            AI_ANONYMOUS_DAILY_TOKEN_LIMIT: t.agentPanel.quotaExhausted,
            AI_QUOTA_EXCEEDED: t.agentPanel.quotaExhausted,
            QUEUE_FULL: t.agentPanel.queueBusy,
            agent_access_denied: t.agentPanel.accessDenied,
            admin_required: t.agentPanel.accessDenied,
            agent_processing_failed: t.agentPanel.executionFailed,
            NETWORK_ERROR: t.agentPanel.streamError,
          },
        )
        // 传输层直接抛出时后端来不及发 error 事件，补一条给状态岛
        pushAgentStatusEvent({
          type: 'error',
          message: errorMsg,
          code: errorCode(error) ?? 'agent_processing_failed',
        })

        // 保留已收集的 debugTrace 和步骤信息，只更新状态
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m
            const existing = m.taskExecution
            return {
              ...m,
              content:
                m.content ||
                t.agentPanel.errorWithDetail.replace('{error}', errorMsg),
              taskExecution: {
                taskId: existing?.taskId ?? '',
                status: 'error' as const,
                progress: existing?.progress ?? 0,
                steps: existing?.steps ?? [],
                debugTrace: existing?.debugTrace,
                executionTrace: existing?.executionTrace,
              },
            }
          }),
        )
      } finally {
        if (loadingMessageIdRef.current === assistantMsgId) {
          loadingMessageIdRef.current = null
          setIsLoading(false)
        }
      }
    },
    [
      isLoading,
      messages,
      sessionId,
      location.pathname,
      pageContentContext,
      createProgressHandler,
      updateMessage,
      pendingAnswerMsg,
      isAuthenticated,
      navigate,
      t,
      format,
    ],
  )

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  // 处理 Agent 响应

  const handleAgentResponse = useCallback(
    async (messageId: string, response: AgentResponse) => {
      const taskData = response.task as Record<string, unknown> | undefined
      let pendingQuestion = taskData?.pendingQuestion as
        PendingQuestion | undefined
      if (
        response.responseType === 'confirmation_required' &&
        response.confirmation
      ) {
        const confirmation = response.confirmation
        const details = confirmation.pendingSteps
          .map((step) => {
            const impact =
              step.impact.length > 0 ? `\n${step.impact.join('\n')}` : ''
            return `${step.capabilityName}: ${step.message}${impact}`
          })
          .join('\n\n')
        pendingQuestion = {
          questionId: `confirmation:${confirmation.confirmationId}`,
          confirmationId: confirmation.confirmationId,
          questionType: 'confirmation',
          question: response.message,
          context: details || undefined,
          options: [
            { value: 'confirm', label: t.common.confirm },
            { value: 'cancel', label: t.common.cancel },
          ],
          required: true,
          riskLevel: confirmation.riskLevel,
          expiresInSeconds: confirmation.expiresInSeconds,
          receivedAtMs: Date.now(),
        }
        // 新 UI 的操作卡片从这里拿料；它按风险决定摊开多少
        setAgentPendingAction(
          buildAgentPendingAction({
            confirmation,
            prompt: response.message,
            nowMs: Date.now(),
          }),
        )
      }
      const taskId = taskData?.taskId as string | undefined
      const taskStatus = taskData?.status as string | undefined
      const responseKey = response.confirmation?.confirmationId
        ? `confirmation:${response.confirmation.confirmationId}`
        : taskId
          ? `${taskId}:${taskStatus ?? response.responseType}:${pendingQuestion?.questionId ?? ''}`
          : null
      if (responseKey) {
        if (handledResponseKeysRef.current.has(responseKey)) return
        handledResponseKeysRef.current.add(responseKey)
      }

      if (pendingQuestion && pendingQuestion.question) {
        if (!pendingQuestion.confirmationId) {
          setAgentStatusAwaitingConfirmation(pendingQuestion.question)
        }
        updateMessage(messageId, {
          pendingQuestion,
          selectedAnswer: undefined,
        })
        updateMessageExecution(messageId, {
          status: 'waiting',
          taskId:
            (taskData?.taskId as string) ||
            (pendingQuestion.confirmationId
              ? `confirmation:${pendingQuestion.confirmationId}`
              : ''),
          progress: 100,
        })
        agentFace.deliver({
          messageId,
          text: pendingQuestion.question,
          locale,
        })
        return
      }

      const isSuccess =
        response.success !== false &&
        (response.task?.status === 'completed' ||
          response.responseType === 'answer' ||
          response.responseType === 'task_completed')

      const responseData = response.data as Record<string, unknown> | undefined

      const stepHistory = taskData?.stepHistory as
        | Array<{
            stepId: string
            status: string
            outputSummary?: string
            capabilityName?: string
            durationMs?: number
            error?: string
          }>
        | undefined

      const isMultiStep = stepHistory && stepHistory.length > 1

      // 构建显示内容
      // 多步骤：response.message 已由后端 ai_summarize 生成人格化汇总，直接使用
      // 单步骤：优先使用 data 中的 AI 文本（reply/aiSummary/analysis/summary）
      // 注：announce_plan 已通过 SSE 实时写入正文，此处 response.message（= ai_summarize）会覆盖它
      let displayMessage: string | undefined

      if (isMultiStep) {
        // 多步骤：后端 response.message 是人格化汇总
        displayMessage = response.message
      } else {
        // 单步骤：从 data 提取 AI 文本
        const aiText = responseData
          ? ((typeof responseData.reply === 'string'
              ? responseData.reply
              : undefined) ??
            (typeof responseData.aiSummary === 'string'
              ? responseData.aiSummary
              : undefined) ??
            (typeof responseData.analysis === 'string'
              ? responseData.analysis
              : undefined) ??
            (typeof responseData.summary === 'string'
              ? responseData.summary
              : undefined))
          : undefined
        const dataMessage =
          typeof responseData?.message === 'string'
            ? responseData.message
            : undefined
        displayMessage = aiText || response.message || dataMessage
      }

      // 失败步骤信息追加
      if (stepHistory && stepHistory.length > 0) {
        const failedSteps = stepHistory.filter((s) => s.status === 'failed')
        if (failedSteps.length > 0 && failedSteps.length < stepHistory.length) {
          const failInfo = failedSteps
            .map((s) =>
              userFacingError(
                s.error || s.outputSummary,
                t.agentPanel.executionFailed,
              ),
            )
            .join('；')
          displayMessage = `${displayMessage || ''}\n${format(t.agentPanel.failReason, { reason: failInfo })}`
        } else if (failedSteps.length === stepHistory.length) {
          displayMessage = t.agentPanel.executionFailed
          const failInfo = failedSteps
            .map((s) =>
              userFacingError(
                s.error || s.outputSummary,
                t.agentPanel.executionFailed,
              ),
            )
            .join('；')
          displayMessage += `\n${failInfo}`
        }
      }

      console.log('[AgentEngine] handleAgentResponse:', {
        responseType: response.responseType,
        message: response.message,
        isMultiStep,
        dataKeys: responseData ? Object.keys(responseData) : [],
        displayMessage,
      })

      // 从 response.data 和 stepHistory 中兜底提取 imageUrls（SSE 丢失时恢复）
      // 与已通过 SSE 实时收集的 imageUrls 合并（不覆盖）
      const fallbackImageUrls: string[] = []
      if (typeof responseData?.imageUrl === 'string') {
        fallbackImageUrls.push(responseData.imageUrl as string)
      }
      if (stepHistory) {
        for (const s of stepHistory) {
          const url = (s as Record<string, unknown>).imageUrl
          if (typeof url === 'string' && !fallbackImageUrls.includes(url)) {
            fallbackImageUrls.push(url)
          }
        }
      }

      // 合并：SSE 实时收集的 + fallback，去重
      const existingImageUrls: string[] = ((): string[] => {
        const msg = messagesRef.current.find((m) => m.id === messageId)
        return msg?.imageUrls ?? []
      })()
      const mergedImageUrls = [...existingImageUrls]
      for (const url of fallbackImageUrls) {
        if (!mergedImageUrls.includes(url)) {
          mergedImageUrls.push(url)
        }
      }

      updateMessage(messageId, {
        content:
          displayMessage || response.message || t.agentPanel.taskCompleted,
        suggestions: response.suggestions?.length
          ? response.suggestions
          : undefined,
        data: response.data,
        pendingQuestion: undefined,
        selectedAnswer: undefined,
        ...(mergedImageUrls.length > 0 ? { imageUrls: mergedImageUrls } : {}),
      })

      const spokenReply = displayMessage || response.message
      if (isSuccess) {
        agentFace.deliver({
          messageId,
          text: spokenReply,
          locale,
          performance: response.performance,
        })
      }

      const hasFailedSteps =
        stepHistory?.some((s) => s.status === 'failed') ?? false

      // 从 TaskInfo 中解析 executionTrace
      const rawTrace = taskData?.executionTrace as
        | {
            trace_id?: string
            total_duration_ms?: number
            totalDurationMs?: number
            tier_usage?: Record<string, number>
            tierUsage?: Record<string, number>
            steps?: Array<{
              step_id?: string
              stepId?: string
              capability_id?: string
              capabilityId?: string
              tier_used?: string
              tierUsed?: string
              duration_ms?: number
              durationMs?: number
              success?: boolean
              error?: string
            }>
          }
        | undefined

      const executionTrace: ExecutionTrace | undefined = rawTrace
        ? {
            totalDurationMs:
              rawTrace.totalDurationMs ?? rawTrace.total_duration_ms ?? 0,
            tierUsage: rawTrace.tierUsage ?? rawTrace.tier_usage ?? {},
            steps: (rawTrace.steps ?? []).map((s) => ({
              stepId: s.stepId ?? s.step_id ?? '',
              capabilityId: s.capabilityId ?? s.capability_id ?? '',
              tierUsed: s.tierUsed ?? s.tier_used ?? '',
              durationMs: s.durationMs ?? s.duration_ms ?? 0,
              success: s.success ?? true,
              error: s.error,
            })),
          }
        : undefined

      const liveSteps =
        messagesRef.current.find((m) => m.id === messageId)?.taskExecution
          ?.steps ?? []
      const historySteps = executionStepsFromHistory(
        stepHistory as Array<Record<string, unknown>> | undefined,
      )

      updateMessageExecution(messageId, {
        status:
          isSuccess && !hasFailedSteps
            ? 'completed'
            : response.success === false || response.responseType === 'error'
              ? 'error'
              : hasFailedSteps || response.task?.status === 'failed'
                ? 'error'
                : 'completed',
        progress: 100,
        ...(executionTrace ? { executionTrace } : {}),
        ...(liveSteps.length === 0 && historySteps.length > 0
          ? { steps: historySteps }
          : {}),
      })

      // 执行前端动作
      const frontendActions = responseData?.frontendActions as
        (typeof response.frontendAction)[] | undefined
      let frontendAction =
        response.frontendAction ||
        (responseData?.frontendAction as typeof response.frontendAction) ||
        (responseData?.action as typeof response.frontendAction)

      if (
        frontendAction &&
        typeof frontendAction === 'object' &&
        'type' in frontendAction
      ) {
        const actionObj = frontendAction as unknown as Record<string, unknown>
        if (!('timestamp' in actionObj)) {
          frontendAction = {
            ...actionObj,
            timestamp: Date.now(),
          } as typeof response.frontendAction
        }
        if (responseData?.criteria && !('criteria' in actionObj)) {
          frontendAction = {
            ...(frontendAction as unknown as Record<string, unknown>),
            criteria: responseData.criteria as string,
          } as typeof response.frontendAction
        }
      }

      if (
        frontendActions &&
        Array.isArray(frontendActions) &&
        frontendActions.length > 0
      ) {
        const visibleResults: unknown[] = []
        for (const action of frontendActions) {
          if (!action) continue
          try {
            const result = await runFrontendAction(action)
            if (
              result &&
              typeof result === 'object' &&
              ['query_windows', 'music_get_status'].includes(action.type)
            ) {
              visibleResults.push(result)
            }
          } catch (error) {
            console.error('[AgentEngine] Frontend action failed:', error)
          }
        }
        if (visibleResults.length > 0) {
          const serialized = JSON.stringify(visibleResults, null, 2).slice(
            0,
            4000,
          )
          updateMessage(messageId, {
            content: `${displayMessage || response.message}\n\n\`\`\`json\n${serialized}\n\`\`\``,
            data: {
              ...(responseData ?? {}),
              frontendActionResults: visibleResults,
            },
          })
        }
      } else if (frontendAction) {
        try {
          const result = await runFrontendAction(frontendAction)
          if (
            result &&
            typeof result === 'object' &&
            ['query_windows', 'music_get_status'].includes(frontendAction.type)
          ) {
            const serialized = JSON.stringify(result, null, 2).slice(0, 4000)
            updateMessage(messageId, {
              content: `${displayMessage || response.message}\n\n\`\`\`json\n${serialized}\n\`\`\``,
              data: {
                ...(responseData ?? {}),
                frontendActionResult: result,
              },
            })
          }
        } catch (error) {
          console.error('[AgentEngine] Frontend action failed:', error)
        }
      }
    },
    [locale, updateMessage, updateMessageExecution],
  )

  useEffect(() => {
    handleAgentResponseRef.current = handleAgentResponse
  }, [handleAgentResponse])

  // 回答问题

  const answerQuestion = useCallback(
    async (messageId: string, answer: string) => {
      const msg = messages.find((m) => m.id === messageId)
      if (!msg?.taskExecution?.taskId || !msg.pendingQuestion) return

      // 敏感确认过期后禁止 Confirm（Cancel 仍可关卡）
      const pq = msg.pendingQuestion
      if (
        answer === 'confirm' &&
        pq.confirmationId &&
        typeof pq.expiresInSeconds === 'number' &&
        pq.expiresInSeconds > 0 &&
        typeof pq.receivedAtMs === 'number'
      ) {
        const remaining =
          pq.expiresInSeconds -
          Math.floor((Date.now() - pq.receivedAtMs) / 1000)
        if (remaining <= 0) {
          updateMessage(messageId, {
            content: t.agentPanel.confirmExpiredHint,
          })
          updateMessageExecution(messageId, { status: 'error' })
          return
        }
      }

      // 保留 pendingQuestion 以显示选中状态，同时用 selectedAnswer 锁定
      updateMessage(messageId, {
        selectedAnswer: answer,
      })
      updateMessageExecution(messageId, {
        status: 'processing',
        progress: 50,
      })
      loadingMessageIdRef.current = messageId
      setIsLoading(true)
      setAgentStatusThinking()

      try {
        const response = msg.pendingQuestion.confirmationId
          ? await agentService.confirmOperation(
              msg.pendingQuestion.confirmationId,
              answer === 'confirm',
              undefined,
              createProgressHandler(messageId),
            )
          : await agentService.answerQuestionWithProgress(
              msg.taskExecution.taskId,
              msg.pendingQuestion.questionId,
              answer,
              createProgressHandler(messageId),
            )
        handleAgentResponseRef.current?.(messageId, response)
      } catch (error) {
        agentFace.cancel(messageId)
        const errorMsg = userFacingError(error, t.errors.agentConfirmFailed)
        updateMessage(messageId, {
          content: format(t.agentPanel.answerFailed, { error: errorMsg }),
        })
        updateMessageExecution(messageId, { status: 'error' })
      } finally {
        // 安全保障：回答流完成后确保 isLoading 归位
        if (loadingMessageIdRef.current === messageId) {
          loadingMessageIdRef.current = null
          setIsLoading(false)
        }
      }
    },
    [
      messages,
      updateMessage,
      updateMessageExecution,
      createProgressHandler,
      t.agentPanel.confirmExpiredHint,
      t.errors.agentConfirmFailed,
      t.agentPanel.answerFailed,
      format,
    ],
  )

  useEffect(() => {
    answerQuestionRef.current = answerQuestion
  }, [answerQuestion])

  // 这个组件不画任何东西。它是执行引擎：SSE、会话、重连、确认、错误处理都在
  // 这里跑，结果通过 store 交给新 UI 去画。
  return null
}

export default AgentEngine
