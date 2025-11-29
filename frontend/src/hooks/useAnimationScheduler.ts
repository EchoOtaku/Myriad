/**
 * 动画调度器 - 限制同时运行的动画数量
 * 
 * 通过队列管理动画，避免大量动画同时运行导致性能问题
 * 
 * 使用方式：
 * ```tsx
 * const { requestAnimation, isAnimating } = useAnimationSlot('my-animation');
 * 
 * useEffect(() => {
 *   if (shouldAnimate) {
 *     requestAnimation(() => {
 *       // 动画开始时的回调
 *     });
 *   }
 * }, [shouldAnimate]);
 * 
 * return <motion.div animate={isAnimating ? animateProps : staticProps} />
 * ```
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// ==================== 全局动画调度器 ====================

interface AnimationSlot {
  id: string;
  priority: number;
  startTime: number;
  duration: number;
  onStart?: () => void;
  onEnd?: () => void;
}

interface AnimationSchedulerConfig {
  /** 最大同时运行的动画数量 */
  maxConcurrent: number;
  /** 动画之间的最小间隔 (ms) */
  minInterval: number;
  /** 默认动画持续时间 (ms) */
  defaultDuration: number;
  /** 队列最大长度，超出后丢弃低优先级动画 */
  maxQueueSize: number;
}

const DEFAULT_CONFIG: AnimationSchedulerConfig = {
  maxConcurrent: 8,      // 最多同时 8 个动画
  minInterval: 50,       // 动画之间至少间隔 50ms
  defaultDuration: 500,  // 默认动画 500ms
  maxQueueSize: 20,      // 队列最多 20 个待执行动画
};

class AnimationScheduler {
  private config: AnimationSchedulerConfig;
  private activeSlots: Map<string, AnimationSlot> = new Map();
  private queue: AnimationSlot[] = [];
  private lastStartTime: number = 0;
  private listeners: Map<string, Set<(active: boolean) => void>> = new Map();
  private processingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<AnimationSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 更新配置 */
  updateConfig(config: Partial<AnimationSchedulerConfig>) {
    this.config = { ...this.config, ...config };
  }

  /** 请求动画槽位 */
  request(
    id: string, 
    options: {
      priority?: number;
      duration?: number;
      onStart?: () => void;
      onEnd?: () => void;
    } = {}
  ): boolean {
    const { priority = 5, duration = this.config.defaultDuration, onStart, onEnd } = options;

    // 如果已经在运行，直接返回 true
    if (this.activeSlots.has(id)) {
      return true;
    }

    // 检查是否可以立即开始
    if (this.canStart()) {
      this.startAnimation(id, priority, duration, onStart, onEnd);
      return true;
    }

    // 🆕 高优先级（1-2）可以抢占低优先级动画
    if (priority <= 2) {
      const preempted = this.tryPreempt(id, priority, duration, onStart, onEnd);
      if (preempted) {
        return true;
      }
    }

    // 加入队列
    this.enqueue({ id, priority, duration, startTime: 0, onStart, onEnd });
    return false;
  }

  /** 🆕 尝试抢占低优先级动画 */
  private tryPreempt(
    id: string,
    priority: number,
    duration: number,
    onStart?: () => void,
    onEnd?: () => void
  ): boolean {
    // 找到优先级最低的活动动画
    let lowestPrioritySlot: AnimationSlot | null = null;
    let lowestPriority = priority; // 只抢占比自己优先级低的

    for (const slot of this.activeSlots.values()) {
      // 优先级数字越大，优先级越低
      if (slot.priority > lowestPriority) {
        lowestPriority = slot.priority;
        lowestPrioritySlot = slot;
      }
    }

    // 如果找到可抢占的槽位
    if (lowestPrioritySlot && lowestPrioritySlot.priority >= 5) {
      // 只抢占优先级 >= 5 的动画（中等及以下）
      // 释放被抢占的动画
      this.activeSlots.delete(lowestPrioritySlot.id);
      this.notifyListeners(lowestPrioritySlot.id, false);
      lowestPrioritySlot.onEnd?.();
      
      // 启动新动画
      this.startAnimation(id, priority, duration, onStart, onEnd);
      return true;
    }

    return false;
  }

  /** 释放动画槽位 */
  release(id: string) {
    const slot = this.activeSlots.get(id);
    if (slot) {
      slot.onEnd?.();
      this.activeSlots.delete(id);
      this.notifyListeners(id, false);
      this.processQueue();
    }
  }

  /** 检查动画是否在运行 */
  isActive(id: string): boolean {
    return this.activeSlots.has(id);
  }

