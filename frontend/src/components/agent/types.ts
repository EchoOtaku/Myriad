/**
 * AraelPanel 组件类型定义
 *
 * 与 AraelPanel.tsx 源文件保持一致
 */

// ============ 动画常量（与源文件一致）============

export const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 25 } as const
export const SPRING_SMOOTH = { type: 'spring', stiffness: 350, damping: 28 } as const
export const TRANSITION_QUICK = { duration: 0.12 } as const
export const TRANSITION_NORMAL = { duration: 0.15 } as const
export const TRANSITION_SLOW = { duration: 0.25, ease: 'easeOut' } as const

// ============ 常量 ============

/** 长按触发时间 (ms) */
export const LONG_PRESS_DURATION = 500

// ============ 类型定义（与源文件一致）============

/** 面板可见性状态 */
export type PanelVisibility = 'hidden' | 'visible'

/** 执行步骤 */
export interface ExecutionStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  message?: string
}

/** 日志条目 */
export interface LogEntry {
  id: string
  timestamp: Date
  type: 'info' | 'success' | 'warning' | 'error' | 'debug'
  message: string
  data?: unknown
}

/** 待回答问题 */
export interface PendingQuestion {
  questionId: string
  questionType: string
  question: string
  options?: string[]
}

/** 任务项 */
export interface TaskItem {
  id: string
  taskId?: string // 后端的 taskId，用于回答问题
  input: string
  status: 'processing' | 'waiting' | 'completed' | 'error'
  progress: number
  message: string
  steps: ExecutionStep[]
  createdAt: Date
  pendingQuestion?: PendingQuestion // 等待用户回答的问题
  result?: {
    success: boolean
    content: string
    suggestions?: string[]
  }
}
