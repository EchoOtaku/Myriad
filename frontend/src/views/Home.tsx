/**
 * 首页视图组件
 * 显示报告卡片
 */

import ReportCards from '../components/ReportCards';
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
    <AnimatedView className="min-h-screen flex items-start justify-center px-3 xs:px-4 sm:px-6 pt-[calc(12vh)] sm:pt-[calc(15vh)] md:pt-[calc(25vh)] pb-28 sm:pb-24 md:pb-8">
      <ReportCards />
    </AnimatedView>
  );
}
