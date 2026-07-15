/**
 * Tapp Runtime - 运行时主控制器
 * 管理 Tapp 的生命周期、加载和执行
 *
 * 数据存储策略：
 * - 所有数据存储在后端数据库
 * - 内存缓存用于快速访问
 * - 通过 API 同步状态
 *
 * 性能优化：
 * - 请求去重防止并发重复请求
 * - 智能缓存策略减少 API 调用
 * - 懒加载按需获取 Tapp 详情
 */

import type {
  BackgroundRequirement,
  CustomPlatformConfig,
  RegisteredWidget,
  TappInstance,
  TappCodeStructure,
  TappManifest,
  TappPermission,
  TappStatus,
  WidgetRegistration,
} from '../types'
import { TAPP_ICON_TOKENS } from '../constants/icons'
import * as TappApiService from '../services/TappApiService'
import { getResourceLoader } from './sandbox/resourceLoader'
import { TappPermissionController } from './TappPermission'

/** 运行时事件类型 */
type RuntimeEvent =
  | 'tapp:installed'
  | 'tapp:uninstalled'
  | 'tapp:started'
  | 'tapp:stopped'
  | 'tapp:error'
  | 'widget:registered'
  | 'widget:unregistered'
  | 'platform:registered'
  | 'sync:complete'
  | 'background:changed' // 后台需求变化

type RuntimeEventCallback = (data: unknown) => void

/** 请求去重管理器 */
class RequestDeduplicator {
  private pendingRequests: Map<string, Promise<unknown>> = new Map()

  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const pending = this.pendingRequests.get(key)
    if (pending) {
      return pending as Promise<T>
    }

    const promise = factory().finally(() => {
      this.pendingRequests.delete(key)
    })

    this.pendingRequests.set(key, promise)
    return promise
  }
}

/**
 * Tapp Runtime 类
 */
export class TappRuntime {
  private static instance: TappRuntime | null = null

  /** 已安装的 Tapp（内存缓存） */
  private installedTapps: Map<string, TappInstance> = new Map()

  /** 运行中的 Tapp */
  private runningTapps: Set<string> = new Set()

  /** 已注册的小组件（内存缓存） */
  private registeredWidgets: Map<string, RegisteredWidget> = new Map()

  /** 已注册的自定义平台 */
  private registeredPlatforms: Map<
    string,
    CustomPlatformConfig & { tappId: string }
  > = new Map()

  /** 后台运行需求（tappId -> 需求集合） */
  private backgroundRequirements: Map<string, Set<BackgroundRequirement>> =
    new Map()

  /** Manifest 声明的后台需求；与运行时 require/release 分开计源。 */
  private manifestBackgroundRequirements: Map<
    string,
    Set<BackgroundRequirement>
  > = new Map()

  /** 事件监听器 */
  private eventListeners: Map<RuntimeEvent, Set<RuntimeEventCallback>> =
    new Map()

  /** 是否已从后端同步 */
  private synced: boolean = false

  /** 是否正在同步 */
  private syncing: boolean = false

  /** 同步错误（用于 waitForSync 超时或失败处理） */
  private syncError: Error | null = null

  /** 请求去重器 */
  private deduplicator = new RequestDeduplicator()

  /** 缓存 TTL（毫秒） */
  private static readonly CACHE_TTL = {
    tappList: 30 * 1000, // Tapp 列表 30 秒
  }

  /** 上次同步时间 */
  private lastSyncTime: number = 0

  private constructor() {
    // 异步从后端同步状态
    this.syncFromBackend().catch((err) => {
      console.error('[TappRuntime] Initial sync failed:', err)
      this.syncError = err
      // 即使失败也标记为已同步，避免无限等待
      this.synced = true
    })
  }

  /**
   * 获取单例实例
   */
  static getInstance(): TappRuntime {
    if (!TappRuntime.instance) {
      TappRuntime.instance = new TappRuntime()
    }
    return TappRuntime.instance
  }

