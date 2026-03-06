/**
 * Agent 服务类型定义
 *
 * AI 驱动的自然语言任务编排系统类型
 */

// ============ 处理上下文 ============

/** 处理上下文 */
export interface ProcessContext {
  /** 当前页面路由 */
  currentRoute?: string
  /** 活跃的平台 */
  activePlatforms?: string[]
  /** 会话 ID */
  sessionId?: string
  /** 自定义数据 */
  customData?: Record<string, unknown>
}

/** 处理请求 */
export interface ProcessRequest {
  /** 用户自然语言输入 */
  input: string
  /** 上下文信息 */
  context?: ProcessContext
}

/** 澄清请求 */
export interface ClarifyRequest {
  /** 原始请求 */
  originalInput: string
  /** 澄清点 ID */
  clarificationId: string
  /** 用户回答 */
  answer: string
  /** 上下文 */
  context?: ProcessContext
}

// ============ 任务相关 ============

/** 任务状态 */
export type TaskStatus
  = | 'pending'
    | 'running'
    | 'waiting_for_input'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'

/** 任务信息 */
export interface TaskInfo {
  taskId: string
  status: TaskStatus
  progress: number
  error?: string
}

/** 任务详情 */
export interface TaskDetail {
  taskId: string
  recipeId: string
  status: string
  progress: number
  startedAt: string
  completedAt?: string
  results?: Record<string, unknown>
}

// ============ 澄清相关 ============

/** 澄清类型 */
export type ClarificationType
  = | 'time_range'
    | 'target'
    | 'action'
    | 'missing_parameter'
    | 'ambiguity'

/** 澄清点 */
export interface ClarificationPoint {
  id: string
  type: ClarificationType
  question: string
  options: string[]
  default?: string
}

// ============ 响应相关 ============

/** 响应类型 */
export type AgentResponseType
  = | 'answer'
    | 'clarification'
    | 'task_created'
    | 'task_progress'
    | 'task_completed'
    | 'error'

/** Agent 响应 */
export interface AgentResponse {
  success: boolean
  responseType: AgentResponseType
  message: string
  data?: unknown
  /** 数据展示提示 */
  dataDisplay?: DataDisplayHint
  suggestions: string[]
  task?: TaskInfo
  /** 前端操作指令 */
  frontendAction?: FrontendAction
}

// ============ SSE 进度事件 ============

/** 任务创建事件 */
export interface TaskCreatedEvent {
  type: 'task_created'
  taskId: string
  message: string
  totalSteps: number
}

/** 步骤开始事件 */
export interface StepStartedEvent {
  type: 'step_started'
  stepId: string
  stepIndex: number
  totalSteps: number
  capabilityName: string
  description: string
}

/** 步骤完成事件 */
export interface StepCompletedEvent {
  type: 'step_completed'
  stepId: string
  stepIndex: number
  success: boolean
  durationMs: number
  outputSummary?: string
}

/** 进度更新事件 */
export interface ProgressUpdateEvent {
  type: 'progress'
  progress: number
  completedSteps: number
  totalSteps: number
  message: string
}

/** 任务完成事件 */
export interface TaskCompletedEvent {
  type: 'task_completed'
  taskId: string
  success: boolean
  response: AgentResponse
}

/** 等待用户输入事件 */
export interface WaitingForInputEvent {
  type: 'waiting_for_input'
  taskId: string
  question: {
    questionId: string
    questionType: string
    question: string
    options?: string[]
  }
}

/** 错误事件 */
export interface ErrorEvent {
  type: 'error'
  taskId?: string
  message: string
  code: string
}

/** 所有进度事件类型 */
export type ProgressEvent
  = | TaskCreatedEvent
    | StepStartedEvent
    | StepCompletedEvent
    | ProgressUpdateEvent
    | TaskCompletedEvent
    | WaitingForInputEvent
    | ErrorEvent

/** 进度回调函数 */
export type ProgressCallback = (event: ProgressEvent) => void

// ============ 数据展示 ============

/** 列定义 */
export interface ColumnDef {
  field: string
  title: string
  width?: number
  sortable: boolean
}

/** 数据展示类型提示 */
export type DataDisplayHint
  = | { type: 'table', columns: ColumnDef[], dataPath?: string }
    | { type: 'chart', chartType: string, xField: string, yField: string }
    | { type: 'card_list', titleField: string, descriptionField?: string, imageField?: string }
    | { type: 'markdown' }
    | { type: 'key_value' }
    | { type: 'timeline', timeField: string, contentField: string }
    | { type: 'raw' }

