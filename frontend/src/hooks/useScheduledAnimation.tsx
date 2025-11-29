/**
 * 调度型动画组件
 * 
 * 这些组件会自动使用动画调度器来限制同时运行的动画数量
 * 适合在大量元素需要动画时使用
 */

import { motion, AnimatePresence, Transition, Variants } from 'framer-motion';
import { ComponentProps, useMemo, useEffect, useCallback, useRef, useState } from 'react';
import { useAnimationSlot, useStaggeredAnimation, globalAnimationScheduler } from './useAnimationScheduler';
import { useAnimationLevel, AnimationConfig } from './useAnimationLevel';

// ==================== 调度型 Motion 组件 ====================

type MotionDivProps = ComponentProps<typeof motion.div>;

interface ScheduledMotionProps extends Omit<MotionDivProps, 'animate'> {
  /** 动画唯一 ID，用于调度器识别 */
  animationId: string;
  /** 动画优先级 (1-10, 10 最高) */
  priority?: number;
  /** 预估动画持续时间 (ms) */
  duration?: number;
  /** 激活时的动画属性 */
  animateActive?: MotionDivProps['animate'];
  /** 非激活/等待时的动画属性 */
  animateIdle?: MotionDivProps['animate'];
  /** 是否自动请求动画槽位 */
  autoRequest?: boolean;
}

/**
 * 调度型 motion.div
 * 
 * 会自动等待调度器分配槽位后才开始动画
 */
export function ScheduledMotionDiv({
  animationId,
  priority = 5,
  duration = 500,
  animateActive,
  animateIdle,
  autoRequest = true,
  ...props
}: ScheduledMotionProps) {
  const { isAnimating, requestAnimation } = useAnimationSlot(animationId, {
    priority,
    duration,
    autoRequest,
  });

  return (
    <motion.div
      {...props}
      animate={isAnimating ? animateActive : animateIdle}
    />
  );
}

// ==================== 分批加载动画 ====================

interface BatchedListProps<T> {
  /** 数据列表 */
  items: T[];
  /** 渲染每个项目的函数 */
  renderItem: (item: T, index: number, isAnimating: boolean) => React.ReactNode;
  /** 每批次处理的数量 */
  batchSize?: number;
  /** 批次间隔 (ms) */
  batchDelay?: number;
  /** 列表容器的 className */
  className?: string;
  /** 每个项目的唯一 key */
  keyExtractor: (item: T, index: number) => string;
}

/**
 * 分批动画列表
 * 
 * 将列表项按批次依次显示，避免大量动画同时启动
 */
export function BatchedAnimationList<T>({
  items,
  renderItem,
  batchSize = 5,
  batchDelay = 100,
  className,
  keyExtractor,
}: BatchedListProps<T>) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [animatedIndices, setAnimatedIndices] = useState<Set<number>>(new Set());
  const animationLevel = useAnimationLevel();

  useEffect(() => {
    if (!animationLevel.loop) {
      // 如果禁用循环动画，直接显示所有
      setVisibleCount(items.length);
      return;
    }

    setVisibleCount(0);
    setAnimatedIndices(new Set());

    let currentBatch = 0;
    const totalBatches = Math.ceil(items.length / batchSize);

    const showNextBatch = () => {
      if (currentBatch >= totalBatches) return;

      const startIndex = currentBatch * batchSize;
      const endIndex = Math.min(startIndex + batchSize, items.length);

      setVisibleCount(endIndex);

      // 标记这批次的项目为正在动画
      const newAnimatedIndices = new Set<number>();
      for (let i = startIndex; i < endIndex; i++) {
        newAnimatedIndices.add(i);
      }
      setAnimatedIndices((prev: Set<number>) => new Set([...prev, ...newAnimatedIndices]));

      currentBatch++;
      if (currentBatch < totalBatches) {
        setTimeout(showNextBatch, batchDelay);
      }
    };

    // 开始第一批
    const timer = setTimeout(showNextBatch, 50);
    return () => clearTimeout(timer);
  }, [items.length, batchSize, batchDelay, animationLevel.loop]);

  const visibleItems = items.slice(0, visibleCount);

  return (
    <div className={className}>
      {visibleItems.map((item, index) => (
        <div key={keyExtractor(item, index)}>
          {renderItem(item, index, animatedIndices.has(index))}
        </div>
      ))}
    </div>
  );
}

