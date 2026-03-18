/**
 * Arael - AI 助手浮动面板
 *
 * 对话系统重构版：
 * - message-centric 聊天 UI（替代 task-list）
 * - 服务端 session 持久化多轮上下文
 * - 保留丰富的任务执行可视化（嵌入聊天气泡）
 * - 全局任意区域长按 500ms 触发
 * - SSE 流式进度更新
 * - 统一面板内切换（对话/会话列表/管理）
 */

import type { TranslationKeys } from '../../i18n'
import type {
  AgentResponse,
  ProgressEvent,
  ProgressUpdateEvent,
  SessionInfo,
  StepCompletedEvent,
  StepStartedEvent,
  SummaryTokenEvent,
  TaskCreatedEvent,
  TaskPreset,
} from '../../services/agent'

import type { ChatMessage, ChatSession, ExecutionStep, ExecutionTrace, PanelVisibility, PendingQuestion, TaskExecution } from './types'
import { AnimatePresenceShim as AnimatePresence, motionShim as motion } from '@lib/motionShim'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../../contexts/I18nContext'
import { usePageContentOptional } from '../../contexts/PageContentContext'
import {
  agentService,
  executeFrontendAction,
} from '../../services/agent'
import { audioToBase64, getSpeechStatus, speechToText } from '../../services/speechApi'

import { AraelChatMessage } from './components/AraelChatMessage'
import { AraelInput } from './components/AraelInput'
import { AraelManageDrawer } from './components/AraelManageDrawer'
import { AraelPresets } from './components/AraelPresets'
import { AraelSessionList } from './components/AraelSessionList'
import {
  LONG_PRESS_DURATION,
  SPRING_SNAPPY,
} from './types'
import './AraelPanel.css'

/** 面板内视图 */
type PanelView = 'chat' | 'sessions' | 'manage'

// 智能提示词生成
function getSmartGreeting(pathname: string, _historyCount: number, arael: TranslationKeys['arael']): string {
  const hour = new Date().getHours()
  const g = arael.greeting

  const timeGreeting = hour < 6
    ? g.lateNight
    : hour < 12
      ? g.morning
      : hour < 18
        ? g.afternoon
        : g.evening

  const pageHintsMap: Record<string, string[]> = {
    '/library': arael.pageHints.library,
    '/brew': arael.pageHints.brew,
    '/reports': arael.pageHints.reports,
    '/config': arael.pageHints.config,
    '/data-management': arael.pageHints.dataManagement,
    '/tapp': arael.pageHints.tapp,
  }

  for (const [path, hints] of Object.entries(pageHintsMap)) {
    if (pathname.startsWith(path)) {
      const hint = hints[Math.floor(Math.random() * hints.length)]
      return `Arael ${timeGreeting}，${hint}`
    }
  }

  const hint = arael.generalHints[Math.floor(Math.random() * arael.generalHints.length)]
  return `Arael ${timeGreeting}，${hint}`
}

