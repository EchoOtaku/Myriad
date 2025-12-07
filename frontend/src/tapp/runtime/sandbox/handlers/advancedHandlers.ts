/**
 * 高级功能处理器
 * 
 * Media, Component, Shortcut, Event, Background, Animation, DynamicContent
 */

import type { TappBridge } from '../../TappBridge'
import type { TappInstance } from '../../../types'
import type { AnimationConfigRef } from '../types'
import { getTappRuntime } from '../../TappRuntime'
import { getDynamicContentProvider, type DynamicContentItem } from '../../../../services/DynamicContentProvider'
import * as TappApiService from '../../../services/TappApiService'

/**
 * 验证 URL 是否安全（防止 SSRF 攻击）
 * 
 * 禁止的目标：
 * - 本地地址 (localhost, 127.0.0.1, ::1)
 * - 私有网络 (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
 * - 链接本地地址 (169.254.x.x)
 * - 元数据服务 (169.254.169.254 - AWS/GCP 等)
 * - 非 HTTP/HTTPS 协议
 */
function validateFetchUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url)
    
    // 只允许 http 和 https 协议
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, reason: 'Only HTTP/HTTPS protocols are allowed' }
    }
    
    const hostname = parsed.hostname.toLowerCase()
    
    // 禁止本地地址
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return { valid: false, reason: 'Localhost access is not allowed' }
    }
    
    // 禁止 .local 域名
    if (hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
      return { valid: false, reason: 'Local domain access is not allowed' }
    }
    
    // 检查 IP 地址
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4Match) {
      const [, a, b, c] = ipv4Match.map(Number)
      
      // 私有网络
      if (a === 10) {
        return { valid: false, reason: 'Private network access (10.x.x.x) is not allowed' }
      }
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, reason: 'Private network access (172.16-31.x.x) is not allowed' }
      }
      if (a === 192 && b === 168) {
        return { valid: false, reason: 'Private network access (192.168.x.x) is not allowed' }
      }
      
      // 链接本地
      if (a === 169 && b === 254) {
        return { valid: false, reason: 'Link-local address access is not allowed' }
      }
      
      // 回环地址
      if (a === 127) {
        return { valid: false, reason: 'Loopback address access is not allowed' }
      }
      
      // 0.0.0.0
      if (a === 0) {
        return { valid: false, reason: 'Invalid IP address' }
      }
    }
    
    return { valid: true }
  } catch {
    return { valid: false, reason: 'Invalid URL format' }
  }
}

/**
 * 注册 Media 处理器
 */
