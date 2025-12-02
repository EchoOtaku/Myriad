/**
 * 基于可见性的动画 Hook
 * 
 * 性能优化特性：
 * 1. 使用 IntersectionObserver 检测元素可见性
 * 2. 只在元素可见时才向协调器注册动画
 * 3. 元素离开视口时自动释放动画槽位
 * 4. 结合 content-visibility: auto CSS 实现完整的虚拟化
 * 
 * 适用场景：
 * - 长列表中的动画元素
 * - 可滚动区域内的动画卡片
 * - 需要节省 CPU 资源的低端设备
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { coordinator } from './coordinator';
import { AnimationPriority, AnimationState, LoopPriority } from './types';

/** 可见性动画选项 */
export interface VisibilityAwareAnimationOptions {
  /** 动画 ID（用于协调器追踪） */
  id: string;
  /** 是否启用可见性检测（默认 true） */
  enableVisibility?: boolean;
  /** IntersectionObserver 阈值（0-1，默认 0.1 表示 10% 可见时触发） */
  threshold?: number;
  /** IntersectionObserver rootMargin（默认 '100px' 预加载） */
  rootMargin?: string;
  /** 动画优先级 */
  priority?: AnimationPriority;
  /** 动画延迟（毫秒） */
  delay?: number;
  /** 循环动画配置（如果提供则作为循环动画处理） */
  loop?: {
    duration: number;
    cooldown: number;
    loopPriority?: LoopPriority;
  };
}

/** 返回值类型 */
export interface VisibilityAwareAnimationResult {
  /** 元素 ref，需要绑定到目标 DOM 元素 */
  ref: React.RefCallback<HTMLElement>;
  /** 元素是否在视口内 */
  isVisible: boolean;
  /** 动画是否可以播放（可见 + 协调器就绪） */
  canAnimate: boolean;
  /** 动画状态 */
  state: AnimationState | null;
  /** 手动触发重新检测 */
  recheckVisibility: () => void;
}

/**
 * 基于可见性的动画 Hook
 * 
 * @example
 * ```tsx
 * function AnimatedCard({ id }: { id: string }) {
 *   const { ref, canAnimate, isVisible } = useVisibilityAwareAnimation({
 *     id: `card-${id}`,
 *     threshold: 0.2,
 *     rootMargin: '200px',
 *   });
 *   
 *   return (
 *     <motion.div
 *       ref={ref}
 *       className="cv-widget" // 配合 content-visibility CSS
 *       animate={canAnimate ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
 *     />
 *   );
 * }
 * ```
 */
export function useVisibilityAwareAnimation(
  options: VisibilityAwareAnimationOptions
): VisibilityAwareAnimationResult {
  const {
    id,
    enableVisibility = true,
    threshold = 0.1,
    rootMargin = '100px',
    priority = AnimationPriority.COMPONENT,
    delay = 0,
    loop,
  } = options;

  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<AnimationState | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const unobserveRef = useRef<(() => void) | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const isRegisteredRef = useRef(false);

  // 注册动画（元素可见时）
  const registerAnimation = useCallback(() => {
    if (isRegisteredRef.current) return;
    isRegisteredRef.current = true;

    if (loop) {
      // 循环动画
      coordinator.requestLoopSlot(
        id,
        loop.duration,
        loop.cooldown,
        loop.loopPriority ?? LoopPriority.NORMAL
      );
    } else {
      // 普通动画
      coordinator.schedule({
        id,
        priority,
        delay,
      });
    }

    // 订阅状态变化
    unsubscribeRef.current = coordinator.subscribe(id, (newState) => {
      setState(newState);
    });
  }, [id, priority, delay, loop]);

  // 注销动画（元素不可见时）
  const unregisterAnimation = useCallback(() => {
    if (!isRegisteredRef.current) return;
    isRegisteredRef.current = false;

    // 取消订阅
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;

    // 释放槽位
    if (loop) {
      coordinator.releaseLoopSlot(id);
    } else {
      // 标记完成以释放槽位
      coordinator.markCompleted(id);
    }

    setState(null);
  }, [id, loop]);

  // 可见性变化时注册/注销动画
  useEffect(() => {
    if (!enableVisibility) {
      // 禁用可见性检测，直接注册
      registerAnimation();
      return () => {
        unregisterAnimation();
      };
    }

    if (isVisible) {
      registerAnimation();
    } else {
      unregisterAnimation();
    }
  }, [isVisible, enableVisibility, registerAnimation, unregisterAnimation]);

  // ref 回调 - 使用共享的 IntersectionObserver
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      // 清理旧元素的观察
      if (unobserveRef.current) {
        unobserveRef.current();
        unobserveRef.current = null;
      }

      elementRef.current = node;

      // 观察新元素
      if (node && enableVisibility) {
        unobserveRef.current = coordinator.observeIntersection(
          node,
          (entry) => {
            setIsVisible(entry.isIntersecting);
          },
          { threshold, rootMargin }
        );
      }
    },
    [threshold, rootMargin, enableVisibility]
  );

  // 清理
  useEffect(() => {
    return () => {
      if (unobserveRef.current) {
        unobserveRef.current();
      }
      unsubscribeRef.current?.();
    };
  }, []);

  // 手动重新检测可见性
  const recheckVisibility = useCallback(() => {
    if (!elementRef.current) return;
    
    const rect = elementRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    const isInViewport =
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= viewportHeight &&
      rect.left <= viewportWidth;
    
    setIsVisible(isInViewport);
  }, []);

  // 计算 canAnimate
  const canAnimate = useMemo(() => {
    if (!enableVisibility) {
      // 禁用可见性检测时，依赖协调器状态
      return state === AnimationState.READY || state === AnimationState.RUNNING;
    }
    
    // 启用可见性检测：可见 + 协调器就绪
    return isVisible && (state === AnimationState.READY || state === AnimationState.RUNNING);
  }, [enableVisibility, isVisible, state]);

  return {
    ref: setRef,
    isVisible,
    canAnimate,
    state,
    recheckVisibility,
  };
}