/** 构建完整调试信息 */
function buildDebugInfo(s: {
  sessionId: string | null
  sessionTitle: string | null
  sessionTitleSetRef: boolean
  panelView: string
  visibility: string
  isLoading: boolean
  hasActiveExecution: boolean
  input: string
  expandedMessageId: string | null
  messages: ChatMessage[]
  presetFavorites: number
  continueSessions: number
  speechAvailable: boolean
  isRecording: boolean
  isProcessingVoice: boolean
}): string {
  const msgs = s.messages
  const lastAssistant = msgs.toReversed().find(m => m.role === 'assistant')
  const exec = lastAssistant?.taskExecution
  const uCount = msgs.filter(m => m.role === 'user').length
  const aCount = msgs.filter(m => m.role === 'assistant').length
  const sCount = msgs.filter(m => m.role === 'system').length

  const lines: string[] = [
    `=== Arael Debug ===`,
    `time: ${new Date().toISOString()}`,
    ``,
    `[Session]`,
    `id: ${s.sessionId ?? 'null'}`,
    `title: ${s.sessionTitle ?? '-'}`,
    `titleSetRef: ${s.sessionTitleSetRef}`,
    ``,
    `[State]`,
    `view: ${s.panelView}`,
    `visibility: ${s.visibility}`,
    `isLoading: ${s.isLoading}`,
    `hasActiveExec: ${s.hasActiveExecution}`,
    `input: "${s.input}"`,
    `expandedMsg: ${s.expandedMessageId ?? '-'}`,
    ``,
    `[Messages] total: ${msgs.length} (u:${uCount} a:${aCount} s:${sCount})`,
  ]

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const ts = m.createdAt.toLocaleTimeString()
    const contentPreview = m.content.slice(0, 80)
    const execInfo = m.taskExecution
      ? ` | exec:${m.taskExecution.status} ${m.taskExecution.progress}%`
      : ''
    const extras: string[] = []
    if (m.suggestions?.length) {
      extras.push(`suggestions:${m.suggestions.length}`)
    }
    if (m.pendingQuestion) {
      extras.push(`pendingQ:${m.pendingQuestion.questionId}`)
    }
    if (m.imageUrls?.length) {
      extras.push(`imgs:${m.imageUrls.length}`)
    }
    if (m.data) {
      extras.push(`data:${JSON.stringify(m.data).slice(0, 60)}`)
    }
    lines.push(`  [${i}] ${m.role} | ${m.id} | ${ts}${execInfo}`)
    lines.push(`        content: ${contentPreview}`)
    if (extras.length) {
      lines.push(`        ${extras.join(' | ')}`)
    }
  }

  lines.push(``)
  lines.push(`[Last Execution]`)
  if (exec) {
    lines.push(`  taskId: ${exec.taskId}`)
    lines.push(`  status: ${exec.status}`)
    lines.push(`  progress: ${exec.progress}%`)
    lines.push(`  steps: ${exec.steps.length}`)
    if (exec.skillId) {
      lines.push(`  skillId: ${exec.skillId}`)
    }
    if (exec.skillName) {
      lines.push(`  skillName: ${exec.skillName}`)
    }
    if (exec.statusMessage) {
      lines.push(`  statusMsg: ${exec.statusMessage.slice(0, 120)}`)
    }
    if (exec.recalledMemories?.length) {
      lines.push(`  memories: ${exec.recalledMemories.join(', ')}`)
    }
    if (exec.assignment) {
      lines.push(`  assignment: ${JSON.stringify(exec.assignment)}`)
    }
    if (exec.executionTrace) {
      const t = exec.executionTrace
      lines.push(`  trace: totalMs=${t.totalDurationMs} steps=${t.steps.length}`)
      lines.push(`  tierUsage: ${JSON.stringify(t.tierUsage)}`)
      for (const sr of t.steps) {
        lines.push(`    ${sr.stepId}: ${sr.success ? 'ok' : 'fail'} ${sr.durationMs}ms cap=${sr.capabilityId} tier=${sr.tierUsed}`)
        if (sr.error) {
          lines.push(`      error: ${sr.error}`)
        }
      }
    }
    for (let i = 0; i < exec.steps.length; i++) {
      const step = exec.steps[i]
      lines.push(`  step[${i}]: ${step.name} | ${step.status} | ${step.durationMs ?? '-'}ms | cat:${step.capabilityCategory ?? '-'} | tier:${step.tierUsed ?? '-'}`)
      if (step.message) {
        lines.push(`    msg: ${step.message.slice(0, 100)}`)
      }
      if (step.imageUrl) {
        lines.push(`    img: ${step.imageUrl}`)
      }
      if (step.degraded) {
        lines.push(`    degraded: true`)
      }
      if (step.retryAttempt) {
        lines.push(`    retry: ${step.retryAttempt}`)
      }
    }
  }
  else {
    lines.push(`  none`)
  }

  lines.push(``)
  lines.push(`[Other]`)
  lines.push(`presets: ${s.presetFavorites}`)
  lines.push(`continueSessions: ${s.continueSessions}`)
  lines.push(`speech: ${s.speechAvailable}`)
  lines.push(`recording: ${s.isRecording}`)
  lines.push(`processingVoice: ${s.isProcessingVoice}`)

  return lines.join('\n')
}

// ============ 组件 ============

