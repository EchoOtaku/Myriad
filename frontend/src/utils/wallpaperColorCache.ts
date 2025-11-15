/**
 * 壁纸颜色缓存管理工具
 *
 * 功能：
 * - 30分钟缓存有效期
 * - 基于标准化URL的简单缓存
 * - 自动清理过期缓存
 */

import { ColorPalette } from './colorExtractor';

interface WallpaperColorCacheItem {
  url: string; // 标准化后的URL
  palette: ColorPalette;
  timestamp: number;
}

interface WallpaperColorCacheStore {
  version: number;
  items: WallpaperColorCacheItem[];
}

const CACHE_VERSION = 4;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30分钟
const CACHE_KEY = 'myriad_wallpaper_color_cache_v4';
const MAX_CACHE_ITEMS = 10; // 最多缓存10张壁纸

/**
 * 标准化URL：去除时间戳和缓存破坏参数
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // 删除常见的缓存破坏参数
    urlObj.searchParams.delete('_t');
    urlObj.searchParams.delete('t');
    urlObj.searchParams.delete('timestamp');
    urlObj.searchParams.delete('cache');
    urlObj.searchParams.delete('v');
    urlObj.searchParams.delete('cachebust');
    urlObj.searchParams.delete('nocache');
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * 检查URL是否为有效壁纸
 */
export async function shouldApplyColorExtraction(url: string): Promise<{
  shouldApply: boolean;
  cacheKey?: string;
}> {
  if (!url) return { shouldApply: false };

  // 快速排除明显不是壁纸的URL
  if (url.includes('/api/proxy/music/')) return { shouldApply: false };
  if (url.startsWith('file://')) return { shouldApply: false };

  try {
    // 加载图片检查尺寸
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 10000);
      img.src = url;
    });

    if (!loaded) {
      return { shouldApply: false };
    }

    // 检查尺寸（排除小图标）
    const isLargeEnough = img.width >= 400 && img.height >= 400;
    if (!isLargeEnough) {
      return { shouldApply: false };
    }

    // 生成缓存key（标准化URL）
    const cacheKey = normalizeUrl(url);
    return { shouldApply: true, cacheKey };

  } catch (error) {
    return { shouldApply: false };
  }
}

/**
 * 从缓存存储中读取
 */
function getCacheStore(): WallpaperColorCacheStore | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const store: WallpaperColorCacheStore = JSON.parse(cached);
    if (store.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return store;
  } catch {
    return null;
  }
}

/**
 * 保存缓存存储
 */
function saveCacheStore(store: WallpaperColorCacheStore): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // 静默失败
  }
}

/**
 * 根据URL从缓存中获取颜色配色
 */
export function getColorFromCache(url: string): ColorPalette | null {
  try {
    const normalizedUrl = normalizeUrl(url);
    const store = getCacheStore();
    if (!store) return null;

    // 查找匹配的URL
    const item = store.items.find((item) => item.url === normalizedUrl);
    if (!item) return null;

    // 检查是否过期
    const age = Date.now() - item.timestamp;
    if (age > CACHE_DURATION_MS) {
      // 移除过期项
      store.items = store.items.filter((i) => i.url !== normalizedUrl);
      saveCacheStore(store);
      return null;
    }

    return item.palette;
  } catch (error) {
    return null;
  }
}

/**
 * 保存颜色配色到缓存
 */
export function saveColorToCache(url: string, palette: ColorPalette): void {
  try {
    const normalizedUrl = normalizeUrl(url);
    let store = getCacheStore();
    if (!store) {
      store = { version: CACHE_VERSION, items: [] };
    }

    // 移除已存在的相同URL
    store.items = store.items.filter((item) => item.url !== normalizedUrl);

    // 添加新项
    store.items.push({
      url: normalizedUrl,
      palette,
      timestamp: Date.now(),
    });

    // 清理过期项和超出数量限制的项
    const now = Date.now();
    store.items = store.items
      .filter((item) => now - item.timestamp < CACHE_DURATION_MS)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_CACHE_ITEMS);

    saveCacheStore(store);
  } catch (error) {
    // 静默失败
  }
}

/**
 * 清除壁纸颜色缓存
 */
export function clearColorCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    console.log('🗑️  壁纸颜色缓存已清除');
  } catch (error) {
    console.warn('清除壁纸颜色缓存失败:', error);
  }
}

/**
 * 获取缓存信息（用于调试）
 */
export function getCacheInfo(): {
  exists: boolean;
  url?: string;
  age?: number;
  remainingTime?: number;
} | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return { exists: false };

    const data: WallpaperColorCache = JSON.parse(cached);
    const age = Date.now() - data.timestamp;
    const remainingTime = Math.max(0, CACHE_DURATION_MS - age);

    return {
      exists: true,
      url: data.url,
      age,
      remainingTime,
    };
  } catch {
    return null;
  }
}
