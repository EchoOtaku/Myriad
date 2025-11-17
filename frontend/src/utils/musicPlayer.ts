/**
 * 音乐播放器 - 支持网易云音乐和QQ音乐歌单播放
 */

import { API_URL } from '../config';

/**
 * 节流函数 - 限制函数执行频率
 * @param func 要节流的函数
 * @param wait 等待时间（毫秒）
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  let previous = 0;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - previous);

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      func.apply(this, args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 防抖函数 - 延迟执行函数
 * @param func 要防抖的函数
 * @param wait 等待时间（毫秒）
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

export type MusicSource = 'netease' | 'qq';

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  url: string;
  duration: number; // 秒
  source: MusicSource;
  // VIP歌曲标识
  isVip?: boolean; // 是否为VIP歌曲
  isTrial?: boolean; // 是否为试听版本
  trialDuration?: number; // 试听时长（秒）
}

export interface LyricLine {
  time: number; // 秒
  text: string;
}

// 歌词缓存（限制最大100首，使用LRU策略）
const lyricsCache = new Map<string, LyricLine[]>();
const MAX_LYRICS_CACHE_SIZE = 100;

// 添加歌词到缓存（LRU策略）
function addToLyricsCache(key: string, lyrics: LyricLine[]): void {
  // 如果已存在，先删除再添加（保证最新的在最后）
  if (lyricsCache.has(key)) {
    lyricsCache.delete(key);
  }
  
  // 如果达到上限，删除最旧的（第一个）
  if (lyricsCache.size >= MAX_LYRICS_CACHE_SIZE) {
    const firstKey = lyricsCache.keys().next().value;
    if (firstKey) {
      lyricsCache.delete(firstKey);
    }
  }
  
  lyricsCache.set(key, lyrics);
}

// 歌单缓存（内存 + SessionStorage）
interface PlaylistCacheEntry {
  data: Song[];
  timestamp: number;
}

const playlistMemoryCache = new Map<string, PlaylistCacheEntry>();
const PLAYLIST_CACHE_DURATION = 30 * 60 * 1000; // 30分钟
const PLAYLIST_STORAGE_KEY = 'myriad_playlist_cache';

/**
 * 解析LRC格式歌词
 */
export function parseLyrics(lrcText: string): LyricLine[] {
  const lines = lrcText.split('\n');
  const lyrics: LyricLine[] = [];

  for (const line of lines) {
    // 匹配时间标签 [mm:ss.xx] 或 [mm:ss]
    const match = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
      const text = match[4].trim();

      if (text) {
        lyrics.push({
          time: minutes * 60 + seconds + milliseconds / 1000,
          text: text,
        });
      }
    }
  }

  // 按时间排序
  return lyrics.sort((a, b) => a.time - b.time);
}

/**
 * 从缓存获取歌单
 */
function getPlaylistFromCache(cacheKey: string): Song[] | null {
  // 1. 先检查内存缓存
  const memoryCache = playlistMemoryCache.get(cacheKey);
  if (memoryCache && Date.now() - memoryCache.timestamp < PLAYLIST_CACHE_DURATION) {
    return memoryCache.data;
  }

  // 2. 检查 SessionStorage
  try {
    const storageData = sessionStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (storageData) {
      const allCache = JSON.parse(storageData) as Record<string, PlaylistCacheEntry>;
      const cached = allCache[cacheKey];
      
      if (cached && Date.now() - cached.timestamp < PLAYLIST_CACHE_DURATION) {
        // 恢复到内存缓存
        playlistMemoryCache.set(cacheKey, cached);
        return cached.data;
      }
    }
  } catch (error) {
    // SessionStorage 读取失败，静默处理
  }

  return null;
}

/**
 * 将歌单存入缓存
 */
function savePlaylistToCache(cacheKey: string, songs: Song[]): void {
  const entry: PlaylistCacheEntry = {
    data: songs,
    timestamp: Date.now(),
  };

  // 1. 存入内存缓存
  playlistMemoryCache.set(cacheKey, entry);

  // 2. 存入 SessionStorage（限制总大小）
  try {
    const storageData = sessionStorage.getItem(PLAYLIST_STORAGE_KEY);
    const allCache: Record<string, PlaylistCacheEntry> = storageData
      ? JSON.parse(storageData)
      : {};

    // 清理过期缓存
    Object.keys(allCache).forEach(key => {
      if (Date.now() - allCache[key].timestamp > PLAYLIST_CACHE_DURATION) {
        delete allCache[key];
      }
    });

    // 添加新缓存
    allCache[cacheKey] = entry;

    // 限制缓存数量（最多5个歌单）
    const keys = Object.keys(allCache);
    if (keys.length > 5) {
      // 删除最旧的
      const oldestKey = keys.reduce((oldest, key) => {
        return allCache[key].timestamp < allCache[oldest].timestamp ? key : oldest;
      }, keys[0]);
      delete allCache[oldestKey];
    }

    sessionStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(allCache));
  } catch (error) {
    // SessionStorage 写入失败（可能配额已满），仅保留内存缓存
    console.warn('Failed to save playlist to SessionStorage:', error);
  }
}

