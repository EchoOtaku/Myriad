/**
 * 主应用入口
 * 集成路由器和布局,构建 SPA 核心
 * 优化: 代码分割 + 预加载 + 性能监控
 */

import type { ModuleVisibilityKey } from './utils/moduleVisibility'
import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import React, { lazy, Suspense, useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import CustomScrollbar from './components/CustomScrollbar'
import RouteLoader from './components/RouteLoader'
import { AgentGlobalActions } from './contexts/AgentGlobalActions'
import { AnimationPreferenceProvider } from './contexts/AnimationPreferenceContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'

import { I18nProvider } from './contexts/I18nContext'
import { MusicPlayerProvider } from './contexts/MusicPlayerContext'
import { NavigationProvider } from './contexts/NavigationContext'
import { PageContentProvider } from './contexts/PageContentContext'
import { ReadingListProvider } from './contexts/ReadingListContext'
import { useRouteScheduler } from './hooks/animation/useRouteScheduler'
import { useAnimationLevel } from './hooks/useAnimationLevel'
import { AppLayout } from './layouts/AppLayout'
import { recordNavigation } from './router/navigationHistory'
import { TappDataExchangeConsentHost } from './tapp/components/TappDataExchangeConsentHost'
import { preloadCriticalRoutes } from './utils/codeSplitting'
import {
  canAccessModuleVisibility,
  canUseAgent,
  DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  useModuleVisibilityPreferences,
} from './utils/moduleVisibility'
import './styles/fonts.css'
import './styles/theme.css'
import './styles/animations.css'
import './styles/page-transitions.css'
import './styles/navigation-island.css'
import './styles/utility.css'
import './styles/modals.css'
import './styles/overrides.css'
import './styles/performance.css'

// TappBackgroundRunner 懒加载，避免其错误阻塞主应用
const TappBackgroundRunner = lazy(
  () => import('./tapp/components/TappBackgroundRunner'),
) // 🔧 性能优化 CSS

// 懒加载视图组件 - 使用代码分割
const Home = lazy(() => import('./views/Home.tsx'))
const Library = lazy(() => import('./views/Library.tsx'))
const Brew = lazy(() => import('./views/Brew.tsx'))
const Reports = lazy(() => import('./views/Reports.tsx'))
const Config = lazy(() => import('./views/Config.tsx'))
const DataManagement = lazy(() => import('./views/DataManagement.tsx'))
const Login = lazy(() => import('./views/Login.tsx'))
const Register = lazy(() => import('./views/Register.tsx'))
const Setup = lazy(() => import('./views/Setup.tsx'))

// Tapp 页面
const TappList = lazy(() => import('./tapp/pages/TappListPage.tsx'))
const TappRun = lazy(() => import('./views/TappRunView.tsx'))
const TappDetail = lazy(() => import('./views/TappDetailView.tsx'))
const TappPlayground = lazy(
  () => import('./tapp/pages/TappPlaygroundPage.tsx'),
)

// Arael AI 助手浮动面板
const AraelPanel = lazy(() => import('./components/agent/AraelPanel'))

/**
 * 路由守卫：复用全局 AuthContext 认证状态
 * 避免每次路由切换都重新发起 /api/auth/me 请求
 */
function RequireAuth({
  children,
  requiresAdmin,
}: {
  children: React.ReactNode
  requiresAdmin?: boolean
}) {
  const { isAuthenticated, isAdmin, hasChecked } = useAuth()

  // AuthContext 尚未完成首次检查
  if (!hasChecked) {
    return null
  }

  // 未认证
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // 需要管理员权限但不是管理员
  if (requiresAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}

/**
 * Guest-only routes (/login, /register): authenticated users go home.
 * While auth is still resolving, show a spinner — never flash the form.
 *
 * OAuth errors (`?oauth_error=`) are toasted by useAuthUrlFeedback on
 * AppLayout while this spinner is shown (URL still has the query), so we
 * intentionally do not re-attach query params on redirect (avoids double-toast).
 */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasChecked } = useAuth()

  if (!hasChecked) {
    return null
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return children
}

function ModuleVisibilityGuard({
  moduleKey,
  children,
}: {
  moduleKey: ModuleVisibilityKey
  children: React.ReactNode
}) {
  const { isAuthenticated, isAdmin, hasChecked } = useAuth()
  const { preferences, isLoading } = useModuleVisibilityPreferences()
  const visibility = preferences.modules[moduleKey]

  /*
   * 门禁加载中不要 return null：会整页卸挂，数字生命毛玻璃 / 房间解码冷启动必闪。
   * 默认可见的模块（life 等为 all）乐观先渲染；加载完再按真实偏好裁。
   */
  if (!hasChecked || isLoading) {
    const fallback = DEFAULT_MODULE_VISIBILITY_PREFERENCES.modules[moduleKey]
    if (fallback === 'all') {
      return children
    }
    return null
  }

  if (
    canAccessModuleVisibility(visibility, {
      isAuthenticated,
      isAdmin,
    })
  ) {
    return children
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Navigate to="/" replace />
}

/**
 * Agent（Arael AI 助手）访问门禁 - 悬浮面板，不做路由跳转，
 * 无权限时直接不渲染面板。
 * 门禁：页面可见性 + Tapp ai:chat（与权限页 Agent 预设同一真相源）。
 */
function AgentAccessGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin, hasChecked } = useAuth()
  const { preferences, isLoading } = useModuleVisibilityPreferences()
  const [elevatedAiChat, setElevatedAiChat] = useState<
    { user: boolean; guest: boolean } | undefined
  >(undefined)
  const [permLoaded, setPermLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { fetchPermissionsConfig } = await import('./lib/api')
        const response = await fetchPermissionsConfig()
        if (cancelled) return
        if (response?.success && response.config) {
          setElevatedAiChat({
            user: !!response.config.user?.ai_chat,
            guest: !!response.config.guest?.ai_chat,
          })
        } else {
          setElevatedAiChat(undefined)
        }
      } catch {
        if (!cancelled) setElevatedAiChat(undefined)
      } finally {
        if (!cancelled) setPermLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!hasChecked || isLoading || !permLoaded) {
    return null
  }

  if (
    !canUseAgent(
      preferences,
      {
        isAuthenticated,
        isAdmin,
      },
      elevatedAiChat,
    )
  ) {
    return null
  }

  return children
}

