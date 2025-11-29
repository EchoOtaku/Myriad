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
    // 部分浏览器支持 deviceMemory / hardwareConcurrency
    const hardwareConcurrency = (navigator as any).hardwareConcurrency ?? null;
    const deviceMemory = (navigator as any).deviceMemory ?? null;
    
    // 检测 iOS 设备（iOS Safari 的 hardwareConcurrency 返回值不可靠）
    // 多种检测方式兼容不同情况
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || 
                  // iPadOS 13+ 伪装成 Mac
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                  // 备用检测：webkit + 触摸设备 + 非 Android
                  (/AppleWebKit/.test(ua) && /Mobile/.test(ua) && !/Android/.test(ua));

    // 🔧 优化低端设备判定逻辑
    // 移动端不再一刀切判定为低端，而是根据实际硬件能力判断
    let lowEndDevice = reduceMotion; // 用户偏好优先

    if (!lowEndDevice) {
      if (isMobile) {
        if (isIOS) {
          // iOS 设备：Safari 的 hardwareConcurrency 不可靠（经常返回固定值如 2 或 4）
          // 且 deviceMemory API 完全不支持
          // 考虑到现代 iOS 设备（iPhone 6s 及以后）性能都不错，默认判定为中高端
          // 只有用户主动开启 reduceMotion 才降级
          lowEndDevice = false;
        } else {
          // Android 等其他移动端：更宽松的判定策略
          // 只有在能确认硬件很差时才判定为低端
          const hasLowCPU = hardwareConcurrency !== null && hardwareConcurrency <= 2;  // 2核及以下
          const hasLowMemory = deviceMemory !== null && deviceMemory <= 2;  // 2GB及以下
          
          // 必须明确检测到低配硬件才判定为低端
          // 如果 API 不支持（返回 null），默认认为是中高端设备
          lowEndDevice = hasLowCPU || hasLowMemory;
        }
      } else {
        // 桌面端：CPU <= 4核 或 内存 <= 4GB 判定为低端
        lowEndDevice = (
          (hardwareConcurrency !== null && hardwareConcurrency <= 4) ||
          (deviceMemory !== null && deviceMemory <= 4)
        );
      }
    }

    // Debug 日志（所有环境都输出，方便调试）
    console.log('[PerformanceProfile]', { isMobile, isIOS, hardwareConcurrency, deviceMemory, reduceMotion, lowEndDevice });

    return { isMobile, reduceMotion, lowEndDevice, hardwareConcurrency, deviceMemory };
  } catch (e) {
    // 发生错误时返回乐观的默认值
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
