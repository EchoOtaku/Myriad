/**
 * 页面过渡动画包装器
 * 使用 framer-motion 实现流畅的进入和退出动画
 * 与统一动画协调器配合
 * 
 * 特性:
 * - 页面级动画享有最高优先级
 * - 自动与 AnimationCoordinator 集成
 * - 支持 framer-motion 懒加载
 * - 🔧 优化：退出动画使用绝对定位避免布局跳变
 * - 🔧 优化：动画完成后释放 GPU 资源
 * - 🔧 优化：使用 contain 属性隔离渲染
 */

import { motionShim as motion } from '@lib/motionShim';
import type { Variants } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePageTransition } from '../hooks/animation';

interface AnimatedViewProps {
  children: React.ReactNode;
  className?: string;
}

/** 动画阶段枚举 */
enum PageAnimationPhase {
  /** 初始状态 */
  INITIAL = 'initial',
  /** 进入动画中 */
  ENTERING = 'entering',
  /** 已进入，显示内容 */
  ENTERED = 'entered',
  /** 退出动画中 */
  EXITING = 'exiting',
}

/**
 * 页面动画变体配置
 * - 进入: 从下方淡入，带轻微缩放
 * - 退出: 快速淡出，使用绝对定位脱离文档流
 * 
 * 🔧 优化：退出时使用 position: absolute 避免影响新页面布局
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
    // 🔧 退出时脱离文档流，避免布局跳变
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
  
  // 🔧 优化：追踪动画阶段
  const [phase, setPhase] = useState<PageAnimationPhase>(PageAnimationPhase.INITIAL);
  const hasEnteredRef = useRef(false);
  
  // 🔧 优化：当路由变化时重置状态
  useEffect(() => {
    hasEnteredRef.current = false;
    setPhase(PageAnimationPhase.INITIAL);
  }, [location.pathname]);
  
  // 🔧 优化：当 isReady 变为 true 时开始进入动画
  useEffect(() => {
    if (isReady && !hasEnteredRef.current) {
      setPhase(PageAnimationPhase.ENTERING);
    }
  }, [isReady]);
  
  // 处理动画完成
  const handleAnimationComplete = useCallback((definition: string) => {
    if (definition === 'enter') {
      hasEnteredRef.current = true;
      setPhase(PageAnimationPhase.ENTERED);
      onEnterComplete();
    } else if (definition === 'exit') {
      setPhase(PageAnimationPhase.EXITING);
    }
  }, [onEnterComplete]);
  
  // 🔧 优化：根据动画阶段计算样式
  const containerStyle = useMemo(() => {
    const base: React.CSSProperties = {};
    
    switch (phase) {
      case PageAnimationPhase.INITIAL:
      case PageAnimationPhase.ENTERING:
        // 动画进行中，启用 GPU 加速
        base.willChange = 'opacity, transform';
        // 🔧 使用 contain 隔离布局计算
        base.contain = 'layout style';
        break;
        
      case PageAnimationPhase.ENTERED:
        // 🔧 动画完成，释放 GPU 资源
        // 不设置 willChange，让浏览器回收合成层
        base.contain = 'none';
        break;
        
      case PageAnimationPhase.EXITING:
        // 退出时保持 GPU 加速
        base.willChange = 'opacity, transform';
        // 🔧 退出时完全隔离，不影响新页面
        base.contain = 'strict';
        break;
    }
    
    return base;
  }, [phase]);
  
  return (
    <motion.div
      className={`animated-view-container ${className}`}
      variants={pageVariants}
      initial="initial"
      animate={isReady ? "enter" : "initial"}
      exit="exit"
      onAnimationComplete={handleAnimationComplete}
      style={containerStyle}
    >
      {children}
    </motion.div>
  );
}