// ============ 前端动作 ============

/** 前端动作类型 */
export type FrontendActionType
  = | 'query_windows'
    | 'open_window'
    | 'close_window'
    | 'focus_window'
    | 'fill_data'
    | 'read_data'
    | 'tapp_interact'
    | 'navigate'
    | 'page_interact'
    | 'brew_open_article'
    | 'music_control'
    | 'music_get_status'
    | 'music_load_playlist'
    | 'reading_list'

/** 窗口目标 */
export interface WindowTarget {
  windowId?: string
  tappId?: string
  tappName?: string
  position?: 'active' | 'left' | 'right' | 'next' | 'previous'
}

/** 页面元素目标 */
export interface PageElementTarget {
  selector?: string
  testId?: string
  text?: string
  ariaLabel?: string
  role?: string
  index?: number
}

/** 交互命令 */
export interface InteractionCommand {
  action: string
  target: string
  value?: string
  command: string
  autoDetect?: boolean
}

/** 滚动选项 */
export interface ScrollOptions {
  direction?: 'top' | 'bottom' | 'left' | 'right'
  offset?: number
  smooth?: boolean
}

/** 等待条件 */
export interface WaitCondition {
  visible?: boolean
  timeout?: number
}

/** 阅读列表载荷 */
export interface ReadingListPayload {
  items?: Array<{
    id: number
    title: string
    source_name: string
    published_at: string
    reason?: string
  }>
  name?: string
}

/** 前端操作指令 */
export interface FrontendAction {
  type: FrontendActionType
  target?: WindowTarget | PageElementTarget
  tappId?: string
  windowId?: string
  commands?: InteractionCommand[]
  script?: string
  timestamp: number
  /** 操作数据 */
  data?: Record<string, unknown>
  /** 导航路径 */
  path?: string
  /** 路由参数 */
  params?: Record<string, unknown>
  /** 查询参数 */
  query?: Record<string, unknown>
  /** 完整路径 */
  fullPath?: string
  /** 控制动作 */
  action?: string
  /** 控制值 */
  value?: number | boolean
  /** 是否替换历史记录 */
  replace?: boolean
  /** 歌单ID */
  playlistId?: string
  /** 音乐来源 */
  source?: string
  /** 是否自动播放 */
  autoPlay?: boolean
  /** 滚动选项 */
  scrollOptions?: ScrollOptions
  /** 等待条件 */
  waitFor?: WaitCondition
  /** 阅读列表载荷 */
  payload?: ReadingListPayload
  /** 筛选条件描述 */
  criteria?: string
}

// ============ 能力定义 ============

/** 能力定义 */
export interface Capability {
  id: string
  name: string
  description: string
  category: string
  actions: string[]
  requiresAi: boolean
}

// ============ 任务预设 ============

/** 预设类型 */
export type PresetType = 'favorite' | 'history'

/** 任务预设 */
export interface TaskPreset {
  id: number
  input: string
  presetType: PresetType
  parsedSteps?: unknown
  intentSummary?: string
  /** 对话标题（用于继续对话时显示） */
  title?: string
  /** 完整对话记录 - 支持「继续对话」模式 */
  conversationData?: ConversationMessage[]
  /** 是否有可继续的对话（conversationData 非空） */
  hasConversation?: boolean
  lastUsedAt: string
  useCount: number
  createdAt: string
}

/** 任务预设列表响应 */
export interface TaskPresetListResponse {
  favorites: TaskPreset[]
  history: TaskPreset[]
}

/** 创建任务预设请求 */
export interface CreatePresetRequest {
  input: string
  presetType: PresetType
  parsedSteps?: unknown
  intentSummary?: string
  /** 对话标题 */
  title?: string
  /** 对话记录（用于保存完整对话以支持「继续对话」） */
  conversationData?: ConversationMessage[]
}

// ============ 会话相关 ============

/** 对话消息（存储在 TaskPreset 中） */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
}

/** 会话信息 */
export interface SessionInfo {
  id: string
  title: string | null
  messageCount: number
  archived: boolean
  createdAt: string
  lastActiveAt: string
}

/** 会话消息 */
export interface SessionMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  taskId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}
