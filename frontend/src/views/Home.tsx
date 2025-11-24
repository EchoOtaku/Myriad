/**
 * 首页视图组件
 * 显示欢迎信息和快速导航
 */

import AnimatedView from '../components/AnimatedView';
import { API_URL } from '../config';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  // 检查是否需要初始化设置
  useEffect(() => {
    async function checkSetup() {
      try {
        const response = await fetch(`${API_URL}/api/setup/status`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (data.is_setup_required) {
          navigate('/setup', { replace: true });
        }
      } catch (error) {
        // 允许用户访问应用
      }
    }

    checkSetup();
  }, [navigate]);

  return (
    <AnimatedView className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* 欢迎标题 */}
        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-gray-800 dark:text-gray-100">
            欢迎使用 Myriad
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            一键聚合你的多平台数字足迹
          </p>
        </div>

        {/* 快速导航 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <button
            onClick={() => navigate('/library')}
            className="glass rounded-2xl p-6 border hover:shadow-lg transition-all hover:scale-105"
          >
            <div className="text-4xl mb-2">📚</div>
            <div className="font-semibold text-gray-800 dark:text-gray-100">资料库</div>
          </button>

          <button
            onClick={() => navigate('/reports')}
            className="glass rounded-2xl p-6 border hover:shadow-lg transition-all hover:scale-105"
          >
            <div className="text-4xl mb-2">📊</div>
            <div className="font-semibold text-gray-800 dark:text-gray-100">报告</div>
          </button>
        </div>
      </div>
    </AnimatedView>
  );
}
