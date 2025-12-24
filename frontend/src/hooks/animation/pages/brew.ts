/**
 * Brew 页专用调度器 Hooks
 * 
 * Brew 页功能需求：
 * - Stagger: 订阅源卡片和文章卡片交错入场动画
 * 
 * @example
 * ```tsx
 * // 在 Brew.tsx 中
 * import { useBrewScheduler } from '@hooks/animation/pages/brew';
 * 
 * function Brew() {
 *   useBrewScheduler();
 *   return <BrewContent />;
 * }
 * 
 * // 在 BrewSourceGrid.tsx 中
 * import { useBrewCardStagger } from '@hooks/animation/pages/brew';
 * 
 * function SourceCard({ index }) {
 *   const { canAnimate, delay, style } = useBrewCardStagger(index, 'source');
 *   return (
 *     <div style={style}>...</div>
 *   );
 * }
 * ```
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { startPage } from '../core';
import { useAnimationLevel, type AnimationConfig } from '../../useAnimationLevel';

const PAGE_ID = 'brew';

// 动画配置
const STAGGER_CONFIG = {
  source: {
    baseDelay: 40,  // 订阅源卡片延迟
    maxDelay: 400,  // 最大延迟
  },
  item: {
    baseDelay: 30,  // 文章卡片延迟
    maxDelay: 300,
  },
};

// ==================== 页面初始化 ====================

/**
 * Brew 页面调度器初始化 Hook
 * 在页面组件最顶层调用一次
 */
export function useBrewScheduler(): void {
  useEffect(() => {
    startPage(PAGE_ID);
  }, []);
}

// ==================== 动画配置 Hook ====================

/**
 * 获取 Brew 专用的动画配置
 * 根据设备性能自动调整
 */
export function useBrewAnimationConfig(): AnimationConfig & {
  /** 是否启用交错动画 */
  enableStagger: boolean;
  /** 是否启用悬浮效果 */
  enableHover: boolean;
  /** 卡片动画时长 */
  cardDuration: number;
  /** 阅读器动画时长 */
  readerDuration: number;
} {
  const baseConfig = useAnimationLevel();

  return useMemo(() => {
    const isNone = baseConfig.level === 'none';
    const isLight = baseConfig.level === 'light';

    return {
      ...baseConfig,
      enableStagger: !isNone,
      enableHover: !isNone,
      cardDuration: isNone ? 0 : isLight ? 150 : 250,
      readerDuration: isNone ? 0 : isLight ? 200 : 400,
    };
  }, [baseConfig]);
}

// ==================== Stagger Animation Hook ====================

interface BrewStaggerResult {
  /** 是否可以开始动画 */
  canAnimate: boolean;
  /** 延迟时间（毫秒） */
  delay: number;
  /** 动画完成回调 */
  onComplete: () => void;
  /** 动画配置 */
  animConfig: AnimationConfig;
  /** CSS 样式（用于初始状态） */
  initialStyle: React.CSSProperties;
  /** CSS 样式（用于动画后状态） */
  animateStyle: React.CSSProperties;
}

/**
 * Brew 卡片交错动画 Hook
 * 
 * 简化版本：使用基于 requestAnimationFrame 的延迟触发
 * 不依赖复杂的 coordinator 调度系统
 * 
 * @param index - 卡片在列表中的索引
 * @param type - 卡片类型：'source' 订阅源 | 'item' 文章
 */
export function useBrewCardStagger(
  index: number,
  type: 'source' | 'item' = 'source'
): BrewStaggerResult {
  const animConfig = useAnimationLevel();
  const config = STAGGER_CONFIG[type];

  // 动画级别为 none 时直接显示
  const isDisabled = animConfig.level === 'none';

  // 计算延迟（简化版：直接使用 index * baseDelay）
  const delay = useMemo(() => {
    if (isDisabled) return 0;
    return Math.min(index * config.baseDelay, config.maxDelay);
  }, [index, config.baseDelay, config.maxDelay, isDisabled]);

  // 状态：是否可以开始动画
  const [canAnimate, setCanAnimate] = useState(isDisabled);

  // 动画完成回调（简化版不需要通知 coordinator）
  const onComplete = useCallback(() => {
    // 空实现，保留接口兼容性
  }, []);

  useEffect(() => {
    // 动画禁用时直接完成
    if (isDisabled) {
      setCanAnimate(true);
      return;
    }

    // 使用 RAF + setTimeout 来触发延迟动画
    // RAF 确保在渲染帧开始时执行，setTimeout 提供延迟
    let timeoutId: ReturnType<typeof setTimeout>;
    let rafId: number;

    rafId = requestAnimationFrame(() => {
      timeoutId = setTimeout(() => {
        setCanAnimate(true);
      }, delay);
    });

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [delay, isDisabled]);

  // 预计算样式
  const initialStyle = useMemo<React.CSSProperties>(() => {
    if (isDisabled) return {};
    return {
      opacity: 0,
      transform: 'translateY(12px) scale(0.98)',
    };
  }, [isDisabled]);

  const animateStyle = useMemo<React.CSSProperties>(() => {
    if (isDisabled) return {};
    // 更流畅的时长和曲线
    const duration = animConfig.level === 'light' ? 200 : 320;
    return {
      opacity: canAnimate ? 1 : 0,
      transform: canAnimate ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
      // cubic-bezier(0.22, 1, 0.36, 1) = ease-out-quint, 非常自然流畅
      transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    };
  }, [isDisabled, canAnimate, animConfig.level]);

  return {
    canAnimate,
    delay,
    onComplete,
    animConfig,
    initialStyle,
    animateStyle,
  };
}

// ==================== 导出动画预设 ====================

/**
 * Brew 卡片动画预设
 * 用于 framer-motion 或 CSS 动画
 */
export const brewAnimationPresets = {
  /** 卡片入场动画 */
  cardEnter: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  /** 阅读器入场动画 */
  readerEnter: {
    initial: { opacity: 0, scale: 0.92, y: 60 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.92, y: 60 },
  },
  /** 淡入淡出 */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
} as const;

/**
 * 获取动画 transition 配置
 */
export function getBrewTransition(
  animConfig: AnimationConfig,
  type: 'card' | 'reader' | 'fade' = 'card'
): { duration: number; ease: [number, number, number, number] } {
  const durations = {
    card: animConfig.level === 'none' ? 0 : animConfig.level === 'light' ? 0.15 : 0.25,
    reader: animConfig.level === 'none' ? 0 : animConfig.level === 'light' ? 0.2 : 0.4,
    fade: animConfig.level === 'none' ? 0 : animConfig.level === 'light' ? 0.1 : 0.2,
  };

  return {
    duration: durations[type],
    ease: [0.16, 1, 0.3, 1], // spring-like easing
  };
}
