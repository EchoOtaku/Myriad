/**
 * 动态内容岛工具
 * 提供天气、问候语、一言等动态内容
 * 
 * 注意：天气和一言功能已拆分到独立文件
 */

import { API_URL } from '../config';

// 重新导出类型和函数，保持向后兼容
export * from './weather';
export * from './quote';

export interface GreetingData {
  text: string;
  icon: string;
  time: string;
}

/**
 * 获取时间段问候语
 */
export function getGreeting(username?: string): GreetingData {
  const hour = new Date().getHours();
  const time = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  let text = '';
  let icon = '';

  if (hour >= 5 && hour < 12) {
    icon = '🌅';
    text = '早上好';
  } else if (hour >= 12 && hour < 14) {
    icon = '☀️';
    text = '中午好';
  } else if (hour >= 14 && hour < 18) {
    icon = '🌤️';
    text = '下午好';
  } else if (hour >= 18 && hour < 22) {
    icon = '🌆';
    text = '晚上好';
  } else {
    icon = '🌙';
    text = '夜深了';
  }

  if (username) {
    text += `，${username}`;
  }

  return { text, icon, time };
}

/**
 * 获取主题状态信息
 */
export function getThemeInfo(): { text: string; icon: string } {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    text: isDark ? '深色模式' : '浅色模式',
    icon: isDark ? '🌙' : '☀️'
  };
}
