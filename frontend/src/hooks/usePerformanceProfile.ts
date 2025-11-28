import { useMemo } from 'react';

/**
 * 设备性能画像与动态特性检测
 * - 用于在移动端 / 低性能设备 / 降低动效场景下自动降级动画与计算频率
 */
export interface PerformanceProfile {
  isMobile: boolean;
  reduceMotion: boolean;
  lowEndDevice: boolean;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
}

export function usePerformanceProfile(): PerformanceProfile {
  return useMemo(() => {
    const isMobile = matchMedia('(hover: none) and (pointer: coarse)').matches;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 部分浏览器支持 deviceMemory / hardwareConcurrency
    const hardwareConcurrency = (navigator as any).hardwareConcurrency || null;
    const deviceMemory = (navigator as any).deviceMemory || null;

    const lowEndDevice = (
      (hardwareConcurrency !== null && hardwareConcurrency <= 4) ||
      (deviceMemory !== null && deviceMemory <= 4) ||
      reduceMotion ||
      isMobile
    );

    return { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
  }, []);
}