/**
 * 清空歌单缓存
 */
export function clearPlaylistCache(): void {
  playlistMemoryCache.clear();
  try {
    sessionStorage.removeItem(PLAYLIST_STORAGE_KEY);
  } catch (error) {
    // 静默处理
  }
}

/**
 * 清空歌词缓存
 */
export function clearLyricsCache(): void {
  lyricsCache.clear();
}

/**
 * 获取网易云音乐歌单（带缓存）
 */
export async function getNeteasePlaylist(playlistId: string): Promise<Song[]> {
  const cacheKey = `netease-${playlistId}`;

  // 检查缓存
  const cached = getPlaylistFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // 通过后端代理访问网易云音乐API
    const response = await fetch(`${API_URL}/api/proxy/music/netease/playlist/${playlistId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch playlist');
    }

    const data = await response.json();

    // NetEase API 返回格式: { code: 200, result: { playlist: { tracks: [...] } } }
    // 或者可能是: { playlist: { tracks: [...] } }
    if (data.code && data.code !== 200) {
      // 网易云常见错误码:
      // -447: 服务器忙碌/频率限制
      // -460: 地理位置限制(海外IP)
      // -462: 版权限制
      if (data.code === -447) {
        throw new Error('网易云API访问频率过高,请稍后再试或使用QQ音乐');
      } else if (data.code === -460 || data.code === -462) {
        throw new Error('该歌单因版权或地理位置限制无法播放,建议使用QQ音乐');
      }
      throw new Error(data.message || `网易云API错误 (${data.code})`);
    }

    const tracks = data.result?.playlist?.tracks || data.playlist?.tracks || [];
    if (tracks.length === 0) {
      throw new Error('歌单为空或无可用歌曲');
    }

    // 统计VIP歌曲
    const vipCount = tracks.filter((t: any) => t.isVip).length;
    console.log(`📋 歌单加载完成: ${tracks.length} 首歌曲，${vipCount} 首VIP`);
    
    const songs = tracks.map((track: any) => {
      // 网易云音乐API v6返回格式：ar(艺术家数组), al(专辑对象), dt(时长毫秒)
      // 兼容旧格式：artists, album, duration
      const artists = track.ar || track.artists || [];
      const album = track.al || track.album || {};
      const duration = track.dt || track.duration || 0;
      
      // 直接使用后端返回的isVip字段（后端已经根据fee字段处理好了）
      const isVip = track.isVip || false;
      const isTrial = false; // 网易云playlist接口不返回试听信息
      const trialDuration = undefined;
      
      return {
        id: track.id.toString(),
        name: track.name,
        artist: artists.map((a: any) => a.name).join(', ') || 'Unknown',
        album: album.name || '',
        cover: album.picUrl || album.blurPicUrl || '',
        // 使用代理获取音频链接
        url: `${API_URL}/api/proxy/music/netease/audio/${track.id}`,
        duration: Math.floor(duration / 1000),
        source: 'netease' as MusicSource,
        isVip,
        isTrial,
        trialDuration,
      };
    });

    // 存入缓存
    savePlaylistToCache(cacheKey, songs);
    
    return songs;
  } catch (error) {
    console.error('Error fetching Netease playlist:', error);
    return [];
  }
}

/**
 * 获取QQ音乐歌单（带缓存）
 */
export async function getQQPlaylist(playlistId: string): Promise<Song[]> {
  const cacheKey = `qq-${playlistId}`;

  // 检查缓存
  const cached = getPlaylistFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // 通过后端代理访问QQ音乐API
    const response = await fetch(`${API_URL}/api/proxy/music/qq/playlist/${playlistId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch playlist');
    }

    const data = await response.json();

    if (!data.cdlist || data.cdlist.length === 0) {
      throw new Error('Invalid playlist response');
    }

    const playlist = data.cdlist[0];
    const songlist = playlist.songlist || [];

    const songs = songlist.map((song: any) => {
      // QQ音乐返回格式：singer(歌手数组), albumname(专辑名), interval(时长秒)
      const singers = Array.isArray(song.singer) ? song.singer : [];
      
      return {
        id: song.songmid || song.id?.toString() || '',
        name: song.songname || song.name,
        artist: singers.length > 0 ? singers.map((s: any) => s.name).join(', ') : 'Unknown',
        album: song.albumname || song.album?.name || '',
        cover: song.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg` : '',
        url: `https://ws.stream.qqmusic.qq.com/${song.songmid}.m4a?fromtag=46`,
        duration: song.interval || 0,
        source: 'qq' as MusicSource,
      };
    });

    // 存入缓存
    savePlaylistToCache(cacheKey, songs);
    
    return songs;
  } catch (error) {
    console.error('Error fetching QQ playlist:', error);
    return [];
  }
}

