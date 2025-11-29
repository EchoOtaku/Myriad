/**
 * 光晕背景组件 - 共享性能优化版本
 * 
 * 性能优化策略：
 * 1. 使用 React.memo 避免父组件状态变化导致重渲染
 * 2. 使用 will-change 提示浏览器启用 GPU 加速
 * 3. 使用 transform3d 强制创建合成层
 * 4. 使用更长的动画周期减少重绘频率
 */

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';

// ========== 动画配置常量 ==========
// 使用较长的 duration 减少 CPU 开销

/** 第一个光晕动画 - 主光源 */
const GLOW_ANIMATION_1 = {
  opacity: [0.08, 0.15, 0.08],
  scale: [1, 1.1, 1],
};

const GLOW_ANIMATION_1_STATIC = {
  opacity: 0.1,
  scale: 1,
};

const GLOW_TRANSITION_1 = {
  duration: 12, // 延长至 12 秒 (原 8 秒 +50%)
  repeat: Infinity,
  ease: 'linear' as const,
  repeatType: 'mirror' as const,
};

/** 第二个光晕动画 - 副光源 */
const GLOW_ANIMATION_2 = {
  opacity: [0.04, 0.1, 0.04],
  scale: [1.05, 1, 1.05],
};

const GLOW_ANIMATION_2_STATIC = {
  opacity: 0.06,
  scale: 1,
};

const GLOW_TRANSITION_2 = {
  duration: 15, // 延长至 15 秒 (原 10 秒 +50%)
  repeat: Infinity,
  ease: 'linear' as const,
  repeatType: 'mirror' as const,
  delay: 2,
};

const GLOW_TRANSITION_STATIC = {
  duration: 0,
};

// ========== 组件接口 ==========

export interface GlowBackgroundProps {
  /** 光晕颜色 (CSS 颜色值或 CSS 变量) */
  color: string;
  /** 动画级别 */
  animLevel: 'none' | 'light' | 'standard';
  /** 是否启用动画 */
  shouldAnimate: boolean;
  /** 
   * 布局变体：
   * - 'single': 单光晕 (右上角)
   * - 'dual': 双光晕 (右上 + 左下)
   * - 'single-left': 单光晕 (左下角)
   */
  variant?: 'single' | 'dual' | 'single-left';
  /** 光晕大小 (sm/md/lg) */
  size?: 'sm' | 'md' | 'lg';
  /** 自定义透明度 (0-1) */
  opacity?: number;
}

/**
 * 光晕背景组件 - Memoized 性能优化版本
 */
export const GlowBackground = memo(function GlowBackground({
  color,
  animLevel,
  shouldAnimate,
  variant = 'single',
  size = 'md',
  opacity,
}: GlowBackgroundProps) {
  const blurClass = animLevel === 'standard' ? 'blur-3xl' : 'blur-xl';

  // 根据 size 确定尺寸类
  const sizeClasses = useMemo(() => {
    switch (size) {
      case 'sm':
        return { primary: 'w-24 h-24', secondary: 'w-20 h-20' };
      case 'lg':
        return { primary: 'w-48 h-48', secondary: 'w-40 h-40' };
      default:
        return { primary: 'w-32 h-32', secondary: 'w-24 h-24' };
    }
  }, [size]);

  // GPU 加速样式
  const gpuAccelStyle = useMemo(() => ({
    background: color,
    willChange: shouldAnimate ? 'opacity, transform' : 'auto',
    transform: 'translate3d(0, 0, 0)', // 强制创建合成层
    ...(opacity !== undefined && { opacity }),
  }), [color, shouldAnimate, opacity]);

  // 根据 variant 渲染不同布局
  if (variant === 'single-left') {
    return (
      <motion.div
        className={`absolute -left-8 -bottom-8 ${sizeClasses.primary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={shouldAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={shouldAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
      />
    );
  }

  if (variant === 'single') {
    return (
      <motion.div
        className={`absolute -right-8 -top-8 ${sizeClasses.primary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={shouldAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={shouldAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
      />
    );
  }

  // dual variant
  return (
    <>
      {/* 第一个光晕 - 右上角 */}
      <motion.div
        className={`absolute -right-8 -top-8 ${sizeClasses.primary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={shouldAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={shouldAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
      />
      {/* 第二个光晕 - 左下角 */}
      <motion.div
        className={`absolute -left-6 -bottom-6 ${sizeClasses.secondary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={shouldAnimate ? GLOW_ANIMATION_2 : GLOW_ANIMATION_2_STATIC}
        transition={shouldAnimate ? GLOW_TRANSITION_2 : GLOW_TRANSITION_STATIC}
      />
    </>
  );
});

export default GlowBackground;