/**
 * 带 Suspense 的懒加载页面包装器
 * 确保每个页面独立处理加载状态，避免切换时闪屏
 *
 * fallback 为 null：引导加载器（PageLoader.astro）与各页面自己的数据
 * 加载态（如 Home 的 dashboard 配置 Spinner）已覆盖真实等待场景；
 * 这中间曾插入一个路由级小环，只在「引导屏刚谢幕、下一路由代码块
 * 还没取到」的窄缝里出现，观感上是无意义的第三次闪烁，故移除。
 */
function SuspensePage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

/**
 * 带动画的页面包装器
 * 确保 AnimatePresence 直接包裹 motion 组件
 */
function AnimatedPage({
  children,
  animationKey,
  animationStyle,
}: {
  children: React.ReactNode
  animationKey?: string
  animationStyle?: 'normal' | 'fixed' | 'opacity-only' | 'none'
}) {
  const location = useLocation()
  const style = animationStyle ?? 'normal'
  const animationConfig = useAnimationLevel()
  const animationsEnabled = animationConfig.level !== 'none'

  // 选择动画变体和包装样式
  const variants = style === 'normal' ? pageVariants : fixedPageVariants
  const wrapperStyle =
    style === 'fixed'
      ? { position: 'absolute' as const, inset: 0 }
      : { width: '100%' }

  // /tapp/run 自带 fixed 全屏壳：不要做 opacity 进场动画。
  // WebKit 在「opacity 动画祖先 + overflow:hidden」链上嵌套 iframe 时会出现
  // 合成层 bug（内容看得见/DOM 在但点不到，或干脆不绘制）。原先用 body portal
  // 规避绘制，却引入几何同步与命中错乱，移动端表现为「摸得到但不触发交互」。
  // 去掉页面级 opacity 后，iframe 可安全内联，触摸链路恢复正常。
  //
  // /life 同理：祖先 opacity 动画期间 backdrop-filter 不采样或采样残缺，
  // 进场结束会「先透后突然糊」——直接静态挂载，毛玻璃首帧就位。
  if (style === 'fixed' || style === 'none') {
    return (
      <div key={animationKey ?? location.pathname} style={wrapperStyle}>
        {children}
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={animationKey ?? location.pathname}
        variants={animationsEnabled ? variants : undefined}
        initial={animationsEnabled ? 'initial' : false}
        animate={animationsEnabled ? 'enter' : undefined}
        exit={animationsEnabled ? 'exit' : undefined}
        style={wrapperStyle}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * 页面动画配置 - 普通页面（带 transform）
 */
const pageVariants = {
  initial: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.35,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -15,
    scale: 0.98,
    transition: {
      duration: 0.25,
      ease: [0.4, 0, 0.6, 1],
    },
  },
}

/**
 * 🎯 Fixed 布局页面动画配置 - 只用 opacity，不用 transform
 * transform 会破坏 fixed 定位（fixed 元素会相对于有 transform 的祖先定位）
 */
const fixedPageVariants = {
  initial: {
    opacity: 0,
  },
  enter: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.6, 1],
    },
  },
}

