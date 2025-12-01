/**
 * 主应用入口
 * 集成路由器和布局,构建 SPA 核心
 * 优化: 代码分割 + 预加载 + 性能监控
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresenceShim as AnimatePresence } from '@lib/motionShim';
import { AppLayout } from './layouts/AppLayout';
import { recordNavigation } from './router/navigationHistory';
import RouteLoader from './components/RouteLoader';
import { NotificationProvider } from './contexts/NotificationContext';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext';
import { AuthProvider } from './contexts/AuthContext';
import { AnimationPreferenceProvider } from './contexts/AnimationPreferenceContext';
import { I18nProvider } from './contexts/I18nContext';
import CustomScrollbar from './components/CustomScrollbar';
import { preloadCriticalRoutes } from './utils/codeSplitting';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/animations.css';
import './styles/page-transitions.css';
import './styles/navigation-island.css';
import './styles/utility.css';
import './styles/modals.css';
import './styles/overrides.css';

// 懒加载视图组件 - 使用代码分割
const Home = lazy(() => import('./views/Home.tsx'));
const Library = lazy(() => import('./views/Library.tsx'));
const Reports = lazy(() => import('./views/Reports.tsx'));
const Config = lazy(() => import('./views/Config.tsx'));
const DataManagement = lazy(() => import('./views/DataManagement.tsx'));
const Login = lazy(() => import('./views/Login.tsx'));
const Details = lazy(() => import('./views/Details.tsx'));
const Setup = lazy(() => import('./views/Setup.tsx'));

/**
 * 路由守卫：检查认证状态
 * ✅ 使用 API 验证（HttpOnly Cookie 无法被 JS 读取）
 */
function RequireAuth({ children, requiresAdmin }: { children: JSX.Element; requiresAdmin?: boolean }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });

        if (response.ok) {
          const userData = await response.json();
          setIsAuthenticated(true);
          setIsAdmin(userData.is_admin || false);
        } else {
          // 401 是正常的未登录状态，静默处理
          setIsAuthenticated(false);
        }
      } catch {
        // 网络错误时静默处理
        setIsAuthenticated(false);
      }
    }

    checkAuth();
  }, []);

  // 加载中
  if (isAuthenticated === null) {
    return <LoadingFallback />;
  }

  // 未认证
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 需要管理员权限但不是管理员
  if (requiresAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * 加载指示器 - 纯光效
 * 无背景遮罩，只有优雅的光
 * 包装在 AnimatedView 中以参与页面切换动画
 */
function LoadingFallback() {
  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center">
      {/* 纯光效 - 跟随壁纸色 */}
      <div className="loading-fallback-light" />
    </div>
  );
}

/**
 * 带 Suspense 的懒加载页面包装器
 * 确保每个页面独立处理加载状态，避免切换时闪屏
 */
function SuspensePage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
}

/**
 * 路由内容组件
 */
function AppRoutes() {
  const location = useLocation();

  // 记录每次路由变化
  // 页面动画状态由 AnimatedView 中的 usePageTransition 自动管理
  useEffect(() => {
    recordNavigation(location.pathname);
  }, [location.pathname]);

  // 路由切换时恢复到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="sync">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<SuspensePage><Home /></SuspensePage>} />
        <Route path="/library" element={<SuspensePage><Library /></SuspensePage>} />
        <Route path="/reports" element={<SuspensePage><Reports /></SuspensePage>} />
        <Route
          path="/config"
          element={
            <RequireAuth requiresAdmin>
              <SuspensePage><Config /></SuspensePage>
            </RequireAuth>
          }
        />
        <Route
          path="/data-management"
          element={
            <RequireAuth requiresAdmin>
              <SuspensePage><DataManagement /></SuspensePage>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<SuspensePage><Login /></SuspensePage>} />
        <Route path="/details" element={<SuspensePage><Details /></SuspensePage>} />
        <Route path="/setup" element={<SuspensePage><Setup /></SuspensePage>} />

        {/* 404 页面 - 重定向到首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

/**
 * 主应用组件
 */
export function App() {
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  
  // 在 React 应用挂载完成后标记就绪状态
  // 注意：这只是通知基本框架已加载，各个组件会独立控制自己的淡入显示
  useEffect(() => {
    // 使用双帧延迟确保基础布局已渲染
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsLayoutReady(true);
        
        // 通知 PageLoader 应用已就绪
        if ((window as any).pageLoader) {
          (window as any).pageLoader.markAppReady();
        }
      });
    });
    
    return () => cancelAnimationFrame(rafId);
  }, []);

  // 预加载关键路由 - 在空闲时加载Library和Config
  useEffect(() => {
    // 延迟2秒后预加载,确保首屏已渲染完成
    const timer = setTimeout(() => {
      preloadCriticalRoutes();
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <BrowserRouter>
      <I18nProvider>
        <AnimationPreferenceProvider>
          <AuthProvider>
            <NotificationProvider>
              <MusicPlayerProvider>
                <RouteLoader />
                <CustomScrollbar />
                <AppLayout>
                  <AppRoutes />
                </AppLayout>
                {/* 开发环境下显示合并的性能监控工具 */}
                {import.meta.env.DEV && (
                  <Suspense fallback={null}>
                    {React.createElement(lazy(() => import('./components/PerformanceMonitor')))}
                  </Suspense>
                )}
              </MusicPlayerProvider>
            </NotificationProvider>
          </AuthProvider>
        </AnimationPreferenceProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

export default App;