export const AraelPanel: React.FC = () => {
  const location = useLocation()
  const { t, format } = useI18n()

  // 页面内容上下文
  const pageContentContext = usePageContentOptional()

  // 面板可见性
  const [visibility, setVisibility] = useState<PanelVisibility>('hidden')

  // 输入状态
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // ============ 对话系统核心状态 ============

  // 聊天消息列表（核心 source of truth）
  const [messages, setMessages] = useState<ChatMessage[]>([])

  // 当前会话 ID（服务端持久化）
  const [sessionId, setSessionId] = useState<string | null>(null)

  // 展开的消息（用于展示执行详情）
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)

  // 面板内视图切换
  const [panelView, setPanelView] = useState<PanelView>('chat')

  // 任务预设（收藏）
  const [presetFavorites, setPresetFavorites] = useState<TaskPreset[]>([])

  // 空状态继续对话候选（上一个、上上个）
  const [continueSessions, setContinueSessions] = useState<ChatSession[]>([])

  // 语音服务可用性
  const [speechAvailable, setSpeechAvailable] = useState(false)

  // 语音录制状态
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Refs
  const handleSendRef = useRef<(text?: string) => Promise<void>>(null)
  const handleAgentResponseRef = useRef<(messageId: string, response: AgentResponse) => Promise<void>>(null)
  const sessionTitleSetRef = useRef(false)
  const [sessionTitle, setSessionTitle] = useState<string | null>(null)

  // 长按检测
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressStartRef = useRef<{ x: number, y: number } | null>(null)
  const isLongPressingRef = useRef(false)
  const [longPressIndicator, setLongPressIndicator] = useState<{ x: number, y: number, active: boolean }>({ x: 0, y: 0, active: false })

  // DOM 引用
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 计算是否有活跃的处理中消息
  const hasActiveExecution = useMemo(() =>
    messages.some(m => m.taskExecution?.status === 'processing' || m.taskExecution?.status === 'waiting'), [messages])

  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // ============ 预设管理 ============

  const loadPresets = useCallback(async () => {
    try {
      const response = await agentService.getPresets()
      setPresetFavorites(response.favorites)
    }
    catch (error) {
      console.error('[AraelPanel] 加载预设失败:', error)
    }
  }, [])

  useEffect(() => {
    if (visibility === 'visible') {
      loadPresets()
    }
  }, [visibility, loadPresets])

  // 语音服务状态
  useEffect(() => {
    if (visibility === 'visible') {
      getSpeechStatus()
        .then(status => setSpeechAvailable(status.available && status.asr_enabled))
        .catch(() => setSpeechAvailable(false))
    }
  }, [visibility])

  const smartGreeting = useMemo(() =>
    getSmartGreeting(location.pathname, 0, t.arael), [visibility, location.pathname, t.arael])

  const loadContinueSessions = useCallback(async () => {
    try {
      const sessions = await agentService.listSessions(1, 10)
      const mapped = sessions
        .filter((s: SessionInfo) => !s.archived)
        .filter((s: SessionInfo) => s.messageCount > 0)
        .slice(0, 2)
        .map((s: SessionInfo) => ({
          id: s.id,
          title: s.title,
          messageCount: s.messageCount,
          lastActiveAt: s.lastActiveAt,
          createdAt: s.createdAt,
        }))
      setContinueSessions(mapped)
    }
    catch (error) {
      console.error('[AraelPanel] 加载继续会话失败:', error)
      setContinueSessions([])
    }
  }, [])

  useEffect(() => {
    if (visibility === 'visible' && panelView === 'chat' && messages.length === 0 && !isLoading) {
      loadContinueSessions()
    }
  }, [visibility, panelView, messages.length, isLoading, loadContinueSessions])

  const togglePresetFavorite = useCallback(async (presetId: number) => {
    try {
      await agentService.toggleFavorite(presetId)
      loadPresets()
    }
    catch (error) {
      console.error('[AraelPanel] 切换收藏状态失败:', error)
    }
  }, [loadPresets])

  const usePreset = useCallback(async (preset: TaskPreset) => {
    setInput(preset.input)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // ============ 消息管理 ============

  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, ...updates } : m,
    ))
  }, [])

  const updateMessageExecution = useCallback((messageId: string, updates: Partial<TaskExecution>) => {
    setMessages(prev => prev.map((m) => {
      if (m.id !== messageId || !m.taskExecution)
        return m
      // progress 仅递增，避免回退
      const newProgress = updates.progress != null
        ? Math.max(updates.progress, m.taskExecution.progress)
        : m.taskExecution.progress
      return {
        ...m,
        taskExecution: { ...m.taskExecution, ...updates, progress: newProgress },
      }
    }))
  }, [])

  const addExecutionStep = useCallback((messageId: string, step: ExecutionStep) => {
    setMessages(prev => prev.map((m) => {
      if (m.id !== messageId || !m.taskExecution)
        return m
      const exists = m.taskExecution.steps.some(s => s.id === step.id)
      if (exists) {
        return {
          ...m,
          taskExecution: {
            ...m.taskExecution,
            steps: m.taskExecution.steps.map(s => s.id === step.id ? { ...s, ...step } : s),
          },
        }
      }
      return {
        ...m,
        taskExecution: {
          ...m.taskExecution,
          steps: [...m.taskExecution.steps, step],
        },
      }
    }))
  }, [])

  const updateExecutionStep = useCallback((messageId: string, stepId: string, updates: Partial<ExecutionStep>) => {
    setMessages(prev => prev.map((m) => {
      if (m.id !== messageId || !m.taskExecution)
        return m
      return {
        ...m,
        taskExecution: {
          ...m.taskExecution,
          steps: m.taskExecution.steps.map(s =>
            s.id === stepId ? { ...s, ...updates } : s,
          ),
        },
      }
    }))
  }, [])

  // ============ 会话管理 ============

  const startNewSession = useCallback(async () => {
    // Cancel any running tasks first
    const processingMsgs = messages.filter(m => m.taskExecution?.status === 'processing')
    for (const msg of processingMsgs) {
      const taskId = msg.taskExecution?.taskId
      if (taskId) {
        try { await agentService.cancelTask(taskId) }
        catch { /* ignore */ }
      }
    }

    setIsLoading(false)
    setSessionId(null)
    setMessages([])
    setExpandedMessageId(null)
    setPanelView('chat')
    sessionTitleSetRef.current = false
    setSessionTitle(null)
  }, [messages])

  const loadSession = useCallback(async (session: ChatSession) => {
    setPanelView('chat')
    setSessionId(session.id)
    setSessionTitle(session.title || null)
    sessionTitleSetRef.current = !!session.title

    try {
      const sessionMessages = await agentService.getSessionMessages(session.id, 1, 50)
      const loaded: ChatMessage[] = sessionMessages.map((m, idx) => {
        const meta = m.metadata as Record<string, unknown> | undefined
        const data = meta?.data as Record<string, unknown> | undefined
        // 从 data / steps 中提取图片 URL
        const imageUrls: string[] = []
        if (data && typeof data.imageUrl === 'string') {
          imageUrls.push(data.imageUrl)
        }
        // 多步骤可能产生多张图片
        const stepHistory = (meta?.task as Record<string, unknown> | undefined)?.stepHistory as Array<Record<string, unknown>> | undefined
        if (stepHistory) {
          for (const s of stepHistory) {
            if (typeof s.imageUrl === 'string' && !imageUrls.includes(s.imageUrl)) {
              imageUrls.push(s.imageUrl)
            }
          }
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
        }
      })
      setMessages(loaded)
    }
    catch (error) {
      console.error('[AraelPanel] 加载会话消息失败:', error)
    }
  }, [])

  // ============ 中断 ============

  const interruptCurrentTask = useCallback(async () => {
    const processingMsgs = messages.filter(m => m.taskExecution?.status === 'processing')
    for (const msg of processingMsgs) {
      const taskId = msg.taskExecution?.taskId
      if (taskId) {
        try { await agentService.cancelTask(taskId) }
        catch { /* ignore */ }
      }
      updateMessage(msg.id, {
        taskExecution: msg.taskExecution ? { ...msg.taskExecution, status: 'error' } : undefined,
        content: msg.content || t.arael.interrupted,
      })
    }
    setIsLoading(false)
  }, [messages, updateMessage])

  // ============ 语音录制 ============

  const startRecording = useCallback(async () => {
    try {
      const status = await getSpeechStatus()
      if (!status.available || !status.asr_enabled) {
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })

      const audioContext = new AudioContext({ sampleRate: 16000 })
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const pcmData: Float32Array[] = []

      processor.onaudioprocess = (e) => {
        pcmData.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      audioChunksRef.current = [];
      (mediaRecorderRef.current as unknown as {
        audioContext: AudioContext
        stream: MediaStream
        processor: ScriptProcessorNode
        pcmData: Float32Array[]
      }) = { audioContext, stream, processor, pcmData }

      setIsRecording(true)
    }
    catch (err) {
      console.error('[AraelPanel] 无法访问麦克风:', err)
    }
  }, [])

  const pcmToWav = useCallback((pcmData: Float32Array[], sampleRate: number): Blob => {
    const totalLength = pcmData.reduce((acc, arr) => acc + arr.length, 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const arr of pcmData) {
      merged.set(arr, offset)
      offset += arr.length
    }

    const buffer = new ArrayBuffer(44 + merged.length * 2)
    const view = new DataView(buffer)

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + merged.length * 2, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, merged.length * 2, true)

    let dataOffset = 44
    for (let i = 0; i < merged.length; i++) {
      const sample = Math.max(-1, Math.min(1, merged[i]))
      view.setInt16(dataOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      dataOffset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current as unknown as {
      audioContext: AudioContext
      stream: MediaStream
      processor: ScriptProcessorNode
      pcmData: Float32Array[]
    } | null

    if (!recorder || !isRecording)
      return

    setIsRecording(false)

    recorder.processor.disconnect()
    recorder.stream.getTracks().forEach(track => track.stop())
    await recorder.audioContext.close()

    if (recorder.pcmData.length === 0) {
      return
    }

    setIsProcessingVoice(true)

    try {
      const wavBlob = pcmToWav(recorder.pcmData, 16000)
      const base64Audio = await audioToBase64(wavBlob)
      const result = await speechToText({
        audio_data: base64Audio,
        format: 'wav',
        engine: '16k_zh',
      })

      if (result.success && result.text) {
        setInput(result.text)
        setTimeout(() => handleSendRef.current?.(result.text), 100)
      }
    }
    catch (err) {
      console.error('[AraelPanel] 语音识别出错:', err)
    }
    finally {
      setIsProcessingVoice(false)
      mediaRecorderRef.current = null
    }
  }, [isRecording, pcmToWav])

  const toggleRecording = useCallback(() => {
    if (isRecording) { stopRecording() }
    else { startRecording() }
  }, [isRecording, startRecording, stopRecording])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current as unknown as {
        audioContext?: AudioContext
        stream?: MediaStream
        processor?: ScriptProcessorNode
      } | null
      if (recorder && isRecording) {
        recorder.processor?.disconnect()
        recorder.stream?.getTracks().forEach(track => track.stop())
        recorder.audioContext?.close()
      }
    }
  }, [isRecording])

  // ============ 长按检测 ============

  const startLongPress = useCallback((e: MouseEvent | TouchEvent) => {
    if (visibility !== 'hidden')
      return
    const point = 'touches' in e ? e.touches[0] : e
    longPressStartRef.current = { x: point.clientX, y: point.clientY }
    isLongPressingRef.current = true
    setLongPressIndicator({ x: point.clientX, y: point.clientY, active: true })

    longPressTimerRef.current = setTimeout(async () => {
      if (isLongPressingRef.current) {
        setLongPressIndicator(prev => ({ ...prev, active: false }))
        setVisibility('visible')
        if (navigator.vibrate)
          navigator.vibrate(50)
      }
    }, LONG_PRESS_DURATION)
  }, [visibility])

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    isLongPressingRef.current = false
    longPressStartRef.current = null
    setLongPressIndicator(prev => ({ ...prev, active: false }))
  }, [])

  const checkMovement = useCallback((e: MouseEvent | TouchEvent) => {
    if (!longPressStartRef.current || !isLongPressingRef.current)
      return
    const point = 'touches' in e ? e.touches[0] : e
    const dx = Math.abs(point.clientX - longPressStartRef.current.x)
    const dy = Math.abs(point.clientY - longPressStartRef.current.y)
    if (dx > 10 || dy > 10)
      cancelLongPress()
  }, [cancelLongPress])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.arael-panel') || target.closest('input') || target.closest('textarea') || target.closest('button') || target.closest('a') || target.closest('[contenteditable]') || target.closest('.tapp-window'))
        return
      startLongPress(e)
    }

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.arael-panel') || target.closest('input') || target.closest('textarea') || target.closest('button') || target.closest('a') || target.closest('[contenteditable]') || target.closest('.tapp-window'))
        return
      startLongPress(e)
    }

    const handleMouseUp = () => cancelLongPress()
    const handleTouchEnd = () => cancelLongPress()
    const handleMouseMove = (e: MouseEvent) => checkMovement(e)
    const handleTouchMove = (e: TouchEvent) => checkMovement(e)

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('touchmove', handleTouchMove, { passive: true })

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('touchmove', handleTouchMove)
      cancelLongPress()
    }
  }, [startLongPress, cancelLongPress, checkMovement])

  // ============ 面板控制 ============

  const closePanel = useCallback(() => {
    setVisibility('hidden')
    setInput('')
    setExpandedMessageId(null)
    setPanelView('chat')
  }, [])

  useEffect(() => {
    if (visibility === 'hidden')
      return
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (hasActiveExecution)
          return
        closePanel()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 100)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClickOutside) }
  }, [visibility, hasActiveExecution, closePanel])

  useEffect(() => {
    if (visibility === 'hidden')
      return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        closePanel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visibility, closePanel])

  useEffect(() => {
    if (visibility === 'visible' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [visibility])

  // ============ SSE 进度处理 ============

  const createProgressHandler = useCallback((assistantMessageId: string) => {
    let streamedSummary = ''
    return (event: ProgressEvent) => {
      switch (event.type) {
        case 'session_created': {
          setSessionId(event.sessionId)
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
          execUpdates.statusMessage = tcEvent.message
          updateMessageExecution(assistantMessageId, execUpdates)
          break
        }

        case 'task_assigned': {
          const assignEvent = event as import('../../services/agent/types').TaskAssignedEvent
          updateMessageExecution(assistantMessageId, {
            assignment: assignEvent.assignment,
          })
          break
        }

        case 'step_started': {
          const stepEvent = event as StepStartedEvent
          addExecutionStep(assistantMessageId, {
            id: stepEvent.stepId,
            name: stepEvent.description,
            status: 'running',
            capabilityCategory: stepEvent.capabilityCategory,
            retryAttempt: stepEvent.retryAttempt,
          })
          updateMessageExecution(assistantMessageId, { queuePosition: 0 })
          // 不更新 message.content，避免与步骤列表重复显示
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
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId
                ? { ...m, imageUrls: [...(m.imageUrls || []).filter(u => u !== stepEvent.imageUrl), stepEvent.imageUrl!] }
                : m,
            ))
          }
          if (stepEvent.outputSummary) {
            updateMessageExecution(assistantMessageId, { statusMessage: stepEvent.outputSummary })
          }
          break
        }

        case 'progress': {
          const progressEvent = event as ProgressUpdateEvent
          const progressUpdates: Partial<TaskExecution> = {
            progress: progressEvent.progress,
          }
          if (progressEvent.message) {
            progressUpdates.statusMessage = progressEvent.message
          }
          updateMessageExecution(assistantMessageId, progressUpdates)
          break
        }

        case 'waiting_for_input':
          updateMessageExecution(assistantMessageId, { status: 'waiting' })
          updateMessage(assistantMessageId, { content: '需要更多信息...' })
          break

        case 'error':
          updateMessageExecution(assistantMessageId, { status: 'error' })
          updateMessage(assistantMessageId, { content: event.message })
          break

        case 'summary_token': {
          const tokenEvent = event as SummaryTokenEvent
          if (!tokenEvent.done) {
            streamedSummary += tokenEvent.token
            updateMessage(assistantMessageId, { content: streamedSummary })
            updateMessageExecution(assistantMessageId, { statusMessage: '正在生成回复...' })
          }
          break
        }

        case 'task_completed':
          break
      }
    }
  }, [updateMessage, updateMessageExecution, addExecutionStep, updateExecutionStep])

  // ============ 发送消息 ============

  const handleSend = useCallback(async (text?: string) => {
    const messageText = text || input.trim()
    if (!messageText || isLoading)
      return

    // 切回对话视图
    setPanelView('chat')

    // 1. 创建 user 消息
    const userMsgId = `msg_user_${Date.now()}`
    const userMessage: ChatMessage = {
      id: userMsgId,
      sessionId: sessionId || '',
      role: 'user',
      content: messageText,
      createdAt: new Date(),
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

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsLoading(true)

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
      if (pageContentContext?.hasContent) {
        const contentForAgent = pageContentContext.getContentForAgent()
        if (contentForAgent) {
          customData.pageContent = contentForAgent
        }
      }
      if (Object.keys(customData).length > 0) {
        context.customData = customData
      }

      const response = await agentService.processWithProgress(
        messageText,
        createProgressHandler(assistantMsgId),
        context,
      )

      if (handleAgentResponseRef.current) {
        handleAgentResponseRef.current(assistantMsgId, response)
      }
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'

      updateMessage(assistantMsgId, {
        content: `出错了：${errorMsg}`,
        taskExecution: {
          taskId: '',
          status: 'error',
          progress: 0,
          steps: [],
        },
      })
    }
    finally {
      setIsLoading(false)
    }
  }, [input, isLoading, sessionId, location.pathname, pageContentContext, createProgressHandler, updateMessage])

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  // ============ 处理 Agent 响应 ============

  const handleAgentResponse = useCallback(async (messageId: string, response: AgentResponse) => {
    const taskData = response.task as Record<string, unknown> | undefined
    const pendingQuestion = taskData?.pendingQuestion as PendingQuestion | undefined

    if (pendingQuestion && pendingQuestion.options && pendingQuestion.options.length > 0) {
      updateMessage(messageId, {
        content: pendingQuestion.question,
        pendingQuestion,
      })
      updateMessageExecution(messageId, {
        status: 'waiting',
        taskId: taskData?.taskId as string || '',
        progress: 100,
      })
      return
    }

    const isSuccess = response.success !== false && (response.task?.status === 'completed' || response.responseType === 'answer' || response.responseType === 'task_completed')

    const responseData = response.data as Record<string, unknown> | undefined

    // 从 response.data 中提取 AI 生成的实际文本
    // 后端各能力的文本字段：reply(ai.chat), aiSummary(搜索), analysis(分析), summary(总结)
    const aiText = responseData
      ? (typeof responseData.reply === 'string' ? responseData.reply : undefined)
      ?? (typeof responseData.aiSummary === 'string' ? responseData.aiSummary : undefined)
      ?? (typeof responseData.analysis === 'string' ? responseData.analysis : undefined)
      ?? (typeof responseData.summary === 'string' ? responseData.summary : undefined)
      : undefined

    // 优先使用 data 中的 AI 文本，其次 response.message，再从 data.message 回退
    const dataMessage = typeof responseData?.message === 'string' ? responseData.message : undefined
    let displayMessage = aiText || response.message || dataMessage

    console.log('[Arael] handleAgentResponse:', {
      responseType: response.responseType,
      message: response.message,
      aiText,
      dataKeys: responseData ? Object.keys(responseData) : [],
      displayMessage,
    })

    const stepHistory = taskData?.stepHistory as Array<{
      stepId: string
      status: string
      outputSummary?: string
      capabilityName?: string
      durationMs?: number
      error?: string
    }> | undefined

    if (stepHistory && stepHistory.length > 0) {
      const failedSteps = stepHistory.filter(s => s.status === 'failed')
      const completedSteps = stepHistory.filter(s => s.status === 'completed')

      if (!aiText && (displayMessage === '任务已完成' || !displayMessage)) {
        if (failedSteps.length > 0 && completedSteps.length > 0) {
          displayMessage = format(t.arael.partialComplete, { completed: completedSteps.length, total: stepHistory.length })
          const failInfo = failedSteps
            .map(s => s.error || s.outputSummary || t.arael.executionFailed)
            .join('；')
          displayMessage += `\n${format(t.arael.failReason, { reason: failInfo })}`
        }
        else if (failedSteps.length === stepHistory.length) {
          displayMessage = t.arael.executionFailed
          const failInfo = failedSteps
            .map(s => s.error || s.outputSummary || t.arael.unknownError)
            .join('；')
          displayMessage += `\n${failInfo}`
        }
        else if (completedSteps.length === stepHistory.length) {
          if (responseData?.prompt && typeof responseData.prompt === 'string') {
            displayMessage = `已生成图片提示词:\n${responseData.prompt as string}`
          }
          else if (responseData?.title && typeof responseData.title === 'string') {
            displayMessage = `${responseData.title as string} - 已完成`
          }
        }
      }
    }

    updateMessage(messageId, {
      content: displayMessage || response.message || '任务已完成',
      suggestions: response.suggestions?.length ? response.suggestions : undefined,
      data: response.data,
    })

    const hasFailedSteps = stepHistory?.some(s => s.status === 'failed') ?? false

    // 从 TaskInfo 中解析 executionTrace
    const rawTrace = taskData?.executionTrace as {
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
    } | undefined

    const executionTrace: ExecutionTrace | undefined = rawTrace
      ? {
          totalDurationMs: rawTrace.totalDurationMs ?? rawTrace.total_duration_ms ?? 0,
          tierUsage: rawTrace.tierUsage ?? rawTrace.tier_usage ?? {},
          steps: (rawTrace.steps ?? []).map(s => ({
            stepId: s.stepId ?? s.step_id ?? '',
            capabilityId: s.capabilityId ?? s.capability_id ?? '',
            tierUsed: s.tierUsed ?? s.tier_used ?? '',
            durationMs: s.durationMs ?? s.duration_ms ?? 0,
            success: s.success ?? true,
            error: s.error,
          })),
        }
      : undefined

    updateMessageExecution(messageId, {
      status: isSuccess && !hasFailedSteps ? 'completed' : (hasFailedSteps ? 'error' : (response.task?.status === 'failed' ? 'error' : 'completed')),
      progress: 100,
      ...(executionTrace ? { executionTrace } : {}),
    })

    // Auto-update session title from first user message
    if (sessionId && !sessionTitleSetRef.current) {
      sessionTitleSetRef.current = true
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        const title = firstUserMsg.content.length > 50
          ? `${firstUserMsg.content.slice(0, 47)}...`
          : firstUserMsg.content
        setSessionTitle(title)
        agentService.updateSessionTitle(sessionId, title).catch(() => {})
      }
    }

    // 执行前端动作
    const frontendActions = responseData?.frontendActions as typeof response.frontendAction[] | undefined
    let frontendAction = response.frontendAction
      || responseData?.frontendAction as typeof response.frontendAction
      || responseData?.action as typeof response.frontendAction

    if (frontendAction && typeof frontendAction === 'object' && 'type' in frontendAction) {
      const actionObj = frontendAction as unknown as Record<string, unknown>
      if (!('timestamp' in actionObj)) {
        frontendAction = { ...actionObj, timestamp: Date.now() } as typeof response.frontendAction
      }
      if (responseData?.criteria && !('criteria' in actionObj)) {
        frontendAction = { ...(frontendAction as unknown as Record<string, unknown>), criteria: responseData.criteria as string } as typeof response.frontendAction
      }
    }

    if (frontendActions && Array.isArray(frontendActions) && frontendActions.length > 0) {
      for (const action of frontendActions) {
        if (!action)
          continue
        try {
          await executeFrontendAction(action)
        }
        catch (error) {
          console.error('[Arael] Frontend action failed:', error)
        }
      }
    }
    else if (frontendAction) {
      try {
        await executeFrontendAction(frontendAction)
      }
      catch (error) {
        console.error('[Arael] Frontend action failed:', error)
      }
    }
  }, [updateMessage, updateMessageExecution])

  useEffect(() => {
    handleAgentResponseRef.current = handleAgentResponse
  }, [handleAgentResponse])

  // ============ 回答问题 ============

  const answerQuestion = useCallback(async (messageId: string, answer: string) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg?.taskExecution?.taskId || !msg.pendingQuestion)
      return

    updateMessage(messageId, {
      content: `正在处理选择: ${answer}...`,
      pendingQuestion: undefined,
    })
    updateMessageExecution(messageId, {
      status: 'processing',
      progress: 50,
    })

    try {
      const response = await agentService.answerQuestion(
        msg.taskExecution.taskId,
        msg.pendingQuestion.questionId,
        answer,
      )
      handleAgentResponseRef.current?.(messageId, response)
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : t.arael.unknownError
      updateMessage(messageId, { content: format(t.arael.answerFailed, { error: errorMsg }) })
      updateMessageExecution(messageId, { status: 'error' })
    }
  }, [messages, updateMessage, updateMessageExecution])

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ============ 渲染 ============

  const showFavorites = visibility === 'visible' && presetFavorites.length > 0 && !hasActiveExecution && !isLoading
  const hasContent = panelView !== 'chat' || messages.length > 0 || (visibility === 'visible' && !isLoading)

  return (
    <div className="arael-panel-container">
      <AnimatePresence>
        {visibility === 'visible' && (
          <motion.div
            ref={panelRef}
            className={`arael-panel${hasActiveExecution ? ' arael-panel-processing' : ''}`}
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={SPRING_SNAPPY}
          >
            {/* 顶部区域 */}
            <div
              className="arael-tasks-wrapper"
              data-expanded={hasContent ? 'true' : 'false'}
            >
              <div className="arael-tasks-inner">
                {/* 标题栏 */}
                <div className="arael-tasks-header">
                  <span className="arael-tasks-title">
                    {hasActiveExecution
                      ? <span className="arael-tasks-title-rest">{sessionTitle || t.arael.processing}</span>
                      : <span className="arael-tasks-title-rest">{sessionTitle || (smartGreeting.startsWith('Arael') ? smartGreeting.slice(6) : smartGreeting)}</span>}
                  </span>
                  <div className="arael-tasks-actions">
                    {/* 新对话 */}
                    <button
                      className="arael-header-btn"
                      onClick={startNewSession}
                      title="新对话"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    {/* 会话列表 */}
                    <button
                      className={`arael-header-btn${panelView === 'sessions' ? ' active' : ''}`}
                      onClick={() => setPanelView(panelView === 'sessions' ? 'chat' : 'sessions')}
                      title="历史对话"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </button>
                    {/* 管理 */}
                    <button
                      className={`arael-header-btn${panelView === 'manage' ? ' active' : ''}`}
                      onClick={() => setPanelView(panelView === 'manage' ? 'chat' : 'manage')}
                      title="管理"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                    {/* Debug */}
                    <button
                      className="arael-debug-badge"
                      onClick={() => {
                        const info = buildDebugInfo({
                          sessionId,
                          sessionTitle,
                          sessionTitleSetRef: sessionTitleSetRef.current,
                          panelView,
                          visibility,
                          isLoading,
                          hasActiveExecution,
                          input,
                          expandedMessageId,
                          messages,
                          presetFavorites: presetFavorites.length,
                          continueSessions: continueSessions.length,
                          speechAvailable,
                          isRecording,
                          isProcessingVoice,
                        })
                        navigator.clipboard.writeText(info)
                      }}
                    >
                      {sessionId ? sessionId.slice(0, 4) : '--'}
                      {' | '}
                      {messages.length}
                      msg
                      {isLoading ? ' | ...' : ''}
                    </button>
                  </div>
                </div>

                {/* 面板视图切换 */}
                {panelView === 'sessions' && (
                  <AraelSessionList
                    activeSessionId={sessionId}
                    onSelectSession={loadSession}
                    onNewSession={startNewSession}
                  />
                )}

                {panelView === 'manage' && (
                  <AraelManageDrawer />
                )}

                {panelView === 'chat' && (
                  <div className="arael-msg-list">
                    {messages.length === 0 && !isLoading && (
                      <div className="arael-empty-state">
                        {/* Hero */}
                        <div className="arael-empty-hero">
                          <span className="arael-empty-hero-name qwitcher-grypen">Arael</span>
                          <span className="arael-empty-hero-sub">{t.arael.heroSub}</span>
                        </div>

                        {/* Recent sessions */}
                        <div className="arael-empty-recent">
                          {continueSessions.length > 0 && (
                            <div className="arael-empty-recent-label">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                              <span>{t.arael.recentConversations}</span>
                            </div>
                          )}
                          <div className="arael-empty-continue-list">
                            {continueSessions.length > 0
                              ? continueSessions.map(session => (
                                  <button
                                    key={session.id}
                                    className="arael-empty-continue-btn"
                                    onClick={() => loadSession(session)}
                                  >
                                    <span className="arael-empty-continue-title">{session.title || t.arael.unnamedConversation}</span>
                                  </button>
                                ))
                              : <span className="arael-empty-hint">{t.arael.noRecentConversations}</span>}
                          </div>
                        </div>
                      </div>
                    )}
                    {messages.map((msg, idx) => (
                      <AraelChatMessage
                        key={msg.id}
                        message={msg}
                        isExpanded={expandedMessageId === msg.id}
                        onToggleExpand={() => setExpandedMessageId(
                          expandedMessageId === msg.id ? null : msg.id,
                        )}
                        onRetry={() => {
                          // 找到此 assistant 消息之前最近的 user 消息
                          const userMsg = messages.slice(0, idx).reverse().find(m => m.role === 'user')
                          if (userMsg) {
                            handleSendRef.current?.(userMsg.content)
                          }
                        }}
                        onAnswerQuestion={answerQuestion}
                      />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 底部输入框 - 仅在聊天视图显示 */}
            {panelView === 'chat' && (
              <AraelInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSend()}
                onKeyDown={handleKeyDown}
                isLoading={isLoading}
                isRecording={isRecording}
                isProcessingVoice={isProcessingVoice}
                onToggleRecording={speechAvailable ? toggleRecording : undefined}
                onInterrupt={hasActiveExecution ? interruptCurrentTask : undefined}
                inputRef={inputRef}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 收藏胶囊 */}
      <AraelPresets
        favorites={presetFavorites}
        isVisible={showFavorites}
        onUsePreset={usePreset}
        onToggleFavorite={togglePresetFavorite}
      />

      {/* 长按提示动效 */}
      <div
        className={`arael-longpress-indicator${longPressIndicator.active ? ' active' : ''}`}
        style={{ left: longPressIndicator.x, top: longPressIndicator.y }}
      >
        <div className="arael-lp-dot" />
        <div className="arael-lp-pulse" />
        <svg className="arael-lp-svg" viewBox="0 0 40 40">
          <circle className="arael-lp-track" cx="20" cy="20" r="16" />
          <circle className="arael-lp-ring" cx="20" cy="20" r="16" />
        </svg>
      </div>
    </div>
  )
}

export default AraelPanel