/**
 * 批量可见性检测 Hook
 * 
 * 用于列表场景，共享单个 IntersectionObserver 实例
 * 
 * @example
 * ```tsx
 * function List({ items }: { items: Item[] }) {
 *   const { createItemRef, getVisibility } = useVisibilityObserver({
 *     threshold: 0.1,
 *     rootMargin: '200px',
 *   });
 *   
 *   return items.map(item => (
 *     <ListItem
 *       key={item.id}
 *       ref={createItemRef(item.id)}
 *       isVisible={getVisibility(item.id)}
 *     />
 *   ));
 * }
 * ```
 */
export interface VisibilityObserverOptions {
  threshold?: number;
  rootMargin?: string;
}

export interface VisibilityObserverResult {
  /** 为每个 item 创建 ref */
  createItemRef: (itemId: string) => React.RefCallback<HTMLElement>;
  /** 获取 item 的可见性 */
  getVisibility: (itemId: string) => boolean;
  /** 所有可见的 item ID */
  visibleItems: Set<string>;
}

export function useVisibilityObserver(
  options: VisibilityObserverOptions = {}
): VisibilityObserverResult {
  const { threshold = 0.1, rootMargin = '100px' } = options;

  const [visibleItems, setVisibleItems] = useState<Set<string>>(new Set());
  const elementMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const unobserveMapRef = useRef<Map<string, () => void>>(new Map());

  // 创建 item ref - 使用共享 IntersectionObserver
  const createItemRef = useCallback(
    (itemId: string): React.RefCallback<HTMLElement> => {
      return (node) => {
        // 取消观察旧元素
        const oldUnobserve = unobserveMapRef.current.get(itemId);
        if (oldUnobserve) {
          oldUnobserve();
          unobserveMapRef.current.delete(itemId);
        }

        if (node) {
          elementMapRef.current.set(itemId, node);
          
          // 使用共享的 IntersectionObserver
          const unobserve = coordinator.observeIntersection(
            node,
            (entry) => {
              setVisibleItems((prev) => {
                if (entry.isIntersecting && !prev.has(itemId)) {
                  const next = new Set(prev);
                  next.add(itemId);
                  return next;
                } else if (!entry.isIntersecting && prev.has(itemId)) {
                  const next = new Set(prev);
                  next.delete(itemId);
                  return next;
                }
                return prev;
              });
            },
            { threshold, rootMargin }
          );
          
          unobserveMapRef.current.set(itemId, unobserve);
        } else {
          elementMapRef.current.delete(itemId);
          setVisibleItems((prev) => {
            if (prev.has(itemId)) {
              const next = new Set(prev);
              next.delete(itemId);
              return next;
            }
            return prev;
          });
        }
      };
    },
    [threshold, rootMargin]
  );

  // 清理
  useEffect(() => {
    return () => {
      unobserveMapRef.current.forEach((unobserve) => unobserve());
      unobserveMapRef.current.clear();
    };
  }, []);

  // 获取可见性
  const getVisibility = useCallback(
    (itemId: string) => visibleItems.has(itemId),
    [visibleItems]
  );

  return {
    createItemRef,
    getVisibility,
    visibleItems,
  };
}

export default useVisibilityAwareAnimation;