  /** 订阅动画状态变化 */
  subscribe(id: string, callback: (active: boolean) => void): () => void {
    if (!this.listeners.has(id)) {
      this.listeners.set(id, new Set());
    }
    this.listeners.get(id)!.add(callback);

    // 立即通知当前状态
    callback(this.activeSlots.has(id));

    return () => {
      this.listeners.get(id)?.delete(callback);
      if (this.listeners.get(id)?.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  /** 获取调度器状态 */
  getStats() {
    return {
      activeCount: this.activeSlots.size,
      queueLength: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
    };
  }

  private canStart(): boolean {
    const now = Date.now();
    return (
      this.activeSlots.size < this.config.maxConcurrent &&
      now - this.lastStartTime >= this.config.minInterval
    );
  }

  private startAnimation(
    id: string,
    priority: number,
    duration: number,
    onStart?: () => void,
    onEnd?: () => void
  ) {
    const now = Date.now();
    const slot: AnimationSlot = {
      id,
      priority,
      startTime: now,
      duration,
      onStart,
      onEnd,
    };

    this.activeSlots.set(id, slot);
    this.lastStartTime = now;
    this.notifyListeners(id, true);
    onStart?.();

    // 自动释放
    setTimeout(() => {
      if (this.activeSlots.get(id)?.startTime === now) {
        this.release(id);
      }
    }, duration);
  }

  private enqueue(slot: AnimationSlot) {
    // 检查是否已在队列中
    const existingIndex = this.queue.findIndex(s => s.id === slot.id);
    if (existingIndex !== -1) {
      // 更新优先级
      this.queue[existingIndex] = slot;
    } else {
      this.queue.push(slot);
    }

    // 按优先级排序（高优先级在前）
    this.queue.sort((a, b) => b.priority - a.priority);

    // 限制队列大小
    if (this.queue.length > this.config.maxQueueSize) {
      this.queue = this.queue.slice(0, this.config.maxQueueSize);
    }

    // 延迟处理队列
    this.scheduleProcessQueue();
  }

  private scheduleProcessQueue() {
    if (this.processingTimer) return;
    
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null;
      this.processQueue();
    }, this.config.minInterval);
  }

  private processQueue() {
    while (this.queue.length > 0 && this.canStart()) {
      const slot = this.queue.shift()!;
      this.startAnimation(slot.id, slot.priority, slot.duration, slot.onStart, slot.onEnd);
    }

    // 如果队列还有待处理项，继续调度
    if (this.queue.length > 0) {
      this.scheduleProcessQueue();
    }
  }

  private notifyListeners(id: string, active: boolean) {
    this.listeners.get(id)?.forEach(cb => cb(active));
  }
}

// 全局调度器实例
export const globalAnimationScheduler = new AnimationScheduler();

// ==================== React Hooks ====================

/**
 * 使用动画槽位
 * 
 * @param id 动画唯一标识
 * @param options 配置选项
 * @returns isAnimating: 是否正在动画中, requestAnimation: 请求动画
 */
export function useAnimationSlot(
  id: string,
  options: {
    priority?: number;
    duration?: number;
    autoRequest?: boolean;
    /** 组件卸载时是否释放槽位，默认 true。设为 false 可让动画自然完成后再释放 */
    releaseOnUnmount?: boolean;
  } = {}
) {
  const { priority = 5, duration = 500, autoRequest = false, releaseOnUnmount = true } = options;
  const [isAnimating, setIsAnimating] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    const unsubscribe = globalAnimationScheduler.subscribe(id, (active) => {
      if (mountedRef.current) {
        setIsAnimating(active);
      }
    });

    if (autoRequest) {
      globalAnimationScheduler.request(id, { priority, duration });
    }

    return () => {
      mountedRef.current = false;
      unsubscribe();
      // 只有 releaseOnUnmount 为 true 时才在卸载时释放
      if (releaseOnUnmount) {
        globalAnimationScheduler.release(id);
      }
    };
  }, [id, autoRequest, priority, duration, releaseOnUnmount]);

  const requestAnimation = useCallback((onStart?: () => void) => {
    return globalAnimationScheduler.request(id, { priority, duration, onStart });
  }, [id, priority, duration]);

  const releaseAnimation = useCallback(() => {
    globalAnimationScheduler.release(id);
  }, [id]);

  return { isAnimating, requestAnimation, releaseAnimation };
}

/**
 * 批量动画控制 - 让一组动画按顺序/间隔执行
 * 
 * @param ids 动画 ID 数组
 * @param options 配置
 */
export function useStaggeredAnimation(
  ids: string[],
  options: {
    staggerMs?: number;
    priority?: number;
    duration?: number;
  } = {}
) {
  const { staggerMs = 100, priority = 5, duration = 500 } = options;
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    ids.forEach((id, index) => {
      const unsub = globalAnimationScheduler.subscribe(id, (active) => {
        setActiveIds(prev => {
          const next = new Set(prev);
          if (active) next.add(id);
          else next.delete(id);
          return next;
        });
      });
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [ids.join(',')]);

  const startStaggered = useCallback(() => {
    ids.forEach((id, index) => {
      setTimeout(() => {
        globalAnimationScheduler.request(id, { priority, duration });
      }, index * staggerMs);
    });
  }, [ids, staggerMs, priority, duration]);

  const isAnimating = useCallback((id: string) => activeIds.has(id), [activeIds]);

  return { startStaggered, isAnimating, activeCount: activeIds.size };
}

/**
 * 获取调度器统计信息
 */
export function useAnimationSchedulerStats() {
  const [stats, setStats] = useState(globalAnimationScheduler.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(globalAnimationScheduler.getStats());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return stats;
}

/**
 * 配置全局调度器
 */
export function configureAnimationScheduler(config: Partial<AnimationSchedulerConfig>) {
  globalAnimationScheduler.updateConfig(config);
}
