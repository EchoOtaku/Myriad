/**
 * 主应用入口
 * 集成路由器和布局,构建 SPA 核心
 * 优化: 代码分割 + 预加载 + 性能监控
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AppLayout } from './layouts/AppLayout';
import { recordNavigation } from './router/navigationHistory';
import RouteLoader from './components/RouteLoader';
import { NotificationProvider } from './contexts/NotificationContext';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext';
import { AuthProvider } from './contexts/AuthContext';
import { AnimationPreferenceProvider } from './contexts/AnimationPreferenceContext';
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
 * 路由内容组件
 */
function AppRoutes() {
  const location = useLocation();

  // 记录每次路由变化
  useEffect(() => {
    recordNavigation(location.pathname);
  }, [location.pathname]);

  // 路由切换时恢复到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route path="/reports" element={<Reports />} />
        <Route
          path="/config"
          element={
            <RequireAuth requiresAdmin>
              <Config />
            </RequireAuth>
          }
        />
        <Route
          path="/data-management"
          element={
            <RequireAuth requiresAdmin>
              <DataManagement />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/details" element={<Details />} />
        <Route path="/setup" element={<Setup />} />

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
  // 在 React 应用挂载完成后隐藏页面加载器
  useEffect(() => {
    const hideLoader = () => {
      if ((window as any).pageLoader) {
        (window as any).pageLoader.hide();
      }
    };

    // 立即尝试隐藏加载器
    hideLoader();

    // 如果页面还在加载,等待完成后再隐藏
    if (document.readyState === 'loading') {
      window.addEventListener('load', hideLoader);
      return () => window.removeEventListener('load', hideLoader);
    }
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
      <AnimationPreferenceProvider>
        <AuthProvider>
          <NotificationProvider>
            <MusicPlayerProvider>
              <RouteLoader />
              <CustomScrollbar />
              <AppLayout>
                <Suspense fallback={<LoadingFallback />}>
                  <AppRoutes />
                </Suspense>
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
    </BrowserRouter>
  );
}

export default App;
