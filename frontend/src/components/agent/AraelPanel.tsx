/**
 * Arael - AI 助手浮动面板
 *
 * 功能：
 * - 全局任意区域长按 500ms 触发
 * - 显示在屏幕顶部中央
 * - 控制岛风格布局：顶部任务列表 + 底部输入区
 * - Framer Motion 动画（学习 ControlIsland）
 * - SSE 流式进度更新
 * - 无背景遮罩模糊
 */

import type {
  AgentResponse,
  ConversationMessage,
  ProgressEvent,
  StepCompletedEvent,
  StepStartedEvent,
  TaskPreset,
} from '../../services/agent'

import type { ExecutionStep, LogEntry, PanelVisibility, PendingQuestion, TaskItem } from './types'
import { AnimatePresenceShim as AnimatePresence, motionShim as motion } from '@lib/motionShim'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageContentOptional } from '../../contexts/PageContentContext'
import {
  agentService,
  executeFrontendAction,
} from '../../services/agent'
import { audioToBase64, getSpeechStatus, speechToText } from '../../services/speechApi'

import { AraelHistory } from './components/AraelHistory'
import { AraelInput } from './components/AraelInput'
import { AraelPresets } from './components/AraelPresets'
import { AraelTaskItem } from './components/AraelTaskItem'
import {
  LONG_PRESS_DURATION,
  SPRING_SNAPPY,
} from './types'
import './AraelPanel.css'

// 智能提示词生成
function getSmartGreeting(pathname: string, _historyCount: number): string {
  const hour = new Date().getHours()

  // 基于时间的问候
  const timeGreeting = hour < 6
    ? '夜深了'
    : hour < 12
      ? '早上好'
      : hour < 18
        ? '下午好'
        : '晚上好'

  // 基于页面的智能提示（实际路由）
  const pageHints: Record<string, string[]> = {
    '/library': ['想听什么音乐？', '探索新歌单', '整理收藏', '随机播放'],
    '/brew': ['来杯什么？', '查看订阅', '刷新内容', '探索发现'],
    '/reports': ['查看分析报告', '生成新报告', '数据洞察'],
    '/config': ['需要调整设置？', '个性化配置', '优化体验'],
    '/data-management': ['管理数据', '同步数据', '清理缓存'],
    '/tapp': ['发现新应用', '管理 Tapp', '运行应用'],
  }

  // 通用提示
  const generalHints = [
    '有什么可以帮你？',
    '今天想做什么？',
    '让我来帮你',
    '随时为你服务',
    '说出你的想法',
    '有什么需要吗？',
  ]

  // 检查当前页面是否有特定提示
  for (const [path, hints] of Object.entries(pageHints)) {
    if (pathname.startsWith(path)) {
      const hint = hints[Math.floor(Math.random() * hints.length)]
      return `Arael · ${timeGreeting}，${hint}`
    }
  }

  // 默认：通用提示
  const hint = generalHints[Math.floor(Math.random() * generalHints.length)]
  return `Arael · ${timeGreeting}，${hint}`
}

// ============ 组件 ============

