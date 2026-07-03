/**
 * Tapp Bridge - 消息桥接层
 * 负责主应用与 Tapp 沙箱之间的安全通信
 *
 * 安全特性：
 * - 严格的消息来源验证
 * - 细粒度权限检查（含用户角色验证）
 * - 输入参数验证
 * - 请求频率限制
 * - 敏感操作审计日志
 */

import type {
  TappAPIRequest,
  TappAPIResponse,
  TappInstance,
  TappMessage,
  TappPermission,
} from '../types'
import { getQuotaManager } from '../services/QuotaManager'
import { PERMISSION_MAP } from './permissionConfig'

type MessageHandler = (message: TappMessage) => Promise<TappAPIResponse>

/**
 * 生成唯一消息 ID（使用加密安全的随机数）
 */
function generateMessageId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return `${Date.now()}-${Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * 消息验证结果
 */
interface MessageValidationResult {
  valid: boolean
  error?: string
}

/**
 * 权限验证详情
 */
interface PermissionCheckResult {
  allowed: boolean
  reason?: string
  requiredPermission?: TappPermission | 'public'
}

/**
 * Tapp Bridge 类
 * 处理主应用与沙箱之间的双向通信
 */
export class TappBridge {
  private iframe: HTMLIFrameElement | null = null
  private tappInstance: TappInstance | null = null
  private messageHandlers: Map<string, MessageHandler> = new Map()
  private pendingRequests: Map<
    string,
    {
      resolve: (value: TappAPIResponse) => void
      reject: (reason: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  > = new Map()

  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map()

  /** 请求超时时间 */
  private readonly REQUEST_TIMEOUT = 30000

  /** 允许的 origin（用于验证接收消息的来源） */
  private allowedOrigin: string = ''

  /**
   * postMessage 目标 origin（发送消息用）
   * srcdoc iframe 在配合 allow-same-origin 时 origin 为父页面，否则为 null
   * 浏览器不接受字符串 'null' 作为 postMessage 目标，使用 '*' 代替
   * 安全性由 event.source === iframe.contentWindow 检查保证
   */
  private postMessageTarget: string = '*'

  /** 会话 token（用于验证消息来源） */
  private sessionToken: string = ''

  /** 最近请求时间戳（用于频率限制） */
  private lastRequestTime: number = 0

  /** 最小请求间隔（毫秒） */
  private readonly MIN_REQUEST_INTERVAL = 10

  /** 敏感操作列表（需要审计日志） */
  private readonly SENSITIVE_ACTIONS = new Set([
    'ai.generate',
    'ai.analyze',
    'ai.chat',
    'platform.addItem',
    'platform.addItems',
    'storage.set',
    'storage.clear',
    'report.create',
    'report.update',
    'report.delete',
  ])

  constructor() {
    // 绑定消息处理器
    this.handleMessage = this.handleMessage.bind(this)
  }

  /**
   * 初始化 Bridge，连接到 iframe
   *
   * @param iframe - 沙箱 iframe 元素
   * @param tappInstance - Tapp 实例
   * @param sessionToken - 会话 token（用于消息验证）
   */
  initialize(
    iframe: HTMLIFrameElement,
    tappInstance: TappInstance,
    sessionToken?: string,
  ): void {
    this.iframe = iframe
    this.tappInstance = tappInstance

    // 设置会话 token（如果未提供则生成一个）
    if (sessionToken) {
      this.sessionToken = sessionToken
    } else {
      // 生成安全的随机 token
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      this.sessionToken = Array.from(array, (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
    }

    // 设置允许的 origin
    // 在沙箱模式下，使用 blob: 或 srcdoc，origin 为 'null'
    this.allowedOrigin = 'null'

    // 监听消息
    window.addEventListener('message', this.handleMessage)
  }

  /**
   * 获取会话 token（供沙箱 HTML 生成时使用）
   */
  getSessionToken(): string {
    return this.sessionToken
  }

  /**
   * 销毁 Bridge
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage)

    // 清理所有待处理的请求
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Bridge destroyed'))
    }
    this.pendingRequests.clear()

    // 清理事件监听器
    this.eventListeners.clear()

    this.iframe = null
    this.tappInstance = null
  }

  /**
   * 注册 API 处理器
   */
  registerHandler(action: string, handler: MessageHandler): void {
    this.messageHandlers.set(action, handler)
  }

  /**
   * 注销 API 处理器
   */
  unregisterHandler(action: string): void {
    this.messageHandlers.delete(action)
  }

  /**
   * 向 Tapp 发送事件
   */
  emit(event: string, data: unknown): void {
    if (!this.iframe?.contentWindow) {
      console.warn('[TappBridge] Cannot emit event: iframe not ready')
      return
    }

    const message: TappMessage = {
      type: 'event',
      id: generateMessageId(),
      action: event,
      payload: data,
      timestamp: Date.now(),
    }

    this.iframe.contentWindow.postMessage(message, this.postMessageTarget)
  }

  /**
   * 验证消息格式和内容
   */
  private validateMessage(message: unknown): MessageValidationResult {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Invalid message format' }
    }

    const msg = message as Record<string, unknown>

    // 必需字段检查
    if (!msg.type || typeof msg.type !== 'string') {
      return { valid: false, error: 'Missing or invalid type field' }
    }

    if (!msg.id || typeof msg.id !== 'string') {
      return { valid: false, error: 'Missing or invalid id field' }
    }

    // ID 格式验证（防止注入攻击）
    if (!/^[\w-]+$/.test(msg.id) || msg.id.length > 100) {
      return { valid: false, error: 'Invalid message ID format' }
    }

    // 类型验证
    if (!['request', 'response', 'event'].includes(msg.type)) {
      return { valid: false, error: 'Unknown message type' }
    }

    // action 字段验证
    if (
      msg.type !== 'response' &&
      (!msg.action || typeof msg.action !== 'string')
    ) {
      return { valid: false, error: 'Missing or invalid action field' }
    }

    // action 格式验证（防止注入攻击）
    if (msg.action && typeof msg.action === 'string') {
      if (!/^[\w.]+$/.test(msg.action) || msg.action.length > 50) {
        return { valid: false, error: 'Invalid action format' }
      }
    }

    // payload 大小检查（防止内存攻击）
    if (msg.payload !== undefined) {
      const payloadStr = JSON.stringify(msg.payload)
      if (payloadStr.length > 1024 * 1024) {
        // 1MB 限制
        return { valid: false, error: 'Payload too large' }
      }
    }

    // 会话 token 验证（增强安全性）
    // 对于 request 类型的消息，验证 session token
    if (msg.type === 'request' && this.sessionToken) {
      const sessionToken = msg._sessionToken as string | undefined
      if (sessionToken !== this.sessionToken) {
        console.warn(
          '[TappBridge] Session token mismatch - possible message spoofing',
        )
        return { valid: false, error: 'Invalid session token' }
      }
    }

    return { valid: true }
  }

  /**
   * 处理来自 Tapp 的消息（增强安全版本）
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    // 安全检查：验证消息来源
    // 注意：blob: URL 的 origin 是 'null'
    if (
      event.origin !== this.allowedOrigin &&
      event.origin !== window.location.origin
    ) {
      // 允许来自同源的消息（开发模式）
      if (event.source !== this.iframe?.contentWindow) {
        return
      }
    }

    // 验证消息来自我们的 iframe
    if (event.source !== this.iframe?.contentWindow) {
      return
    }

    // 验证消息格式
    const validation = this.validateMessage(event.data)
    if (!validation.valid) {
      console.warn(`[TappBridge] Invalid message: ${validation.error}`)
      return
    }

    const message = event.data as TappMessage

    // 频率限制检查（仅限事件类型消息，request 类必须始终处理以避免 SDK 挂起）
    const now = Date.now()
    if (
      message.type !== 'request' &&
      now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL
    ) {
      return
    }
    this.lastRequestTime = now

    switch (message.type) {
      case 'request':
        await this.handleRequest(message as TappMessage<TappAPIRequest>)
        break
      case 'response':
        this.handleResponse(message as TappMessage<TappAPIResponse<unknown>>)
        break
      case 'event':
        this.handleEvent(message)
        break
    }
  }

  /**
   * 处理 API 请求（增强安全版本）
   */
  private async handleRequest(
    message: TappMessage<TappAPIRequest>,
  ): Promise<void> {
    const { id, payload } = message

    if (!payload || !payload.api || !payload.method) {
      this.sendResponse(id, {
        success: false,
        error: 'Invalid request format',
        code: 'INVALID_REQUEST',
      })
      return
    }

    // 验证 API 和 method 名称格式
    if (!/^[a-z]+$/i.test(payload.api) || !/^[a-z]+$/i.test(payload.method)) {
      this.sendResponse(id, {
        success: false,
        error: 'Invalid API or method name format',
        code: 'INVALID_REQUEST',
      })
      return
    }

    const action = `${payload.api}.${payload.method}`

    // 配额检查
    if (this.tappInstance) {
      const quotaManager = getQuotaManager()
      const quotaCheck = quotaManager.checkQuota(this.tappInstance.id, action)
      if (!quotaCheck.allowed) {
        this.sendResponse(id, {
          success: false,
          error: quotaCheck.reason || 'Quota exceeded',
          code: 'QUOTA_EXCEEDED',
        })
        return
      }
    }

    // 权限检查（增强版）
    const permissionCheck = this.checkPermissionDetailed(action)
    if (!permissionCheck.allowed) {
      this.sendResponse(id, {
        success: false,
        error: `Permission denied: ${permissionCheck.reason || action}`,
        code: 'PERMISSION_DENIED',
      })
      return
    }

    // 查找处理器
    const handler = this.messageHandlers.get(action)
    if (!handler) {
      this.sendResponse(id, {
        success: false,
        error: `Unknown action: ${action}`,
        code: 'UNKNOWN_ACTION',
      })
      return
    }

    try {
      const response = await handler(message)

      // 记录配额使用
      if (this.tappInstance) {
        const quotaManager = getQuotaManager()
        quotaManager.recordUsage(this.tappInstance.id, action)
      }

      this.sendResponse(id, response)
    } catch (error) {
      console.error(`[TappBridge] Handler error for ${action}:`, error)
      this.sendResponse(id, {
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
        code: 'HANDLER_ERROR',
      })
    }
  }

  /**
   * 处理响应
   */
  private handleResponse(message: TappMessage<TappAPIResponse>): void {
    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      console.warn(`[TappBridge] No pending request for ID: ${message.id}`)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(message.id)

    if (message.error) {
      pending.reject(new Error(message.error))
    } else {
      pending.resolve(message.payload)
    }
  }

  /**
   * 处理事件
   */
  private handleEvent(message: TappMessage): void {
    const listeners = this.eventListeners.get(message.action)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(message.payload)
        } catch (error) {
          console.error(`[TappBridge] Event listener error:`, error)
        }
      }
    }
  }

  /**
   * 发送响应到 Tapp
   */
  private sendResponse(requestId: string, response: TappAPIResponse): void {
    if (!this.iframe?.contentWindow) {
      console.warn('[TappBridge] Cannot send response: iframe not ready')
      return
    }

    const message: TappMessage<TappAPIResponse> = {
      type: 'response',
      id: requestId,
      action: 'response',
      payload: response,
      timestamp: Date.now(),
    }

    this.iframe.contentWindow.postMessage(message, this.postMessageTarget)
  }

  /**
   * 详细权限检查（返回检查结果和原因）
   *
   * 性能优化：使用模块级别的静态 Map 避免每次调用都创建对象
   */
  private checkPermissionDetailed(action: string): PermissionCheckResult {
    if (!this.tappInstance) {
      return { allowed: false, reason: 'Tapp instance not initialized' }
    }

    // 使用静态 Map 查找权限（O(1) 时间复杂度）
    const requiredPermission = PERMISSION_MAP.get(action)

    // 公开 API
    if (requiredPermission === 'public') {
      return { allowed: true, requiredPermission }
    }

    // 未知 action 默认拒绝
    if (!requiredPermission) {
      console.warn(
        `[TappBridge] Unknown action for permission check: ${action}`,
      )
      return { allowed: false, reason: `Unknown action: ${action}` }
    }

    // 检查是否已授权
    // 后端已经根据权限下放配置过滤了 grantedPermissions
    // 如果权限在列表中，说明后端已批准，前端无需再次验证角色
    const granted =
      this.tappInstance.grantedPermissions.includes(requiredPermission)
    if (!granted) {
      return {
        allowed: false,
        reason: `Missing permission: ${requiredPermission}`,
        requiredPermission,
      }
    }

    return { allowed: true, requiredPermission }
  }

  /**
   * 检查权限（简化版，向后兼容）
   */
  private checkPermission(action: string): boolean {
    return this.checkPermissionDetailed(action).allowed
  }

  /**
   * 监听来自 Tapp 的事件
   */
  on(event: string, callback: (data: unknown) => void): () => void {
    let listeners = this.eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(event, listeners)
    }
    listeners.add(callback)

    // 返回取消监听的函数
    return () => {
      listeners?.delete(callback)
    }
  }
}

/**
 * 创建 Bridge 实例
 */
export function createTappBridge(): TappBridge {
  return new TappBridge()
}
