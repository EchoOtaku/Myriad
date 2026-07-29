/**
 * 网站元数据管理工具
 * 统一管理网站标题、描述和图标
 */

import { API_URL } from '../config'

export interface SiteMetadata {
  site_title: string
  site_description: string
  site_favicon: string
}

// 默认元数据
const DEFAULT_METADATA: SiteMetadata = {
  site_title: 'Myriad - A myriad of lights, in one place.',
  site_description: 'A myriad of lights, in one place.',
  site_favicon: '/favicon.webp',
}

// 缓存键名
const CACHE_KEY = 'site_metadata'
const CACHE_TIME_KEY = 'site_metadata_time'
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

/**
 * 从缓存中获取元数据
 */
function getCachedMetadata(): SiteMetadata | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    const cacheTime = localStorage.getItem(CACHE_TIME_KEY)

    if (cached && cacheTime) {
      const age = Date.now() - Number.parseInt(cacheTime)
      if (age < CACHE_DURATION) {
        return JSON.parse(cached)
      }
    }
  } catch (error) {
    console.warn('[元数据] 读取缓存失败:', error)
  }
  return null
}

/**
 * 缓存元数据
 */
function cacheMetadata(metadata: SiteMetadata): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(metadata))
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
  } catch (error) {
    console.warn('[元数据] 写入缓存失败:', error)
  }
}

/**
 * 从后端获取元数据
 */
async function fetchMetadata(): Promise<SiteMetadata | null> {
  try {
    // 如果 API_URL 为空，使用相对路径（生产环境）
    const apiUrl = API_URL || ''
    const url = apiUrl
      ? `${apiUrl}/api/config/metadata`
      : '/api/config/metadata'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000) // 3秒超时

    const response = await fetch(url, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      return {
        site_title: data.site_title || DEFAULT_METADATA.site_title,
        site_description:
          data.site_description || DEFAULT_METADATA.site_description,
        site_favicon: data.site_favicon || DEFAULT_METADATA.site_favicon,
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.warn('[元数据] 获取失败:', error)
    }
  }

  return null
}

/**
 * 更新页面标题（防止闪烁）
 */
function updateTitle(title: string): void {
  if (document.title !== title) {
    document.title = title
  }
}

/**
 * 更新页面描述
 */
function updateDescription(description: string): void {
  const metaDesc = document.querySelector('meta[name="description"]')
  if (metaDesc && metaDesc.getAttribute('content') !== description) {
    metaDesc.setAttribute('content', description)
  }
}

/**
 * 从路径或 data URL 推断 favicon MIME type
 */
function inferFaviconType(faviconUrl: string): string | undefined {
  if (faviconUrl.startsWith('data:image/')) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+)/.exec(faviconUrl)
    return match?.[1]
  }
  if (faviconUrl.endsWith('.svg') || faviconUrl.includes('.svg?')) {
    return 'image/svg+xml'
  }
  if (faviconUrl.endsWith('.webp') || faviconUrl.includes('.webp?')) {
    return 'image/webp'
  }
  if (faviconUrl.endsWith('.png') || faviconUrl.includes('.png?')) {
    return 'image/png'
  }
  if (faviconUrl.endsWith('.ico') || faviconUrl.includes('.ico?')) {
    return 'image/x-icon'
  }
  if (
    faviconUrl.endsWith('.jpg') ||
    faviconUrl.endsWith('.jpeg') ||
    faviconUrl.includes('.jpg?') ||
    faviconUrl.includes('.jpeg?')
  ) {
    return 'image/jpeg'
  }
  if (faviconUrl.endsWith('.gif') || faviconUrl.includes('.gif?')) {
    return 'image/gif'
  }
  return undefined
}

/**
 * 更新网站图标（支持站外链接、相对路径、data URL 本地上传）
 */
function updateFavicon(faviconUrl: string): void {
  if (!faviconUrl) return

  let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

  if (!favicon) {
    favicon = document.createElement('link')
    favicon.rel = 'icon'
    document.head.appendChild(favicon)
  }

  const isDataUrl = faviconUrl.startsWith('data:')
  const isExternalUrl =
    faviconUrl.startsWith('http://') || faviconUrl.startsWith('https://')

  const fullUrl = isDataUrl || isExternalUrl
    ? faviconUrl
    : new URL(faviconUrl, window.location.origin).href

  // data: 与较长 base64 用字符串比较；避免浏览器规范化差异时重复写
  if (favicon.getAttribute('href') === fullUrl || favicon.href === fullUrl) {
    return
  }

  if (isDataUrl) {
    favicon.removeAttribute('crossorigin')
  } else if (isExternalUrl) {
    favicon.crossOrigin = 'anonymous'
  } else {
    favicon.removeAttribute('crossorigin')
  }

  const mime = inferFaviconType(faviconUrl)
  if (mime) {
    favicon.type = mime
  } else if (isExternalUrl) {
    favicon.type = 'image/webp'
  } else {
    favicon.removeAttribute('type')
  }

  favicon.href = fullUrl
}

/**
 * 应用元数据到页面
 */
function applyMetadata(metadata: SiteMetadata): void {
  updateTitle(metadata.site_title)
  updateDescription(metadata.site_description)
  updateFavicon(metadata.site_favicon)
}

// 标记是否已经初始化（防止重复初始化）
let isInitialized = false
let initPromise: Promise<void> | null = null

/**
 * 初始化网站元数据（在页面加载时立即调用）
 * 策略：
 * 1. 优先使用缓存（避免闪烁）
 * 2. 异步获取后端数据库数据
 * 3. 如果都失败，使用默认值
 *
 * 注意：数据库数据优先级高于环境变量
 */
export async function initSiteMetadata(): Promise<void> {
  // 如果已经在初始化中，返回现有的 Promise
  if (initPromise) {
    return initPromise
  }

  // 如果已经初始化过，直接返回
  if (isInitialized) {
    return
  }

  initPromise = (async () => {
    // 1. 先尝试使用缓存（立即应用，避免闪烁）
    const cached = getCachedMetadata()
    if (cached) {
      applyMetadata(cached)
    }

    // 2. 异步获取后端数据库的最新数据（数据库优先）
    const fetched = await fetchMetadata()
    if (fetched) {
      cacheMetadata(fetched)
      // 只有当数据真的变化时才更新（减少 DOM 操作）
      if (!cached || JSON.stringify(cached) !== JSON.stringify(fetched)) {
        applyMetadata(fetched)
      }
    } else if (!cached) {
      // 3. 如果缓存和数据库都失败，使用默认值
      applyMetadata(DEFAULT_METADATA)
    }

    isInitialized = true
    initPromise = null
  })()

  return initPromise
}

/**
 * 强制刷新元数据（清除缓存并重新从数据库获取）
 */
export async function refreshSiteMetadata(): Promise<void> {
  localStorage.removeItem(CACHE_KEY)
  localStorage.removeItem(CACHE_TIME_KEY)
  isInitialized = false
  initPromise = null
  await initSiteMetadata()
}

/**
 * 获取当前元数据
 */
export function getCurrentMetadata(): SiteMetadata {
  return getCachedMetadata() || DEFAULT_METADATA
}
