/**
 * 主应用入口
 * 集成路由器和布局，构建 SPA 核心
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { AppLayout } from './layouts/AppLayout';
import { recordNavigation } from './router/navigationHistory';
import RouteLoader from './components/RouteLoader';
import { NotificationProvider } from './contexts/NotificationContext';
import CustomScrollbar from './components/CustomScrollbar';
import './styles/page-transitions.css';

// 懒加载视图组件
const Home = lazy(() => import('./views/Home.tsx'));
const Library = lazy(() => import('./views/Library.tsx'));
const Account = lazy(() => import('./views/Account.tsx'));
const Config = lazy(() => import('./views/Config.tsx'));
const DataManagement = lazy(() => import('./views/DataManagement.tsx'));
const Login = lazy(() => import('./views/Login.tsx'));
const Details = lazy(() => import('./views/Details.tsx'));
const Setup = lazy(() => import('./views/Setup.tsx'));

/**
 * 路由守卫：检查认证状态
 */
function RequireAuth({ children, requiresAdmin }: { children: JSX.Element; requiresAdmin?: boolean }) {
  const token = localStorage.getItem('auth_token');
  
  if (!token) {
    return <Navigate to="/login" replace />;
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
  const prevLocationRef = useRef(location.pathname);

  // 记录每次路由变化
  useEffect(() => {
    recordNavigation(location.pathname);
  }, [location.pathname]);

  // 记录路由变化（移除滚动锁定逻辑）
  useEffect(() => {
    prevLocationRef.current = location.pathname;
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
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
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

    // 如果页面还在加载，等待完成后再隐藏
    if (document.readyState === 'loading') {
      window.addEventListener('load', hideLoader);
      return () => window.removeEventListener('load', hideLoader);
    }
  }, []);

  return (
    <BrowserRouter>
      <NotificationProvider>
        <RouteLoader />
        <CustomScrollbar />
        <AppLayout>
          <Suspense fallback={<LoadingFallback />}>
            <AppRoutes />
          </Suspense>
        </AppLayout>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;
