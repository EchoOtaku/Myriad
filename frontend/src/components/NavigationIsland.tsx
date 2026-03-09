/**
 * 导航岛组件 - Apple Dynamic Island 风格
 *
 * 职责：
 * - 渲染一级导航（主页、资料库、Brew、报告、Tapp）
 * - 根据 NavigationContext 渲染页面声明的二级导航
 * - 处理一二级导航的切换动画
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

import { SiAppstore } from '@lib/icons'
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

/**
 * 设备感知的动画时序配置
 * 桌面端：从容优雅，给用户充分感知动画层次
 * 移动端：敏捷紧凑，触控反馈要快
 */
function getAnimationTiming() {
  const isMobile = window.innerWidth < 768
  return {
    /** 退出动画各项间隔 (ms) */
    exitStagger: isMobile ? 25 : 40,
    /** 退出阶段持续 (ms) - 需覆盖 CSS transition 最长时长 */
    exitDuration: isMobile ? 240 : 380,
    /** 进入动画各项间隔 (ms) */
    enterStagger: isMobile ? 30 : 50,
    /** 进入首项延迟 (ms) - 等新 DOM 布局稳定 */
    enterDelay: isMobile ? 40 : 70,
  }
}

// 工具函数：获取设备类型
const getVariant = () => (window.innerWidth >= 768 ? 'desktop' : 'mobile')

// 工具函数：验证并修正高度值
function validateHeight(height: number | null | undefined): number | null {
  if (height === null || height === undefined || !Number.isFinite(height)) {
    return null
  }
  if (height < MIN_ISLAND_HEIGHT) {
    return MIN_ISLAND_HEIGHT
  }
  if (height > MAX_ISLAND_HEIGHT) {
    return MAX_ISLAND_HEIGHT
  }
  return Math.round(height) // 避免小数导致的布局抖动
}

// 工具函数：安全设置高度
function safeSetHeight(island: HTMLElement, height: number | null | undefined): boolean {
  const validHeight = validateHeight(height)
  if (validHeight !== null) {
    island.style.height = `${validHeight}px`
    return true
  }
  return false
}

// 工具函数：计算 padding（带安全检查）
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
 * 桌面端显示在按钮右侧，移动端显示在按钮上方，不带箭头
 */
