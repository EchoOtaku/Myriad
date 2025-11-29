import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 动画可见性控制 Hook
 * 
 * 当元素不在视口内时自动暂停动画，节省 CPU/GPU 资源
 * 
 * 使用方式：
 * ```tsx
 * const { ref, isVisible, shouldAnimate } = useAnimationVisibility();
 * return (
 *   <div ref={ref} style={{ animationPlayState: shouldAnimate ? 'running' : 'paused' }}>
 *     ...
 *   </div>
 * );
 * ```
 */
export function useAnimationVisibility<T extends HTMLElement = HTMLElement>(options?: {
  /** 根边距，默认 '50px' 提前加载 */
  rootMargin?: string;
  /** 可见性阈值，默认 0 */
  threshold?: number;
  /** 是否默认可见（用于 SSR），默认 true */
  defaultVisible?: boolean;
  /** 延迟暂停时间(ms)，避免快速滚动时频繁切换，默认 100 */
  pauseDelay?: number;
}) {
  const {
    rootMargin = '50px',
    threshold = 0,
    defaultVisible = true,
    pauseDelay = 100,
  } = options || {};

  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(defaultVisible);
  const [shouldAnimate, setShouldAnimate] = useState(defaultVisible);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // 检查是否支持 IntersectionObserver
    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      setShouldAnimate(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const nowVisible = entry.isIntersecting;
        
        setIsVisible(nowVisible);

        // 清除之前的延迟
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        if (nowVisible) {
          // 立即恢复动画
          setShouldAnimate(true);
        } else {
          // 延迟暂停，避免快速滚动时闪烁
          timeoutRef.current = setTimeout(() => {
            setShouldAnimate(false);
          }, pauseDelay);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [rootMargin, threshold, pauseDelay]);

  return { ref, isVisible, shouldAnimate };
}

/**
 * 批量管理多个动画元素的可见性
 * 使用单个 IntersectionObserver 实例来优化性能
 */
export function useAnimationVisibilityBatch() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [visibleSet, setVisibleSet] = useState<Set<Element>>(new Set());

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleSet((prev) => {
          const next = new Set(prev);
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              next.add(entry.target);
            } else {
              next.delete(entry.target);
            }
          });
          return next;
        });
      },
      { rootMargin: '50px' }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const observe = useCallback((element: Element | null) => {
    if (element && observerRef.current) {
      observerRef.current.observe(element);
    }
  }, []);

  const unobserve = useCallback((element: Element | null) => {
    if (element && observerRef.current) {
      observerRef.current.unobserve(element);
      setVisibleSet((prev) => {
        const next = new Set(prev);
        next.delete(element);
        return next;
      });
    }
  }, []);

  const isVisible = useCallback(
    (element: Element | null): boolean => {
      return element ? visibleSet.has(element) : false;
    },
    [visibleSet]
  );

  return { observe, unobserve, isVisible, visibleSet };
}

/**
 * CSS 类名版本的动画可见性控制
 * 自动添加/移除 'animation-paused' 类
 */
export function useAnimationPauseOnHidden<T extends HTMLElement = HTMLElement>(
  options?: Parameters<typeof useAnimationVisibility>[0]
) {
  const { ref, shouldAnimate } = useAnimationVisibility<T>(options);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (shouldAnimate) {
      element.classList.remove('animation-paused');
    } else {
      element.classList.add('animation-paused');
    }
  }, [shouldAnimate]);

  return ref;
}
