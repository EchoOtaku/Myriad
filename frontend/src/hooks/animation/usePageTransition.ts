/**
 * 页面过渡 Hook
 * 
 * 用于 AnimatedView 等页面级组件
 * 管理页面进入/退出动画的生命周期
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { coordinator } from './coordinator';
import { AnimationPriority } from './types';

interface UsePageTransitionOptions {
  /** 页面唯一标识 */
  pageId: string;
}

interface PageTransitionResult {
  /** 是否可以开始动画 */
  isReady: boolean;
  /** 进入动画完成回调 */
  onEnterComplete: () => void;
  /** 退出动画完成回调 */
  onExitComplete: () => void;
}

/**
 * 页面过渡 Hook
 * 
 * @example
 * ```tsx
 * function AnimatedView({ children, id }) {
 *   const { isReady, onEnterComplete } = usePageTransition({ pageId: id });
 *   
 *   return (
 *     <motion.div
 *       animate={isReady ? 'enter' : 'initial'}
 *       onAnimationComplete={onEnterComplete}
 *     >
 *       {children}
 *     </motion.div>
 *   );
 * }
 * ```
 */
export function usePageTransition({ pageId }: UsePageTransitionOptions): PageTransitionResult {
  const [isReady, setIsReady] = useState(false);
  const hasStarted = useRef(false);
  const animationId = `page-${pageId}`;

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    // 通知协调器开始页面过渡
    coordinator.startPageTransition(pageId);
    
    // 调度页面动画
    coordinator.schedule({
      id: animationId,
      priority: AnimationPriority.PAGE,
    });

    // 页面级动画立即开始
    // 使用 RAF 确保在下一帧开始，避免闪烁
    requestAnimationFrame(() => {
      setIsReady(true);
    });

    return () => {
      hasStarted.current = false;
    };
  }, [pageId, animationId]);

  const onEnterComplete = useCallback(() => {
    coordinator.markCompleted(animationId);
    coordinator.completePageTransition();
  }, [animationId]);

  const onExitComplete = useCallback(() => {
    // 退出动画完成，可以进行清理
  }, []);

  return {
    isReady,
    onEnterComplete,
    onExitComplete,
  };
}

export default usePageTransition;
