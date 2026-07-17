/**
 * Tapp Playground 页面
 * 用自然语言生成、预览并安装 Tapp；全程运行在无授权的临时沙箱中。
 * 布局与多窗口运行页一致：透明工作区 + 可自由拖拽/缩放的浮动窗格，
 * 输入与日志收纳在底部控制岛。
 */

import type {
  PlaygroundAgentStep,
  PlaygroundKnowledgeSource,
  PlaygroundValidationReport,
  TappPlaygroundProject,
} from '../services/TappPlaygroundService'
import type { TappCodeStructure, TappInstance } from '../types'
import {
  FaArrowLeft,
  FaArrowUp,
  FaCheck,
  FaCode,
  FaDownload,
  FaGripVertical,
  FaLock,
  FaRedo,
  FaUndo,
} from '@lib/icons'
import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import Prism from 'prismjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../contexts/I18nContext'
import { useNavigation } from '../../contexts/NavigationContext'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { useBreakpoints } from '../../hooks/useSharedEventListener'
import {
  PlaygroundTraceIcon,
  TappPlaygroundIcon,
} from '../components/PlaygroundIcons'
import { TappPageSandbox } from '../runtime/TappPageSandbox'
import { installFromCode } from '../services/TappApiService'
import { generatePlaygroundProject } from '../services/TappPlaygroundService'
import 'prismjs/components/prism-json'
import './TappPlaygroundPage.css'

const SESSION_KEY = 'myriad:tapp-playground:session:v1'

type FileId =
  | 'manifest'
  | 'html'
  | 'page'
  | 'core'
  | 'styles'
  | 'i18n'
  | 'widget'
  | 'widgetHtml'
  | 'modules'
  | 'assets'

interface Revision {
  project: TappPlaygroundProject
  explanation: string
  instruction: string
  warnings: string[]
  createdAt: number
  origin?: 'user' | 'runtime-repair'
  agentTrace?: PlaygroundAgentStep[]
  knowledgeSources?: PlaygroundKnowledgeSource[]
  validation?: PlaygroundValidationReport
}

interface StoredSession {
  revisions: Revision[]
  revisionIndex: number
}

function loadSession(): StoredSession {
  if (typeof window === 'undefined') return { revisions: [], revisionIndex: -1 }
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (
      value &&
      Array.isArray(value.revisions) &&
      Number.isInteger(value.revisionIndex)
    ) {
      return value
    }
  } catch {
    // A malformed or stale session should never block the editor.
  }
  return { revisions: [], revisionIndex: -1 }
}

function fileContents(project: TappPlaygroundProject, file: FileId): string {
  switch (file) {
    case 'manifest':
      return JSON.stringify(project.manifest, null, 2)
    case 'html':
      return project.code.pageHtml || ''
    case 'page':
      return project.code.page || ''
    case 'core':
      return project.code.core || ''
    case 'styles':
      return project.code.styles || ''
    case 'i18n':
      return JSON.stringify(project.code.i18n || {}, null, 2)
    case 'widget':
      return project.code.widget || ''
    case 'widgetHtml':
      return project.code.widgetHtml || ''
    case 'modules':
      return JSON.stringify(project.code.pageModules || {}, null, 2)
    case 'assets':
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(project.code.assets || {}).map(([path, value]) => [
            path,
            `[encoded asset: ${value.length} bytes]`,
          ]),
        ),
        null,
        2,
      )
  }
}

/* ============================================================
 * 浮动窗格 - 拖拽/缩放逻辑取自 TappWindowManager（简化版）
 * ============================================================ */

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const MIN_PANE_SIZE = { width: 320, height: 220 }

const RESIZE_HANDLES = [
  { direction: 'n', className: 'top-0 left-2 right-2 h-1 cursor-n-resize' },
  { direction: 's', className: 'bottom-0 left-2 right-2 h-1 cursor-s-resize' },
  { direction: 'e', className: 'right-0 top-2 bottom-2 w-1 cursor-e-resize' },
  { direction: 'w', className: 'left-0 top-2 bottom-2 w-1 cursor-w-resize' },
  { direction: 'ne', className: 'top-0 right-0 w-3 h-3 cursor-ne-resize' },
  { direction: 'nw', className: 'top-0 left-0 w-3 h-3 cursor-nw-resize' },
  { direction: 'se', className: 'bottom-0 right-0 w-3 h-3 cursor-se-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 w-3 h-3 cursor-sw-resize' },
] as const

interface FloatingPaneProps {
  defaultRect: Rect
  bounds: { width: number; height: number }
  isActive: boolean
  onFocus: () => void
  /** 标题栏内容（拖拽把手区域） */
  header: React.ReactNode
  children: React.ReactNode
  /** 移动端渲染为静态块，禁用拖拽/缩放 */
  interactive: boolean
  /** 静态模式下的高度 class */
  staticClassName?: string
}

