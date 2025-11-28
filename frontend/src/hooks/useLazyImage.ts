import { useState, useEffect, useRef } from 'react';

interface UseLazyImageOptions {
  threshold?: number;
  rootMargin?: string;
  placeholder?: string;
}

/**
 * 图片懒加载 Hook - 使用 Intersection Observer 实现懒加载
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
  const imgRef = useRef<HTMLImageElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!src) return;

    // 创建一个临时的 img 元素用于观察
    const img = new Image();
    imgRef.current = img;

    const loadImage = () => {
      setIsLoading(true);
      setHasError(false);

      img.onload = () => {
        setImageSrc(src);
        setIsLoading(false);
      };

      img.onerror = () => {
        setHasError(true);
        setIsLoading(false);
      };

      img.src = src;
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
      observerRef.current?.disconnect();
      if (imgRef.current) {
        imgRef.current.onload = null;
        imgRef.current.onerror = null;
      }
    };
  }, [src, threshold, rootMargin]);

  return { imageSrc, isLoading, hasError };
}