/**
 * 获取网易云音乐歌词
 */
export async function getNeteaseLyrics(songId: string): Promise<LyricLine[]> {
  const cacheKey = `netease-${songId}`;

  // 检查缓存
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  try {
    const response = await fetch(`${API_URL}/api/proxy/music/netease/lyrics/${songId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch lyrics');
    }

    const data = await response.json();

    if (data.lrc?.lyric) {
      const lyrics = parseLyrics(data.lrc.lyric);
      addToLyricsCache(cacheKey, lyrics);
      return lyrics;
    }

    return [];
  } catch (error) {
    console.error('Error fetching Netease lyrics:', error);
    return [];
  }
}

/**
 * 获取QQ音乐歌词
 */
export async function getQQLyrics(songId: string): Promise<LyricLine[]> {
  const cacheKey = `qq-${songId}`;

  // 检查缓存
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  try {
    const response = await fetch(`${API_URL}/api/proxy/music/qq/lyrics/${songId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch lyrics');
    }

    const data = await response.json();

    if (data.lyric) {
      const lyrics = parseLyrics(data.lyric);
      addToLyricsCache(cacheKey, lyrics);
      return lyrics;
    }

    return [];
  } catch (error) {
    console.error('Error fetching QQ lyrics:', error);
    return [];
  }
}

/**
 * 根据当前播放时间获取当前歌词索引
 * 重构版：精确匹配，正确处理所有边界情况
 */
export function getCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (!lyrics || lyrics.length === 0) return -1;
  
  // 如果还没到第一句歌词的时间，返回 -1 表示没有当前歌词
  if (currentTime < lyrics[0].time) {
    return -1;
  }
  
  // 找到当前时间应该显示的歌词索引
  // 规则：显示最后一个时间小于等于当前时间的歌词
  let currentIndex = -1;
  
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= currentTime) {
      currentIndex = i;
    } else {
      // 因为歌词已按时间排序，后面的都不会匹配了
      break;
    }
  }
  
  return currentIndex;
}

/**
 * 格式化时间（秒 -> mm:ss）
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 检查歌曲是否为VIP或试听版本
 */
export function getSongVipStatus(song: Song): {
  isVip: boolean;
  isTrial: boolean;
  displayText: string;
} {
  const isVip = song.isVip || false;
  const isTrial = song.isTrial || false;
  
  // 简化显示：VIP歌曲直接显示VIP标识
  const displayText = isVip ? 'VIP' : '';
  
  return { isVip, isTrial, displayText };
}

/**
 * 过滤播放列表
 * @param songs 歌曲列表
 * @param query 搜索关键词
 * @param options 过滤选项
 */
export function filterPlaylist(
  songs: Song[], 
  query: string,
  options?: {
    hideVip?: boolean; // 隐藏VIP歌曲
    hideTrial?: boolean; // 隐藏试听歌曲
  }
): Song[] {
  let filtered = songs;
  
  // 根据VIP状态过滤
  if (options?.hideVip) {
    filtered = filtered.filter(song => !song.isVip);
  }
  if (options?.hideTrial) {
    filtered = filtered.filter(song => !song.isTrial);
  }
  
  // 根据搜索关键词过滤
  if (query && query.trim()) {
    const lowerQuery = query.toLowerCase().trim();
    filtered = filtered.filter(song => 
      song.name.toLowerCase().includes(lowerQuery) ||
      song.artist.toLowerCase().includes(lowerQuery) ||
      song.album.toLowerCase().includes(lowerQuery)
    );
  }
  
  return filtered;
}

/**
 * 高亮搜索关键词
 * @param text 原文本
 * @param query 搜索关键词
 */
export function highlightText(text: string, query: string): string {
  if (!query || !query.trim()) {
    return text;
  }

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}
