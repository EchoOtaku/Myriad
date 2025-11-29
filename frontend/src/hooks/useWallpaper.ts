/**
 * 壁纸管理 Hook
 * 
 * 提供壁纸加载、刷新和状态管理功能
 * 确保壁纸URL和颜色提取的一致性
 * 
 * @module useWallpaper
 * @version 2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { fetchJsonWithRetry } from '../utils/apiRetry';
import { API_URL } from '../config';
import { 
  wallpaperState, 
  normalizeWallpaperUrl, 
  areUrlsEquivalent,
  extractBackgroundUrl,
  // 向后兼容导出
  getActiveWallpaperUrl,
  getWallpaperApplyTimestamp,
  isWallpaperUrlActive,
  getDOMWallpaperUrl,
} from '../utils/wallpaperState';

// 重新导出向后兼容函数
export { 
  getActiveWallpaperUrl,
  getWallpaperApplyTimestamp,
  isWallpaperUrlActive,
  getDOMWallpaperUrl,
  normalizeWallpaperUrl,
  areUrlsEquivalent,
};

// ============================================================================
// 类型定义
// ============================================================================

interface WallpaperConfig {
  wallpaper_url: string;
  wallpaper_blur: number;
}

interface LoadWallpaperResult {
  /** 验证后的实际URL */
  actualUrl: string;
  /** 模糊度 */
  blur: number;
  /** URL是否经过验证 */
  verified: boolean;
}

// ============================================================================
// 常量
// ============================================================================

/** 图片加载超时时间 */
const IMAGE_LOAD_TIMEOUT = 15000;

/** 壁纸元素ID */
const WALLPAPER_ELEMENT_ID = 'wallpaper';

/** 随机图片服务列表 */
const RANDOM_IMAGE_SERVICES = [
  'picsum.photos',
  'loremflickr.com',
  'source.unsplash.com',
  'unsplash.com/random',
  'api.unsplash.com',
  'bing.com/hpimagearchive',
] as const;

/** 静态CDN标识 */
const STATIC_CDN_INDICATORS = [
  'cdn.', 
  'static.', 
  '/static/', 
  '/images/', 
  '/assets/', 
  '/uploads/'
] as const;

/** 图片扩展名 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'] as const;

/** 动态脚本扩展名 */
const DYNAMIC_EXTENSIONS = ['.php', '.jsp', '.asp', '.aspx', '.py'] as const;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 判断URL是否为单一静态图片链接
 * 返回true表示是固定的静态图片，不应显示刷新按钮
 */
function isStaticImageUrl(url: string): boolean {
  if (!url) return true;

  const lowerUrl = url.toLowerCase();

  // 随机图片服务 → 可刷新
  if (RANDOM_IMAGE_SERVICES.some(service => lowerUrl.includes(service))) {
    return false;
  }

  // 包含 /random 或 /daily 路径 → 可刷新
  if (lowerUrl.includes('/random') || lowerUrl.includes('/daily')) {
    return false;
  }

  // 动态脚本 → 可刷新
  if (DYNAMIC_EXTENSIONS.some(ext => lowerUrl.endsWith(ext))) {
    return false;
  }
  
  // 不以图片扩展名结尾 → 可能是API → 可刷新
  const endsWithImage = IMAGE_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
  if (!endsWithImage) {
    return false;
  }

  // 静态CDN图片 → 不可刷新
  if (STATIC_CDN_INDICATORS.some(indicator => lowerUrl.includes(indicator))) {
    return true;
  }

  // 默认可刷新（保守策略）
  return false;
}

/**
 * 获取实际的图片URL（处理重定向）
 */
async function resolveImageUrl(apiUrl: string, bustCache = false): Promise<string> {
  const url = bustCache
    ? apiUrl.includes('?')
      ? `${apiUrl}&t=${Date.now()}`
      : `${apiUrl}?t=${Date.now()}`
    : apiUrl;

  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.url;
  } catch {
    // 如果HEAD请求失败，返回原始URL
    return url;
  }
}

/**
 * 预加载图片
 * @returns 加载成功返回true，失败返回false
 */
function preloadImage(url: string, timeout = IMAGE_LOAD_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    const timer = setTimeout(() => {
      img.src = '';
      resolve(false);
    }, timeout);
    
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    
    img.src = url;
  });
}

/**
 * 应用壁纸到DOM并更新全局状态
 * @param imageUrl 目标图片URL
 * @param blur 模糊度
 * @param forceRefresh 是否强制刷新（即使URL相同）
 * @returns 验证后的URL，失败返回null
 */
