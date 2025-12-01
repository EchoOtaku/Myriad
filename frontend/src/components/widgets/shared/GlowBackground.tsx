/**
 * 光晕背景组件 - 共享性能优化版本
 * 
 * 性能优化策略：
 * 1. 使用 React.memo 避免父组件状态变化导致重渲染
 * 2. 使用 will-change 提示浏览器启用 GPU 加速
 * 3. 使用 transform3d 强制创建合成层
 * 4. 使用更长的动画周期减少重绘频率
 * 5. 🆕 接入动画调度器，限制同时运行的动画数量
 * 6. 🔑 使用同步初始配置，避免首屏闪烁
 * 7. 🚀 使用静态动画常量，避免每次渲染创建新对象
 */

import { memo, useMemo, useId } from 'react';
import { motionShim as motion } from '@lib/motionShim';
import { useLoopAnimation, LoopPriority } from '../../../hooks/animation';
import { getAnimationConfigSync } from '../../../hooks/useAnimationLevel';

// 🔑 模块加载时同步获取动画配置，确保首次渲染正确
const INITIAL_ANIM_CONFIG = getAnimationConfigSync();

// ========== 静态动画常量（避免每次渲染创建新对象）==========

/** 第一个光晕动画 - 主光源 */
const GLOW_ANIMATION_1 = {
  opacity: [0.08, 0.15, 0.08],
  scale: [1, 1.1, 1],
};

const GLOW_ANIMATION_1_STATIC = {
  opacity: 0.1,
  scale: 1,
};

// 改为有限次数，配合调度器 duration=12000ms
const GLOW_TRANSITION_1 = {
  duration: 12,
  repeat: 0, // 只运行一轮，由调度器控制重新播放
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

// 改为有限次数
const GLOW_TRANSITION_2 = {
  duration: 12, // 统一为 12s，配合调度器
  repeat: 0,
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
  // 🆕 使用统一动画调度器管理循环动画 - 光晕是装饰动画，优先级最低
  const uniqueId = useId();
  const { isAnimating } = useLoopAnimation({
    duration: 12000, // 12秒一个周期
    cooldown: 8000, // 冷却 8 秒后重新加入队列
    autoRequest: shouldAnimate,
    loopPriority: LoopPriority.DECORATIVE, // 装饰动画，可被抢占
  });
  
  // 只有在调度器分配了槽位且允许动画时才真正动画
  const canAnimate = shouldAnimate && isAnimating;
  
  // 🔑 关键修复：直接使用模块级同步配置
  // animLevel prop 来自 useAnimationLevel hook，可能在首次渲染时值不正确
  // 但 INITIAL_ANIM_CONFIG 是在模块加载时就同步计算好的，保证正确
  // 由于我们已经修复了 useAnimationLevel hook，现在 animLevel 应该始终正确
  // 但为了双重保险，这里仍使用 INITIAL_ANIM_CONFIG.level 作为可靠基准
  const blurClass = INITIAL_ANIM_CONFIG.level === 'standard' ? 'blur-3xl' : 'blur-xl';

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
    willChange: canAnimate ? 'opacity, transform' : 'auto',
    transform: 'translate3d(0, 0, 0)', // 强制创建合成层
    ...(opacity !== undefined && { opacity }),
  }), [color, canAnimate, opacity]);

  // 根据 variant 渲染不同布局
  if (variant === 'single-left') {
    return (
      <motion.div
        className={`absolute -left-8 -bottom-8 ${sizeClasses.primary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={canAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={canAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
      />
    );
  }

  if (variant === 'single') {
    return (
      <motion.div
        className={`absolute -right-8 -top-8 ${sizeClasses.primary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={canAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={canAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
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
        animate={canAnimate ? GLOW_ANIMATION_1 : GLOW_ANIMATION_1_STATIC}
        transition={canAnimate ? GLOW_TRANSITION_1 : GLOW_TRANSITION_STATIC}
      />
      {/* 第二个光晕 - 左下角 */}
      <motion.div
        className={`absolute -left-6 -bottom-6 ${sizeClasses.secondary} rounded-full pointer-events-none ${blurClass}`}
        style={gpuAccelStyle}
        animate={canAnimate ? GLOW_ANIMATION_2 : GLOW_ANIMATION_2_STATIC}
        transition={canAnimate ? GLOW_TRANSITION_2 : GLOW_TRANSITION_STATIC}
      />
    </>
  );
});

export default GlowBackground;
