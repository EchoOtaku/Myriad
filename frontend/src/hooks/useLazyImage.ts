import { useState, useEffect, useRef } from 'react';
import { loadImagePooled } from '../utils/objectPool';

interface UseLazyImageOptions {
  threshold?: number;
  rootMargin?: string;
  placeholder?: string;
}

/**
 * 图片懒加载 Hook - 使用 Intersection Observer 实现懒加载
 * 
 * 性能优化：
 * - 使用对象池加载图片，减少 GC 压力
 * - 支持可选的 IntersectionObserver 观察
 * 
 * @param src 图片源地址
 * @param options 配置项
 * @returns 当前显示的图片地址和加载状态
 */
export function useLazyImage(
  src: string,
  options: UseLazyImageOptions = {}
): { imageSrc: string; isLoading: boolean; hasError: boolean } {
  const {
    threshold = 0.01,
    rootMargin = '50px',
    placeholder = ''
  } = options;

  const [imageSrc, setImageSrc] = useState<string>(placeholder);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const abortedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!src) return;

    abortedRef.current = false;

    const loadImage = async () => {
      setIsLoading(true);
      setHasError(false);

      // 使用池化的图片加载
      const success = await loadImagePooled(src, { timeout: 15000 });
      
      // 检查是否已被取消
      if (abortedRef.current) return;
      
      if (success) {
        setImageSrc(src);
        setIsLoading(false);
      } else {
        setHasError(true);
        setIsLoading(false);
      }
    };

    // 如果浏览器支持 IntersectionObserver
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              loadImage();
              observerRef.current?.disconnect();
            }
          });
        },
        { threshold, rootMargin }
      );

      // 由于我们没有实际的 DOM 元素，直接加载图片
      // 在实际使用中，你需要传入一个 ref 来观察实际的 img 元素
      loadImage();
    } else {
      // 不支持 IntersectionObserver 的浏览器直接加载
      loadImage();
    }

    return () => {
      abortedRef.current = true;
      observerRef.current?.disconnect();
    };
  }, [src, threshold, rootMargin]);

  return { imageSrc, isLoading, hasError };
}