export const AraelPanel: React.FC = () => {
  const location = useLocation()

  // 页面内容上下文 - 用于获取当前阅读的文章等内容
  const pageContentContext = usePageContentOptional()

  // 面板可见性
  const [visibility, setVisibility] = useState<PanelVisibility>('hidden')

  // 输入状态
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // 任务列表（支持多个并行任务）
  const [tasks, setTasks] = useState<TaskItem[]>([])

  // 日志
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)

  // 展开的任务
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  // 任务预设（收藏和历史）
  const [presetFavorites, setPresetFavorites] = useState<TaskPreset[]>([])
  const [presetHistory, setPresetHistory] = useState<TaskPreset[]>([])
  const [_showPresets, setShowPresets] = useState(false)

  // 当前活跃的对话 preset ID（用于继续对话模式）
  // 使用 ref 而不是 state，因为 handleAgentResponse 的闭包会捕获旧的 state 值
  const activeConversationPresetIdRef = useRef<number | null>(null)
  const activeConversationDataRef = useRef<ConversationMessage[]>([])

  // 语音录制状态
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // handleSend 的 ref，用于在 stopRecording 中调用（避免循环依赖）
  const handleSendRef = useRef<(text?: string) => Promise<void>>(null)
  // handleAgentResponse 的 ref，用于在 answerQuestion 中调用（避免循环依赖）
  const handleAgentResponseRef = useRef<(taskId: string, response: AgentResponse) => Promise<void>>(null)

  // 长按检测
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressStartRef = useRef<{ x: number, y: number } | null>(null)
  const isLongPressingRef = useRef(false)

  // DOM 引用
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // ============ 日志工具 ============

  const addLog = useCallback((type: LogEntry['type'], message: string, data?: unknown) => {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      timestamp: new Date(),
      type,
      message,
      data,
    }
    setLogs(prev => [...prev, entry])
  }, [])

  // 计算活跃任务（正在进行或等待的）
  const activeTasks = useMemo(() =>
    tasks.filter(t => t.status === 'processing' || t.status === 'waiting'), [tasks])

  // 计算完成的任务
  const completedTasks = useMemo(() =>
    tasks.filter(t => t.status === 'completed' || t.status === 'error'), [tasks])

  // 历史记录分页（每页3条）
  const [historyPage, setHistoryPage] = useState(0)
  const HISTORY_PAGE_SIZE = 3

  // 智能问候语 - 仅在面板打开时生成一次
  const smartGreeting = useMemo(() =>
    getSmartGreeting(location.pathname, presetHistory.length), [visibility, location.pathname], // visibility 变化时重新生成
  )

  // 自动滚动日志
  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, showLogs])

  // ============ 任务预设管理 ============

  // 加载预设列表
  const loadPresets = useCallback(async () => {
    try {
      const response = await agentService.getPresets()
      setPresetFavorites(response.favorites)
      // 历史列表只显示 history 类型，收藏的任务已经在收藏胶囊中显示
      const historyOnly = response.history
        .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
      setPresetHistory(historyOnly)
    }
    catch (error) {
      console.error('[AraelPanel] 加载预设失败:', error)
    }
  }, [])

  // 面板打开时加载预设
  useEffect(() => {
    if (visibility === 'visible') {
      loadPresets()
    }
  }, [visibility, loadPresets])

  // 切换收藏状态
  const togglePresetFavorite = useCallback(async (presetId: number) => {
    try {
      const updated = await agentService.toggleFavorite(presetId)
      // 刷新预设列表
      loadPresets()
      addLog('info', `${updated.presetType === 'favorite' ? '已添加到' : '已从'}收藏${updated.presetType === 'favorite' ? '' : '中移除'}`)
    }
    catch (error) {
      console.error('[AraelPanel] 切换收藏状态失败:', error)
      addLog('error', '切换收藏状态失败')
    }
  }, [loadPresets, addLog])

  // 删除预设
  const deletePreset = useCallback(async (presetId: number) => {
    try {
      await agentService.deletePreset(presetId)
      loadPresets()
      addLog('info', '已删除预设')
    }
    catch (error) {
      console.error('[AraelPanel] 删除预设失败:', error)
      addLog('error', '删除预设失败')
    }
  }, [loadPresets, addLog])

  // 使用预设 - 使用 ref 避免循环依赖
  const createProgressHandlerRef = useRef<(taskId: string) => (event: ProgressEvent) => void>(null)
  const handleAgentResponseRef2 = useRef<(taskId: string, response: AgentResponse) => Promise<void>>(null)
  const updateTaskRef = useRef<(taskId: string, updates: Partial<TaskItem>) => void>(null)

  const usePreset = useCallback(async (preset: TaskPreset) => {
    // 关闭预设面板
    setShowPresets(false)

    // 重新运行会开始新对话，清除活跃对话状态
    activeConversationPresetIdRef.current = null
    activeConversationDataRef.current = []

    // 检查预设是否有保存的 recipe（parsedSteps）
    if (preset.parsedSteps) {
      // 有保存的 recipe，直接执行（跳过意图分析）
      addLog('info', `直接执行预设任务: ${preset.input}`)

      // 创建新任务
      const taskId = `task_${Date.now()}`
      const newTask: TaskItem = {
        id: taskId,
        input: preset.input,
        status: 'processing',
        progress: 0,
        message: 'Arael 正在执行预设任务...',
        steps: [],
        createdAt: new Date(),
      }

      setTasks(prev => [newTask, ...prev])
      setIsLoading(true)
      setExpandedTaskId(taskId)

      try {
        // 调用 executePreset API（使用 ref 获取 progressHandler）
        const progressHandler = createProgressHandlerRef.current?.(taskId)
        const response = await agentService.executePreset(preset.id, progressHandler)

        addLog('debug', `预设执行完成: ${response.responseType}`, response)
        handleAgentResponseRef2.current?.(taskId, response)
      }
      catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误'
        addLog('error', `预设执行失败: ${errorMsg}`, error)

        updateTaskRef.current?.(taskId, {
          status: 'error',
          message: `执行失败：${errorMsg}`,
          result: {
            success: false,
            content: errorMsg,
          },
        })
      }
      finally {
        setIsLoading(false)
      }
    }
    else {
      // 没有保存的 recipe，填充输入让用户手动执行
      addLog('info', `预设无保存步骤，填充输入: ${preset.input}`)
      setInput(preset.input)
      // 聚焦输入框
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [addLog])

  // 继续对话（加载完整对话历史）
  const continueConversation = useCallback(async (preset: TaskPreset) => {
    if (!preset.conversationData || preset.conversationData.length === 0) {
      addLog('warning', '此预设没有对话历史，改为重新运行')
      usePreset(preset)
      return
    }

    addLog('info', `加载对话历史: ${preset.title || preset.input}`)

    // 保存当前对话的 preset ID 和历史数据（用于后续更新）
    activeConversationPresetIdRef.current = preset.id
    activeConversationDataRef.current = [...preset.conversationData]
    console.log('[AraelPanel] 继续对话模式已激活, presetId:', preset.id, 'conversationData:', preset.conversationData.length, '条消息')

    // 清空当前任务列表，加载历史对话
    const restoredTasks: TaskItem[] = []
    let currentTask: TaskItem | null = null

    for (const msg of preset.conversationData) {
      if (msg.role === 'user') {
        // 用户消息 -> 创建新任务
        currentTask = {
          id: `restored_${Date.now()}_${restoredTasks.length}`,
          input: msg.content,
          status: 'completed',
          progress: 100,
          message: '',
          steps: [],
          createdAt: new Date(msg.createdAt),
        }
        restoredTasks.push(currentTask)
      }
      else if (msg.role === 'assistant' && currentTask) {
        // 助手回复 -> 填充任务结果
        currentTask.message = msg.content
        currentTask.result = {
          success: true,
          content: msg.content,
        }
      }
    }

    // 恢复任务列表
    setTasks(restoredTasks.reverse())
    setExpandedTaskId(restoredTasks[0]?.id || null)

    addLog('success', `已加载 ${restoredTasks.length} 条对话记录，继续输入将延续此对话`)
  }, [addLog, usePreset])

  // 将任务添加到收藏
  const addTaskToFavorites = useCallback(async (taskInput: string) => {
    try {
      await agentService.addToFavorites(taskInput)
      loadPresets()
      addLog('success', '已添加到收藏')
    }
    catch (error) {
      console.error('[AraelPanel] 添加收藏失败:', error)
      addLog('error', '添加收藏失败')
    }
  }, [loadPresets, addLog])

  // ============ 任务管理 ============

  const updateTask = useCallback((taskId: string, updates: Partial<TaskItem>) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, ...updates } : t,
    ))
  }, [])

  const updateTaskStep = useCallback((taskId: string, stepId: string, updates: Partial<ExecutionStep>) => {
    setTasks(prev => prev.map((t) => {
      if (t.id !== taskId)
        return t
      return {
        ...t,
        steps: t.steps.map(s =>
          s.id === stepId ? { ...s, ...updates } : s,
        ),
      }
    }))
  }, [])

  const addTaskStep = useCallback((taskId: string, step: ExecutionStep) => {
    setTasks(prev => prev.map((t) => {
      if (t.id !== taskId)
        return t
      const exists = t.steps.some(s => s.id === step.id)
      if (exists) {
        return {
          ...t,
          steps: t.steps.map(s => s.id === step.id ? { ...s, ...step } : s),
        }
      }
      return { ...t, steps: [...t.steps, step] }
    }))
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }, [])

  // 回答问题（用户选择选项）
  const answerQuestion = useCallback(async (task: TaskItem, answer: string) => {
    if (!task.taskId || !task.pendingQuestion) {
      addLog('error', '无法回答问题：缺少任务信息')
      return
    }

    addLog('info', `用户选择: ${answer}`)

    // 更新任务状态为处理中
    updateTask(task.id, {
      status: 'processing',
      progress: 50,
      message: `正在处理选择: ${answer}...`,
      pendingQuestion: undefined, // 清除问题
    })

    try {
      // 调用后端回答问题的 API
      const response = await agentService.answerQuestion(task.taskId, task.pendingQuestion.questionId, answer)

      // 处理响应（使用 ref 避免循环依赖）
      handleAgentResponseRef.current?.(task.id, response)
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      addLog('error', `回答问题失败: ${errorMsg}`)
      updateTask(task.id, {
        status: 'error',
        message: `回答失败：${errorMsg}`,
      })
    }
  }, [addLog, updateTask])

  // ============ 语音录制 ============

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      // 检查语音服务状态
      const status = await getSpeechStatus()
      if (!status.available || !status.asr_enabled) {
        addLog('error', '语音识别服务不可用，请检查配置')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // 使用 AudioContext 录制 PCM 数据，然后转换为 WAV
      const audioContext = new AudioContext({ sampleRate: 16000 })
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      const pcmData: Float32Array[] = []

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        pcmData.push(new Float32Array(inputData))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      // 保存引用以便停止时使用
      audioChunksRef.current = [];
      (mediaRecorderRef.current as unknown as {
        audioContext: AudioContext
        stream: MediaStream
        processor: ScriptProcessorNode
        pcmData: Float32Array[]
      }) = {
        audioContext,
        stream,
        processor,
        pcmData,
      }

      setIsRecording(true)
      addLog('info', '开始录音...')
    }
    catch (err) {
      addLog('error', `无法访问麦克风: ${err instanceof Error ? err.message : '未知错误'}`)
    }
  }, [addLog])

  // 将 PCM 数据转换为 WAV 格式
  const pcmToWav = useCallback((pcmData: Float32Array[], sampleRate: number): Blob => {
    // 合并所有 PCM 数据
    const totalLength = pcmData.reduce((acc, arr) => acc + arr.length, 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const arr of pcmData) {
      merged.set(arr, offset)
      offset += arr.length
    }

    // 转换为 16-bit PCM
    const buffer = new ArrayBuffer(44 + merged.length * 2)
    const view = new DataView(buffer)

    // WAV 头部
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + merged.length * 2, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // PCM format
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true) // byte rate
    view.setUint16(32, 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample
    writeString(36, 'data')
    view.setUint32(40, merged.length * 2, true)

    // 写入 PCM 数据
    let dataOffset = 44
    for (let i = 0; i < merged.length; i++) {
      const sample = Math.max(-1, Math.min(1, merged[i]))
      view.setInt16(dataOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      dataOffset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }, [])

  // 停止录音
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
    addLog('info', '录音结束，正在处理...')

    // 停止录制
    recorder.processor.disconnect()
    recorder.stream.getTracks().forEach(track => track.stop())
    await recorder.audioContext.close()

    if (recorder.pcmData.length === 0) {
      addLog('warning', '未录制到音频')
      return
    }

    setIsProcessingVoice(true)
    addLog('info', '正在识别语音...')

    try {
      // 转换为 WAV 格式
      const wavBlob = pcmToWav(recorder.pcmData, 16000)
      const base64Audio = await audioToBase64(wavBlob)

      const result = await speechToText({
        audio_data: base64Audio,
        format: 'wav',
        engine: '16k_zh',
      })

      if (result.success && result.text) {
        addLog('success', `语音识别成功: ${result.text}`)
        // 直接执行，不需要手动点发送
        setInput(result.text)
        // 使用 ref 调用 handleSend（避免循环依赖）
        setTimeout(() => {
          handleSendRef.current?.(result.text)
        }, 100)
      }
      else {
        addLog('error', `语音识别失败: ${result.error || '未知错误'}`)
      }
    }
    catch (err) {
      addLog('error', `语音识别出错: ${err instanceof Error ? err.message : '未知错误'}`)
    }
    finally {
      setIsProcessingVoice(false)
      mediaRecorderRef.current = null
    }
  }, [isRecording, addLog, pcmToWav])

  // 切换录音状态
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    }
    else {
      startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // 组件卸载时清理
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

  // ============ 长按检测逻辑 ============

  const startLongPress = useCallback((e: MouseEvent | TouchEvent) => {
    // 如果面板已显示，不触发
    if (visibility !== 'hidden')
      return

    // 获取起始位置
    const point = 'touches' in e ? e.touches[0] : e
    longPressStartRef.current = { x: point.clientX, y: point.clientY }
    isLongPressingRef.current = true

    // 开始计时
    longPressTimerRef.current = setTimeout(async () => {
      if (isLongPressingRef.current) {
        // 触发面板显示
        setVisibility('visible')

        // 震动反馈（如果支持）
        if (navigator.vibrate) {
          navigator.vibrate(50)
        }
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
  }, [])

  const checkMovement = useCallback((e: MouseEvent | TouchEvent) => {
    if (!longPressStartRef.current || !isLongPressingRef.current)
      return

    const point = 'touches' in e ? e.touches[0] : e
    const dx = Math.abs(point.clientX - longPressStartRef.current.x)
    const dy = Math.abs(point.clientY - longPressStartRef.current.y)

    // 如果移动超过 10px，取消长按
    if (dx > 10 || dy > 10) {
      cancelLongPress()
    }
  }, [cancelLongPress])

  // 全局长按监听
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // 排除一些不应触发的元素
      const target = e.target as HTMLElement
      if (
        target.closest('.arael-panel')
        || target.closest('input')
        || target.closest('textarea')
        || target.closest('button')
        || target.closest('a')
        || target.closest('[contenteditable]')
        || target.closest('.tapp-window') // 排除 Tapp 窗口
      ) {
        return
      }
      startLongPress(e)
    }

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('.arael-panel')
        || target.closest('input')
        || target.closest('textarea')
        || target.closest('button')
        || target.closest('a')
        || target.closest('[contenteditable]')
        || target.closest('.tapp-window')
      ) {
        return
      }
      startLongPress(e)
    }

    const handleMouseUp = () => cancelLongPress()
    const handleTouchEnd = () => cancelLongPress()
    const handleMouseMove = (e: MouseEvent) => checkMovement(e)
    const handleTouchMove = (e: TouchEvent) => checkMovement(e)

    // 添加全局监听
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
    setShowLogs(false)
    setExpandedTaskId(null)
    // 保留任务列表，清除已完成的
    setTasks(prev => prev.filter(t => t.status === 'processing' || t.status === 'waiting'))
  }, [])

  // 点击外部关闭
  useEffect(() => {
    if (visibility === 'hidden')
      return

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // 如果有活跃任务，不自动关闭
        if (activeTasks.length > 0) {
          return
        }
        closePanel()
      }
    }

    // 延迟添加监听，避免触发长按的点击事件立即关闭面板
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visibility, activeTasks, closePanel])

  // ESC 键关闭
  useEffect(() => {
    if (visibility === 'hidden')
      return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visibility, closePanel])

  // 自动聚焦输入框
  useEffect(() => {
    if (visibility === 'visible' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [visibility])

  // ============ Agent 交互 ============

  // 处理 SSE 进度事件
  const createProgressHandler = useCallback((taskId: string) => {
    return (event: ProgressEvent) => {
      addLog('debug', `SSE 事件: ${event.type}`, event)

      switch (event.type) {
        case 'task_created':
          updateTask(taskId, {
            progress: 5,
            message: event.message,
          })
          break

        case 'step_started': {
          const stepEvent = event as StepStartedEvent
          addTaskStep(taskId, {
            id: stepEvent.stepId,
            name: stepEvent.description,
            status: 'running',
          })
          updateTask(taskId, {
            message: `正在执行: ${stepEvent.description}`,
          })
          addLog('info', `步骤开始: ${stepEvent.description}`)
          break
        }

        case 'step_completed': {
          const stepEvent = event as StepCompletedEvent
          updateTaskStep(taskId, stepEvent.stepId, {
            status: stepEvent.success ? 'completed' : 'error',
            message: stepEvent.outputSummary,
          })
          if (stepEvent.success) {
            addLog('success', `步骤完成: ${stepEvent.outputSummary || stepEvent.stepId}`)
          }
          else {
            addLog('error', `步骤失败: ${stepEvent.stepId}`)
          }
          break
        }

        case 'progress':
          updateTask(taskId, {
            progress: event.progress,
            message: event.message,
          })
          break

        case 'waiting_for_input':
          addLog('info', '等待用户输入', event.question)
          updateTask(taskId, {
            status: 'waiting',
            message: '需要更多信息...',
          })
          break

        case 'error':
          addLog('error', `任务错误: ${event.message}`)
          updateTask(taskId, {
            status: 'error',
            message: event.message,
          })
          break

        case 'task_completed':
          addLog('success', '任务已完成')
          break
      }
    }
  }, [addLog, updateTask, addTaskStep, updateTaskStep])

  const handleSend = useCallback(async (text?: string) => {
    const messageText = text || input.trim()
    console.log('[Arael] handleSend called', { text, input, messageText, isLoading })

    if (!messageText) {
      console.log('[Arael] Empty message, returning')
      return
    }
    if (isLoading) {
      console.log('[Arael] Already loading, returning')
      return
    }

    console.log('[Arael] Starting task processing...')

    // 创建新任务
    const taskId = `task_${Date.now()}`
    const newTask: TaskItem = {
      id: taskId,
      input: messageText,
      status: 'processing',
      progress: 0,
      message: 'Arael 正在思考...',
      steps: [],
      createdAt: new Date(),
    }

    // 继续对话模式：追加到末尾保持对话顺序；新对话模式：放在顶部
    const isConversationMode = activeConversationPresetIdRef.current !== null
    if (isConversationMode) {
      setTasks(prev => [...prev, newTask])
    }
    else {
      setTasks(prev => [newTask, ...prev])
    }
    setInput('')
    setIsLoading(true)
    setExpandedTaskId(taskId)
    addLog('info', `用户输入: "${messageText}"${isConversationMode ? ' (继续对话)' : ''}`)

    try {
      console.log('[Arael] Calling agentService.processWithProgress...')

      // 构建上下文，包含页面内容
      const context: Record<string, unknown> = {
        currentRoute: location.pathname,
      }

      // 初始化 customData
      const customData: Record<string, unknown> = {}

      // 如果有页面内容（如正在阅读的文章），添加到 customData
      if (pageContentContext?.hasContent) {
        const contentForAgent = pageContentContext.getContentForAgent()
        if (contentForAgent) {
          customData.pageContent = contentForAgent
          addLog('info', `包含页面内容: ${contentForAgent.type} - ${contentForAgent.title}`)
        }
      }

      // 继续对话模式：传入对话历史（转换为字符串格式供AI理解）
      console.log('[AraelPanel] 检查对话模式:', {
        isConversationMode,
        presetIdRef: activeConversationPresetIdRef.current,
        dataLength: activeConversationDataRef.current.length,
      })
      if (isConversationMode && activeConversationDataRef.current.length > 0) {
        // 将对话历史转换为字符串格式
        const historyText = activeConversationDataRef.current
          .map((msg) => {
            const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'Arael' : '系统'
            return `${role}: ${msg.content}`
          })
          .join('\n')
        customData.conversation_history = historyText
        console.log('[AraelPanel] 传入对话历史:', `${historyText.slice(0, 200)}...`)
        addLog('info', `传入对话历史: ${activeConversationDataRef.current.length} 条消息`)
      }

      // 如果有 customData，添加到 context
      if (Object.keys(customData).length > 0) {
        context.customData = customData
      }

      // 使用 SSE 流式处理
      const response = await agentService.processWithProgress(
        messageText,
        createProgressHandler(taskId),
        context,
      )

      console.log('[Arael] Got response:', response)
      addLog('debug', `收到最终响应: ${response.responseType}`, response)

      // 使用 ref 调用，避免闭包问题
      if (handleAgentResponseRef.current) {
        handleAgentResponseRef.current(taskId, response)
      }
      else {
        console.error('[AraelPanel] handleAgentResponseRef.current is null!')
      }
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      addLog('error', `请求失败: ${errorMsg}`, error)

      updateTask(taskId, {
        status: 'error',
        message: `出错了：${errorMsg}`,
        result: {
          success: false,
          content: errorMsg,
        },
      })
    }
    finally {
      setIsLoading(false)
    }
  }, [input, isLoading, location.pathname, pageContentContext, createProgressHandler, addLog, updateTask])

  // 同步 handleSend 到 ref，供 stopRecording 调用（避免循环依赖）
  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  const handleAgentResponse = useCallback(async (taskId: string, response: AgentResponse) => {
    // 检查是否有待回答的问题
    const taskData = response.task as Record<string, unknown> | undefined
    const pendingQuestion = taskData?.pendingQuestion as PendingQuestion | undefined

    // 如果有待回答的问题，设置为 waiting 状态
    if (pendingQuestion && pendingQuestion.options && pendingQuestion.options.length > 0) {
      addLog('info', `需要用户选择: ${pendingQuestion.question}`)
      updateTask(taskId, {
        status: 'waiting',
        progress: 100,
        message: pendingQuestion.question,
        taskId: taskData?.taskId as string,
        pendingQuestion,
      })
      return
    }

    // 更新任务状态
    const isSuccess = response.task?.status === 'completed' || response.responseType === 'answer' || response.responseType === 'task_completed'

    updateTask(taskId, {
      status: isSuccess
        ? 'completed'
        : response.task?.status === 'failed' ? 'error' : 'completed',
      progress: 100,
      message: response.message,
      result: {
        success: isSuccess,
        content: response.message,
        suggestions: response.suggestions,
      },
    })

    // 任务成功完成时，保存到历史记录
    console.log('[AraelPanel] handleAgentResponse - isSuccess:', isSuccess, 'taskId:', taskId)
    if (isSuccess) {
      // 从任务列表中获取原始输入，从响应中提取 recipe
      setTasks((currentTasks) => {
        const task = currentTasks.find(t => t.id === taskId)
        console.log('[AraelPanel] 查找任务结果:', task ? '找到' : '未找到', 'taskId:', taskId)
        if (task) {
          // 提取 recipe 用于保存（跳过重新分析）
          const responseData = response.data as Record<string, unknown> | undefined
          const recipe = responseData?.recipe

          // 构建新的对话消息
          const now = new Date().toISOString()
          const newMessages: ConversationMessage[] = [
            {
              role: 'user',
              content: task.input,
              createdAt: now,
            },
            {
              role: 'assistant',
              content: response.message,
              metadata: {
                responseType: response.responseType,
                suggestions: response.suggestions,
              },
              createdAt: now,
            },
          ]

          // 检查是否是继续对话模式
          const currentPresetId = activeConversationPresetIdRef.current
          console.log('[AraelPanel] 保存历史, currentPresetId:', currentPresetId, 'ref值:', activeConversationPresetIdRef.current)
          if (currentPresetId) {
            console.log('[AraelPanel] 继续对话模式 - 更新 preset:', currentPresetId)
            // 继续对话：更新现有 preset
            const updatedConversation = [...activeConversationDataRef.current, ...newMessages]
            activeConversationDataRef.current = updatedConversation

            agentService.updatePresetConversation(
              currentPresetId,
              task.input.slice(0, 50), // 用最新输入更新标题
              updatedConversation,
            ).then(() => {
              loadPresets() // 刷新历史列表
            }).catch((e) => {
              console.error('[AraelPanel] 更新对话失败:', e)
            })
          }
          else {
            // 新对话：创建新的历史记录
            console.log('[AraelPanel] 新对话模式 - 创建新历史记录')
            agentService.saveToHistory(
              task.input,
              recipe,
              response.message.slice(0, 100),
              undefined, // title - 使用默认
              newMessages,
            ).then(() => {
              console.log('[AraelPanel] 保存历史记录成功')
              loadPresets() // 刷新历史列表
            }).catch((e) => {
              console.error('[AraelPanel] 保存历史记录失败:', e)
            })
          }
        }
        else {
          console.warn('[AraelPanel] 未找到任务，无法保存历史')
        }
        return currentTasks // 不修改状态
      })
    }

    // 执行前端动作 - 支持单个和多个动作
    const responseData = response.data as Record<string, unknown> | undefined
    const frontendActions = responseData?.frontendActions as typeof response.frontendAction[] | undefined
    // 支持多种字段名：frontendAction、action（后端返回的阅读列表等）
    let frontendAction = response.frontendAction
      || responseData?.frontendAction as typeof response.frontendAction
      || responseData?.action as typeof response.frontendAction

    // 如果 action 存在但缺少 timestamp，补充它
    if (frontendAction && typeof frontendAction === 'object' && 'type' in frontendAction) {
      const actionObj = frontendAction as unknown as Record<string, unknown>
      if (!('timestamp' in actionObj)) {
        frontendAction = { ...actionObj, timestamp: Date.now() } as typeof response.frontendAction
      }
      // 同时把顶层的 criteria 传递给 action（用于 reading_list）
      if (responseData?.criteria && !('criteria' in actionObj)) {
        frontendAction = { ...(frontendAction as unknown as Record<string, unknown>), criteria: responseData.criteria as string } as typeof response.frontendAction
      }
    }

    // 优先处理多个动作数组
    if (frontendActions && Array.isArray(frontendActions) && frontendActions.length > 0) {
      addLog('info', `检测到 ${frontendActions.length} 个前端动作`)
      for (const action of frontendActions) {
        if (!action)
          continue
        try {
          addLog('info', `执行前端动作: ${action.type}`, action)
          await executeFrontendAction(action)
          addLog('success', `前端动作 ${action.type} 执行完成`)
        }
        catch (error) {
          console.error('[Arael] Frontend action failed:', error)
          addLog('error', `前端动作 ${action.type} 执行失败: ${error}`)
        }
      }
    }
    else if (frontendAction) {
      // 兼容单个动作
      try {
        addLog('info', `执行前端动作: ${frontendAction.type}`, frontendAction)
        await executeFrontendAction(frontendAction)
        addLog('success', '前端动作执行完成')
      }
      catch (error) {
        console.error('[Arael] Frontend action failed:', error)
        addLog('error', `前端动作执行失败: ${error}`)
      }
    }
  }, [updateTask, addLog])

  // 同步 handleAgentResponse 到 ref，供 answerQuestion 调用（避免循环依赖）
  useEffect(() => {
    handleAgentResponseRef.current = handleAgentResponse
  }, [handleAgentResponse])

  // 同步 refs，供 usePreset 调用（避免循环依赖）
  useEffect(() => {
    createProgressHandlerRef.current = createProgressHandler
    handleAgentResponseRef2.current = handleAgentResponse
    updateTaskRef.current = updateTask
  }, [createProgressHandler, handleAgentResponse, updateTask])

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ============ 渲染 ============

  // 是否显示收藏胶囊
  const showFavorites = visibility === 'visible' && presetFavorites.length > 0 && activeTasks.length === 0 && !isLoading

  return (
    <div className="arael-panel-container">
      <AnimatePresence>
        {visibility === 'visible' && (
          <motion.div
            ref={panelRef}
            className={`arael-panel${activeTasks.length > 0 ? ' arael-panel-processing' : ''}`}
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            layout
            layoutRoot
          >
            {/* 顶部区域 - 统一的任务列表（包括当前任务和历史任务） */}
            <motion.div
              className="arael-tasks-wrapper"
              data-expanded={tasks.length > 0 || presetHistory.length > 0 ? 'true' : 'false'}
              layout
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <div className="arael-tasks-inner">
                {(tasks.length > 0 || presetHistory.length > 0) && (
                  <>
                    <div className="arael-tasks-header">
                      <span className="arael-tasks-title">
                        {activeTasks.length > 0
                          ? (
                              <>
                                <span className="arael-pulse-dot" />
                                Arael 正在处理
                                {' '}
                                {activeTasks.length}
                                {' '}
                                个任务
                              </>
                            )
                          : (
                              <>{smartGreeting}</>
                            )}
                      </span>
                      <div className="arael-tasks-actions">
                        {tasks.length > 0 && (
                          <button
                            className="arael-logs-btn"
                            onClick={() => setShowLogs(!showLogs)}
                          >
                            {showLogs ? '收起日志' : '查看日志'}
                          </button>
                        )}
                        {completedTasks.length > 0 && (
                          <button
                            className="arael-clear-btn"
                            onClick={() => setTasks(activeTasks)}
                          >
                            清除
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="arael-tasks-list">
                      {/* 当前任务 */}
                      {tasks.map(task => (
                        <AraelTaskItem
                          key={task.id}
                          task={task}
                          isExpanded={expandedTaskId === task.id}
                          onToggleExpand={() => setExpandedTaskId(
                            expandedTaskId === task.id ? null : task.id,
                          )}
                          onAnswerQuestion={answerQuestion}
                          onRemoveTask={removeTask}
                          onAddToFavorites={addTaskToFavorites}
                        />
                      ))}

                      {/* 历史任务 - 分页显示，滚轮翻页 */}
                      <AraelHistory
                        history={presetHistory}
                        currentPage={historyPage}
                        pageSize={HISTORY_PAGE_SIZE}
                        onPageChange={setHistoryPage}
                        onUsePreset={usePreset}
                        onContinueConversation={continueConversation}
                        onToggleFavorite={togglePresetFavorite}
                        onDeletePreset={deletePreset}
                      />
                    </div>

                    {/* 日志面板 */}
                    <div
                      className="arael-logs-wrapper"
                      data-expanded={showLogs && tasks.length > 0 ? 'true' : 'false'}
                    >
                      <div className="arael-logs-panel">
                        <div className="arael-logs-header">
                          <span>调试日志</span>
                          <button onClick={() => setLogs([])}>清空</button>
                        </div>
                        <div className="arael-logs-content">
                          {logs.length === 0
                            ? (
                                <div className="arael-logs-empty">暂无日志</div>
                              )
                            : (
                                logs.map(log => (
                                  <div key={log.id} className={`arael-log-entry arael-log-${log.type}`}>
                                    <span className="arael-log-time">
                                      {log.timestamp.toLocaleTimeString()}
                                    </span>
                                    <span className="arael-log-type">{log.type.toUpperCase()}</span>
                                    <span className="arael-log-message">{log.message}</span>
                                    {log.data !== undefined && (
                                      <details className="arael-log-data">
                                        <summary>数据</summary>
                                        <pre>{typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}</pre>
                                      </details>
                                    )}
                                  </div>
                                ))
                              )}
                          <div ref={logsEndRef} />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>

            {/* 底部区域 - 输入框 */}
            <AraelInput
              value={input}
              onChange={setInput}
              onSubmit={() => handleSend()}
              onKeyDown={handleKeyDown}
              isLoading={isLoading}
              isRecording={isRecording}
              isProcessingVoice={isProcessingVoice}
              onToggleRecording={toggleRecording}
              inputRef={inputRef}
            />
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
    </div>
  )
}

export default AraelPanel