/**
 * 路由内容组件
 */
function AppRoutes() {
  const location = useLocation()

  // 🎯 动画风格选择：
  // - 'fixed': 绝对定位包装器（仅 tapp/run 等自带 fixed 全屏布局的页面）
  // - 'none': 无进场动画（数字生命：避免 opacity 进场导致毛玻璃闪现）
  // - 'opacity-only': 不用 transform
  // - 'normal': 正常页面（带 transform 动画）
  const animationStyle: 'normal' | 'fixed' | 'opacity-only' | 'none' =
    location.pathname.startsWith('/tapp/run')
      ? 'fixed'
      : location.pathname.startsWith('/life')
        ? 'none'
        : 'normal'

  // 🎯 动画分组 key：同组路由之间不触发 exit/enter 动画，避免白屏间隙
  const animationKey = location.pathname

  // 🔧 原子化调度器：在路由变化时自动管理页面生命周期
  // 这会在路由切换时清理旧页面的订阅并初始化新页面
  useRouteScheduler()

  // 记录每次路由变化
  // 页面动画状态由 AnimatedView 中的 usePageTransition 自动管理
  useEffect(() => {
    recordNavigation(location.pathname)
  }, [location.pathname])

  // 路由切换时恢复到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <AnimatedPage animationStyle={animationStyle} animationKey={animationKey}>
      <Routes location={location}>
        <Route
          path="/"
          element={
            <SuspensePage>
              <Home />
            </SuspensePage>
          }
        />
        <Route
          path="/library"
          element={
            <ModuleVisibilityGuard moduleKey="library">
              <SuspensePage>
                <Library />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        {/* Brew 页面允许游客访问（只读），登录用户可使用已读/收藏，管理员可管理 */}
        <Route
          path="/brew"
          element={
            <ModuleVisibilityGuard moduleKey="brew">
              <SuspensePage>
                <Brew />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/reports"
          element={
            <ModuleVisibilityGuard moduleKey="reports">
              <SuspensePage>
                <Reports />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
                </SuspensePage>
              </RequireAuth>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/config"
          element={
            <RequireAuth requiresAdmin>
              <SuspensePage>
                <Config />
              </SuspensePage>
            </RequireAuth>
          }
        />
        <Route
          path="/data-management"
          element={
            <RequireAuth requiresAdmin>
              <SuspensePage>
                <DataManagement />
              </SuspensePage>
            </RequireAuth>
          }
        />
        <Route
          path="/login"
          element={
            <GuestOnly>
              <SuspensePage>
                <Login />
              </SuspensePage>
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <SuspensePage>
                <Register />
              </SuspensePage>
            </GuestOnly>
          }
        />
        <Route
          path="/setup"
          element={
            <SuspensePage>
              <Setup />
            </SuspensePage>
          }
        />

        {/* Tapp 路由 */}
        <Route
          path="/tapp"
          element={
            <ModuleVisibilityGuard moduleKey="tapp">
              <SuspensePage>
                <TappList />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/tapp/run"
          element={
            <ModuleVisibilityGuard moduleKey="tapp">
              <SuspensePage>
                <TappRun />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/tapp/run/:id"
          element={
            <ModuleVisibilityGuard moduleKey="tapp">
              <SuspensePage>
                <TappRun />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/tapp/detail/:id"
          element={
            <ModuleVisibilityGuard moduleKey="tapp">
              <SuspensePage>
                <TappDetail />
              </SuspensePage>
            </ModuleVisibilityGuard>
          }
        />
        <Route
          path="/tapp/playground"
          element={
            <RequireAuth requiresAdmin>
              <SuspensePage>
                <TappPlayground />
              </SuspensePage>
            </RequireAuth>
          }
        />

        {/* 404 页面 - 重定向到首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatedPage>
  )
}

/**
 * 主应用组件
 */
export function App() {
  console.debug('[App] App component rendering...')
  const [_isLayoutReady, setIsLayoutReady] = useState(false)

  // 后台 Tapp 宿主延后到首屏渲染 + 入场动画之后再挂载：
  // 它会拉起整个 tapp runtime（含沙箱/SDK 代码），不应与首屏抢主线程。
  // 后台 Tapp 本身无 UI，晚几秒启动对用户不可见。
  const [backgroundTappsReady, setBackgroundTappsReady] = useState(false)
  useEffect(() => {
    let idleId: number | null = null
    const start = () => setBackgroundTappsReady(true)
    const timerId = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = requestIdleCallback(start, { timeout: 4000 })
      } else {
        start()
      }
    }, 3000)
    return () => {
      window.clearTimeout(timerId)
      if (idleId !== null && 'cancelIdleCallback' in window) {
        cancelIdleCallback(idleId)
      }
    }
  }, [])

  // 在 React 应用挂载完成后标记就绪状态
  // 注意：这只是通知基本框架已加载，各个组件会独立控制自己的淡入显示
  useEffect(() => {
    console.debug('[App] App useEffect running...')
    // 使用双帧延迟确保基础布局已渲染
    let innerRafId: number | null = null
    const rafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        setIsLayoutReady(true)

        // 通知 PageLoader 应用已就绪
        if ((window as any).pageLoader) {
          ;(window as any).pageLoader.markAppReady()
        }
      })
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (innerRafId !== null) cancelAnimationFrame(innerRafId)
    }
  }, [])

  // 预加载关键路由 - 在空闲时加载Library和Config
  useEffect(() => {
    // 延迟6秒后预加载：低端设备上首屏渲染 + 小组件数据请求 + 入场动画
    // 可持续数秒，过早预取会与首屏抢主线程（preloadRoutes 内部还有
    // requestIdleCallback 二次让路）
    const timer = setTimeout(() => {
      preloadCriticalRoutes()
    }, 6000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <BrowserRouter>
      <I18nProvider>
        <AnimationPreferenceProvider>
          <AuthProvider>
            <MusicPlayerProvider>
              <NavigationProvider>
                <PageContentProvider>
                  <ReadingListProvider>
                    {/* Agent 全局动作处理器 - 处理路由导航和页面元素交互 */}
                    <AgentGlobalActions />
                    {/* Arael AI 助手浮动面板 - 长按触发 */}
                    <AgentAccessGate>
                      <Suspense fallback={null}>
                        <AraelPanel />
                      </Suspense>
                    </AgentAccessGate>
                    <RouteLoader />
                    <CustomScrollbar />
                    {backgroundTappsReady && (
                      <Suspense fallback={null}>
                        <TappBackgroundRunner />
                      </Suspense>
                    )}
                    <TappDataExchangeConsentHost />
                    <AppLayout>
                      <AppRoutes />
                    </AppLayout>
                    {/* 开发环境下显示合并的性能监控工具 */}
                    {import.meta.env.DEV && (
                      <Suspense fallback={null}>
                        {React.createElement(
                          lazy(() => import('./components/PerformanceMonitor')),
                        )}
                      </Suspense>
                    )}
                  </ReadingListProvider>
                </PageContentProvider>
              </NavigationProvider>
            </MusicPlayerProvider>
          </AuthProvider>
        </AnimationPreferenceProvider>
      </I18nProvider>
    </BrowserRouter>
  )
}

export default App
