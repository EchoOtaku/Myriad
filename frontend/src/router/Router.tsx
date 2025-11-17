/**
 * 应用路由器
 * 管理所有路由逻辑、权限验证、页面过渡动画
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { routes } from './routes';


// 懒加载页面组件
const Home = lazy(() => import('../views/Home.tsx'));
const Library = lazy(() => import('../views/Library.tsx'));
const Config = lazy(() => import('../views/Config.tsx'));
const Login = lazy(() => import('../views/Login.tsx'));
const Details = lazy(() => import('../views/Details.tsx'));
const Setup = lazy(() => import('../views/Setup.tsx'));

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
    return <div>Loading...</div>;
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
 * 路由内容组件
 */
function AnimatedRoutes() {
  const location = useLocation();

  // 页面切换时更新标题和描述
  useEffect(() => {
    const route = routes.find(r => r.path === location.pathname);
    if (route) {
      document.title = route.title;
      if (route.description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute('content', route.description);
        }
      }
    }
  }, [location]);

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route 
          path="/config" 
          element={
            <RequireAuth requiresAdmin>
              <Config />
            </RequireAuth>
          } 
        />
        <Route path="/login" element={<Login />} />
        <Route path="/details" element={<Details />} />
        <Route path="/setup" element={<Setup />} />
        
        {/* 旧的 /account 路由重定向到首页，控制面板已整合账户管理 */}
        <Route path="/account" element={<Navigate to="/" replace />} />
        
        {/* 404 页面 - 重定向到首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

/**
 * 加载指示器
 */
function LoadingFallback() {
  return null;
}

/**
 * 主路由器组件
 */
export function AppRouter({ children }: { children?: React.ReactNode }) {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        {children || <AnimatedRoutes />}
      </Suspense>
    </BrowserRouter>
  );
}

export default AppRouter;
