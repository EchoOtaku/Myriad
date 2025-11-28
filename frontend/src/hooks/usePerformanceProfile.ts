import { useMemo, useState, useEffect } from 'react';

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

// SSR 安全的默认值
const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: false,
  reduceMotion: false,
  lowEndDevice: false,
  hardwareConcurrency: null,
  deviceMemory: null,
};

// 检测是否在浏览器环境
const isBrowser = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

// 缓存检测结果，避免重复计算
let cachedProfile: PerformanceProfile | null = null;

function detectPerformanceProfile(): PerformanceProfile {
  if (!isBrowser) {
    return DEFAULT_PROFILE;
  }

  // 使用缓存避免重复检测
  if (cachedProfile !== null) {
    return cachedProfile;
  }

  try {
    const isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 部分浏览器支持 deviceMemory / hardwareConcurrency
    const hardwareConcurrency = (navigator as any).hardwareConcurrency ?? null;
    const deviceMemory = (navigator as any).deviceMemory ?? null;

    const lowEndDevice = (
      (hardwareConcurrency !== null && hardwareConcurrency <= 4) ||
      (deviceMemory !== null && deviceMemory <= 4) ||
      reduceMotion ||
      isMobile
    );

    cachedProfile = { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
    return cachedProfile;
  } catch (e) {
    // 发生错误时返回保守的默认值
    console.warn('Failed to detect performance profile:', e);
    return DEFAULT_PROFILE;
  }
}

export function usePerformanceProfile(): PerformanceProfile {
  // 使用 useState + useEffect 确保 SSR 和客户端水合时行为一致
  const [profile, setProfile] = useState<PerformanceProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    // 仅在客户端执行检测
    setProfile(detectPerformanceProfile());
  }, []);

  return profile;
}
