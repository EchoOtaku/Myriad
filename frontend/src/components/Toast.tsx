/**
 * 统一的Toast提示组件
 * 用于显示成功/失败消息
 */

import './Toast.css';
import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose?: () => void;
  duration?: number;
}

export default function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  const [isHiding, setIsHiding] = useState(false);
  
  // 自动判断类型
  const toastType = type || (message.startsWith('✓') ? 'success' : 'error');
  
  // 清理消息前缀
  const cleanMessage = message.replace(/^[✓✗]\s*/, '');

  useEffect(() => {
    if (duration > 0) {
      const hideTimer = setTimeout(() => {
        setIsHiding(true);
      }, duration);

      const removeTimer = setTimeout(() => {
        onClose?.();
      }, duration + 300); // 等待消失动画完成

      return () => {
        clearTimeout(hideTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [duration, onClose]);

  return (
    <div className={`toast-container ${isHiding ? 'hiding' : ''}`}>
      <div className={`toast-message ${toastType}`}>
        {toastType === 'success' ? (
          <svg className="toast-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.6667 5L7.50004 14.1667L3.33337 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg className="toast-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        <span>{cleanMessage}</span>
      </div>
    </div>
  );
}
