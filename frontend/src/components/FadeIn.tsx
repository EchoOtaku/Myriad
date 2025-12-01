/**
 * FadeIn 组件 - 受页面动画调度的淡入动画
 * 
 * 使用方式：
 * 1. 包裹需要淡入效果的组件
 * 2. 组件会在页面动画完成后自动淡入显示
 * 3. 可以通过 delay 属性设置额外延迟
 * 
 * 特点：
 * - 自动等待页面级动画完成后再执行
 * - 支持交错动画（通过 staggerIndex）
 * - 使用 CSS 过渡实现平滑效果
 */

import { useEffect, useState, useRef, ReactNode, CSSProperties } from 'react';
import { useElementAnimation } from '../hooks/animation';

interface FadeInProps {
  /** 子内容 */
  children: ReactNode;
  /** 淡入延迟（毫秒） */
  delay?: number;
  /** 动画持续时间（毫秒） */
  duration?: number;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 是否禁用动画（直接显示） */
  disabled?: boolean;
  /** 淡入方向：fade-仅透明度，up-从下往上，down-从上往下 */
  direction?: 'fade' | 'up' | 'down';
  /** 交错索引 - 用于计算交错延迟 */
  staggerIndex?: number;
  /** 交错基础延迟（毫秒） */
  staggerDelay?: number;
  /** 是否等待页面动画完成 */
  waitForPage?: boolean;
  /** 分组ID */
  groupId?: string;
}

/**
 * 单组件淡入包装器
 * 组件挂载后自动平滑淡入，遵循协调器调度
 */
export default function FadeIn({
  children,
  delay = 0,
  duration = 350,
  className = '',
  style,
  disabled = false,
  direction = 'fade',
  staggerIndex = 0,
  staggerDelay = 50,
  waitForPage = true,
  groupId = 'fadein',
}: FadeInProps) {
  // 使用新的动画协调系统
  const { canAnimate, onComplete } = useElementAnimation({
    groupId,
    index: staggerIndex,
    staggerDelay,
    waitForPage: !disabled && waitForPage,
  });

  const [isVisible, setIsVisible] = useState(disabled);
  const ref = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const hasCompletedRef = useRef(false);

  // 协调器通知可以开始动画后，再应用额外延迟
  useEffect(() => {
    mountedRef.current = true;
    
    if (disabled) {
      setIsVisible(true);
      return;
    }
    
    if (!canAnimate) return;

    // 只应用额外的 delay（交错延迟已由协调器处理）
    if (delay > 0) {
      const timeoutId = window.setTimeout(() => {
        if (mountedRef.current) {
          setIsVisible(true);
        }
      }, delay);
      
      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      setIsVisible(true);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [delay, disabled, canAnimate]);

  useEffect(() => {
    if (hasCompletedRef.current) return;

    if (disabled) {
      hasCompletedRef.current = true;
      onComplete();
      return;
    }

    if (!canAnimate || !isVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!hasCompletedRef.current) {
        hasCompletedRef.current = true;
        onComplete();
      }
    }, duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canAnimate, isVisible, duration, disabled, onComplete]);

  // 计算初始和最终的 transform
  const getTransform = () => {
    if (disabled) return 'none';
    
    switch (direction) {
      case 'up':
        return isVisible ? 'translateY(0)' : 'translateY(12px)';
      case 'down':
        return isVisible ? 'translateY(0)' : 'translateY(-12px)';
      default:
        return 'none';
    }
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: getTransform(),
        transition: disabled ? 'none' : `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        willChange: isVisible ? 'auto' : 'opacity, transform',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// 向后兼容导出
export { resetPageAnimationState } from '../hooks/usePageReady';

/**
 * 带骨架屏的 FadeIn
 * 在内容加载前显示骨架屏，加载后平滑切换
 */
interface FadeInWithSkeletonProps extends Omit<FadeInProps, 'disabled'> {
  /** 是否正在加载 */
  loading: boolean;
  /** 骨架屏内容 */
  skeleton: ReactNode;
  /** 最小骨架屏显示时间（避免闪烁） */
  minSkeletonTime?: number;
}

export function FadeInWithSkeleton({
  children,
  loading,
  skeleton,
  delay = 0,
  duration = 350,
  minSkeletonTime = 200,
  className = '',
  style,
  direction = 'fade',
  staggerIndex = 0,
  staggerDelay = 50,
  waitForPage = true,
  groupId = 'fadein-skeleton',
}: FadeInWithSkeletonProps & { groupId?: string }) {
  // 使用新的动画协调系统
  const { canAnimate, onComplete } = useElementAnimation({
    groupId,
    index: staggerIndex,
    staggerDelay,
    waitForPage,
  });

  const [showContent, setShowContent] = useState(!loading);
  const [isContentVisible, setIsContentVisible] = useState(!loading);
  const loadStartRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    
    if (loading) {
      loadStartRef.current = Date.now();
      setShowContent(false);
      setIsContentVisible(false);
    } else if (canAnimate) {
      // 确保骨架屏至少显示 minSkeletonTime
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, minSkeletonTime - elapsed);
      const totalDelay = delay;

      const timer1 = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setShowContent(true);
        
        // 等待 DOM 更新后再淡入
        requestAnimationFrame(() => {
          const timer2 = window.setTimeout(() => {
            if (mountedRef.current) {
              setIsContentVisible(true);
            }
          }, totalDelay);
          return () => clearTimeout(timer2);
        });
      }, remaining);

      return () => {
        clearTimeout(timer1);
      };
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [loading, delay, minSkeletonTime, canAnimate]);

  useEffect(() => {
    if (hasCompletedRef.current) return;
    if (!canAnimate || !showContent || !isContentVisible) return;

    const timer = window.setTimeout(() => {
      if (!hasCompletedRef.current) {
        hasCompletedRef.current = true;
        onComplete();
      }
    }, duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canAnimate, showContent, isContentVisible, duration, onComplete]);

  const getTransform = () => {
    switch (direction) {
      case 'up':
        return isContentVisible ? 'translateY(0)' : 'translateY(12px)';
      case 'down':
        return isContentVisible ? 'translateY(0)' : 'translateY(-12px)';
      default:
        return 'none';
    }
  };

  return (
    <div className={`relative ${className}`} style={style}>
      {/* 骨架屏层 */}
      <div
        style={{
          position: showContent ? 'absolute' : 'relative',
          inset: 0,
          opacity: showContent ? 0 : 1,
          transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          pointerEvents: showContent ? 'none' : 'auto',
        }}
      >
        {skeleton}
      </div>

      {/* 内容层 */}
      {showContent && (
        <div
          style={{
            opacity: isContentVisible ? 1 : 0,
            transform: getTransform(),
            transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
