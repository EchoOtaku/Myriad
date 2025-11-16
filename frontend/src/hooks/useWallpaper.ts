import { useState, useCallback } from 'react';
import { fetchJsonWithRetry } from '../utils/apiRetry';
import { API_URL } from '../config';

interface WallpaperConfig {
  wallpaper_url: string;
  wallpaper_blur: number;
}

/**
 * 判断URL是否为单一静态图片链接
 *
 * 返回true表示是固定的静态图片，不应显示刷新按钮
 * 返回false表示是API端点或随机图片服务，应显示刷新按钮
 *
 * 策略：默认视为可刷新（API），除非明确是静态CDN图片
 */
function isSingleImageUrl(url: string): boolean {
  if (!url) return true; // 空URL不显示刷新按钮

  const lowerUrl = url.toLowerCase();

  // 明确的随机图片服务 → 可刷新
  const randomServices = [
    'picsum.photos',
    'loremflickr.com',
    'source.unsplash.com',
    'unsplash.com/random',
    'api.unsplash.com',
    'bing.com/hpimagearchive',
  ];
  if (randomServices.some(service => lowerUrl.includes(service))) {
    return false;
  }

  // 包含 /random 或 /daily 路径 → 可刷新
  if (lowerUrl.includes('/random') || lowerUrl.includes('/daily')) {
    return false;
  }

  // 静态CDN图片的特征：
  // 1. 以图片扩展名结尾（排除动态脚本）
  // 2. 来自明确的静态托管域名（如 cdn、static、images）
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const dynamicExtensions = ['.php', '.jsp', '.asp', '.aspx', '.py'];
  
  // 如果是动态脚本（如 .php），视为API端点，可刷新
  const isDynamicScript = dynamicExtensions.some(ext => lowerUrl.endsWith(ext));
  if (isDynamicScript) {
    return false; // 动态脚本，可刷新
  }
  
  const endsWithImage = imageExtensions.some(ext => lowerUrl.endsWith(ext));

  if (!endsWithImage) {
    // 不以图片扩展名结尾 → 可能是API → 可刷新
    return false;
  }

  // 以图片扩展名结尾，进一步判断：
  // 如果URL路径包含明确的静态标识，视为静态图片
  const staticIndicators = ['cdn.', 'static.', '/static/', '/images/', '/assets/', '/uploads/'];
  const isStaticCdn = staticIndicators.some(indicator => lowerUrl.includes(indicator));

  if (isStaticCdn) {
    return true; // 静态CDN图片，不可刷新
  }

  // 否则默认可刷新（保守策略）
  return false;
}

/**
 * 获取实际的图片URL（处理重定向）
 */
async function resolveActualImageUrl(apiUrl: string, addTimestamp = false): Promise<string> {
  const urlWithTimestamp = addTimestamp
    ? apiUrl.includes('?')
      ? `${apiUrl}&t=${Date.now()}`
      : `${apiUrl}?t=${Date.now()}`
    : apiUrl;

  const response = await fetch(urlWithTimestamp, { method: 'HEAD' });
  return response.url;
}

/**
 * 预加载图片
 */
function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * 应用壁纸到 DOM
 */
function applyWallpaperToDOM(imageUrl: string, blur: number): void {
  const wallpaperEl = document.getElementById('wallpaper');
  if (wallpaperEl) {
    wallpaperEl.style.backgroundImage = `url(${imageUrl})`;
    wallpaperEl.style.filter = `blur(${blur}px)`;
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
          `Failed to fetch wallpaper config (attempt ${attempt}): ${error.message}. Retrying in ${delay}ms...`
        );
      },
    });

    if (data.wallpaper_url) {
      return {
        wallpaper_url: data.wallpaper_url,
        wallpaper_blur: data.wallpaper_blur || 3,
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch wallpaper config after retries:', error);
    return null;
  }
}

/**
 * 壁纸管理自定义 Hook
 */
export function useWallpaper() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string>('');
  const [canRefresh, setCanRefresh] = useState<boolean>(false);
  const [blur, setBlur] = useState<number>(3);

  /**
   * 加载壁纸配置和显示
   */
  const loadWallpaper = useCallback(async (): Promise<{
    actualUrl: string;
    blur: number;
  } | null> => {
    try {
      const config = await fetchWallpaperConfig();
      if (!config) return null;

      const actualUrl = await resolveActualImageUrl(config.wallpaper_url);

      // 验证URL有效性（排除音乐代理URL）
      if (!actualUrl || actualUrl.includes('/api/proxy/music/')) {
        return null;
      }

      setWallpaperUrl(actualUrl);
      setBlur(config.wallpaper_blur);
      const isSingle = isSingleImageUrl(config.wallpaper_url);
      const canRefreshValue = !isSingle;
      setCanRefresh(canRefreshValue);

      // 应用到DOM
      applyWallpaperToDOM(actualUrl, config.wallpaper_blur);

      return { actualUrl, blur: config.wallpaper_blur };
    } catch (error) {
      console.warn('Failed to load wallpaper:', error);
      return null;
    }
  }, []);

  /**
   * 刷新壁纸（添加时间戳避免缓存）
   */
  const refreshWallpaper = useCallback(async (): Promise<void> => {
    try {
      const config = await fetchWallpaperConfig();
      if (!config) return;

      const actualUrl = await resolveActualImageUrl(config.wallpaper_url, true);

      // 验证URL有效性
      if (!actualUrl || actualUrl.includes('/api/proxy/music/')) {
        return;
      }

      // 预加载新图片实现平滑过渡
      await preloadImage(actualUrl);

      // 更新状态
      setWallpaperUrl(actualUrl);
      setBlur(config.wallpaper_blur);

      // 应用到DOM
      applyWallpaperToDOM(actualUrl, config.wallpaper_blur);

      // 触发事件通知其他组件（用于颜色提取）
      window.dispatchEvent(
        new CustomEvent('wallpaperChanged', {
          detail: { url: actualUrl },
        })
      );
    } catch (error) {
      console.warn('Failed to refresh wallpaper:', error);
    }
  }, []);

  return {
    wallpaperUrl,
    canRefresh,
    blur,
    loadWallpaper,
    refreshWallpaper,
  };
}
