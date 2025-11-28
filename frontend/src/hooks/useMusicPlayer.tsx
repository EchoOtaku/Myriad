/**
 * 音乐播放器状态管理 Hook
 * 从 GlobalControlPanel 分离出来的音乐播放器核心逻辑
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_URL } from '../config';
import {
  Song,
  LyricLine,
  MusicSource,
  getNeteasePlaylist,
  getQQPlaylist,
  getNeteaseLyrics,
  getQQLyrics,
  getCurrentLyricIndex,
  clearPlaylistCache,
  throttle,
  filterPlaylist,
  audioManager
} from '../utils/musicPlayer';
import { extractColorsFromImage } from '../utils/colorExtractor';
import { loadResource } from '../utils/resourceLoader';

// 播放模式类型
export type PlayMode = 'loop' | 'single' | 'shuffle';

// 音乐播放器视图类型
export type MusicPlayerView = 'info' | 'lyrics' | 'playlist';

// 临时播放模式状态
interface TempPlayMode {
  enabled: boolean;
  originalPlaylist: Song[];
  originalIndex: number;
  originalSource: MusicSource;
  originalPlaylistId: string;
}

// 音乐颜色类型
export interface MusicColors {
  primary: string;
  secondary: string;
  accent: string;
  light: string;
  dark: string;
}

// Hook 返回的状态和方法
export interface UseMusicPlayerReturn {
  // 基本状态
  playlist: Song[];
  currentSongIndex: number;
  currentSong: Song | null;
  isPlaying: boolean;
  isAudioLoading: boolean;
  currentTime: number;
  audioDuration: number;
  volume: number;
  lyrics: LyricLine[];
  currentLyricIndex: number;
  musicEnabled: boolean;
  musicSource: MusicSource;
  playlistId: string;
  musicError: string;
  musicPlayerView: MusicPlayerView;
  playMode: PlayMode;
  musicColors: MusicColors | null;
  
  // 搜索和过滤
  playlistSearchQuery: string;
  excludeVipSongs: boolean;
  filteredPlaylist: Song[];
  
  // 临时播放模式
  isTempPlayMode: boolean;
  
  // 控制方法
  togglePlay: () => Promise<void>;
  playPrevious: () => void;
  playNext: () => void;
  handleSeek: (time: number) => void;
  handleSeekStart: () => void;
  handleSeekEnd: () => void;
  handleVolumeChange: (volume: number) => void;
  togglePlayMode: () => void;
  selectSong: (song: Song, index: number, autoPlay?: boolean) => Promise<void>;
  playSong: (song: Song) => void;
  stopTempPlay: () => Promise<void>;
  setMusicPlayerView: (view: MusicPlayerView) => void;
  setPlaylistSearchQuery: (query: string) => void;
  setExcludeVipSongs: (exclude: boolean) => void;
  loadMusicConfig: () => Promise<void>;
  
  // Refs (供外部使用)
  audioRef: React.RefObject<HTMLAudioElement | null>;
  lyricsScrollRef: React.RefObject<HTMLDivElement>;
  playlistScrollRef: React.RefObject<HTMLDivElement>;
  progressBarRef: React.RefObject<HTMLInputElement>;
  musicContainerRef: React.RefObject<HTMLDivElement>;
  volumeControlRef: React.RefObject<HTMLDivElement>;
  
  // 音量弹出控制
  showVolumePopup: boolean;
  setShowVolumePopup: (show: boolean) => void;
  
  // 播放模式相关
  getPlayModeInfo: () => { icon: React.ReactNode; text: string };
}

// 全局状态恢复（跨页面切换）
const getGlobalState = () => (window as any).__musicPlayerState;
const setGlobalState = (state: any) => {
  (window as any).__musicPlayerState = state;
};

export function useMusicPlayer(): UseMusicPlayerReturn {
  // 尝试从全局状态恢复
  const globalState = getGlobalState();
  
  // 基本状态
  const [playlist, setPlaylist] = useState<Song[]>(globalState?.playlist || []);
  const [currentSongIndex, setCurrentSongIndex] = useState(globalState?.currentSongIndex || 0);
  const [currentSong, setCurrentSong] = useState<Song | null>(globalState?.currentSong || null);
  const [isPlaying, setIsPlaying] = useState(false); // 播放状态不恢复，避免自动播放
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [musicEnabled, setMusicEnabled] = useState(globalState?.isEnabled || false);
  const [musicSource, setMusicSource] = useState<MusicSource>('netease');
  const [playlistId, setPlaylistId] = useState('');
  const [musicError, setMusicError] = useState<string>('');
  const [musicPlayerView, setMusicPlayerView] = useState<MusicPlayerView>('info');
  const [playMode, setPlayMode] = useState<PlayMode>('loop');
  const [musicColors, setMusicColors] = useState<MusicColors | null>(null);
  
  // 搜索和过滤状态
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const [excludeVipSongs, setExcludeVipSongs] = useState(true);
  
  // 音量弹出控制
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  
  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const playlistScrollRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLInputElement>(null);
  const musicContainerRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef<boolean>(false);
  
  // 歌词相关 Refs（避免频繁触发 effect）
  const lyricsRef = useRef<LyricLine[]>([]);
  const currentLyricIndexRef = useRef<number>(-1);
  
  // 封面颜色缓存
  const colorCacheRef = useRef<Map<string, MusicColors>>(new Map());
  
  // Timeout 追踪
  const timeoutIdsRef = useRef<number[]>([]);
  
  // 预加载系统
  const [preloadedSongIndex, setPreloadedSongIndex] = useState<number>(-1);
  const preloadCacheRef = useRef<Map<number, boolean>>(new Map());
  const preloadErrorCountRef = useRef<number>(0);
  const preloadDisabledUntilRef = useRef<number>(0);
  
  // 预加载触发控制
  const currentSongLoadedRef = useRef<boolean>(false);
  const currentSongStartTimeRef = useRef<number>(0);
  const preloadTriggeredRef = useRef<boolean>(false);
  
  // 随机播放模式的下一首索引
  const nextShuffleIndexRef = useRef<number>(-1);
  
  // 进度条呼吸动画
  const breathAnimationRef = useRef<number | null>(null);
  
  // 临时播放模式
  const tempPlayModeRef = useRef<TempPlayMode>({
    enabled: false,
    originalPlaylist: [],
    originalIndex: 0,
    originalSource: 'netease',
    originalPlaylistId: '',
  });
  
  // 过滤后的播放列表
  const filteredPlaylist = useMemo(() => {
    let filtered = filterPlaylist(playlist, playlistSearchQuery);
    if (excludeVipSongs) {
      filtered = filtered.filter(song => !song.isVip);
    }
    return filtered;
  }, [playlist, playlistSearchQuery, excludeVipSongs]);
  
  // 同步 lyrics 和 currentLyricIndex 到 ref
  useEffect(() => {
    lyricsRef.current = lyrics;
  }, [lyrics]);
  
  useEffect(() => {
    currentLyricIndexRef.current = currentLyricIndex;
  }, [currentLyricIndex]);
  
  // 验证并规范化颜色值
  const normalizeColor = useCallback((color: string): string => {
    const cleaned = color.trim().replace(/\s+/g, '');
    if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(cleaned)) {
      return cleaned.toLowerCase();
    }
    console.warn(`Invalid color format: "${color}", using fallback`);
    return '#999999';
  }, []);
  
  // 应用音乐颜色到全局作用域
  useEffect(() => {
    const root = document.documentElement;
    if (musicColors) {
      root.style.setProperty('--music-primary', normalizeColor(musicColors.primary));
      root.style.setProperty('--music-secondary', normalizeColor(musicColors.secondary));
      root.style.setProperty('--music-accent', normalizeColor(musicColors.accent));
      root.style.setProperty('--music-light', normalizeColor(musicColors.light));
      root.style.setProperty('--music-dark', normalizeColor(musicColors.dark));
    } else {
      root.style.removeProperty('--music-primary');
      root.style.removeProperty('--music-secondary');
      root.style.removeProperty('--music-accent');
      root.style.removeProperty('--music-light');
      root.style.removeProperty('--music-dark');
    }
    
    return () => {
      root.style.removeProperty('--music-primary');
      root.style.removeProperty('--music-secondary');
      root.style.removeProperty('--music-accent');
      root.style.removeProperty('--music-light');
      root.style.removeProperty('--music-dark');
    };
  }, [musicColors, normalizeColor]);
  
  // 进度条呼吸动画控制
  const startProgressBreathAnimation = useCallback(() => {
    if (!progressBarRef.current) return;
    
    if (breathAnimationRef.current !== null) {
      cancelAnimationFrame(breathAnimationRef.current);
    }
    
    const progressBar = progressBarRef.current;
    const startTime = Date.now();
    const duration = 1500;
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = (elapsed % duration) / duration;
      
      const scale = 1 + 0.3 * Math.sin(progress * Math.PI * 2);
      const opacity = 0.85 + 0.15 * Math.sin(progress * Math.PI * 2);
      const shadowIntensity = 0.3 + 0.25 * Math.sin(progress * Math.PI * 2);
      
      const primaryColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--music-primary')
        .trim() || '#ec4899';
      
      const hexToRgba = (hex: string, alpha: number) => {
        const cleanHex = hex.replace('#', '');
        const r = parseInt(cleanHex.substring(0, 2), 16);
        const g = parseInt(cleanHex.substring(2, 4), 16);
        const b = parseInt(cleanHex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };
      
      progressBar.style.setProperty('--thumb-scale', scale.toString());
      progressBar.style.setProperty('--thumb-opacity', opacity.toString());
      progressBar.style.setProperty('--thumb-shadow',
        `0 ${2 + 2 * (scale - 1) / 0.3}px ${6 + 6 * (scale - 1) / 0.3}px ${hexToRgba(primaryColor, shadowIntensity)}, 0 0 ${20 * (scale - 1) / 0.3}px ${hexToRgba(primaryColor, shadowIntensity * 0.6)}`
      );
      
      breathAnimationRef.current = requestAnimationFrame(animate);
    };
    
    breathAnimationRef.current = requestAnimationFrame(animate);
  }, []);
  
  const stopProgressBreathAnimation = useCallback(() => {
    if (breathAnimationRef.current !== null) {
      cancelAnimationFrame(breathAnimationRef.current);
      breathAnimationRef.current = null;
    }
    
    if (progressBarRef.current) {
      progressBarRef.current.style.removeProperty('--thumb-scale');
      progressBarRef.current.style.removeProperty('--thumb-opacity');
      progressBarRef.current.style.removeProperty('--thumb-shadow');
    }
  }, []);
  
  // 控制进度条呼吸动画
  useEffect(() => {
    if (isAudioLoading) {
      startProgressBreathAnimation();
    } else {
      stopProgressBreathAnimation();
    }
    
    return () => {
      stopProgressBreathAnimation();
    };
  }, [isAudioLoading, startProgressBreathAnimation, stopProgressBreathAnimation]);
  
  // 为随机模式生成下一首歌曲索引
  const generateNextShuffleIndex = useCallback((currentIndex: number) => {
    if (playlist.length <= 1) return -1;
    
    const availableSongs = excludeVipSongs
      ? playlist.map((song, idx) => ({ song, idx })).filter(item => !item.song.isVip)
      : playlist.map((song, idx) => ({ song, idx }));
    
    if (availableSongs.length === 0) return -1;
    
    const availableOptions = availableSongs.filter(item => item.idx !== currentIndex);
    if (availableOptions.length === 0) return availableSongs[0].idx;
    
    const randomItem = availableOptions[Math.floor(Math.random() * availableOptions.length)];
    return randomItem.idx;
  }, [playlist, excludeVipSongs]);
  
  // 预加载下一首歌曲
  const preloadNextSong = useCallback((nextIndex: number, force: boolean = false) => {
    if (preloadDisabledUntilRef.current > Date.now()) {
      return;
    }
    
    if (!preloadAudioRef.current || nextIndex < 0 || nextIndex >= playlist.length) {
      return;
    }
    
    if (preloadCacheRef.current.has(nextIndex)) {
      return;
    }
    
    if (!force) {
      if (!currentSongLoadedRef.current) {
        return;
      }
      
      const currentPlayTime = Date.now() - currentSongStartTimeRef.current;
      if (currentPlayTime < 30000) {
        return;
      }
      
      if (preloadTriggeredRef.current) {
        return;
      }
    }
    
    const nextSong = playlist[nextIndex];
    if (!nextSong) return;
    
    if (excludeVipSongs && nextSong.isVip) {
      return;
    }
    
    preloadTriggeredRef.current = true;
    
    loadResource.low(`music-preload-${nextIndex}`, async () => {
      const preloadAudio = preloadAudioRef.current;
      if (!preloadAudio) return;
      
      return new Promise<void>((resolve, reject) => {
        const handleError = () => {
          preloadErrorCountRef.current += 1;
          
          if (preloadErrorCountRef.current >= 3) {
            preloadDisabledUntilRef.current = Date.now() + 5 * 60 * 1000;
            console.warn('音乐预加载已临时禁用5分钟');
          }
          
          cleanup();
          reject(new Error('Preload failed'));
        };
        
        const handleCanPlay = () => {
          preloadErrorCountRef.current = 0;
          setPreloadedSongIndex(nextIndex);
          preloadCacheRef.current.set(nextIndex, true);
          
          if (preloadCacheRef.current.size > 1) {
            const oldestKey = Array.from(preloadCacheRef.current.keys())[0];
            preloadCacheRef.current.delete(oldestKey);
          }
          
          cleanup();
          resolve();
        };
        
        const cleanup = () => {
          preloadAudio.removeEventListener('error', handleError);
          preloadAudio.removeEventListener('canplay', handleCanPlay);
        };
        
        preloadAudio.addEventListener('error', handleError);
        preloadAudio.addEventListener('canplay', handleCanPlay);
        
        preloadAudio.src = nextSong.url;
        preloadAudio.load();
      });
    });
  }, [playlist, excludeVipSongs]);
  
  // 广播状态变化事件 - 使用 ref 避免重复广播
  const lastBroadcastRef = useRef<string>('');
  const broadcastStateChange = useCallback(() => {
    // 创建状态快照用于比较
    const stateSnapshot = JSON.stringify({
      songId: currentSong?.id,
      isEnabled: musicEnabled,
      isPlaying,
      color: musicColors?.primary,
      isTempPlay: tempPlayModeRef.current.enabled,
      index: currentSongIndex,
      length: playlist.length,
    });
    
    // 如果状态没有变化，跳过广播
    if (lastBroadcastRef.current === stateSnapshot) {
      return;
    }
    lastBroadcastRef.current = stateSnapshot;
    
    window.dispatchEvent(new CustomEvent('music-player-state-change', {
      detail: {
        currentSong,
        isEnabled: musicEnabled,
        isPlaying,
        musicColor: musicColors?.primary || '#ef4444',
        isTempPlay: tempPlayModeRef.current.enabled,
        currentSongIndex,
        playlistLength: playlist.length,
        playlist,
      },
    }));
  }, [currentSong, musicEnabled, isPlaying, musicColors, currentSongIndex, playlist]);
  
  // 选择歌曲
  const selectSong = useCallback(async (song: Song, index: number, autoPlay: boolean = false) => {
    if (excludeVipSongs && song.isVip) {
      return;
    }
    
    // 重置预加载状态
    currentSongLoadedRef.current = false;
    currentSongStartTimeRef.current = 0;
    preloadTriggeredRef.current = false;
    
    setCurrentSong(song);
    setCurrentSongIndex(index);
    setAudioDuration(0);
    
    // 立即触发状态更新
    window.dispatchEvent(new CustomEvent('music-player-state-change', {
      detail: {
        currentSong: song,
        isEnabled: musicEnabled,
        isPlaying: false,
        musicColor: musicColors?.primary || '#ef4444',
        isTempPlay: tempPlayModeRef.current.enabled,
        currentSongIndex: index,
        playlistLength: playlist.length,
        playlist,
      },
    }));
    
    // 提取封面颜色
    if (song.cover) {
      try {
        const musicContainer = musicContainerRef.current;
        
        if (colorCacheRef.current.has(song.cover)) {
          const cachedColors = colorCacheRef.current.get(song.cover)!;
          setMusicColors(cachedColors);
        } else {
          if (musicContainer) {
            musicContainer.classList.add('color-transitioning');
          }
          
          const colors = await extractColorsFromImage(song.cover, { context: 'music' });
          
          if (colorCacheRef.current.size >= 50) {
            const firstKey = colorCacheRef.current.keys().next().value;
            if (firstKey !== undefined) {
              colorCacheRef.current.delete(firstKey);
            }
          }
          colorCacheRef.current.set(song.cover, colors);
          
          const tid1 = window.setTimeout(() => {
            setMusicColors(colors);
            if (musicContainer) {
              const tid2 = window.setTimeout(() => {
                musicContainer.classList.remove('color-transitioning');
              }, 50);
              timeoutIdsRef.current.push(tid2);
            }
          }, 300);
          timeoutIdsRef.current.push(tid1);
        }
      } catch (error) {
        console.warn('Failed to extract colors from cover:', error);
        setMusicColors(null);
        const musicContainer = musicContainerRef.current;
        if (musicContainer) {
          musicContainer.classList.remove('color-transitioning');
        }
      }
    } else {
      setMusicColors(null);
    }
    
    // 加载歌词（低优先级）
    setLyrics([]);
    setCurrentLyricIndex(-1);
    
    loadResource.low(`lyrics-${song.id}`, async () => {
      try {
        const fetchedLyrics = song.source === 'netease'
          ? await getNeteaseLyrics(song.id)
          : await getQQLyrics(song.id);
        
        if (fetchedLyrics && fetchedLyrics.length > 0) {
          setLyrics(fetchedLyrics);
          setCurrentLyricIndex(-1);
        } else {
          setLyrics([]);
        }
      } catch (error) {
        setLyrics([]);
        setCurrentLyricIndex(-1);
      }
    });
    
    // 加载歌曲
    if (audioRef.current) {
      setIsAudioLoading(true);
      
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = song.url;
      audioRef.current.load();
      
      audioManager.setCurrentAudio(audioRef.current, song);
      
      if (autoPlay) {
        setTimeout(() => {
          audioRef.current?.play().catch(() => setIsPlaying(false));
          setIsPlaying(true);
          audioManager.setPlaybackState('playing');
        }, 100);
      } else {
        setIsPlaying(false);
        audioManager.setPlaybackState('paused');
      }
      setCurrentTime(0);
    }
    
    // 随机模式需要提前确定下一首
    if (playMode === 'shuffle' && playlist.length > 1) {
      const nextIndex = generateNextShuffleIndex(index);
      if (nextIndex !== -1 && nextIndex !== index) {
        nextShuffleIndexRef.current = nextIndex;
      }
    }
    
    // 更新全局状态
    setGlobalState({
      playlist,
      currentSongIndex: index,
      currentSong: song,
      isEnabled: musicEnabled,
    });
    
    // 触发状态更新事件
    window.dispatchEvent(new CustomEvent('music-player-state-change', {
      detail: {
        currentSong: song,
        isEnabled: musicEnabled,
        isPlaying: autoPlay,
        musicColor: musicColors?.primary || '#ef4444',
        isTempPlay: tempPlayModeRef.current.enabled,
        currentSongIndex: index,
        playlistLength: playlist.length,
        playlist,
      },
    }));
  }, [musicEnabled, musicColors, playlist, playMode, excludeVipSongs, generateNextShuffleIndex]);
  
  // 播放单首歌曲（临时播放模式）
  const playSong = useCallback((song: Song) => {
    // 确保音频元素已初始化
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
      audioManager.setCurrentAudio(audioRef.current, song);
    }
    
    if (!tempPlayModeRef.current.enabled) {
      tempPlayModeRef.current = {
        enabled: true,
        originalPlaylist: [...playlist],
        originalIndex: currentSongIndex,
        originalSource: musicSource,
        originalPlaylistId: playlistId,
      };
    }
    
    if (!musicEnabled) {
      setMusicEnabled(true);
      setMusicSource(song.source || 'netease');
    }
    
    // 先设置播放列表，再延迟调用 selectSong 确保状态已更新
    setPlaylist([song]);
    
    // 使用 setTimeout 确保 React 状态更新已完成
    setTimeout(() => {
      selectSong(song, 0, true);
    }, 0);
  }, [musicEnabled, volume, playlist, currentSongIndex, musicSource, playlistId, selectSong]);
  
  // 停止临时播放
  const stopTempPlay = useCallback(async () => {
    if (!tempPlayModeRef.current.enabled) return;
    
    const { originalPlaylist, originalIndex, originalSource, originalPlaylistId } = tempPlayModeRef.current;
    
    tempPlayModeRef.current.enabled = false;
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    
    setPlaylist(originalPlaylist);
    setMusicSource(originalSource);
    setPlaylistId(originalPlaylistId);
    
    if (originalPlaylist.length > 0 && originalPlaylist[originalIndex]) {
      await selectSong(originalPlaylist[originalIndex], originalIndex, false);
    } else {
      setCurrentSong(null);
    }
  }, [selectSong]);
  
  // 加载歌单
  const loadPlaylist = useCallback(async (source: MusicSource, plistId: string) => {
    loadResource.medium(`music-playlist-${plistId}`, async () => {
      try {
        setMusicError('');
        const songs = source === 'netease'
          ? await getNeteasePlaylist(plistId)
          : await getQQPlaylist(plistId);
        
        setPlaylist(songs);
        
        if (songs.length > 0) {
          let firstSongIndex = 0;
          if (excludeVipSongs) {
            const nonVipIndex = songs.findIndex(song => !song.isVip);
            if (nonVipIndex !== -1) {
              firstSongIndex = nonVipIndex;
            }
          }
          selectSong(songs[firstSongIndex], firstSongIndex);
        }
      } catch (error) {
        let errorMessage = '加载歌单失败';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        console.error('Failed to load music playlist:', error);
        setMusicError(errorMessage);
        setPlaylist([]);
        
        setTimeout(() => {
          setMusicError('');
        }, 3000);
      }
    });
  }, [selectSong, excludeVipSongs]);
  
  // 加载音乐配置
  const loadMusicConfig = useCallback(async () => {
    try {
      preloadErrorCountRef.current = 0;
      preloadDisabledUntilRef.current = 0;
      
      const response = await fetch(`${API_URL}/api/config/ui?t=${Date.now()}`);
      const data = await response.json();
      
      const enabled = data.music_enabled === 'true';
      const source = data.music_source || 'netease';
      const plistId = data.music_playlist_id || '';
      
      setMusicEnabled(enabled);
      setMusicSource(source as MusicSource);
      setPlaylistId(plistId);
      
      if (enabled && plistId) {
        loadPlaylist(source as MusicSource, plistId);
      }
      
      broadcastStateChange();
    } catch (error) {
      // 静默处理
    }
  }, [loadPlaylist, broadcastStateChange]);
  
  // 播放/暂停
  const togglePlay = useCallback(async () => {
    if (!audioRef.current || !currentSong) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      audioManager.setPlaybackState('paused');
    } else {
      const maxRetries = 3;
      let retries = 0;
      
      while (retries < maxRetries) {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
          audioManager.setPlaybackState('playing');
          break;
        } catch (error) {
          retries++;
          console.warn(`播放失败，重试 ${retries}/${maxRetries}:`, error);
          
          if (retries >= maxRetries) {
            console.error('播放失败，已达到最大重试次数:', error);
            setMusicError('播放失败，请检查网络连接或歌曲是否可用');
            setTimeout(() => setMusicError(''), 3000);
            setIsPlaying(false);
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          }
        }
      }
    }
    
    broadcastStateChange();
  }, [isPlaying, currentSong, broadcastStateChange]);
  
  // 上一首
  const playPrevious = useCallback(() => {
    if (playlist.length === 0) return;
    
    let newIndex: number;
    
    if (playMode === 'shuffle') {
      newIndex = generateNextShuffleIndex(currentSongIndex);
    } else {
      newIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
      let attempts = 0;
      
      while (excludeVipSongs && playlist[newIndex]?.isVip && attempts < playlist.length) {
        newIndex = newIndex === 0 ? playlist.length - 1 : newIndex - 1;
        attempts++;
      }
      
      if (attempts >= playlist.length) {
        console.warn('所有歌曲都是VIP，无法播放');
        return;
      }
    }
    
    selectSong(playlist[newIndex], newIndex, true);
  }, [playlist, currentSongIndex, selectSong, excludeVipSongs, playMode, generateNextShuffleIndex]);
  
  // 下一首
  const playNext = useCallback(() => {
    if (playlist.length === 0) return;
    
    let newIndex: number;
    
    if (playMode === 'shuffle') {
      newIndex = nextShuffleIndexRef.current !== -1
        ? nextShuffleIndexRef.current
        : generateNextShuffleIndex(currentSongIndex);
    } else {
      newIndex = (currentSongIndex + 1) % playlist.length;
      let attempts = 0;
      
      while (excludeVipSongs && playlist[newIndex]?.isVip && attempts < playlist.length) {
        newIndex = (newIndex + 1) % playlist.length;
        attempts++;
      }
      
      if (attempts >= playlist.length) {
        console.warn('所有歌曲都是VIP，无法播放');
        return;
      }
    }
    
    selectSong(playlist[newIndex], newIndex, true);
  }, [playlist, currentSongIndex, selectSong, excludeVipSongs, playMode, generateNextShuffleIndex]);
  
  // 调整音量
  const handleVolumeChange = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
    
    if (audioRef.current) {
      try {
        audioRef.current.volume = clampedVolume;
      } catch (error) {
        console.warn('Failed to set audio volume:', error);
      }
    }
    
    if (preloadAudioRef.current) {
      try {
        preloadAudioRef.current.volume = clampedVolume;
      } catch (error) {
        // 静默处理
      }
    }
  }, []);
  
  // 调整播放进度
  const handleSeek = useCallback((time: number) => {
    if (audioRef.current && currentSong) {
      const maxSeekTime = currentSong.duration > 1 ? currentSong.duration - 1 : currentSong.duration * 0.95;
      const safeTime = Math.min(time, maxSeekTime);
      
      audioRef.current.currentTime = safeTime;
      setCurrentTime(safeTime);
    }
  }, [currentSong]);
  
  // 进度条拖动开始
  const handleSeekStart = useCallback(() => {
    seekingRef.current = true;
  }, []);
  
  // 进度条拖动结束
  const handleSeekEnd = useCallback(() => {
    setTimeout(() => {
      seekingRef.current = false;
    }, 100);
  }, []);
  
  // 切换播放模式
  const togglePlayMode = useCallback(() => {
    setPlayMode(prev => {
      if (prev === 'loop') return 'single';
      if (prev === 'single') return 'shuffle';
      return 'loop';
    });
  }, []);
  
  // 获取播放模式信息
  const getPlayModeInfo = useCallback(() => {
    switch (playMode) {
      case 'single':
        return {
          icon: (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>
            </svg>
          ),
          text: '单曲循环'
        };
      case 'shuffle':
        return {
          icon: (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
            </svg>
          ),
          text: '随机播放'
        };
      case 'loop':
      default:
        return {
          icon: (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
            </svg>
          ),
          text: '列表循环'
        };
    }
  }, [playMode]);
  
  // 初始化音频元素和事件监听
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
      audioManager.setCurrentAudio(audioRef.current, currentSong);
    }
    
    if (!preloadAudioRef.current) {
      preloadAudioRef.current = new Audio();
      preloadAudioRef.current.preload = 'auto';
      preloadAudioRef.current.volume = volume;
    }
    
    const audio = audioRef.current;
    
    const handleTimeUpdate = throttle(() => {
      const currentTime = audio.currentTime;
      setCurrentTime(currentTime);
      
      if (lyricsRef.current.length > 0) {
        const index = getCurrentLyricIndex(lyricsRef.current, currentTime);
        if (index !== currentLyricIndexRef.current) {
          setCurrentLyricIndex(index);
        }
      }
      
      // 智能预加载触发
      if (currentSongLoadedRef.current && !preloadTriggeredRef.current) {
        const playTime = Date.now() - currentSongStartTimeRef.current;
        if (playTime >= 30000) {
          if (playlist.length > 1) {
            if (playMode === 'loop') {
              let nextIndex = (currentSongIndex + 1) % playlist.length;
              if (excludeVipSongs) {
                let attempts = 0;
                while (playlist[nextIndex]?.isVip && attempts < playlist.length) {
                  nextIndex = (nextIndex + 1) % playlist.length;
                  attempts++;
                }
              }
              if (nextIndex !== currentSongIndex && !playlist[nextIndex]?.isVip) {
                preloadNextSong(nextIndex);
              }
            } else if (playMode === 'shuffle') {
              const nextIndex = generateNextShuffleIndex(currentSongIndex);
              if (nextIndex !== -1 && nextIndex !== currentSongIndex) {
                nextShuffleIndexRef.current = nextIndex;
                preloadNextSong(nextIndex);
              }
            }
          }
        }
      }
    }, 200);
    
    const handleCanPlay = () => {
      if (!currentSongLoadedRef.current) {
        currentSongLoadedRef.current = true;
        currentSongStartTimeRef.current = Date.now();
      }
      setIsAudioLoading(false);
    };
    
    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };
    
    const handleError = () => {
      console.error('音频播放错误:', audio.error);
      setIsPlaying(false);
      setIsAudioLoading(false);
      
      if (playlist.length > 1 && playMode !== 'single') {
        setTimeout(() => {
          const nextIndex = (currentSongIndex + 1) % playlist.length;
          if (playlist[nextIndex]) {
            selectSong(playlist[nextIndex], nextIndex, true);
          }
        }, 1000);
      }
    };
    
    const handleEnded = async () => {
      if (seekingRef.current) return;
      if (audio !== audioRef.current) return;
      
      // 临时播放模式处理
      if (tempPlayModeRef.current.enabled) {
        const { originalPlaylist, originalIndex, originalSource, originalPlaylistId } = tempPlayModeRef.current;
        
        tempPlayModeRef.current.enabled = false;
        
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        
        setPlaylist(originalPlaylist);
        setMusicSource(originalSource);
        setPlaylistId(originalPlaylistId);
        
        if (originalPlaylist.length > 0 && originalPlaylist[originalIndex]) {
          await selectSong(originalPlaylist[originalIndex], originalIndex, false);
        }
        
        return;
      }
      
      if (playlist.length > 0) {
        let newIndex: number;
        let attempts = 0;
        
        if (playMode === 'single') {
          newIndex = currentSongIndex;
        } else if (playMode === 'shuffle') {
          if (nextShuffleIndexRef.current !== -1) {
            newIndex = nextShuffleIndexRef.current;
          } else {
            newIndex = generateNextShuffleIndex(currentSongIndex);
            if (newIndex === -1) {
              newIndex = 0;
            }
          }
        } else {
          newIndex = (currentSongIndex + 1) % playlist.length;
          
          while (excludeVipSongs && playlist[newIndex]?.isVip && attempts < playlist.length) {
            newIndex = (newIndex + 1) % playlist.length;
            attempts++;
          }
        }
        
        if (attempts >= playlist.length && excludeVipSongs && playlist[newIndex]?.isVip) {
          console.warn('没有可播放的歌曲');
          setIsPlaying(false);
          return;
        }
        
        const nextSong = playlist[newIndex];
        
        // 如果下一首已预加载
        if (preloadedSongIndex === newIndex && preloadAudioRef.current && preloadAudioRef.current.readyState >= 2) {
          setIsAudioLoading(false);
          
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current.src = preloadAudioRef.current.src;
            audioRef.current.volume = volume;
            audioRef.current.load();
            audioRef.current.play().catch(() => setIsPlaying(false));
            setIsPlaying(true);
            
            audioManager.setCurrentAudio(audioRef.current, nextSong);
          }
          
          setCurrentSong(nextSong);
          setCurrentSongIndex(newIndex);
          setCurrentTime(0);
          
          // 提取颜色
          if (nextSong.cover) {
            try {
              const musicContainer = musicContainerRef.current;
              if (musicContainer) {
                musicContainer.classList.add('color-transitioning');
              }
              
              const colors = await extractColorsFromImage(nextSong.cover, { context: 'music' });
              
              const tid1 = window.setTimeout(() => {
                setMusicColors(colors);
                if (musicContainer) {
                  const tid2 = window.setTimeout(() => {
                    musicContainer.classList.remove('color-transitioning');
                  }, 30);
                  timeoutIdsRef.current.push(tid2);
                }
              }, 150);
              timeoutIdsRef.current.push(tid1);
            } catch (error) {
              setMusicColors(null);
            }
          } else {
            setMusicColors(null);
          }
          
          // 加载歌词
          setLyrics([]);
          setCurrentLyricIndex(-1);
          loadResource.low(`lyrics-${nextSong.id}`, async () => {
            try {
              const fetchedLyrics = nextSong.source === 'netease'
                ? await getNeteaseLyrics(nextSong.id)
                : await getQQLyrics(nextSong.id);
              
              if (fetchedLyrics && fetchedLyrics.length > 0) {
                setLyrics(fetchedLyrics);
                setCurrentLyricIndex(-1);
              }
            } catch (error) {
              setLyrics([]);
            }
          });
          
          // 随机模式确定下一首
          if (playMode === 'shuffle' && playlist.length > 1) {
            const nextIndex = generateNextShuffleIndex(newIndex);
            if (nextIndex !== -1 && nextIndex !== newIndex) {
              nextShuffleIndexRef.current = nextIndex;
            }
          }
        } else {
          selectSong(playlist[newIndex], newIndex, true);
        }
      } else {
        setIsPlaying(false);
      }
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [volume, playlist, currentSongIndex, selectSong, preloadedSongIndex, preloadNextSong, playMode, generateNextShuffleIndex, excludeVipSongs]);
  
  // 播放列表变化时清除预加载缓存
  useEffect(() => {
    preloadCacheRef.current.clear();
    setPreloadedSongIndex(-1);
  }, [playlist]);
  
  // 初始化 Media Session API - 使用 ref 存储回调避免频繁重建
  const playPreviousRef = useRef(playPrevious);
  const playNextRef = useRef(playNext);
  playPreviousRef.current = playPrevious;
  playNextRef.current = playNext;
  
  useEffect(() => {
    audioManager.setMediaSessionHandlers({
      play: () => {
        if (audioRef.current) {
          audioRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
      },
      pause: () => {
        if (audioRef.current) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      },
      previoustrack: () => playPreviousRef.current(),
      nexttrack: () => playNextRef.current(),
      seekbackward: () => {
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
        }
      },
      seekforward: () => {
        if (audioRef.current) {
          audioRef.current.currentTime = Math.min(
            audioRef.current.duration || 0,
            audioRef.current.currentTime + 10
          );
        }
      },
      seekto: (details) => {
        if (audioRef.current && details.seekTime !== undefined) {
          audioRef.current.currentTime = details.seekTime;
          setCurrentTime(details.seekTime);
        }
      },
    });
  }, []); // 只在挂载时初始化一次
  
  // 监听播放歌曲事件 - 使用 ref 避免频繁重建监听器
  const playSongRef = useRef(playSong);
  playSongRef.current = playSong;
  
  useEffect(() => {
    const handlePlaySong = (e: Event) => {
      const customEvent = e as CustomEvent;
      const song = customEvent.detail?.song;
      if (song) {
        playSongRef.current(song);
      }
    };
    
    window.addEventListener('play-song', handlePlaySong);
    return () => {
      window.removeEventListener('play-song', handlePlaySong);
    };
  }, []); // 只在挂载时设置一次
  
  // 监听切换播放/暂停事件 - 使用 ref 避免频繁重建监听器
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  
  useEffect(() => {
    const handleTogglePlayPause = () => {
      togglePlayRef.current();
    };
    
    window.addEventListener('toggle-play-pause', handleTogglePlayPause);
    return () => {
      window.removeEventListener('toggle-play-pause', handleTogglePlayPause);
    };
  }, []); // 只在挂载时设置一次
  
  // 监听音乐状态同步请求 - 使用 ref 避免频繁重建监听器
  const broadcastStateChangeRef = useRef(broadcastStateChange);
  broadcastStateChangeRef.current = broadcastStateChange;
  
  useEffect(() => {
    const handleSyncRequest = () => {
      broadcastStateChangeRef.current();
    };
    
    window.addEventListener('request-music-state-sync', handleSyncRequest);
    return () => {
      window.removeEventListener('request-music-state-sync', handleSyncRequest);
    };
  }, []); // 只在挂载时设置一次
  
  // 发送音乐播放器状态变化事件 - 使用节流避免频繁触发
  const broadcastThrottleRef = useRef<number | null>(null);
  useEffect(() => {
    // 使用节流，最多每 200ms 广播一次
    if (broadcastThrottleRef.current) {
      return;
    }
    broadcastThrottleRef.current = window.setTimeout(() => {
      broadcastThrottleRef.current = null;
      broadcastStateChange();
    }, 200);
    
    return () => {
      if (broadcastThrottleRef.current) {
        clearTimeout(broadcastThrottleRef.current);
        broadcastThrottleRef.current = null;
      }
    };
  }, [currentSong?.id, musicEnabled, isPlaying, musicColors?.primary, currentSongIndex, playlist.length]);
  
  // 监听停止临时播放事件 - 使用 ref 避免频繁重建监听器
  const stopTempPlayRef = useRef(stopTempPlay);
  stopTempPlayRef.current = stopTempPlay;
  
  useEffect(() => {
    const handleStopTempPlay = () => {
      stopTempPlayRef.current();
    };
    
    window.addEventListener('stop-temp-play', handleStopTempPlay);
    return () => {
      window.removeEventListener('stop-temp-play', handleStopTempPlay);
    };
  }, []); // 只在挂载时设置一次
  
  // 组件卸载时清理
  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach(clearTimeout);
      timeoutIdsRef.current = [];
      
      audioManager.stopCurrentAudio();
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      
      if (preloadAudioRef.current) {
        preloadAudioRef.current.pause();
        preloadAudioRef.current.src = '';
        preloadAudioRef.current = null;
      }
      
      colorCacheRef.current.clear();
    };
  }, []);
  
  return {
    // 基本状态
    playlist,
    currentSongIndex,
    currentSong,
    isPlaying,
    isAudioLoading,
    currentTime,
    audioDuration,
    volume,
    lyrics,
    currentLyricIndex,
    musicEnabled,
    musicSource,
    playlistId,
    musicError,
    musicPlayerView,
    playMode,
    musicColors,
    
    // 搜索和过滤
    playlistSearchQuery,
    excludeVipSongs,
    filteredPlaylist,
    
    // 临时播放模式
    isTempPlayMode: tempPlayModeRef.current.enabled,
    
    // 控制方法
    togglePlay,
    playPrevious,
    playNext,
    handleSeek,
    handleSeekStart,
    handleSeekEnd,
    handleVolumeChange,
    togglePlayMode,
    selectSong,
    playSong,
    stopTempPlay,
    setMusicPlayerView,
    setPlaylistSearchQuery,
    setExcludeVipSongs,
    loadMusicConfig,
    
    // Refs
    audioRef,
    lyricsScrollRef,
    playlistScrollRef,
    progressBarRef,
    musicContainerRef,
    volumeControlRef,
    
    // 音量弹出控制
    showVolumePopup,
    setShowVolumePopup,
    
    // 播放模式相关
    getPlayModeInfo,
  };
}
