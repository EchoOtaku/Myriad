/**
 * 导航岛组件 - Apple Dynamic Island 风格
 *
 * 职责：
 * - 渲染一级导航（主页、资料库、Brew、报告、Tapp）
 * - 根据 NavigationContext 渲染页面声明的二级导航
 * - 处理一二级导航的切换动画
 */

import { SiAppstore } from '@lib/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '../contexts/I18nContext'
import { useNavigation } from '../contexts/NavigationContext'

interface ModeMetrics {
  height?: number
  width?: number
}

// 常量
const ITEM_HEIGHT = 40
const MIN_ISLAND_HEIGHT = 48
const MAX_ISLAND_HEIGHT = 800
const PRIMARY_NAV_COUNT = 5

// ─── 提取 SVG 图标为模块级常量，避免每次渲染重新创建 JSX ───
const IconBack = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)
const IconHome = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
)
const IconLibrary = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
)
const IconBrew = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" />
  </svg>
)
const IconReports = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
  </svg>
)

/**
 * 设备感知的动画时序配置
 * 桌面端：从容优雅，给用户充分感知动画层次
 * 移动端：敏捷紧凑，触控反馈要快
 */
function getAnimationTiming() {
  const isMobile = window.innerWidth < 768
  return {
    exitStagger: isMobile ? 25 : 40,
    exitDuration: isMobile ? 240 : 380,
    enterStagger: isMobile ? 30 : 50,
    enterDelay: isMobile ? 40 : 70,
  }
}

const getVariant = () => (window.innerWidth >= 768 ? 'desktop' : 'mobile')
const isDesktop = () => window.innerWidth >= 768

function validateHeight(height: number | null | undefined): number | null {
  if (height === null || height === undefined || !Number.isFinite(height))
    return null
  return Math.round(Math.min(MAX_ISLAND_HEIGHT, Math.max(MIN_ISLAND_HEIGHT, height)))
}

function safeSetHeight(island: HTMLElement, height: number | null | undefined): boolean {
  const validHeight = validateHeight(height)
  if (validHeight !== null) {
    island.style.height = `${validHeight}px`
    return true
  }
  return false
}

/** 两帧延迟执行 - 确保浏览器完成布局后回调 */
function doubleRaf(callback: () => void): () => void {
  let id2: number
  const id1 = requestAnimationFrame(() => {
    id2 = requestAnimationFrame(callback)
  })
  return () => {
    cancelAnimationFrame(id1)
    cancelAnimationFrame(id2)
  }
}

/** 计算 padding（带安全检查），结果可缓存 */
function getPaddingVertical(island: HTMLElement | null): number {
  if (!island)
    return 0
  try {
    const styles = getComputedStyle(island)
    const paddingTop = Number.parseFloat(styles.paddingTop)
    const paddingBottom = Number.parseFloat(styles.paddingBottom)
    const result = (Number.isFinite(paddingTop) ? paddingTop : 0)
      + (Number.isFinite(paddingBottom) ? paddingBottom : 0)
    return Number.isFinite(result) ? result : 0
  }
  catch {
    return 0
  }
}

/**
 * 导航岛 Tooltip - 使用 Portal 渲染到 body，避免被 overflow:hidden 裁剪
 * 使用事件委托：pointerenter/pointerleave 替代 mousemove，减少事件触发频率
 */
function NavIslandTooltip({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [tooltip, setTooltip] = useState<{ text: string, rect: DOMRect } | null>(null)
  const [visible, setVisible] = useState(false)
  const showTimerRef = useRef<number>(0)
  const hideTimerRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container)
      return

    const show = (target: HTMLElement) => {
      const text = target.getAttribute('data-tooltip')
      if (!text)
        return
      clearTimeout(hideTimerRef.current)
      clearTimeout(showTimerRef.current)
      setTooltip({ text, rect: target.getBoundingClientRect() })
      showTimerRef.current = window.setTimeout(() => setVisible(true), 120)
    }

    const hide = () => {
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        setTimeout(() => setTooltip(null), 120)
      }, 60)
    }

    // 事件委托：在容器上监听 pointerenter/pointerleave，通过冒泡匹配 [data-tooltip]
    const handlePointerEnter = (e: PointerEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null
      if (target && container.contains(target)) {
        show(target)
      }
    }

    const handlePointerLeave = (e: PointerEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null
      if (target) {
        hide()
      }
    }

    const handleLeaveContainer = () => hide()

    container.addEventListener('pointerenter', handlePointerEnter, true)
    container.addEventListener('pointerleave', handlePointerLeave, true)
    container.addEventListener('mouseleave', handleLeaveContainer)
    return () => {
      container.removeEventListener('pointerenter', handlePointerEnter, true)
      container.removeEventListener('pointerleave', handlePointerLeave, true)
      container.removeEventListener('mouseleave', handleLeaveContainer)
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
    }
  }, [containerRef])

  if (!tooltip)
    return null

  const mobile = !isDesktop()
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: 1,
    padding: '6px 10px',
    borderRadius: '8px',
    background: 'var(--bg-secondary)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    boxShadow: '0 2px 8px var(--shadow-color)',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.12s ease',
    ...(mobile
      ? {
          left: tooltip.rect.left + tooltip.rect.width / 2,
          top: tooltip.rect.top - 10,
          transform: 'translate(-50%, -100%)',
        }
      : {
          left: tooltip.rect.right + 10,
          top: tooltip.rect.top + tooltip.rect.height / 2,
          transform: 'translateY(-50%)',
        }),
  }

  return createPortal(
    <div style={style}>{tooltip.text}</div>,
    document.body,
  )
}