function NavIslandTooltip({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [tooltip, setTooltip] = useState<{ text: string, rect: DOMRect } | null>(null)
  const [visible, setVisible] = useState(false)
  const showTimerRef = useRef<number>(0)
  const hideTimerRef = useRef<number>(0)
  const activeTargetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const show = (target: HTMLElement) => {
      const text = target.getAttribute('data-tooltip')
      if (!text) return
      activeTargetRef.current = target
      clearTimeout(hideTimerRef.current)
      clearTimeout(showTimerRef.current)
      // 立即更新位置，延迟显示避免闪烁
      setTooltip({ text, rect: target.getBoundingClientRect() })
      showTimerRef.current = window.setTimeout(() => setVisible(true), 120)
    }

    const hide = () => {
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        // 等淡出动画完成再移除 DOM
        setTimeout(() => {
          activeTargetRef.current = null
          setTooltip(null)
        }, 120)
      }, 60)
    }

    const handleMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const target = el?.closest?.('[data-tooltip]') as HTMLElement | null

      if (target && container.contains(target)) {
        if (target !== activeTargetRef.current) {
          // 切换到新按钮：立即更新位置，重置显示定时
          show(target)
        }
      } else {
        if (activeTargetRef.current) {
          hide()
        }
      }
    }

    const handleLeaveContainer = () => {
      hide()
    }

    container.addEventListener('mousemove', handleMove)
    container.addEventListener('mouseleave', handleLeaveContainer)
    return () => {
      container.removeEventListener('mousemove', handleMove)
      container.removeEventListener('mouseleave', handleLeaveContainer)
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
    }
  }, [containerRef])

  if (!tooltip) return null

  const isMobile = window.innerWidth < 768
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
  }

  if (isMobile) {
    style.left = tooltip.rect.left + tooltip.rect.width / 2
    style.top = tooltip.rect.top - 10
    style.transform = 'translate(-50%, -100%)'
  } else {
    style.left = tooltip.rect.right + 10
    style.top = tooltip.rect.top + tooltip.rect.height / 2
    style.transform = 'translateY(-50%)'
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

  // 当前是否显示二级导航
  const showSecondary = secondaryNav?.expanded && secondaryNav.routePath === location.pathname

  // 动画期间锁定的渲染模式
  const currentRenderMode = isAnimating ? renderModeRef.current : (showSecondary ? 'secondary' : 'normal')

  // 记录是否已自动展开过（避免重复触发）
  const autoExpandedRef = useRef<string | null>(null)

  // 缓存 metrics key 构建函数
  const buildMetricsKey = useCallback((mode: 'normal' | 'secondary', variant: 'desktop' | 'mobile') =>
    `${mode}-${variant}-${location.pathname}`, [location.pathname])

  // 更新 metrics
  const updateModeMetrics = useCallback((mode: 'normal' | 'secondary', metrics: ModeMetrics) => {
    const key = buildMetricsKey(mode, getVariant())
    islandMetricsRef.current[key] = { ...islandMetricsRef.current[key], ...metrics }
  }, [buildMetricsKey])

  // 应用 metrics
  const applyModeMetrics = useCallback((mode: 'normal' | 'secondary', island: HTMLElement) => {
    if (!island)
      return

    const key = buildMetricsKey(mode, getVariant())
    const metrics = islandMetricsRef.current[key]

    if (window.innerWidth >= 768) {
      // 尝试应用缓存的高度，如果无效则尝试重新计算
      if (metrics?.height) {
        if (!safeSetHeight(island, metrics.height)) {
          // 缓存的高度无效，尝试根据内容重新计算
          const content = island.querySelector('.nav-island-content') as HTMLElement
          if (content) {
            const paddingVertical = getPaddingVertical(island)
            const fallbackHeight = content.scrollHeight + paddingVertical
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
  }, [buildMetricsKey])

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

  // 处理展开二级导航（带退出动画）
  const handleExpand = useCallback(() => {
    if (isAnimating || !secondaryNav)
      return

    const content = navContentRef.current
    if (!content) {
      secondaryNav.onToggleExpand()
      return
    }

    setIsAnimating(true)
    renderModeRef.current = 'normal'

    const groups = Array.from(content.querySelectorAll('.nav-group'))
    const island = content.closest('.dynamic-island') as HTMLElement

    // 预计算二级导航模式尺寸并立即应用
    if (island && window.innerWidth >= 768) {
      const paddingVertical = getPaddingVertical(island)
      const itemCount = Math.max(1, secondaryNav.items?.length ?? 0) // 确保至少有1项
      const estimatedSecondaryHeight = (itemCount + 2) * ITEM_HEIGHT + paddingVertical
      const validHeight = validateHeight(estimatedSecondaryHeight)
      if (validHeight !== null) {
        updateModeMetrics('secondary', { height: validHeight })
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

    // 等退出阶段完全结束后切换状态
    setTimeout(() => {
      groups.forEach((group) => {
        (group as HTMLElement).removeAttribute('data-animation')
      })
      renderModeRef.current = 'secondary'
      secondaryNav.onToggleExpand()
      setIsAnimating(false)
    }, groups.length * timing.exitStagger + timing.exitDuration)
  }, [isAnimating, secondaryNav, setIsAnimating, renderModeRef, updateModeMetrics])

  // 处理收起二级导航（返回按钮）
  const handleCollapse = useCallback(() => {
    if (isAnimating || !secondaryNav)
      return

    const content = navContentRef.current
    if (!content) {
      secondaryNav.onToggleExpand()
      return
    }

    setIsAnimating(true)
    renderModeRef.current = 'secondary'

    const groups = Array.from(content.querySelectorAll('.nav-group'))
    const island = content.closest('.dynamic-island') as HTMLElement

    // 预计算正常模式尺寸（一级菜单：5主按钮）
    if (island && window.innerWidth >= 768) {
      const paddingVertical = getPaddingVertical(island)
      const estimatedNormalHeight = 5 * ITEM_HEIGHT + paddingVertical
      const validHeight = validateHeight(estimatedNormalHeight)
      if (validHeight !== null) {
        updateModeMetrics('normal', { height: validHeight })
        // 立即应用高度变化（容器和内容退出同时进行）
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

    // 等退出阶段完全结束后切换状态
    setTimeout(() => {
      groups.forEach((group) => {
        (group as HTMLElement).removeAttribute('data-animation')
      })
      renderModeRef.current = 'normal'
      secondaryNav.onToggleExpand()
      setIsAnimating(false)
    }, groups.length * timing.exitStagger + timing.exitDuration)
  }, [isAnimating, secondaryNav, setIsAnimating, renderModeRef, updateModeMetrics])

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

    // 清理旧动画标记
    groups.forEach((group) => {
      (group as HTMLElement).removeAttribute('data-animation')
    })

    if (island) {
      island.setAttribute('data-transitioning', 'true')
    }

    // 设置进入初始状态
    groups.forEach((group) => {
      (group as HTMLElement).setAttribute('data-animation', 'enter-initial')
    })

    // 延迟两帧读取尺寸，确保新内容已完全渲染和布局
    let sizeRafId2: number
    const sizeRafId1 = requestAnimationFrame(() => {
      sizeRafId2 = requestAnimationFrame(() => {
        const currentContent = navContentRef.current
        if (!currentContent)
          return

        const currentIsland = currentContent.closest('.dynamic-island') as HTMLElement
        if (!currentIsland)
          return

        const paddingVertical = getPaddingVertical(currentIsland)
        const scrollHeight = currentContent.scrollHeight

        // 确保 scrollHeight 是有效值
        if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) {
          // 内容尚未渲染完成，稍后重试
          requestAnimationFrame(() => {
            const retryContent = navContentRef.current
            const retryIsland = retryContent?.closest('.dynamic-island') as HTMLElement
            if (retryContent && retryIsland && window.innerWidth >= 768) {
              const retryPadding = getPaddingVertical(retryIsland)
              const retryHeight = retryContent.scrollHeight + retryPadding
              if (safeSetHeight(retryIsland, retryHeight)) {
                updateModeMetrics(currentMode, { height: validateHeight(retryHeight) ?? undefined })
              }
            }
          })
          return
        }

        const calculatedHeight = scrollHeight + paddingVertical
        const validHeight = validateHeight(calculatedHeight)
        const metrics: ModeMetrics = { height: validHeight ?? undefined }

        if (window.innerWidth >= 768) {
          if (!safeSetHeight(currentIsland, validHeight)) {
            // 如果设置失败，移除内联样式让 CSS 处理
            currentIsland.style.removeProperty('height')
          }
        }
        else {
          currentIsland.style.removeProperty('width')
          currentIsland.style.removeProperty('height')
        }

        if (metrics.height) {
          updateModeMetrics(currentMode, metrics)
        }

      })
    })

    // 进入动画 - 交错移除 enter-initial 标记，触发 CSS 过渡
    const timing = getAnimationTiming()
    let rafId2: number
    const enterTimers: number[] = []
    let cleanupTimer: number

    const rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        groups.forEach((group, index) => {
          const timer = window.setTimeout(() => {
            (group as HTMLElement).removeAttribute('data-animation')
          }, index * timing.enterStagger + timing.enterDelay)
          enterTimers.push(timer)
        })

        // 安全兜底：所有进入动画应已完成后清理残留标记
        cleanupTimer = window.setTimeout(() => {
          if (island) {
            island.removeAttribute('data-transitioning')
          }
          groups.forEach((group) => {
            (group as HTMLElement).removeAttribute('data-animation')
          })
        }, groups.length * timing.enterStagger + timing.enterDelay + 150)
      })
    })

    return () => {
      cancelAnimationFrame(sizeRafId1)
      cancelAnimationFrame(sizeRafId2)
      cancelAnimationFrame(rafId1)
      cancelAnimationFrame(rafId2)
      enterTimers.forEach(timer => clearTimeout(timer))
      if (cleanupTimer)
        clearTimeout(cleanupTimer)
    }
  }, [showSecondary, isAnimating, renderModeRef, secondaryNav])

  // 首次挂载时初始化导航岛高度，并记录基础高度
  useEffect(() => {
    const content = navContentRef.current
    if (!content)
      return

    const island = content.closest('.dynamic-island') as HTMLElement
    if (!island)
      return

    // 使用 rAF 等待浏览器完成布局后设置尺寸
    let rafId: number
    let retryCount = 0
    const maxRetries = 5

    const initHeight = () => {
      const currentContent = navContentRef.current
      const currentIsland = currentContent?.closest('.dynamic-island') as HTMLElement
      if (!currentContent || !currentIsland)
        return

      if (window.innerWidth >= 768) {
        const paddingVertical = getPaddingVertical(currentIsland)
        const scrollHeight = currentContent.scrollHeight

        // 如果内容尚未渲染完成（scrollHeight 为 0 或很小），重试
        if ((!Number.isFinite(scrollHeight) || scrollHeight < MIN_ISLAND_HEIGHT) && retryCount < maxRetries) {
          retryCount++
          rafId = requestAnimationFrame(initHeight)
          return
        }

        const height = scrollHeight + paddingVertical
        const validHeight = validateHeight(height)

        if (validHeight !== null) {
          currentIsland.style.height = `${validHeight}px`
          updateModeMetrics('normal', { height: validHeight })
        }
      }
    }

    rafId = requestAnimationFrame(initHeight)

    return () => cancelAnimationFrame(rafId)
    // 仅首次挂载时执行
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
          // 跨越断点时，重新计算高度
          if (currentWidth >= 768 && content) {
            const paddingVertical = getPaddingVertical(island)
            const height = content.scrollHeight + paddingVertical
            safeSetHeight(island, height)
          }
          else {
            // 移动端，清除固定尺寸
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
                  </svg>
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                  </svg>
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" />
                  </svg>
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
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
