import { useState, useEffect, useMemo } from 'react';

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
const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: false,
  reduceMotion: false,
  lowEndDevice: false,
  hardwareConcurrency: null,
  deviceMemory: null,
};

function detectPerformanceProfile(): PerformanceProfile {
  // 每次调用时检测浏览器环境
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
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

    return { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
  } catch (e) {
    console.warn('Failed to detect performance profile:', e);
    return DEFAULT_PROFILE;
  }
}

/**
 * 同步获取性能配置（用于模块初始化时，非 React 上下文）
 * 返回当前检测到的设备性能画像
 */
export function getPerformanceProfileSync(): PerformanceProfile {
  return detectPerformanceProfile();
}

export function usePerformanceProfile(): PerformanceProfile {
  // 🔧 关键修复：使用 useMemo 在首次渲染时同步检测
  // 这样可以确保第一次渲染就能获取正确的值
  const initialProfile = useMemo(() => {
    if (typeof window !== 'undefined') {
      return detectPerformanceProfile();
    }
    return DEFAULT_PROFILE;
  }, []);

  const [profile, setProfile] = useState<PerformanceProfile>(initialProfile);

  // 监听 reduceMotion 变化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => {
      setProfile(detectPerformanceProfile());
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return profile;
}
