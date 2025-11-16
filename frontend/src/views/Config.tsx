/**
 * 系统配置视图组件
 */

import { useState, useEffect } from 'react';
import AnimatedView from '../components/AnimatedView';
import { useNavigate } from 'react-router-dom';
import ConfigForm from '../components/ConfigForm';
import { API_URL } from '../config';
import TokenManager from '../utils/tokenManager';

export default function Config() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // 检查管理员权限
  useEffect(() => {
    async function checkAdmin() {
      // ✅ 直接调用 API 验证（不再手动检查 token，因为 HttpOnly Cookie 无法被 JS 读取）
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: 'include', // ✅ 自动发送 HttpOnly Cookie
        });

        if (!response.ok) {
          navigate('/login', { replace: true });
          return;
        }

        const user = await response.json();
        if (!user.is_admin) {
          navigate('/', { replace: true });
          return;
        }

        setIsAdmin(true);
      } catch (error) {
        navigate('/login', { replace: true });
      } finally {
        setLoading(false);
      }
    }

    checkAdmin();
  }, [navigate]);

  if (loading) {
    return (
      <AnimatedView className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">加载中...</p>
        </div>
      </AnimatedView>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
      <div className="max-w-6xl mx-auto">
        <ConfigForm />
      </div>
    </AnimatedView>
  );
}
