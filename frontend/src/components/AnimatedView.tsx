/**
 * 页面过渡动画包装器
 * 使用 framer-motion 实现流畅的进入和退出动画
 * 与统一动画协调器配合
 * 
 * 特性:
 * - 页面级动画享有最高优先级
 * - 自动与 AnimationCoordinator 集成
 * - 支持 framer-motion 懒加载
 * - 退出动画使用绝对定位避免布局跳变
 */

import { motionShim as motion } from '@lib/motionShim';
import type { Variants } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { usePageTransition } from '../hooks/animation';

interface AnimatedViewProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * 页面动画变体配置
 * - 进入: 从下方淡入，带轻微缩放
 * - 退出: 快速淡出，使用绝对定位脱离文档流
 */
const pageVariants: Variants = {
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
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1], // 平滑的缓动曲线
      staggerChildren: 0.05,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.98,
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: -1,
    pointerEvents: 'none' as const,
    transition: {
      duration: 0.25,
      ease: [0.4, 0, 0.6, 1], // 退出时稍微加速
    },
  },
};

export default function AnimatedView({ children, className = '' }: AnimatedViewProps) {
  const location = useLocation();
  const pageId = location.pathname.replace(/\//g, '-') || 'home';
  
  // 使用统一动画协调器
  const { isReady, onEnterComplete } = usePageTransition({ pageId });
  
  // 处理动画完成
  const handleAnimationComplete = (definition: string) => {
    if (definition === 'enter') {
      onEnterComplete();
    }
  };
  
  return (
    <motion.div
      className={`animated-view-container ${className}`}
      variants={pageVariants}
      initial="initial"
      animate={isReady ? "enter" : "initial"}
      exit="exit"
      onAnimationComplete={handleAnimationComplete}
      style={{
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </motion.div>
  );
}