// ==================== 智能动画管理器 ====================

interface AnimationThrottleConfig {
  /** 每秒最大动画数 */
  maxPerSecond: number;
  /** 持续时间窗口 (ms) */
  windowMs: number;
}

class AnimationThrottle {
  private timestamps: number[] = [];
  private config: AnimationThrottleConfig;

  constructor(config: Partial<AnimationThrottleConfig> = {}) {
    this.config = {
      maxPerSecond: 10,
      windowMs: 1000,
      ...config,
    };
  }

  /** 检查是否可以启动新动画 */
  canStart(): boolean {
    this.cleanup();
    return this.timestamps.length < this.config.maxPerSecond;
  }

  /** 记录一个动画启动 */
  record() {
    this.cleanup();
    this.timestamps.push(Date.now());
  }

  /** 获取当前窗口内的动画数量 */
  getCurrentCount(): number {
    this.cleanup();
    return this.timestamps.length;
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    this.timestamps = this.timestamps.filter(t => t > cutoff);
  }
}

export const globalAnimationThrottle = new AnimationThrottle({ maxPerSecond: 15 });

/**
 * 使用节流动画
 * 
 * 如果当前时间窗口内启动的动画过多，会返回 false
 */
export function useThrottledAnimation() {
  const canAnimate = useCallback(() => {
    if (!globalAnimationThrottle.canStart()) {
      return false;
    }
    globalAnimationThrottle.record();
    return true;
  }, []);

  return { canAnimate, getCurrentCount: () => globalAnimationThrottle.getCurrentCount() };
}

// ==================== 视口内动画 ====================

interface ViewportAnimationProps extends MotionDivProps {
  /** 进入视口多少比例后开始动画 */
  threshold?: number;
  /** 只动画一次 */
  once?: boolean;
}

/**
 * 只在视口内才执行动画的组件
 */
export function ViewportMotionDiv({
  threshold = 0.1,
  once = true,
  ...props
}: ViewportAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (once && hasAnimated.current) return;
          setIsInView(true);
          hasAnimated.current = true;
        } else if (!once) {
          setIsInView(false);
        }
      },
      { threshold }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, once]);

  return (
    <motion.div
      ref={ref}
      {...props}
      initial={props.initial}
      animate={isInView ? props.animate : props.initial}
    />
  );
}

// ==================== 性能感知动画 ====================

/**
 * 根据当前性能自动调整动画复杂度
 */
export function usePerformanceAwareAnimation<T extends object>(
  fullAnimation: T,
  reducedAnimation: T,
  options: {
    /** RAF/秒超过此值时使用简化动画 */
    rafThreshold?: number;
    /** 同时动画数超过此值时使用简化动画 */
    concurrentThreshold?: number;
  } = {}
) {
  const { rafThreshold = 120, concurrentThreshold = 10 } = options;
  const animLevel = useAnimationLevel();
  const [useReduced, setUseReduced] = useState(!animLevel.loop);

  useEffect(() => {
    // 如果用户设置禁用循环动画，直接使用简化版
    if (!animLevel.loop) {
      setUseReduced(true);
      return;
    }

    // 检查调度器状态
    const stats = globalAnimationScheduler.getStats();
    if (stats.activeCount > concurrentThreshold) {
      setUseReduced(true);
    } else {
      setUseReduced(false);
    }
  }, [animLevel.loop, concurrentThreshold]);

  return useReduced ? reducedAnimation : fullAnimation;
}

// ==================== 预设动画变体 ====================

/** 淡入动画变体 */
export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** 滑入动画变体 */
export const slideInVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/** 缩放动画变体 */
export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
};

/** 获取性能优化的 transition */
export function getOptimizedTransition(
  animLevel: AnimationConfig,
  type: 'fast' | 'normal' | 'slow' = 'normal'
): Transition {
  const baseDuration = {
    fast: 0.15,
    normal: 0.3,
    slow: 0.5,
  }[type];

  if (!animLevel.spring) {
    // 不使用弹簧动画时，使用简单的 ease
    return {
      duration: baseDuration * animLevel.durationScale,
      ease: 'easeOut',
    };
  }

  return {
    type: 'spring',
    stiffness: 300,
    damping: 25,
    mass: 0.5,
  };
}