async function applyWallpaperToDOM(
  imageUrl: string, 
  blur: number,
  forceRefresh = false
): Promise<string | null> {
  const wallpaperEl = document.getElementById(WALLPAPER_ELEMENT_ID);
  if (!wallpaperEl) {
    console.warn('壁纸元素不存在');
    return null;
  }
  
  // 🔒 检查是否需要更新：如果当前壁纸与目标相同且不是强制刷新，跳过
  const currentUrl = extractBackgroundUrl(WALLPAPER_ELEMENT_ID);
  if (!forceRefresh && currentUrl && areUrlsEquivalent(currentUrl, imageUrl)) {
    // 已经是目标壁纸，只需更新模糊度（如果不同）
    const currentFilter = wallpaperEl.style.filter;
    const targetFilter = `blur(${blur}px)`;
    if (currentFilter !== targetFilter) {
      wallpaperEl.style.filter = targetFilter;
    }
    // 确保状态同步
    wallpaperState.updateState(imageUrl, blur);
    return imageUrl;
  }
  
  // 标记加载状态
  wallpaperState.setLoading(true);
  
  try {
    // 预加载图片
    const loaded = await preloadImage(imageUrl);
    if (!loaded) {
      wallpaperState.setError('图片加载失败');
      return null;
    }
    
    // 🔒 再次检查：预加载期间可能已经切换到目标壁纸
    const currentUrlAfterLoad = extractBackgroundUrl(WALLPAPER_ELEMENT_ID);
    if (!forceRefresh && currentUrlAfterLoad && areUrlsEquivalent(currentUrlAfterLoad, imageUrl)) {
      wallpaperState.updateState(imageUrl, blur);
      return imageUrl;
    }
    
    // 应用到DOM（使用渐变过渡减少闪烁）
    wallpaperEl.style.backgroundImage = `url(${imageUrl})`;
    wallpaperEl.style.filter = `blur(${blur}px)`;
    
    // 更新全局状态
    wallpaperState.updateState(imageUrl, blur);
    
    // 等待下一帧验证DOM更新
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // 验证DOM是否已更新
    const appliedUrl = extractBackgroundUrl(WALLPAPER_ELEMENT_ID);
    
    if (appliedUrl && areUrlsEquivalent(appliedUrl, imageUrl)) {
      return imageUrl;
    }
    
    // 二次验证
    await new Promise(resolve => setTimeout(resolve, 50));
    const retryUrl = extractBackgroundUrl(WALLPAPER_ELEMENT_ID);
    
    if (retryUrl && areUrlsEquivalent(retryUrl, imageUrl)) {
      return imageUrl;
    }
    
    console.warn('壁纸应用验证失败', { expected: imageUrl, actual: retryUrl });
    return retryUrl || imageUrl;
    
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    wallpaperState.setError(message);
    return null;
  } finally {
    wallpaperState.setLoading(false);
  }
}

/**
 * 获取壁纸配置（带自动重试）
 */
async function fetchWallpaperConfig(): Promise<WallpaperConfig | null> {
  try {
    const data = await fetchJsonWithRetry<any>(`${API_URL}/api/config/ui`, {
      maxRetries: 3,
      timeout: 10000,
      onRetry: (error, attempt, delay) => {
        console.warn(
          `壁纸配置获取失败 (尝试 ${attempt}): ${error.message}. ${delay}ms后重试...`
        );
      },
    });

    if (data.wallpaper_url) {
      return {
        wallpaper_url: data.wallpaper_url,
        wallpaper_blur: data.wallpaper_blur ?? 3,
      };
    }
    return null;
  } catch (error) {
    console.error('壁纸配置获取失败:', error);
    return null;
  }
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 壁纸管理 Hook
 */
export function useWallpaper() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string>('');
  const [canRefresh, setCanRefresh] = useState<boolean>(false);
  const [blur, setBlur] = useState<number>(3);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 订阅全局状态变化
  useEffect(() => {
    return wallpaperState.subscribe((snapshot) => {
      setIsLoading(snapshot.isLoading);
    });
  }, []);

  /**
   * 加载壁纸配置和显示
   */
  const loadWallpaper = useCallback(async (): Promise<LoadWallpaperResult | null> => {
    try {
      const config = await fetchWallpaperConfig();
      if (!config) {
        return null;
      }

      const actualUrl = await resolveImageUrl(config.wallpaper_url);

      // 验证URL有效性
      if (!actualUrl || actualUrl.includes('/api/proxy/music/')) {
        return null;
      }

      // 应用到DOM并验证
      const verifiedUrl = await applyWallpaperToDOM(actualUrl, config.wallpaper_blur);
      
      if (!verifiedUrl) {
        return null;
      }

      // 更新本地状态
      setWallpaperUrl(verifiedUrl);
      setBlur(config.wallpaper_blur);
      setCanRefresh(!isStaticImageUrl(config.wallpaper_url));

      return { 
        actualUrl: verifiedUrl, 
        blur: config.wallpaper_blur,
        verified: areUrlsEquivalent(verifiedUrl, actualUrl),
      };
    } catch (error) {
      console.error('加载壁纸失败:', error);
      return null;
    }
  }, []);

  /**
   * 刷新壁纸（添加时间戳避免缓存）
   */
  const refreshWallpaper = useCallback(async (): Promise<string | null> => {
    try {
      const config = await fetchWallpaperConfig();
      if (!config) {
        return null;
      }

      const actualUrl = await resolveImageUrl(config.wallpaper_url, true);

      // 验证URL有效性
      if (!actualUrl || actualUrl.includes('/api/proxy/music/')) {
        return null;
      }

      // 应用到DOM并验证（强制刷新）
      const verifiedUrl = await applyWallpaperToDOM(actualUrl, config.wallpaper_blur, true);
      
      if (!verifiedUrl) {
        return null;
      }

      // 更新本地状态
      setWallpaperUrl(verifiedUrl);
      setBlur(config.wallpaper_blur);

      // 触发事件通知其他组件
      window.dispatchEvent(
        new CustomEvent('wallpaperChanged', {
          detail: { 
            url: verifiedUrl, 
            timestamp: wallpaperState.getAppliedTimestamp(),
          },
        })
      );
      
      return verifiedUrl;
    } catch (error) {
      console.error('刷新壁纸失败:', error);
      return null;
    }
  }, []);

  return {
    wallpaperUrl,
    canRefresh,
    blur,
    isLoading,
    loadWallpaper,
    refreshWallpaper,
  };
}