  /**
   * 从后端同步状态（带请求去重和缓存检查）
   */
  async syncFromBackend(force: boolean = false): Promise<void> {
    // 检查缓存是否仍有效
    if (
      !force &&
      this.synced &&
      Date.now() - this.lastSyncTime < TappRuntime.CACHE_TTL.tappList
    ) {
      return
    }

    // 使用请求去重
    return this.deduplicator.dedupe('sync', async () => {
      if (this.syncing) return
      this.syncing = true

      try {
        const details = await TappApiService.listTappDetails()
        this.installedTapps.clear()
        this.runningTapps.clear()

        for (const detail of details) {
          const instance: TappInstance = {
            id: detail.id,
            manifest: detail.manifest as TappManifest,
            status: detail.status as TappStatus,
            installedAt: detail.installed_at,
            lastRunAt: detail.last_run_at,
            grantedPermissions: detail.granted_permissions as TappPermission[],
            userRole:
              (detail.user_role as 'guest' | 'user' | 'admin') || 'guest',
            isTemporary: detail.is_temporary ?? false,
            isAdminTapp: detail.is_admin_tapp ?? false,
          }
          this.installedTapps.set(detail.id, instance)
          if (detail.status === 'running') {
            this.runningTapps.add(detail.id)
            // 恢复运行态的 Tapp 也要补注册 manifest 后台需求，
            // 否则重载后 headless core 不会被拉起。
            this.registerManifestBackgroundRequirements(instance)
          }
        }

        // 获取后端已注册的小组件
        const backendWidgets = await TappApiService.getAllWidgets()
        this.registeredWidgets.clear()
        for (const widget of backendWidgets) {
          this.registeredWidgets.set(widget.id, widget)
        }

        // 从 manifest 补充注册缺失的 widgets（批量处理优化）
        const widgetsToSync: Array<{
          tappId: string
          widget: RegisteredWidget
        }> = []

        for (const [tappId, instance] of this.installedTapps) {
          const { manifest } = instance
          if (!manifest.widgets || manifest.widgets.length === 0) continue

          for (const widgetDef of manifest.widgets) {
            const fullId = `tapp.${tappId}.${widgetDef.id}`
            if (!this.registeredWidgets.has(fullId)) {
              const widget: RegisteredWidget = {
                id: fullId,
                tappId,
                config: {
                  id: widgetDef.id,
                  name: widgetDef.name,
                  description: widgetDef.description || '',
                  icon:
                    widgetDef.icon || manifest.icon || TAPP_ICON_TOKENS.package,
                  sizes: widgetDef.sizes,
                  defaultSize: widgetDef.defaultSize,
                  category: widgetDef.category || 'utility',
                  settings: widgetDef.settings,
                  refreshPolicy: widgetDef.refreshPolicy,
                },
                instanceCount: 0,
                registeredAt: new Date().toISOString(),
              }
              this.registeredWidgets.set(fullId, widget)
              widgetsToSync.push({ tappId, widget })
            }
          }
        }

        // 批量同步 widgets 到后端（限制并发）
        const WIDGET_SYNC_CONCURRENCY = 3
        for (
          let i = 0;
          i < widgetsToSync.length;
          i += WIDGET_SYNC_CONCURRENCY
        ) {
          const batch = widgetsToSync.slice(i, i + WIDGET_SYNC_CONCURRENCY)
          await Promise.allSettled(
            batch.map(({ tappId, widget }) =>
              TappApiService.registerTappWidget(
                tappId,
                widget.config as WidgetRegistration,
              ).catch(() => {
                /* 静默失败，widget 可在下次同步时重试 */
              }),
            ),
          )
        }

        // 停止、卸载或新 manifest 已移除声明的 Tapp 不应残留后台来源。
        for (const tappId of Array.from(
          this.manifestBackgroundRequirements.keys(),
        )) {
          if (!this.runningTapps.has(tappId)) {
            this.setManifestBackgroundRequirements(tappId, [])
          }
        }

        this.synced = true
        this.lastSyncTime = Date.now()
        this.emit('sync:complete', {
          tapps: details.length,
          widgets: this.registeredWidgets.size,
        })
      } catch (error) {
        console.error('[TappRuntime] Failed to sync from backend:', error)
        throw error
      } finally {
        this.syncing = false
      }
    })
  }

  /**
   * 等待同步完成
   * 包含超时保护（10秒）
   */
  async waitForSync(): Promise<void> {
    if (this.synced) return

    return new Promise((resolve, reject) => {
      // 超时保护：10秒后自动解决
      const timeout = setTimeout(() => {
        console.warn('[TappRuntime] waitForSync timed out after 10s')
        this.synced = true
        resolve()
      }, 10000)

      const unsubscribe = this.on('sync:complete', () => {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      })

      // 检查是否在等待期间已完成同步
      if (this.synced) {
        clearTimeout(timeout)
        unsubscribe()
        if (this.syncError) {
          reject(this.syncError)
        } else {
          resolve()
        }
      }
    })
  }

