import { useState, useEffect } from 'react';

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

// SSR 安全的默认值 - 乐观策略：假设为中高端设备
// 这样可以避免 SSR 水合时的闪烁问题
const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: false,
  reduceMotion: false,
  lowEndDevice: false,  // 🔧 改为 false，避免 SSR 时误判
  hardwareConcurrency: null,
  deviceMemory: null,
};

// 检测是否在浏览器环境
const isBrowser = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function detectPerformanceProfile(): PerformanceProfile {
  if (!isBrowser) {
    return DEFAULT_PROFILE;
  }

  try {
    const isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hardwareConcurrency = (navigator as any).hardwareConcurrency ?? null;
    const deviceMemory = (navigator as any).deviceMemory ?? null;

    // 🔧 极简判定逻辑
    // 移动端：全部判定为中高端，现代手机性能都足够
    // 只有用户主动开启 reduceMotion 才降级
    let lowEndDevice = reduceMotion;

    // 桌面端：根据硬件判断
    if (!lowEndDevice && !isMobile) {
      lowEndDevice = (
        (hardwareConcurrency !== null && hardwareConcurrency <= 4) ||
        (deviceMemory !== null && deviceMemory <= 4)
      );
    }

    console.log('[PerformanceProfile]', { isMobile, hardwareConcurrency, deviceMemory, reduceMotion, lowEndDevice });

    return { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
  } catch (e) {
    console.warn('Failed to detect performance profile:', e);
    return DEFAULT_PROFILE;
  }
}

export function usePerformanceProfile(): PerformanceProfile {
  // SSR 时使用默认值，客户端立即检测
  const [profile, setProfile] = useState<PerformanceProfile>(() => {
    // 🔧 客户端立即检测，不使用缓存，避免 SSR 残留问题
    if (isBrowser) {
      return detectPerformanceProfile();
    }
    return DEFAULT_PROFILE;
  });

  useEffect(() => {
    // 客户端水合后再次检测，确保值是正确的
    const detected = detectPerformanceProfile();
    setProfile(detected);
  }, []);

  return profile;
}