export function NavigationIsland() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const {
    secondaryNav,
    isAnimating,
    setIsAnimating,
    renderModeRef,
    immersiveMode,
  } = useNavigation()

  const navContentRef = useRef<HTMLDivElement>(null)
  const navContainerRef = useRef<HTMLElement>(null)
  const lastModeRef = useRef<'normal' | 'secondary'>('normal')
  const islandMetricsRef = useRef<Record<string, ModeMetrics>>({})
  const prevPathnameRef = useRef(location.pathname)
  // 缓存 padding 值，避免每次动画都触发 getComputedStyle
  const cachedPaddingRef = useRef<number | null>(null)

  // 当前是否显示二级导航
  const showSecondary = secondaryNav?.expanded && secondaryNav.routePath === location.pathname

  // 动画期间锁定的渲染模式
  const currentRenderMode = isAnimating ? renderModeRef.current : (showSecondary ? 'secondary' : 'normal')

  // 记录是否已自动展开过（避免重复触发）
  const autoExpandedRef = useRef<string | null>(null)

  // 获取缓存的 padding，仅首次调用时触发 getComputedStyle
  const getCachedPadding = useCallback((island: HTMLElement): number => {
    if (cachedPaddingRef.current !== null)
      return cachedPaddingRef.current
    const padding = getPaddingVertical(island)
    cachedPaddingRef.current = padding
    return padding
  }, [])

  const buildMetricsKey = useCallback((mode: 'normal' | 'secondary', variant: 'desktop' | 'mobile') =>
    `${mode}-${variant}-${location.pathname}`, [location.pathname])

  const updateModeMetrics = useCallback((mode: 'normal' | 'secondary', metrics: ModeMetrics) => {
    const key = buildMetricsKey(mode, getVariant())
    islandMetricsRef.current[key] = { ...islandMetricsRef.current[key], ...metrics }
  }, [buildMetricsKey])

  const applyModeMetrics = useCallback((mode: 'normal' | 'secondary', island: HTMLElement) => {
    if (!island)
      return

    const key = buildMetricsKey(mode, getVariant())
    const metrics = islandMetricsRef.current[key]

    if (isDesktop()) {
      if (metrics?.height) {
        if (!safeSetHeight(island, metrics.height)) {
          const content = island.querySelector('.nav-island-content') as HTMLElement
          if (content) {
            const fallbackHeight = content.scrollHeight + getCachedPadding(island)
            safeSetHeight(island, fallbackHeight)
          }
        }
      }
      island.style.removeProperty('width')
    }
    else {
      island.style.removeProperty('width')
      island.style.removeProperty('height')
    }
  }, [buildMetricsKey, getCachedPadding])

  // 路由切换时重置状态
  useEffect(() => {
    if (prevPathnameRef.current !== location.pathname) {
      prevPathnameRef.current = location.pathname
      // 路由切换时重置为正常模式
      lastModeRef.current = 'normal'
      renderModeRef.current = 'normal'
      setIsAnimating(false)
      // 重置自动展开标记，允许新页面自动展开
      autoExpandedRef.current = null
    }
  }, [location.pathname, renderModeRef, setIsAnimating])

  // 安全机制：防止 isAnimating 卡死，超时强制重置
  useEffect(() => {
    if (!isAnimating)
      return
    const safetyTimer = setTimeout(() => {
      setIsAnimating(false)
    }, 2000)
    return () => clearTimeout(safetyTimer)
  }, [isAnimating, setIsAnimating])

  // 自动展开二级导航：当进入有二级导航的页面时
  useEffect(() => {
    // 条件：有二级导航配置、当前在对应路由、尚未展开、未在动画中、还未自动展开过
    if (
      secondaryNav
      && secondaryNav.routePath === location.pathname
      && !secondaryNav.expanded
      && !isAnimating
      && autoExpandedRef.current !== location.pathname
    ) {
      // 标记已自动展开，避免重复触发
      autoExpandedRef.current = location.pathname
      // 延迟触发展开，等待页面初始化完成
      const timer = setTimeout(() => {
        // 触发展开事件，让页面自己处理
        window.dispatchEvent(new CustomEvent('nav-expand-secondary', { detail: { path: location.pathname } }))
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [secondaryNav, location.pathname, isAnimating])

  /**
   * 统一模式切换动画处理
   * @param targetMode - 目标模式（'secondary' = 展开, 'normal' = 收起）
   */
  const handleTransition = useCallback((targetMode: 'normal' | 'secondary') => {
    if (isAnimating || !secondaryNav)
      return

    const content = navContentRef.current
    if (!content) {
      secondaryNav.onToggleExpand()
      return
    }

    setIsAnimating(true)
    // 锁定当前模式（退出阶段保持旧内容渲染）
    renderModeRef.current = targetMode === 'secondary' ? 'normal' : 'secondary'

    const groups = Array.from(content.querySelectorAll('.nav-group'))
    const island = content.closest('.dynamic-island') as HTMLElement

    // 标记过渡开始（启用 will-change、CSS 安全网）
    if (island) {
      island.setAttribute('data-transitioning', 'true')
    }

    // 预计算目标模式高度
    if (island && isDesktop()) {
      const padding = getCachedPadding(island)
      const itemCount = targetMode === 'secondary'
        ? Math.max(1, secondaryNav.items?.length ?? 0) + 2 // 二级: items + 返回 + 分隔
        : PRIMARY_NAV_COUNT
      const estimatedHeight = itemCount * ITEM_HEIGHT + padding
      const validHeight = validateHeight(estimatedHeight)
      if (validHeight !== null) {
        updateModeMetrics(targetMode, { height: validHeight })
        island.style.height = `${validHeight}px`
      }
    }

    // 退出动画 - 交错标记各项退出
    const timing = getAnimationTiming()
    groups.forEach((group, index) => {
      const el = group as HTMLElement
      el.removeAttribute('data-animation')
      setTimeout(() => {
        el.setAttribute('data-animation', 'exit')
      }, index * timing.exitStagger)
    })

    // 退出完成后切换内容（保持 isAnimating=true 直到进入动画结束）
    setTimeout(() => {
      // 标记即将加载新内容，CSS 安全网确保新 DOM 不闪现
      if (island) {
        island.setAttribute('data-entering', 'true')
      }
      // 不清理旧 DOM 的 data-animation — 它们即将被 React 卸载
      renderModeRef.current = targetMode
      secondaryNav.onToggleExpand()
      // 不在此处 setIsAnimating(false)，等进入动画完成后再解锁
    }, groups.length * timing.exitStagger + timing.exitDuration)
  }, [isAnimating, secondaryNav, setIsAnimating, renderModeRef, updateModeMetrics, getCachedPadding])

  const handleExpand = useCallback(() => handleTransition('secondary'), [handleTransition])
  const handleCollapse = useCallback(() => handleTransition('normal'), [handleTransition])

  // 导航到页面并展开二级导航
  const handleNavToPage = useCallback((path: string) => {
    if (location.pathname === path) {
      // 已在目标页面
      if (secondaryNav?.routePath === path) {
        // 有二级导航，无论当前是否展开，都触发展开
        // 如果已展开则不做任何事，如果未展开则展开
        if (!secondaryNav.expanded) {
          handleExpand()
        }
      }
    }
    else {
      // 导航到目标页面
      navigate(path)
      // 等待路由更新后展开
      setTimeout(() => {
        if (window.location.pathname === path) {
          // 通过事件通知页面展开二级导航
          window.dispatchEvent(new CustomEvent('nav-expand-secondary', { detail: { path } }))
        }
      }, 150)
    }
  }, [location.pathname, secondaryNav, handleExpand, navigate])

  // 进入动画
  useLayoutEffect(() => {
    const content = navContentRef.current
    if (!content)
      return

    const currentMode: 'normal' | 'secondary' = showSecondary ? 'secondary' : 'normal'
    if (lastModeRef.current === currentMode)
      return

    lastModeRef.current = currentMode

    const groups = content.querySelectorAll('.nav-group')
    const island = content.closest('.dynamic-island') as HTMLElement

    // 直接设置 enter-initial（跳过 removeAttribute — 新 DOM 没有残留标记）
    groups.forEach((group) => {
      (group as HTMLElement).setAttribute('data-animation', 'enter-initial')
    })

    if (island) {
      island.setAttribute('data-transitioning', 'true')
      // 移除 entering 标记 — enter-initial 已接管可见性控制，防闪安全网可解除
      island.removeAttribute('data-entering')
    }

    // 两帧后读取尺寸并启动进入动画
    const enterTimers: number[] = []
    let cleanupTimer: number

    const cancelSizeRaf = doubleRaf(() => {
      const currentContent = navContentRef.current
      const currentIsland = currentContent?.closest('.dynamic-island') as HTMLElement
      if (!currentContent || !currentIsland)
        return

      const padding = getCachedPadding(currentIsland)
      const scrollHeight = currentContent.scrollHeight

      if (isDesktop() && Number.isFinite(scrollHeight) && scrollHeight > 0) {
        const calculatedHeight = scrollHeight + padding
        const validHeight = validateHeight(calculatedHeight)
        if (safeSetHeight(currentIsland, validHeight)) {
          updateModeMetrics(currentMode, { height: validHeight ?? undefined })
        }
        else {
          currentIsland.style.removeProperty('height')
        }
      }
      else if (!isDesktop()) {
        currentIsland.style.removeProperty('width')
        currentIsland.style.removeProperty('height')
      }
    })

    const timing = getAnimationTiming()
    const cancelEnterRaf = doubleRaf(() => {
      groups.forEach((group, index) => {
        const timer = window.setTimeout(() => {
          (group as HTMLElement).removeAttribute('data-animation')
        }, index * timing.enterStagger + timing.enterDelay)
        enterTimers.push(timer)
      })

      cleanupTimer = window.setTimeout(() => {
        if (island) {
          island.removeAttribute('data-transitioning')
          island.removeAttribute('data-entering')
        }
        groups.forEach((group) => {
          (group as HTMLElement).removeAttribute('data-animation')
        })
        // 进入动画完成，解锁动画状态
        setIsAnimating(false)
      }, groups.length * timing.enterStagger + timing.enterDelay + 150)
    })

    return () => {
      cancelSizeRaf()
      cancelEnterRaf()
      enterTimers.forEach(timer => clearTimeout(timer))
      if (cleanupTimer)
        clearTimeout(cleanupTimer)
      // 被中断时清理过渡标记
      if (island) {
        island.removeAttribute('data-transitioning')
        island.removeAttribute('data-entering')
      }
    }
  }, [showSecondary, isAnimating, renderModeRef, secondaryNav, setIsAnimating, getCachedPadding, updateModeMetrics])

  // 首次挂载时初始化导航岛高度，并缓存 padding
  useEffect(() => {
    const content = navContentRef.current
    if (!content)
      return

    const island = content.closest('.dynamic-island') as HTMLElement
    if (!island)
      return

    let rafId: number
    let retryCount = 0
    const maxRetries = 5

    const initHeight = () => {
      const currentContent = navContentRef.current
      const currentIsland = currentContent?.closest('.dynamic-island') as HTMLElement
      if (!currentContent || !currentIsland)
        return

      // 首次计算时缓存 padding
      const padding = getCachedPadding(currentIsland)

      if (isDesktop()) {
        const scrollHeight = currentContent.scrollHeight

        if ((!Number.isFinite(scrollHeight) || scrollHeight < MIN_ISLAND_HEIGHT) && retryCount < maxRetries) {
          retryCount++
          rafId = requestAnimationFrame(initHeight)
          return
        }

        const validHeight = validateHeight(scrollHeight + padding)
        if (validHeight !== null) {
          currentIsland.style.height = `${validHeight}px`
          updateModeMetrics('normal', { height: validHeight })
        }
      }
    }

    rafId = requestAnimationFrame(initHeight)

    return () => cancelAnimationFrame(rafId)
  }, [])

  // 窗口大小变化时更新尺寸 - 使用防抖避免频繁更新
  useEffect(() => {
    let timeoutId: number | null = null
    let lastWidth = window.innerWidth

    const handleResize = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(() => {
        const content = navContentRef.current
        const island = content?.closest('.dynamic-island') as HTMLElement | null
        if (!island)
          return

        const currentWidth = window.innerWidth
        const crossedBreakpoint = (lastWidth >= 768) !== (currentWidth >= 768)
        lastWidth = currentWidth

        if (crossedBreakpoint) {
          // 跨断点时重置 padding 缓存（padding 可能不同）
          cachedPaddingRef.current = null
          if (currentWidth >= 768 && content) {
            const padding = getCachedPadding(island)
            const height = content.scrollHeight + padding
            safeSetHeight(island, height)
          }
          else {
            island.style.removeProperty('width')
            island.style.removeProperty('height')
          }
        }
        else {
          // 未跨越断点，应用缓存的 metrics
          applyModeMetrics(lastModeRef.current, island)
        }
      }, 100)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [applyModeMetrics])

  return (
    <nav
      ref={navContainerRef}
      className={`nav-container ${immersiveMode ? 'immersive' : ''}`}
      aria-label={t.nav.mainNavigation}
      {...(immersiveMode && { 'aria-hidden': 'true' })}
    >
      <div className="dynamic-island shadow-2xl" role="navigation">
        <div className="flex flex-row md:flex-col items-center gap-1 relative">
          {currentRenderMode === 'secondary' && secondaryNav ? (
            /* 二级导航模式 */
            <div ref={navContentRef} className="nav-island-content flex flex-row md:flex-col items-center gap-1" key="secondary-mode">
              {/* 返回按钮 */}
              <div className="nav-group" data-group="back">
                <button
                  onClick={handleCollapse}
                  className="nav-item"
                  data-tooltip={t.nav.back}
                  aria-label={t.nav.backToNav}
                >
                  {IconBack}
                </button>
              </div>

              {/* 分隔符 */}
              <div className="nav-group nav-group-spaced" data-group="divider">
                <div className="w-px h-6 bg-gray-300/50 dark:bg-neutral-700/50 md:w-6 md:h-px md:my-0"></div>
              </div>

              {/* 二级导航项 */}
              {secondaryNav.items.map(item => (
                <div key={item.id} className="nav-group nav-group-spaced" data-group={item.id}>
                  <button
                    onClick={() => secondaryNav.onChange(item.id)}
                    className={`nav-item ${secondaryNav.activeId === item.id ? 'active-secondary' : ''}`}
                    data-tooltip={item.title || item.label}
                    aria-label={item.ariaLabel || item.label}
                  >
                    {item.icon}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* 一级导航模式 */
            <div ref={navContentRef} className="nav-island-content flex flex-row md:flex-col items-center gap-1" key="primary-mode">
              {/* 主页按钮 */}
              <div className="nav-group" data-group="main">
                <a href="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`} data-tooltip={t.nav.home} aria-label={t.nav.backToHome} aria-current={location.pathname === '/' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate('/') }}>
                  {IconHome}
                </a>
              </div>

              {/* 资料库按钮 */}
              <div className="nav-group nav-group-spaced" data-group="library">
                <button
                  className={`nav-item ${location.pathname === '/library' ? 'active' : ''}`}
                  data-tooltip={t.nav.library}
                  aria-label={t.nav.library}
                  aria-current={location.pathname === '/library' ? 'page' : undefined}
                  onClick={() => handleNavToPage('/library')}
                >
                  {IconLibrary}
                </button>
              </div>

              {/* Brew 阅读按钮 - 使用咖啡杯图标契合 Brew 品牌 */}
              <div className="nav-group nav-group-spaced" data-group="brew">
                <button
                  className={`nav-item ${location.pathname === '/brew' ? 'active' : ''}`}
                  data-tooltip={t.nav.brewReading}
                  aria-label={t.nav.brewReading}
                  aria-current={location.pathname === '/brew' ? 'page' : undefined}
                  onClick={() => handleNavToPage('/brew')}
                >
                  {IconBrew}
                </button>
              </div>

              {/* 报告按钮 */}
              <div className="nav-group nav-group-spaced" data-group="reports">
                <button
                  className={`nav-item ${location.pathname === '/reports' ? 'active' : ''}`}
                  data-tooltip={t.nav.reports}
                  aria-label={t.nav.reports}
                  aria-current={location.pathname === '/reports' ? 'page' : undefined}
                  onClick={() => handleNavToPage('/reports')}
                >
                  {IconReports}
                </button>
              </div>

              {/* Tapp 应用商店按钮 */}
              <div className="nav-group nav-group-spaced" data-group="tapp">
                <a
                  href="/tapp"
                  className={`nav-item ${location.pathname === '/tapp' || location.pathname.startsWith('/tapp/') ? 'active' : ''}`}
                  data-tooltip={t.nav.tappStore}
                  aria-label={t.nav.openTappStore}
                  aria-current={location.pathname === '/tapp' || location.pathname.startsWith('/tapp/') ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); navigate('/tapp') }}
                >
                  <SiAppstore className="w-5 h-5" />
                </a>
              </div>

            </div>
          )}
        </div>
      </div>
      <NavIslandTooltip containerRef={navContainerRef} />
    </nav>
  )
}

export default NavigationIsland