function FloatingPane({
  defaultRect,
  bounds,
  isActive,
  onFocus,
  header,
  children,
  interactive,
  staticClassName,
}: FloatingPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect>(() => defaultRect)
  const [isDragging, setIsDragging] = useState(false)
  const [resizeDirection, setResizeDirection] = useState<string | null>(null)

  const dragStartRef = useRef({ x: 0, y: 0 })
  const rectStartRef = useRef<Rect>(rect)
  const currentRectRef = useRef<Rect>(rect)

  useEffect(() => {
    currentRectRef.current = rect
  }, [rect])

  const beginInteraction = useCallback(
    (e: React.MouseEvent | React.TouchEvent, direction: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      dragStartRef.current = { x: clientX, y: clientY }
      rectStartRef.current = { ...currentRectRef.current }
      if (direction) {
        setResizeDirection(direction)
      } else {
        setIsDragging(true)
      }
      onFocus()
    },
    [onFocus],
  )

  // 移动/缩放 - RAF 节流，直接操作 DOM，结束时一次性提交 state
  useEffect(() => {
    if (!isDragging && !resizeDirection) return

    let rafId: number | null = null
    let lastX = dragStartRef.current.x
    let lastY = dragStartRef.current.y

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX =
        'touches' in e ? (e.touches[0]?.clientX ?? lastX) : e.clientX
      const clientY =
        'touches' in e ? (e.touches[0]?.clientY ?? lastY) : e.clientY
      if (clientX === lastX && clientY === lastY) return
      lastX = clientX
      lastY = clientY

      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const node = paneRef.current
        if (!node) return
        const deltaX = clientX - dragStartRef.current.x
        const deltaY = clientY - dragStartRef.current.y
        const start = rectStartRef.current
        let { x, y, width, height } = start

        if (isDragging) {
          x = Math.max(0, Math.min(start.x + deltaX, bounds.width - width))
          y = Math.max(0, Math.min(start.y + deltaY, bounds.height - height))
        } else if (resizeDirection) {
          if (resizeDirection.includes('e')) {
            width = Math.max(MIN_PANE_SIZE.width, start.width + deltaX)
          }
          if (resizeDirection.includes('w')) {
            const widthDelta = Math.min(
              deltaX,
              start.width - MIN_PANE_SIZE.width,
            )
            width = start.width - widthDelta
            x = start.x + widthDelta
          }
          if (resizeDirection.includes('s')) {
            height = Math.max(MIN_PANE_SIZE.height, start.height + deltaY)
          }
          if (resizeDirection.includes('n')) {
            const heightDelta = Math.min(
              deltaY,
              start.height - MIN_PANE_SIZE.height,
            )
            height = start.height - heightDelta
            y = start.y + heightDelta
          }
          width = Math.min(width, bounds.width - x)
          height = Math.min(height, bounds.height - y)
        }

        node.style.transform = `translate3d(${x}px, ${y}px, 0)`
        node.style.width = `${width}px`
        node.style.height = `${height}px`
        currentRectRef.current = { x, y, width, height }
      })
    }

    const handleEnd = () => {
      if (rafId) cancelAnimationFrame(rafId)
      setRect(currentRectRef.current)
      setIsDragging(false)
      setResizeDirection(null)
    }

    document.addEventListener('mousemove', handleMove, { passive: true })
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchmove', handleMove, { passive: true })
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchcancel', handleEnd)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging, resizeDirection, bounds])

  const isInteracting = isDragging || !!resizeDirection

  if (!interactive) {
    return (
      <div
        className={`relative flex flex-col overflow-hidden rounded-xl w-full ${staticClassName || ''}`}
        style={{
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div
          className="flex items-center h-9 shrink-0 select-none backdrop-blur-sm"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {header}
        </div>
        <div
          className="flex-1 min-h-0 overflow-hidden relative"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={paneRef}
      className="absolute flex flex-col overflow-hidden rounded-xl"
      style={{
        top: 0,
        left: 0,
        width: rect.width,
        height: rect.height,
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        zIndex: isActive ? 30 : 20,
        transition: isInteracting ? 'none' : 'box-shadow 0.15s',
        boxShadow: isActive
          ? '0 8px 24px rgba(0, 0, 0, 0.2)'
          : '0 4px 12px rgba(0, 0, 0, 0.1)',
        border: '1px solid var(--border-color)',
      }}
      onMouseDown={onFocus}
      onTouchStart={onFocus}
    >
      {/* 标题栏 - 拖拽把手 */}
      <div
        className={`flex items-center h-9 shrink-0 select-none backdrop-blur-sm ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          borderBottom: '1px solid var(--border-color)',
          opacity: isActive ? 1 : 0.7,
          transition: 'opacity 0.2s ease',
        }}
        onMouseDown={(e) => beginInteraction(e, null)}
        onTouchStart={(e) => beginInteraction(e, null)}
      >
        {header}
      </div>

      {/* 内容 */}
      <div
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        {/* 交互时的透明遮罩，防止 iframe 捕获指针事件 */}
        {isInteracting && <div className="absolute inset-0 z-50" />}
        {children}
      </div>

      {/* 缩放手柄 */}
      {RESIZE_HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          className={`absolute z-40 ${className}`}
          onMouseDown={(e) => beginInteraction(e, direction)}
          onTouchStart={(e) => beginInteraction(e, direction)}
        />
      ))}
    </div>
  )
}

/* ============================================================
 * 代码编辑器：Prism 高亮层 + 透明 textarea 输入层
 * ============================================================ */

const FILE_LANGUAGE: Record<FileId, string> = {
  page: 'javascript',
  core: 'javascript',
  widget: 'javascript',
  html: 'markup',
  widgetHtml: 'markup',
  styles: 'css',
  manifest: 'json',
  i18n: 'json',
  modules: 'json',
  assets: 'json',
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function CodeEditor({
  value,
  language,
  readOnly,
  label,
  onChange,
}: {
  value: string
  language: string
  readOnly: boolean
  label: string
  onChange: (next: string) => void
}) {
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[language]
    return grammar
      ? Prism.highlight(value, grammar, language)
      : escapeHtml(value)
  }, [value, language])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = event.currentTarget
      el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end')
      onChange(el.value)
    }
  }

  return (
    <div className="playground-code-editor">
      <pre aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
      </pre>
      {!readOnly && (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="soft"
          aria-label={label}
        />
      )}
    </div>
  )
}

/* ============================================================
 * 控制岛内的日志条
 * ============================================================ */

function LogEntry({
  tone,
  icon,
  children,
}: {
  tone: 'error' | 'warning' | 'success'
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const toneClass = {
    error: 'bg-red-500/10 text-red-600 dark:text-red-300',
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  }[tone]

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="pb-1.5">
        <div
          className={`rounded-xl px-3 py-2 text-xs leading-relaxed flex gap-2 ${toneClass}`}
        >
          {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
          <span className="min-w-0 break-words">{children}</span>
        </div>
      </div>
    </motion.div>
  )
}

/* ============================================================
 * 页面
 * ============================================================ */

export function TappPlaygroundPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { isMobile } = useBreakpoints()
  const { setImmersiveMode } = useNavigation()
  const animConfig = useAnimationLevel()
  const [session, setSession] = useState<StoredSession>(loadSession)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyMode, setBusyMode] = useState<'user' | 'runtime-repair'>('user')
  const [installing, setInstalling] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileId>('page')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [activePane, setActivePane] = useState<'preview' | 'code'>('preview')
  // 手动编辑代码的草稿：为空表示未编辑，直接展示项目内容
  const [draft, setDraft] = useState<string | null>(null)
  const [draftInvalid, setDraftInvalid] = useState(false)
  const draftTimerRef = useRef<number | undefined>(undefined)
  const runtimeRepairCountRef = useRef(0)
  const repairedRuntimeErrorsRef = useRef(new Set<string>())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const animationsEnabled = animConfig.level !== 'none'
  const springTransition = animConfig.spring
    ? ({ type: 'spring', stiffness: 400, damping: 30 } as const)
    : ({ type: 'tween', duration: 0.25 * animConfig.durationScale } as const)

  const revision = session.revisions[session.revisionIndex]
  const project = revision?.project

  // 工作区尺寸（用于窗格默认布局与边界约束）
  // callback ref + ResizeObserver：motion 懒加载会重挂根节点，
  // 单次 effect 测量会拿到 0，观察器保证任何挂载/尺寸变化都能测到
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const workspaceObserverRef = useRef<ResizeObserver | null>(null)
  const attachWorkspace = useCallback((node: HTMLDivElement | null) => {
    workspaceObserverRef.current?.disconnect()
    workspaceObserverRef.current = null
    if (!node) return
    const measure = () =>
      setBounds({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    workspaceObserverRef.current = observer
  }, [])
  useEffect(() => () => workspaceObserverRef.current?.disconnect(), [])

  // 进入沉浸模式，隐藏底部导航岛给控制岛让位
  useEffect(() => {
    setImmersiveMode(true)
    return () => setImmersiveMode(false)
  }, [setImmersiveMode])

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [session])

  // 默认布局：预览居左约 55%，代码居右，底部为控制岛预留空间
  const defaultLayout = useMemo(() => {
    if (!bounds.width || !bounds.height) return null
    const margin = 14
    const top = 64
    const gap = 14
    const bottomReserve = 132
    const height = Math.max(
      MIN_PANE_SIZE.height,
      bounds.height - top - margin - bottomReserve,
    )
    const innerWidth = bounds.width - margin * 2 - gap
    const previewWidth = Math.max(
      MIN_PANE_SIZE.width,
      Math.round(innerWidth * 0.55),
    )
    const codeWidth = Math.max(MIN_PANE_SIZE.width, innerWidth - previewWidth)
    return {
      preview: { x: margin, y: top, width: previewWidth, height },
      code: {
        x: margin + previewWidth + gap,
        y: top,
        width: codeWidth,
        height,
      },
    }
  }, [bounds])

  const tappInstance = useMemo<TappInstance | null>(() => {
    if (!project) return null
    return {
      id: project.manifest.id,
      manifest: project.manifest,
      status: 'running',
      installedAt: new Date().toISOString(),
      grantedPermissions: project.manifest.permissions,
      userRole: 'admin',
      isTemporary: true,
      isAdminTapp: false,
    }
  }, [project])

  const executeGeneration = async (
    prompt: string,
    origin: 'user' | 'runtime-repair',
    runtimeFeedback: string[] = [],
  ) => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setBusyMode(origin)
    setError('')
    setNotice('')
    if (origin === 'user') setPreviewError('')
    try {
      const response = await generatePlaygroundProject({
        instruction: prompt.trim(),
        currentProject: project,
        runtimeFeedback,
      })
      setSession((current) => {
        const retained = current.revisions.slice(0, current.revisionIndex + 1)
        retained.push({
          project: response.project,
          explanation: response.explanation,
          instruction: prompt.trim(),
          warnings: response.warnings,
          createdAt: Date.now(),
          origin,
          agentTrace: response.agentTrace,
          knowledgeSources: response.knowledgeSources,
          validation: response.validation,
        })
        const revisions = retained.slice(-20)
        return { revisions, revisionIndex: revisions.length - 1 }
      })
      if (origin === 'user') setInstruction('')
      setPreviewError('')
      setNotice(response.explanation)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t.tapp.playgroundGenerateFailed,
      )
    } finally {
      setBusy(false)
    }
  }

  const runGeneration = async () => {
    const prompt = instruction.trim()
    if (!prompt || busy) return
    runtimeRepairCountRef.current = 0
    repairedRuntimeErrorsRef.current.clear()
    await executeGeneration(prompt, 'user')
  }

  const handleSandboxError = (sandboxError: Error) => {
    const message = sandboxError.message || 'Unknown sandbox runtime error'
    setPreviewError(message)
    if (!project || busy || runtimeRepairCountRef.current >= 2) return

    const errorKey = `${revision?.createdAt || 0}:${message}`
    if (repairedRuntimeErrorsRef.current.has(errorKey)) return
    repairedRuntimeErrorsRef.current.add(errorKey)
    runtimeRepairCountRef.current += 1

    window.setTimeout(() => {
      void executeGeneration(
        '修复沙箱运行错误，保持用户要求和现有正常功能不变。',
        'runtime-repair',
        [message],
      )
    }, 500)
  }

  const moveRevision = (delta: number) => {
    setSession((current) => ({
      ...current,
      revisionIndex: Math.max(
        0,
        Math.min(current.revisions.length - 1, current.revisionIndex + delta),
      ),
    }))
    setError('')
    setNotice('')
    setPreviewError('')
  }

  const installProject = async () => {
    if (!project || installing) return
    setInstalling(true)
    setError('')
    setNotice('')
    try {
      const installed = await installFromCode(
        project.manifest,
        project.code as TappCodeStructure,
      )
      setNotice(t.tapp.playgroundInstallSuccess)
      window.setTimeout(
        navigate,
        450,
        `/tapp/detail/${encodeURIComponent(installed.id)}`,
      )
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : t.tapp.installFailed,
      )
    } finally {
      setInstalling(false)
    }
  }

  const clearSession = () => {
    setSession({ revisions: [], revisionIndex: -1 })
    setInstruction('')
    setError('')
    setNotice('')
    setPreviewError('')
    runtimeRepairCountRef.current = 0
    repairedRuntimeErrorsRef.current.clear()
  }

  // 输入框自适应高度（1-5 行）
  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }
  useEffect(autoGrow, [instruction])

  // 切换文件或版本时丢弃未提交的编辑草稿；清理时取消待落盘的定时器
  useEffect(() => {
    setDraft(null)
    setDraftInvalid(false)
    return () => {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    }
  }, [selectedFile, session.revisionIndex])

  // 手动编辑落盘：文本文件直接写入当前版本，JSON 文件解析成功后写入
  const applyDraft = useCallback((file: FileId, text: string) => {
    const textKeys = {
      page: 'page',
      html: 'pageHtml',
      styles: 'styles',
      core: 'core',
      widget: 'widget',
      widgetHtml: 'widgetHtml',
    } as const
    let parsedJson: unknown
    const isJsonFile =
      file === 'manifest' || file === 'i18n' || file === 'modules'
    if (isJsonFile) {
      try {
        parsedJson = JSON.parse(text)
      } catch {
        setDraftInvalid(true)
        return
      }
    } else if (!(file in textKeys)) {
      return
    }
    setDraftInvalid(false)
    setSession((current) => {
      const rev = current.revisions[current.revisionIndex]
      if (!rev) return current
      const revProject = rev.project
      let nextProject: TappPlaygroundProject
      if (file === 'manifest') {
        nextProject = {
          ...revProject,
          manifest: parsedJson as TappPlaygroundProject['manifest'],
        }
      } else if (file === 'i18n') {
        nextProject = {
          ...revProject,
          code: {
            ...revProject.code,
            i18n: parsedJson as TappPlaygroundProject['code']['i18n'],
          },
        }
      } else if (file === 'modules') {
        nextProject = {
          ...revProject,
          code: {
            ...revProject.code,
            pageModules: parsedJson as TappPlaygroundProject['code']['pageModules'],
          },
        }
      } else {
        nextProject = {
          ...revProject,
          code: {
            ...revProject.code,
            [textKeys[file as keyof typeof textKeys]]: text,
          },
        }
      }
      const revisions = current.revisions.slice()
      revisions[current.revisionIndex] = { ...rev, project: nextProject }
      return { ...current, revisions }
    })
  }, [])

  const handleCodeChange = (text: string) => {
    if (!project || busy) return
    setDraft(text)
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    const file = selectedFile
    draftTimerRef.current = window.setTimeout(applyDraft, 600, file, text)
  }

  const files: Array<{ id: FileId; label: string }> = [
    { id: 'page', label: 'main.js · page' },
    { id: 'html', label: 'page.html' },
    { id: 'styles', label: 'styles.css' },
    { id: 'core', label: 'main.js · core' },
    { id: 'manifest', label: 'manifest.json' },
    { id: 'i18n', label: 'i18n.json' },
    ...(project?.code.widget
      ? ([{ id: 'widget', label: 'main.js · widget' }] as const)
      : []),
    ...(project?.code.widgetHtml
      ? ([{ id: 'widgetHtml', label: 'widget.html' }] as const)
      : []),
    ...(Object.keys(project?.code.pageModules || {}).length
      ? ([{ id: 'modules', label: 'page/modules' }] as const)
      : []),
    ...(Object.keys(project?.code.assets || {}).length
      ? ([{ id: 'assets', label: 'assets' }] as const)
      : []),
  ]

  const hasLog = !!(
    error ||
    previewError ||
    notice ||
    revision?.warnings.length ||
    revision?.agentTrace?.length
  )

  const interactive = !isMobile

  /* ---------- 窗格内容 ---------- */

  const previewHeader = (
    <div className="flex items-center gap-2 min-w-0 w-full px-3">
      {interactive && (
        <FaGripVertical
          className="w-3 h-3 shrink-0"
          style={{ color: 'var(--text-muted)' }}
        />
      )}
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          previewError
            ? 'bg-amber-500'
            : `bg-emerald-500 ${animConfig.loop && project ? 'animate-pulse' : ''}`
        }`}
      />
      <span
        className="text-xs font-medium truncate"
        style={{ color: 'var(--text-primary)' }}
      >
        {t.tapp.playgroundPreview}
      </span>
      {project && (
        <span
          className="ml-auto text-[10px] truncate"
          style={{ color: 'var(--text-muted)' }}
        >
          {project.manifest.name} · v{project.manifest.version}
        </span>
      )}
    </div>
  )

  const previewContent = (
    <>
      {tappInstance && project ? (
        <TappPageSandbox
          tappInstance={tappInstance}
          code={project.code}
          previewMode
          onError={handleSandboxError}
          onReady={() => setPreviewError('')}
          style={{ borderRadius: 0 }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-6 text-center overflow-y-auto">
          <motion.div
            initial={
              animationsEnabled ? { opacity: 0, scale: 0.94, y: 10 } : false
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={springTransition}
          >
            <div
              className="w-16 h-16 mx-auto rounded-[22px] grid place-items-center border"
              style={{
                color: 'var(--color-primary)',
                background:
                  'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                borderColor:
                  'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              }}
            >
              <TappPlaygroundIcon className="w-8 h-8" />
            </div>
            <h2 className="mt-4 font-bold text-gray-800 dark:text-gray-100">
              {t.tapp.playgroundEmptyTitle}
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-sm leading-relaxed">
              {t.tapp.playgroundEmptyDesc}
            </p>
          </motion.div>
        </div>
      )}

      {/* 生成中的遮罩 */}
      <AnimatePresence>
        {busy && project && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-30 grid place-items-center bg-white/40 dark:bg-black/40 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white/85 dark:bg-black/70 backdrop-blur-xl shadow-lg ring-1 ring-inset ring-black/5 dark:ring-white/10">
              <span
                className="w-4 h-4 border-2 rounded-full animate-spin"
                style={{
                  borderColor:
                    'color-mix(in srgb, var(--color-primary) 30%, transparent)',
                  borderTopColor: 'var(--color-primary)',
                }}
              />
              {busyMode === 'runtime-repair'
                ? t.tapp.playgroundRepairingRuntime
                : t.tapp.playgroundGenerating}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )

  const codeHeader = (
    <div className="flex items-center gap-2 min-w-0 w-full px-3">
      {interactive && (
        <FaGripVertical
          className="w-3 h-3 shrink-0"
          style={{ color: 'var(--text-muted)' }}
        />
      )}
      <FaCode
        className="w-3 h-3 shrink-0"
        style={{ color: 'var(--color-primary)' }}
      />
      <span
        className="text-xs font-medium truncate"
        style={{ color: 'var(--text-primary)' }}
      >
        {t.tapp.playgroundCodeTitle}
      </span>
      {draftInvalid ? (
        <span className="ml-auto text-[10px] text-amber-500 whitespace-nowrap truncate">
          {t.tapp.playgroundInvalidJson}
        </span>
      ) : project ? (
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: 'var(--text-muted)' }}
        >
          {session.revisionIndex + 1}/{session.revisions.length}
        </span>
      ) : null}
    </div>
  )

  const codeValue =
    draft ??
    (project ? fileContents(project, selectedFile) : t.tapp.playgroundCodeEmpty)
  const codeReadOnly = !project || busy || selectedFile === 'assets'

  const codeContent = (
    <div className="absolute inset-0 flex flex-col bg-[#0d0f14] text-gray-200">
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 overflow-x-auto border-b border-white/10">
        {files.map((file) => (
          <button
            key={file.id}
            onClick={() => setSelectedFile(file.id)}
            disabled={!project}
            className={`relative h-7 px-2.5 rounded-lg text-[11px] font-mono whitespace-nowrap transition-colors disabled:opacity-30 ${
              selectedFile === file.id
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {selectedFile === file.id && (
              <motion.span
                layoutId="playground-file-tab"
                transition={springTransition}
                className="absolute inset-0 rounded-lg bg-white/10"
              />
            )}
            <span className="relative z-10">{file.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <CodeEditor
          value={codeValue}
          language={FILE_LANGUAGE[selectedFile]}
          readOnly={codeReadOnly}
          label={
            files.find((file) => file.id === selectedFile)?.label ||
            selectedFile
          }
          onChange={handleCodeChange}
        />
      </div>
    </div>
  )

  return (
    <motion.div
      ref={attachWorkspace}
      initial={animationsEnabled ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 * animConfig.durationScale }}
      className={`fixed inset-0 z-100 ${
        interactive ? 'overflow-hidden' : 'overflow-y-auto'
      }`}
      data-no-ripple
    >
      {/* 顶部工具栏 - 与多窗口运行页一致的浮动样式 */}
      <div className="absolute top-3.5 left-3.5 z-40">
        <div
          className="flex items-center gap-1.5 rounded-xl pl-1.5 pr-3 py-1.5 backdrop-blur-md"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--bg-card) 80%, transparent)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          }}
        >
          <motion.button
            onClick={() => navigate('/tapp')}
            whileTap={animationsEnabled ? { scale: 0.92 } : {}}
            className="w-8 h-8 rounded-lg grid place-items-center transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
            aria-label={t.tapp.back}
          >
            <FaArrowLeft className="w-3.5 h-3.5" />
          </motion.button>
          <div
            className="w-px h-5 mx-0.5"
            style={{ backgroundColor: 'var(--border-color)' }}
          />
          <div
            className="w-7 h-7 rounded-lg grid place-items-center text-white shadow-sm"
            style={{
              background:
                'linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 80%, black))',
            }}
          >
            <TappPlaygroundIcon className="w-4 h-4" />
          </div>
          <span
            className="text-sm font-semibold whitespace-nowrap"
            style={{ color: 'var(--text-primary)' }}
          >
            {t.tapp.playgroundTitle}
          </span>
          <div
            className="hidden sm:block w-px h-5 mx-0.5"
            style={{ backgroundColor: 'var(--border-color)' }}
          />
          <span
            className="hidden sm:flex items-center gap-1.5 text-[10px] whitespace-nowrap cursor-help"
            style={{ color: 'var(--text-muted)' }}
            title={t.tapp.playgroundIsolationDesc}
          >
            <FaLock className="w-2.5 h-2.5" />
            {t.tapp.playgroundIsolationTitle}
          </span>
        </div>
      </div>

      {/* 工作区窗格 */}
      {interactive ? (
        defaultLayout && (
          <>
            <FloatingPane
              defaultRect={defaultLayout.preview}
              bounds={bounds}
              isActive={activePane === 'preview'}
              onFocus={() => setActivePane('preview')}
              header={previewHeader}
              interactive
            >
              {previewContent}
            </FloatingPane>
            <FloatingPane
              defaultRect={defaultLayout.code}
              bounds={bounds}
              isActive={activePane === 'code'}
              onFocus={() => setActivePane('code')}
              header={codeHeader}
              interactive
            >
              {codeContent}
            </FloatingPane>
          </>
        )
      ) : (
        <div className="flex flex-col gap-3 px-3 pt-16 pb-48">
          <FloatingPane
            defaultRect={{ x: 0, y: 0, width: 0, height: 0 }}
            bounds={bounds}
            isActive
            onFocus={() => {}}
            header={previewHeader}
            interactive={false}
            staticClassName="h-[56vh]"
          >
            {previewContent}
          </FloatingPane>
          <FloatingPane
            defaultRect={{ x: 0, y: 0, width: 0, height: 0 }}
            bounds={bounds}
            isActive
            onFocus={() => {}}
            header={codeHeader}
            interactive={false}
            staticClassName="h-[42vh]"
          >
            {codeContent}
          </FloatingPane>
        </div>
      )}

      {/* 底部控制岛：日志 + 输入 + 版本/安装 */}
      <motion.div
        initial={animationsEnabled ? { opacity: 0, y: 24 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className={`z-50 ${
          interactive
            ? 'absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(94vw,46rem)]'
            : 'fixed bottom-3 inset-x-3'
        }`}
      >
        <div className="rounded-[1.75rem] bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
          {/* 日志区 */}
          {hasLog && (
            <div className="px-3 pt-3 max-h-44 overflow-y-auto">
              <AnimatePresence initial={false}>
                {error && (
                  <LogEntry key="error" tone="error">
                    {error}
                  </LogEntry>
                )}
                {previewError && (
                  <LogEntry key="preview-error" tone="warning">
                    {previewError}
                  </LogEntry>
                )}
                {notice && (
                  <LogEntry
                    key="notice"
                    tone="success"
                    icon={<FaCheck className="w-3 h-3" />}
                  >
                    {notice}
                  </LogEntry>
                )}
                {revision?.warnings.map((warning) => (
                  <LogEntry key={`warning-${warning}`} tone="warning">
                    {warning}
                  </LogEntry>
                ))}
              </AnimatePresence>

              {/* Agent 工作轨迹 + 会话操作 */}
              {revision?.agentTrace?.length ? (
                <details
                  className="mb-1.5 rounded-xl border px-3 py-2 group"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                    borderColor:
                      'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                  }}
                >
                  <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                    <PlaygroundTraceIcon
                      className="w-3.5 h-3.5"
                      style={{ color: 'var(--color-primary)' }}
                    />
                    {t.tapp.playgroundAgentTrace}
                    <span
                      className="ml-auto text-[10px] font-mono"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {revision.validation?.passed
                        ? `${t.tapp.playgroundValidated} · ${revision.validation.attempts}`
                        : revision.agentTrace.length}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {revision.agentTrace.map((step, index) => (
                      <div
                        key={`${step.tool}-${index}`}
                        className="grid grid-cols-[8px_minmax(0,1fr)] gap-2 text-[10px] leading-relaxed"
                      >
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full ${
                            step.status === 'success'
                              ? 'bg-emerald-500'
                              : step.status === 'failed'
                                ? 'bg-red-500'
                                : 'bg-amber-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <span
                            className="font-mono font-bold"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {step.tool}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {' '}
                            {step.summary}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {revision.knowledgeSources?.length ? (
                    <div
                      className="mt-2 pt-2 border-t"
                      style={{
                        borderColor:
                          'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                      }}
                    >
                      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                        {t.tapp.playgroundKnowledgeSources}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {revision.knowledgeSources.slice(0, 10).map((source) => (
                          <span
                            key={`${source.document}-${source.section}`}
                            title={source.section}
                            className="max-w-full truncate rounded-lg bg-black/5 dark:bg-white/5 px-2 py-0.5 text-[9px] font-mono text-gray-600 dark:text-gray-300"
                          >
                            {source.document} · {source.section}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </div>
          )}

          {/* 输入行 */}
          <div className="flex items-end gap-1.5 p-2">
            <div
              className="w-9 h-9 shrink-0 rounded-full grid place-items-center"
              style={{
                color: 'var(--color-primary)',
                background:
                  'color-mix(in srgb, var(--color-primary) 12%, transparent)',
              }}
            >
              <TappPlaygroundIcon className="w-4 h-4" />
            </div>
            <textarea
              ref={textareaRef}
              value={instruction}
              rows={1}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void runGeneration()
                }
              }}
              placeholder={
                project
                  ? t.tapp.playgroundModifyPlaceholder
                  : t.tapp.playgroundCreatePlaceholder
              }
              title={t.tapp.playgroundShortcut}
              className="flex-1 min-w-0 resize-none self-center py-2 px-1.5 text-sm leading-5 max-h-[132px] placeholder:text-gray-400 dark:placeholder:text-gray-500"
              style={{
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
              }}
              maxLength={8000}
            />

            {/* 版本切换 */}
            {session.revisions.length > 0 && (
              <div className="flex items-center rounded-full bg-black/5 dark:bg-white/10 p-0.5 shrink-0">
                <motion.button
                  onClick={() => moveRevision(-1)}
                  disabled={session.revisionIndex <= 0 || busy}
                  whileTap={animationsEnabled ? { scale: 0.9 } : {}}
                  className="w-8 h-8 rounded-full grid place-items-center text-gray-600 dark:text-gray-300 hover:bg-white hover:shadow-sm dark:hover:bg-white/15 transition-all disabled:opacity-30 disabled:pointer-events-none"
                  title={t.tapp.playgroundUndo}
                  aria-label={t.tapp.playgroundUndo}
                >
                  <FaUndo className="w-3 h-3" />
                </motion.button>
                <motion.button
                  onClick={() => moveRevision(1)}
                  disabled={
                    session.revisionIndex < 0 ||
                    session.revisionIndex >= session.revisions.length - 1 ||
                    busy
                  }
                  whileTap={animationsEnabled ? { scale: 0.9 } : {}}
                  className="w-8 h-8 rounded-full grid place-items-center text-gray-600 dark:text-gray-300 hover:bg-white hover:shadow-sm dark:hover:bg-white/15 transition-all disabled:opacity-30 disabled:pointer-events-none"
                  title={t.tapp.playgroundRedo}
                  aria-label={t.tapp.playgroundRedo}
                >
                  <FaRedo className="w-3 h-3" />
                </motion.button>
              </div>
            )}

            {/* 安装 */}
            <AnimatePresence>
              {project && (
                <motion.button
                  initial={
                    animationsEnabled ? { opacity: 0, scale: 0.8 } : false
                  }
                  animate={{ opacity: 1, scale: 1 }}
                  exit={
                    animationsEnabled ? { opacity: 0, scale: 0.8 } : undefined
                  }
                  transition={springTransition}
                  whileTap={animationsEnabled ? { scale: 0.92 } : {}}
                  onClick={installProject}
                  disabled={installing || busy}
                  className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-white bg-gray-900 dark:bg-white dark:text-gray-900 shadow-sm disabled:opacity-40 transition-opacity"
                  title={t.tapp.playgroundInstall}
                  aria-label={t.tapp.playgroundInstall}
                >
                  {installing ? (
                    <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  ) : (
                    <FaDownload className="w-3.5 h-3.5" />
                  )}
                </motion.button>
              )}
            </AnimatePresence>

            {/* 生成/发送 */}
            <motion.button
              onClick={runGeneration}
              disabled={!instruction.trim() || busy}
              whileTap={
                animationsEnabled && instruction.trim() && !busy
                  ? { scale: 0.92 }
                  : {}
              }
              className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-white shadow-md disabled:opacity-40 transition-opacity"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 80%, black))',
              }}
              title={
                project ? t.tapp.playgroundApplyChange : t.tapp.playgroundGenerate
              }
              aria-label={
                project ? t.tapp.playgroundApplyChange : t.tapp.playgroundGenerate
              }
            >
              {busy ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FaArrowUp className="w-3.5 h-3.5" />
              )}
            </motion.button>
          </div>

          {/* 底部信息行 */}
          <div className="flex items-center justify-between px-4 pb-2 -mt-0.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
              {busy
                ? busyMode === 'runtime-repair'
                  ? t.tapp.playgroundRepairingRuntime
                  : t.tapp.playgroundGenerating
                : t.tapp.playgroundShortcut}
            </span>
            {session.revisions.length > 0 && (
              <button
                onClick={clearSession}
                className="text-[10px] font-semibold text-red-500/80 hover:text-red-500 transition-colors shrink-0"
              >
                {t.tapp.playgroundClear}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default TappPlaygroundPage