  /**
   * 安装 Tapp
   */
  async installTapp(
    manifest: TappManifest,
    code: TappCodeStructure,
    _requestedPermissions?: TappPermission[],
  ): Promise<TappInstance> {
    // 验证 Manifest
    const validation =
      TappPermissionController.validateManifestPermissions(manifest)
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`)
    }

    // 检查是否已安装
    if (this.installedTapps.has(manifest.id)) {
      throw new Error(`Tapp ${manifest.id} is already installed`)
    }

    // 通过 API 安装（传递完整的代码结构，包括 CSS 和 HTML 模板）
    const result = await TappApiService.installFromCode(manifest, code)
    const detail = await TappApiService.getTapp(result.id)

    // 将后端返回的 user_role 转换为 UserRole 类型
    const userRole = (detail.user_role as 'guest' | 'user' | 'admin') || 'guest'

    const backendPerms = detail.granted_permissions as TappPermission[]

    const instance: TappInstance = {
      id: detail.id,
      manifest: detail.manifest as TappManifest,
      status: detail.status as TappStatus,
      installedAt: detail.installed_at,
      lastRunAt: detail.last_run_at,
      grantedPermissions: backendPerms,
      userRole,
      isTemporary: detail.is_temporary ?? result.isTemporary ?? false,
      isAdminTapp: detail.is_admin_tapp ?? result.isAdminTapp ?? false,
    }

    // 添加到内存缓存
    this.installedTapps.set(manifest.id, instance)

    // 安装内容可能覆盖同 ID 的资源，确保真实资源加载器不会返回旧页面/widget/core。
    getResourceLoader().clearCache(manifest.id)

    // 从 manifest 预注册 widgets（无需运行 Tapp 代码）
    await this.registerWidgetsFromManifest(instance)

    // 触发事件
    this.emit('tapp:installed', instance)

    return instance
  }

  /**
   * 从 manifest 预注册 widgets
   */
  private async registerWidgetsFromManifest(
    instance: TappInstance,
  ): Promise<void> {
    const { manifest } = instance
    if (!manifest.widgets || manifest.widgets.length === 0) {
      return
    }

    let widgetsRegistered = 0

    for (const widgetDef of manifest.widgets) {
      const fullId = `tapp.${manifest.id}.${widgetDef.id}`

      // 检查是否已注册
      if (this.registeredWidgets.has(fullId)) {
        widgetsRegistered++
        continue
      }

      const widget: RegisteredWidget = {
        id: fullId,
        tappId: manifest.id,
        config: {
          id: widgetDef.id,
          name: widgetDef.name,
          description: widgetDef.description || '',
          icon: widgetDef.icon || manifest.icon || TAPP_ICON_TOKENS.package,
          sizes: widgetDef.sizes,
          defaultSize: widgetDef.defaultSize,
          category: widgetDef.category || 'utility',
          settings: widgetDef.settings,
          refreshPolicy: widgetDef.refreshPolicy,
        },
        instanceCount: 0,
        registeredAt: new Date().toISOString(),
      }

      this.registeredWidgets.set(fullId, widget)
      widgetsRegistered++

      // 同步到后端
      try {
        await TappApiService.registerTappWidget(
          manifest.id,
          widget.config as WidgetRegistration,
        )
      } catch (error) {
        console.error(
          `[TappRuntime] Failed to sync widget ${fullId} to backend:`,
          error,
        )
      }

      this.emit('widget:registered', widget)
    }

    // 如果有 widget 被注册，自动声明 widget 后台需求
    if (widgetsRegistered > 0) {
      this.registerBackgroundRequirement(manifest.id, 'widget')
    }
  }

  /**
   * 卸载 Tapp
   * @param tappId Tapp ID
   * @param options 卸载选项，包含 keepData 可选参数
   */
  async uninstallTapp(
    tappId: string,
    options?: { keepData?: boolean },
  ): Promise<void> {
    const instance = this.installedTapps.get(tappId)
    if (!instance) {
      throw new Error(`Tapp ${tappId} is not installed`)
    }

    // 如果正在运行，先停止
    if (this.runningTapps.has(tappId)) {
      await this.stopTapp(tappId)
    }

    // 调用 API 卸载
    await TappApiService.uninstallTapp(tappId, options)

    // 删除注册的小组件
    for (const [widgetId, widget] of this.registeredWidgets) {
      if (widget.tappId === tappId) {
        this.registeredWidgets.delete(widgetId)
      }
    }

    // 删除注册的平台
    for (const [platformId, platform] of this.registeredPlatforms) {
      if (platform.tappId === tappId) {
        this.registeredPlatforms.delete(platformId)
      }
    }

    // 清除该 Tapp 的全部模式资源缓存
    getResourceLoader().clearCache(tappId)

    // 从列表中移除
    this.installedTapps.delete(tappId)

    // 触发事件
    this.emit('tapp:uninstalled', { id: tappId })
  }

  /**
   * 启动 Tapp
   */
  async startTapp(tappId: string): Promise<void> {
    const instance = this.installedTapps.get(tappId)
    if (!instance) {
      throw new Error(`Tapp ${tappId} is not installed`)
    }

    if (this.runningTapps.has(tappId)) {
      return
    }

    // 调用 API 启动
    await TappApiService.startTapp(tappId)

    // 更新状态
    instance.status = 'running'
    instance.lastRunAt = new Date().toISOString()
    this.runningTapps.add(tappId)

    // 注册 manifest 声明的后台需求（引导 headless core 在后台持续运行）
    this.registerManifestBackgroundRequirements(instance)

    // 触发事件
    this.emit('tapp:started', instance)
  }

  /**
   * 注册 manifest 声明的后台需求。
   * 声明真实需求（非仅 widget）的 Tapp 由此在运行期被 getBackgroundTapps 收入，
   * 从而由 TappBackgroundRunner 拉起 headless core。
   */
  private registerManifestBackgroundRequirements(instance: TappInstance): void {
    this.setManifestBackgroundRequirements(
      instance.id,
      instance.manifest.backgroundRequirements || [],
    )
  }

  private setManifestBackgroundRequirements(
    tappId: string,
    requirements: BackgroundRequirement[],
  ): void {
    const hadRealRequirement = this.hasRealBackgroundRequirement(tappId)
    if (requirements.length > 0) {
      this.manifestBackgroundRequirements.set(tappId, new Set(requirements))
    } else {
      this.manifestBackgroundRequirements.delete(tappId)
    }
    const hasRealRequirement = this.hasRealBackgroundRequirement(tappId)

    if (hadRealRequirement !== hasRealRequirement) {
      this.emit('background:changed', {
        tappId,
        requirements: this.getBackgroundRequirements(tappId),
        hasRequirements: hasRealRequirement,
      })
    }
  }

  private getEffectiveBackgroundRequirements(
    tappId: string,
  ): Set<BackgroundRequirement> {
    return new Set([
      ...(this.manifestBackgroundRequirements.get(tappId) || []),
      ...(this.backgroundRequirements.get(tappId) || []),
    ])
  }

  /**
   * 停止 Tapp
   */
  async stopTapp(tappId: string): Promise<void> {
    const instance = this.installedTapps.get(tappId)
    if (!instance) {
      throw new Error(`Tapp ${tappId} is not installed`)
    }

    if (!this.runningTapps.has(tappId)) {
      return
    }

    // 调用 API 停止
    await TappApiService.stopTapp(tappId)

    // 清除后台需求（停止时重置）
    this.clearBackgroundRequirements(tappId)

    // 更新状态
    instance.status = 'installed'
    this.runningTapps.delete(tappId)

    // 触发事件
    this.emit('tapp:stopped', { id: tappId })
  }

  /**
   * 获取 Tapp 实例
   */
  getTapp(tappId: string): TappInstance | undefined {
    return this.installedTapps.get(tappId)
  }

  /**
   * 获取所有已安装的 Tapp
   */
  getAllTapps(): TappInstance[] {
    return Array.from(this.installedTapps.values())
  }

  /**
   * 清除真实资源加载器中的 core/page/widget 缓存。
   */
  clearCodeCache(tappId?: string): void {
    getResourceLoader().clearCache(tappId)
  }

  /**
   * 检查 Tapp 是否在运行
   */
  isRunning(tappId: string): boolean {
    return this.runningTapps.has(tappId)
  }

  /**
   * 注册小组件
   */
  async registerWidget(
    tappId: string,
    config: RegisteredWidget['config'],
  ): Promise<RegisteredWidget> {
    const instance = this.installedTapps.get(tappId)
    if (!instance) {
      throw new Error(`Tapp ${tappId} is not installed`)
    }

    if (!instance.grantedPermissions.includes('widget:register')) {
      throw new Error('Permission denied: widget:register')
    }

    const fullId = `tapp.${tappId}.${config.id}`

    // 检查是否已存在（避免重复注册）
    const existing = this.registeredWidgets.get(fullId)
    if (existing) {
      return existing
    }

    // 同步到后端
    await TappApiService.registerTappWidget(
      tappId,
      config as WidgetRegistration,
    )

    // 更新内存缓存
    const widget: RegisteredWidget = {
      id: fullId,
      tappId,
      config,
      instanceCount: 0,
      registeredAt: new Date().toISOString(),
    }

    this.registeredWidgets.set(fullId, widget)

    // 触发事件
    this.emit('widget:registered', widget)

    return widget
  }

  /**
   * 注销小组件
   */
  async unregisterWidget(tappId: string, widgetId: string): Promise<void> {
    const fullId = widgetId.startsWith('tapp.')
      ? widgetId
      : `tapp.${tappId}.${widgetId}`
    const widget = this.registeredWidgets.get(fullId)

    if (!widget) {
      throw new Error(`Widget ${fullId} is not registered`)
    }

    if (widget.tappId !== tappId) {
      throw new Error(
        'Permission denied: cannot unregister widget from another Tapp',
      )
    }

    // 同步到后端
    await TappApiService.unregisterTappWidget(tappId, widgetId)

    // 从内存缓存移除
    this.registeredWidgets.delete(fullId)

    // 触发事件
    this.emit('widget:unregistered', { id: fullId })
  }

  /**
   * 获取所有已注册的小组件
   */
  getRegisteredWidgets(): RegisteredWidget[] {
    return Array.from(this.registeredWidgets.values())
  }

  /**
   * 获取指定 Tapp 的小组件
   */
  getWidgetsByTapp(tappId: string): RegisteredWidget[] {
    return Array.from(this.registeredWidgets.values()).filter(
      (w) => w.tappId === tappId,
    )
  }

  /**
   * 注册自定义平台
   */
  registerPlatform(tappId: string, config: CustomPlatformConfig): void {
    const instance = this.installedTapps.get(tappId)
    if (!instance) {
      throw new Error(`Tapp ${tappId} is not installed`)
    }

    if (!instance.grantedPermissions.includes('platform:register')) {
      throw new Error('Permission denied: platform:register')
    }

    const fullId = `tapp.${tappId}.${config.id}`

    if (this.registeredPlatforms.has(fullId)) {
      throw new Error(`Platform ${fullId} is already registered`)
    }

    this.registeredPlatforms.set(fullId, { ...config, tappId })

    // 触发事件
    this.emit('platform:registered', { id: fullId, config })
  }

  /**
   * 获取所有已注册的自定义平台
   */
  getRegisteredPlatforms(): Array<CustomPlatformConfig & { tappId: string }> {
    return Array.from(this.registeredPlatforms.values())
  }

  /**
   * 监听事件
   */
  on(event: RuntimeEvent, callback: RuntimeEventCallback): () => void {
    let listeners = this.eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(event, listeners)
    }
    listeners.add(callback)

    return () => {
      listeners?.delete(callback)
    }
  }

  /**
   * 触发事件
   */
  private emit(event: RuntimeEvent, data: unknown): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[TappRuntime] Event listener error:`, error)
        }
      })
    }
  }

  /**
   * 更新 Tapp 状态
   */
  updateTappStatus(tappId: string, status: TappStatus, error?: string): void {
    const instance = this.installedTapps.get(tappId)
    if (instance) {
      instance.status = status
      instance.error = error

      if (status === 'error') {
        this.emit('tapp:error', { id: tappId, error })
      }
    }
  }

  // ============ 后台运行需求管理 ============

  /**
   * 注册后台运行需求
   * Tapp 在需要后台运行时调用此方法声明需求
   */
  registerBackgroundRequirement(
    tappId: string,
    requirement: BackgroundRequirement,
  ): void {
    let requirements = this.backgroundRequirements.get(tappId)
    if (!requirements) {
      requirements = new Set()
      this.backgroundRequirements.set(tappId, requirements)
    }

    const hadRealRequirement = this.hasRealBackgroundRequirement(tappId)
    requirements.add(requirement)
    const hasRealRequirement = this.hasRealBackgroundRequirement(tappId)

    // Runner 关心的是「真实后台需求」边界，而不是 Set 是否为空。
    // 常见场景是已有 widget，再动态 require('sync')；旧逻辑不会发事件，
    // 导致 headless core 永远不启动。
    if (!hadRealRequirement && hasRealRequirement) {
      this.emit('background:changed', {
        tappId,
        requirements: this.getBackgroundRequirements(tappId),
        hasRequirements: true,
      })
    }
  }

  /**
   * 注销后台运行需求
   */
  unregisterBackgroundRequirement(
    tappId: string,
    requirement: BackgroundRequirement,
  ): void {
    const requirements = this.backgroundRequirements.get(tappId)
    if (!requirements) return

    const hadRealRequirement = this.hasRealBackgroundRequirement(tappId)
    requirements.delete(requirement)
    const hasRealRequirement = this.hasRealBackgroundRequirement(tappId)

    if (requirements.size === 0) {
      this.backgroundRequirements.delete(tappId)
    }

    // 即使仍保留 widget，只要最后一个真实需求被释放，也必须卸载 headless core。
    if (hadRealRequirement && !hasRealRequirement) {
      this.emit('background:changed', {
        tappId,
        requirements: this.getBackgroundRequirements(tappId),
        hasRequirements: false,
      })
    }
  }

  /**
   * 清除 Tapp 的所有后台需求
   */
  clearBackgroundRequirements(tappId: string): void {
    const had = this.hasBackgroundRequirements(tappId)
    this.backgroundRequirements.delete(tappId)
    this.manifestBackgroundRequirements.delete(tappId)

    if (had) {
      this.emit('background:changed', {
        tappId,
        requirements: [],
        hasRequirements: false,
      })
    }
  }

  /**
   * 获取 Tapp 的后台运行需求
   */
  getBackgroundRequirements(tappId: string): BackgroundRequirement[] {
    return Array.from(this.getEffectiveBackgroundRequirements(tappId))
  }

  /**
   * 检查 Tapp 是否有后台运行需求
   */
  hasBackgroundRequirements(tappId: string): boolean {
    return this.getEffectiveBackgroundRequirements(tappId).size > 0
  }

  /**
   * 检查 Tapp 是否有「真实」后台运行需求。
   *
   * 'widget' 需求是安装时对每个带主页 widget 的 Tapp 自动声明的（见 registerWidgets），
   * 它只表示「有 widget 在主页」——widget 本身由 TappWidget 独立渲染，
   * 不需要再额外拉起一个隐藏的后台实例。因此后台运行判定必须排除「仅 widget」的情况，
   * 否则每个 widget Tapp 都会白白多跑一个隐藏沙箱。
   */
  hasRealBackgroundRequirement(tappId: string): boolean {
    const requirements = this.getEffectiveBackgroundRequirements(tappId)
    for (const req of requirements) {
      if (req !== 'widget') return true
    }
    return false
  }

  /**
   * 检查 Tapp 是否有特定的后台运行需求
   */
  hasBackgroundRequirement(
    tappId: string,
    requirement: BackgroundRequirement,
  ): boolean {
    return this.getEffectiveBackgroundRequirements(tappId).has(requirement)
  }

  /**
   * 获取所有需要后台运行的 Tapp（有任何后台需求的）
   */
  getTappsWithBackgroundRequirements(): Array<{
    tappId: string
    requirements: BackgroundRequirement[]
  }> {
    const result: Array<{
      tappId: string
      requirements: BackgroundRequirement[]
    }> = []
    const tappIds = new Set([
      ...this.backgroundRequirements.keys(),
      ...this.manifestBackgroundRequirements.keys(),
    ])
    for (const tappId of tappIds) {
      const requirements = this.getEffectiveBackgroundRequirements(tappId)
      if (requirements.size > 0) {
        result.push({ tappId, requirements: Array.from(requirements) })
      }
    }
    return result
  }

  /**
   * 检查 Tapp 是否应该在后台运行
   * 条件：Tapp 正在运行 + 有后台需求
   */
  shouldRunInBackground(tappId: string): boolean {
    return this.isRunning(tappId) && this.hasRealBackgroundRequirement(tappId)
  }

  /**
   * 获取所有应该在后台运行的 Tapp
   */
  getBackgroundTapps(): TappInstance[] {
    const result: TappInstance[] = []
    for (const tappId of this.runningTapps) {
      // 仅当存在「真实」后台需求（非仅 widget）时才后台运行，
      // 避免每个 widget Tapp 白白多跑一个隐藏沙箱。
      if (this.hasRealBackgroundRequirement(tappId)) {
        const instance = this.installedTapps.get(tappId)
        if (instance) {
          result.push(instance)
        }
      }
    }
    return result
  }
}

/**
 * 获取 Runtime 实例
 */
export function getTappRuntime(): TappRuntime {
  return TappRuntime.getInstance()
}

export default TappRuntime
