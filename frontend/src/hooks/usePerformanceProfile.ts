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

// SSR 安全的默认值 - 保守策略：假设为低端设备
const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: true,  // SSR 时假设为移动端，避免注册不必要的监听器
  reduceMotion: false,
  lowEndDevice: true,  // SSR 时假设为低端设备，避免复杂计算
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

    // 🔧 优化低端设备判定逻辑
    // 移动端不再一刀切判定为低端，而是根据实际硬件能力判断
    let lowEndDevice = reduceMotion; // 用户偏好优先

    if (!lowEndDevice) {
      if (isMobile) {
        // 移动端：只有真正低配的设备才判定为低端
        // CPU核心 <= 4 且 内存 <= 4GB 才认为是低端移动设备
        const isLowEndMobile = (
          (hardwareConcurrency !== null && hardwareConcurrency <= 4) &&
          (deviceMemory !== null && deviceMemory <= 4)
        );
        // 如果无法获取硬件信息，假设是中高端设备（现代手机大多性能不错）
        lowEndDevice = isLowEndMobile;
      } else {
        // 桌面端：CPU <= 4核 或 内存 <= 4GB 判定为低端
        lowEndDevice = (
          (hardwareConcurrency !== null && hardwareConcurrency <= 4) ||
          (deviceMemory !== null && deviceMemory <= 4)
        );
      }
    }

    cachedProfile = { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
    return cachedProfile;
  } catch (e) {
    // 发生错误时返回保守的默认值
    console.warn('Failed to detect performance profile:', e);
    return DEFAULT_PROFILE;
  }
}

// 立即获取初始值（如果在浏览器环境）
const getInitialProfile = (): PerformanceProfile => {
  if (isBrowser) {
    return detectPerformanceProfile();
  }
  return DEFAULT_PROFILE;
};

export function usePerformanceProfile(): PerformanceProfile {
  // 使用同步初始化，避免首次渲染时使用错误的默认值
  // 这样可以确保在组件首次渲染时就能获取正确的设备信息
  const [profile, setProfile] = useState<PerformanceProfile>(getInitialProfile);

  useEffect(() => {
    // 客户端水合后再次检测，确保值是正确的
    const detected = detectPerformanceProfile();
    setProfile(prev => {
      // 只在值真正变化时更新，避免不必要的重渲染
      if (prev.isMobile !== detected.isMobile || 
          prev.lowEndDevice !== detected.lowEndDevice ||
          prev.reduceMotion !== detected.reduceMotion) {
        return detected;
      }
      return prev;
    });
  }, []);

  return profile;
}