export function registerMediaHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance
): void {
  bridge.registerHandler('media.control', async (message) => {
    const [params] = (message.payload as { args: unknown[] }).args || []
    const { action, value } = (params || {}) as { action?: string; value?: unknown }
    try {
      const result = await TappApiService.mediaControl({ tappId: tappInstance.id, action: (action || 'play') as 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume' | 'mute' | 'unmute' | 'mode', value })
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('media.getStatus', async () => {
    const globalState = (window as { __musicPlayerState?: Record<string, unknown> }).__musicPlayerState
    if (globalState) {
      const currentSong = globalState.currentSong as Record<string, unknown> | null
      return {
        success: true,
        data: {
          isPlaying: globalState.isPlaying || false,
          isPaused: !globalState.isPlaying && currentSong !== null,
          currentTrack: currentSong ? {
            id: currentSong.id || '',
            title: currentSong.name || currentSong.title || '',
            artist: currentSong.artist || '',
            album: currentSong.album || '',
            cover: currentSong.cover || '',
            duration: currentSong.duration || 0,
            source: currentSong.source || 'unknown'
          } : null,
          progress: { current: 0, duration: (currentSong?.duration as number) || 0, percentage: 0 },
          playlist: globalState.playlist ? { id: 'current', name: 'Current Playlist', tracks: (globalState.playlistLength as number) || (globalState.playlist as unknown[]).length || 0 } : null,
          mode: 'sequence',
          volume: 80,
          muted: false
        }
      }
    }
    return { success: true, data: { isPlaying: false, isPaused: false, currentTrack: null, progress: { current: 0, duration: 0, percentage: 0 }, playlist: null, mode: 'sequence', volume: 80, muted: false } }
  })

  bridge.registerHandler('media.getPlaylist', async () => {
    const globalState = (window as { __musicPlayerState?: Record<string, unknown> }).__musicPlayerState
    if (globalState?.playlist) {
      const playlist = globalState.playlist as Array<Record<string, unknown>>
      const tracks = playlist.map((song, index) => ({
        id: song.id || String(index),
        index,
        title: song.name || song.title || 'Unknown',
        artist: song.artist || 'Unknown',
        album: song.album || '',
        cover: song.cover || '',
        duration: song.duration || 0,
        source: song.source || 'unknown',
        isCurrent: index === globalState.currentSongIndex
      }))
      return { success: true, data: { tracks, currentIndex: globalState.currentSongIndex || 0, total: tracks.length } }
    }
    return { success: true, data: { tracks: [], currentIndex: 0, total: 0 } }
  })

  bridge.registerHandler('media.playTrack', async (message) => {
    const [params] = (message.payload as { args: unknown[] }).args || []
    const { trackId, trackIndex } = (params || {}) as { trackId?: string; trackIndex?: number }
    const globalState = (window as { __musicPlayerState?: Record<string, unknown> }).__musicPlayerState
    if (globalState?.playlist) {
      const playlist = globalState.playlist as Array<Record<string, unknown>>
      let targetSong: Record<string, unknown> | null = null
      let targetIndex = -1
      if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < playlist.length) {
        targetSong = playlist[trackIndex]
        targetIndex = trackIndex
      } else if (trackId) {
        targetIndex = playlist.findIndex((s) => s.id === trackId)
        if (targetIndex >= 0) targetSong = playlist[targetIndex]
      }
      if (targetSong) {
        window.dispatchEvent(new CustomEvent('play-song-at-index', { detail: { index: targetIndex, song: targetSong } }))
        return { success: true, data: { index: targetIndex, track: { id: targetSong.id, title: targetSong.name || targetSong.title, artist: targetSong.artist, duration: targetSong.duration, cover: targetSong.cover } } }
      }
    }
    return { success: false, error: 'Track not found' }
  })
}

/**
 * 注册 Background 处理器
 */
export function registerBackgroundHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance
): void {
  const validRequirements = ['widget', 'media', 'sync', 'notification', 'scheduler', 'event-listener', 'realtime']

  bridge.registerHandler('background.require', async (message) => {
    const [requirement, reason] = (message.payload as { args: unknown[] }).args || []
    if (!requirement) return { success: false, error: 'Requirement required' }
    if (!validRequirements.includes(requirement as string)) {
      return { success: false, error: `Invalid requirement. Valid: ${validRequirements.join(', ')}` }
    }
    try {
      const runtime = getTappRuntime()
      runtime.registerBackgroundRequirement(tappInstance.id, requirement as 'widget' | 'notification' | 'sync' | 'media' | 'scheduler' | 'event-listener' | 'realtime')
      console.log(`[Sandbox] ${tappInstance.id} background: ${requirement}${reason ? ` (${reason})` : ''}`)
      return { success: true, data: { requirement, registered: true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('background.release', async (message) => {
    const [requirement] = (message.payload as { args: unknown[] }).args || []
    if (!requirement) return { success: false, error: 'Requirement required' }
    try {
      const runtime = getTappRuntime()
      runtime.unregisterBackgroundRequirement(tappInstance.id, requirement as 'widget' | 'notification' | 'sync' | 'media' | 'scheduler' | 'event-listener' | 'realtime')
      return { success: true, data: { requirement, released: true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('background.list', async () => {
    try {
      const runtime = getTappRuntime()
      const requirements = runtime.getBackgroundRequirements(tappInstance.id)
      return { success: true, data: requirements }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('background.has', async (message) => {
    const [requirement] = (message.payload as { args: unknown[] }).args || []
    if (!requirement) return { success: false, error: 'Requirement required' }
    try {
      const runtime = getTappRuntime()
      const requirements = runtime.getBackgroundRequirements(tappInstance.id)
      return { success: true, data: requirements.includes(requirement as 'widget' | 'notification' | 'sync' | 'media' | 'scheduler' | 'event-listener' | 'realtime') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })
}

/**
 * 注册 Animation 处理器
 */
export function registerAnimationHandlers(
  bridge: TappBridge,
  animationConfigRef?: React.RefObject<AnimationConfigRef>
): void {
  bridge.registerHandler('animation.getLevel', async () => {
    return { success: true, data: animationConfigRef?.current?.level || 'standard' }
  })

  bridge.registerHandler('animation.shouldAnimate', async () => {
    return { success: true, data: (animationConfigRef?.current?.level || 'standard') !== 'none' }
  })

  bridge.registerHandler('animation.getConfig', async () => {
    const cfg = animationConfigRef?.current
    return {
      success: true,
      data: cfg || { level: 'standard', loop: true, spring: { tension: 280, friction: 20 }, durationScale: 1 }
    }
  })

  bridge.registerHandler('animation.getStaggerDelay', async (message) => {
    const [index, baseDelay = 50] = (message.payload as { args: unknown[] }).args || []
    if (typeof index !== 'number') return { success: false, error: 'Index required' }
    const cfg = animationConfigRef?.current
    if (!cfg) return { success: true, data: index * (baseDelay as number) }
    let delay = baseDelay as number
    if (cfg.level === 'none') delay = 0
    else if (cfg.level === 'light') delay = (baseDelay as number) * 0.5
    return { success: true, data: index * delay * cfg.durationScale }
  })
}

/**
 * 注册 DynamicContent 处理器
 */
export function registerDynamicContentHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance
): void {
  bridge.registerHandler('dynamicContent.set', async (message) => {
    const [config] = (message.payload as { args: unknown[] }).args || []
    const { icon, text, subtext, priority, showSubtext, expiresAt, i18n } = (config || {}) as {
      icon?: string; text?: string; subtext?: string; priority?: number; showSubtext?: boolean; expiresAt?: number; i18n?: unknown
    }
    if (!icon || !text) return { success: false, error: 'Icon and text required' }
    try {
      const provider = getDynamicContentProvider()
      const content: Omit<DynamicContentItem, 'sourceTappId'> = {
        type: `tapp-${tappInstance.id}`,
        icon,
        text,
        subtext,
        priority: priority ?? -1,
        showSubtext: showSubtext ?? !!subtext,
        onClick: 'expand',
        expiresAt,
        i18n: i18n as DynamicContentItem['i18n'],
      }
      provider.setTappContent(tappInstance.id, content)
      getTappRuntime().registerBackgroundRequirement(tappInstance.id, 'notification')
      return { success: true, data: { registered: true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('dynamicContent.update', async (message) => {
    const [updates] = (message.payload as { args: unknown[] }).args || []
    if (!updates) return { success: false, error: 'Updates required' }
    try {
      const provider = getDynamicContentProvider()
      const existing = provider.getTappContent(tappInstance.id)
      if (!existing) return { success: false, error: 'No content found. Use set first.' }
      provider.setTappContent(tappInstance.id, { ...existing, ...(updates as Partial<DynamicContentItem>), type: existing.type })
      return { success: true, data: { updated: true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('dynamicContent.remove', async () => {
    try {
      const provider = getDynamicContentProvider()
      provider.removeTappContent(tappInstance.id)
      getTappRuntime().unregisterBackgroundRequirement(tappInstance.id, 'notification')
      return { success: true, data: { removed: true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('dynamicContent.get', async () => {
    try {
      const provider = getDynamicContentProvider()
      const content = provider.getTappContent(tappInstance.id)
      return { success: true, data: content || null }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })
}

/**
 * 注册 Component/Shortcut/Event 处理器
 */
export function registerAdvancedHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance
): void {
  // Component handlers
  bridge.registerHandler('component.registerTheme', async (message) => {
    const [config] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.registerComponent(tappInstance.id, 'theme', config as TappApiService.ComponentConfig)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('component.registerAgent', async (message) => {
    const [config] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.registerComponent(tappInstance.id, 'agent', config as TappApiService.ComponentConfig)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('component.unregister', async (message) => {
    const [type, id] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.unregisterComponent(tappInstance.id, type as TappApiService.ComponentType, id as string)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('component.list', async (message) => {
    const [type] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.listComponents(tappInstance.id, type as TappApiService.ComponentType | undefined)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // Shortcut handlers
  bridge.registerHandler('shortcut.register', async (message) => {
    const [config] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.registerShortcut(tappInstance.id, config as TappApiService.ShortcutConfig)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('shortcut.unregister', async (message) => {
    const [id] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.unregisterShortcut(tappInstance.id, id as string)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('shortcut.list', async () => {
    try {
      const result = await TappApiService.listShortcuts(tappInstance.id)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // Event handlers
  bridge.registerHandler('event.publish', async (message) => {
    const [eventType, payload, target] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.publishEvent({ tappId: tappInstance.id, eventType: eventType as string, payload, target: target as string })
      bridge.emit(`tapp:${eventType}`, { source: tappInstance.id, payload })
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('event.subscribe', async (message) => {
    const [eventTypes] = (message.payload as { args: unknown[] }).args || []
    try {
      const result = await TappApiService.updateEventSubscriptions(tappInstance.id, eventTypes as string[])
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('event.unsubscribe', async (message) => {
    const [eventTypes] = (message.payload as { args: unknown[] }).args || []
    try {
      const current = await TappApiService.getEventSubscriptions(tappInstance.id)
      const updated = ((current.subscriptions || []) as string[]).filter((t) => !(eventTypes as string[]).includes(t))
      const result = await TappApiService.updateEventSubscriptions(tappInstance.id, updated)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })
}

/**
 * 注册 Context/Fetch/Data 处理器
 */
export function registerContextHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance
): void {
  bridge.registerHandler('context.getApp', async () => {
    try { return { success: true, data: await TappApiService.getContextApp() } }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed' } }
  })

  bridge.registerHandler('context.getUser', async () => {
    try { return { success: true, data: await TappApiService.getContextUser() } }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed' } }
  })

  bridge.registerHandler('context.getPlayer', async () => {
    try { return { success: true, data: await TappApiService.getContextPlayer() } }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed' } }
  })

  bridge.registerHandler('context.getNavigation', async () => {
    try { return { success: true, data: await TappApiService.getContextNavigation() } }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed' } }
  })

  bridge.registerHandler('context.getSystem', async () => {
    try { return { success: true, data: await TappApiService.getContextSystem() } }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed' } }
  })

  bridge.registerHandler('fetch.proxy', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    const req = request as { url?: string; method?: string; headers?: Record<string, string>; body?: unknown; timeout?: number }
    if (!req?.url) return { success: false, error: 'URL required' }
    
    // 🔒 安全校验：验证 URL 防止 SSRF 攻击
    const urlValidation = validateFetchUrl(req.url)
    if (!urlValidation.valid) {
      return { success: false, error: `Invalid URL: ${urlValidation.reason}` }
    }
    
    // 🔒 安全校验：限制请求超时（最大 30 秒）
    const timeout = Math.min(req.timeout || 10000, 30000)
    
    try {
      const response = await TappApiService.fetchProxy({ 
        tappId: tappInstance.id, 
        url: req.url, 
        method: req.method, 
        headers: req.headers, 
        body: req.body, 
        timeout 
      })
      return { success: true, data: response }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('data.transform', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    const req = request as { input?: unknown; pipeline?: unknown; output?: unknown }
    if (!req?.input || !req?.pipeline) return { success: false, error: 'Input and pipeline required' }
    try {
      const response = await TappApiService.dataTransform({ tappId: tappInstance.id, input: req.input as TappApiService.DataInput, pipeline: req.pipeline as TappApiService.ProcessStep[], output: req.output as TappApiService.DataOutput | undefined })
      return { success: true, data: response }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })
}
