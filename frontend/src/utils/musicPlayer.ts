/**
 * 音乐播放器 - 支持网易云音乐和QQ音乐歌单播放
 */

import { API_URL } from '../config';

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
}

export interface LyricLine {
  time: number; // 秒
  text: string;
}

// 歌词缓存
const lyricsCache = new Map<string, LyricLine[]>();

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
 * 获取网易云音乐歌单
 */
export async function getNeteasePlaylist(playlistId: string): Promise<Song[]> {
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

    return tracks.map((track: any) => {
      // 网易云音乐API v6返回格式：ar(艺术家数组), al(专辑对象), dt(时长毫秒)
      // 兼容旧格式：artists, album, duration
      const artists = track.ar || track.artists || [];
      const album = track.al || track.album || {};
      const duration = track.dt || track.duration || 0;
      
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
      };
    });
  } catch (error) {
    console.error('Error fetching Netease playlist:', error);
    return [];
  }
}

/**
 * 获取QQ音乐歌单
 */
export async function getQQPlaylist(playlistId: string): Promise<Song[]> {
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
    const songs = playlist.songlist || [];

    return songs.map((song: any) => {
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
      lyricsCache.set(cacheKey, lyrics);
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
      lyricsCache.set(cacheKey, lyrics);
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
