import { useReducer, useCallback, useRef, useEffect } from 'react';
import {
  Song,
  LyricLine,
  MusicSource,
  getNeteasePlaylist,
  getQQPlaylist,
  getNeteaseLyrics,
  getQQLyrics,
  getCurrentLyricIndex,
} from '../utils/musicPlayer';
import { extractColorsFromImage, ColorPalette } from '../utils/colorExtractor';

// 音乐播放器状态接口
export interface MusicPlayerState {
  // 播放列表
  playlist: Song[];
  currentSongIndex: number;
  currentSong: Song | null;

  // 播放状态
  isPlaying: boolean;
  currentTime: number;
  volume: number;

  // 歌词
  lyrics: LyricLine[];
  currentLyricIndex: number;

  // 配置
  musicEnabled: boolean;
  musicSource: MusicSource;
  playlistId: string;

  // UI 状态
  musicPlayerView: 'info' | 'lyrics' | 'playlist';
  showVolumePopup: boolean;

  // 颜色主题
  musicColors: ColorPalette | null;

  // 预加载
  preloadedSongIndex: number;
}

// 动作类型
type MusicPlayerAction =
  | { type: 'SET_PLAYLIST'; payload: Song[] }
  | { type: 'SET_CURRENT_SONG'; payload: { song: Song; index: number } }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_CURRENT_TIME'; payload: number }
  | { type: 'SET_VOLUME'; payload: number }
  | { type: 'SET_LYRICS'; payload: LyricLine[] }
  | { type: 'SET_CURRENT_LYRIC_INDEX'; payload: number }
  | { type: 'SET_CONFIG'; payload: { enabled: boolean; source: MusicSource; playlistId: string } }
  | { type: 'SET_VIEW'; payload: 'info' | 'lyrics' | 'playlist' }
  | { type: 'SET_VOLUME_POPUP'; payload: boolean }
  | { type: 'SET_MUSIC_COLORS'; payload: ColorPalette | null }
  | { type: 'SET_PRELOADED_INDEX'; payload: number }
  | { type: 'NEXT_SONG' }
  | { type: 'PREV_SONG' }
  | { type: 'TOGGLE_PLAYING' };

// 初始状态
const initialState: MusicPlayerState = {
  playlist: [],
  currentSongIndex: 0,
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  volume: 0.7,
  lyrics: [],
  currentLyricIndex: -1,
  musicEnabled: false,
  musicSource: 'netease',
  playlistId: '',
  musicPlayerView: 'info',
  showVolumePopup: false,
  musicColors: null,
  preloadedSongIndex: -1,
};

// Reducer 函数
function musicPlayerReducer(
  state: MusicPlayerState,
  action: MusicPlayerAction
): MusicPlayerState {
  switch (action.type) {
    case 'SET_PLAYLIST':
      return { ...state, playlist: action.payload };

    case 'SET_CURRENT_SONG':
      return {
        ...state,
        currentSong: action.payload.song,
        currentSongIndex: action.payload.index,
        currentTime: 0,
      };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.payload };

    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.payload };

    case 'SET_VOLUME':
      return { ...state, volume: action.payload };

    case 'SET_LYRICS':
      return { ...state, lyrics: action.payload };

    case 'SET_CURRENT_LYRIC_INDEX':
      return { ...state, currentLyricIndex: action.payload };

    case 'SET_CONFIG':
      return {
        ...state,
        musicEnabled: action.payload.enabled,
        musicSource: action.payload.source,
        playlistId: action.payload.playlistId,
      };

    case 'SET_VIEW':
      return { ...state, musicPlayerView: action.payload };

    case 'SET_VOLUME_POPUP':
      return { ...state, showVolumePopup: action.payload };

    case 'SET_MUSIC_COLORS':
      return { ...state, musicColors: action.payload };

    case 'SET_PRELOADED_INDEX':
      return { ...state, preloadedSongIndex: action.payload };

    case 'NEXT_SONG':
      if (state.playlist.length === 0) return state;
      const nextIndex = (state.currentSongIndex + 1) % state.playlist.length;
      return {
        ...state,
        currentSongIndex: nextIndex,
        currentSong: state.playlist[nextIndex],
        currentTime: 0,
      };

    case 'PREV_SONG':
      if (state.playlist.length === 0) return state;
      const prevIndex =
        state.currentSongIndex === 0
          ? state.playlist.length - 1
          : state.currentSongIndex - 1;
      return {
        ...state,
        currentSongIndex: prevIndex,
        currentSong: state.playlist[prevIndex],
        currentTime: 0,
      };

    case 'TOGGLE_PLAYING':
      return { ...state, isPlaying: !state.isPlaying };

    default:
      return state;
  }
}

/**
 * 音乐播放器自定义 Hook
 */
export function useMusicPlayer() {
  const [state, dispatch] = useReducer(musicPlayerReducer, initialState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadCacheRef = useRef<Map<number, HTMLAudioElement>>(new Map());

  // 加载播放列表
  const loadPlaylist = useCallback(async () => {
    if (!state.musicEnabled || !state.playlistId) return;

    try {
      const songs =
        state.musicSource === 'netease'
          ? await getNeteasePlaylist(state.playlistId)
          : await getQQPlaylist(state.playlistId);

      dispatch({ type: 'SET_PLAYLIST', payload: songs });

      if (songs.length > 0) {
        dispatch({ type: 'SET_CURRENT_SONG', payload: { song: songs[0], index: 0 } });
      }
    } catch (error) {
      console.error('Failed to load playlist:', error);
    }
  }, [state.musicEnabled, state.musicSource, state.playlistId]);

  // 加载歌词
  const loadLyrics = useCallback(
    async (song: Song) => {
      try {
        const lyricsData =
          song.source === 'netease'
            ? await getNeteaseLyrics(song.id)
            : await getQQLyrics(song.id);

        dispatch({ type: 'SET_LYRICS', payload: lyricsData });
      } catch (error) {
        console.error('Failed to load lyrics:', error);
        dispatch({ type: 'SET_LYRICS', payload: [] });
      }
    },
    []
  );

  // 提取音乐封面颜色
  const extractMusicColors = useCallback(async (coverUrl: string) => {
    try {
      const musicContainer = document.querySelector('.music-player-container');
      if (musicContainer) {
        musicContainer.classList.add('color-transitioning');
      }

      const colors = await extractColorsFromImage(coverUrl, { context: 'music' });

      setTimeout(() => {
        dispatch({ type: 'SET_MUSIC_COLORS', payload: colors });
        if (musicContainer) {
          setTimeout(() => {
            musicContainer.classList.remove('color-transitioning');
          }, 50);
        }
      }, 300);
    } catch (error) {
      console.error('Failed to extract colors:', error);
      dispatch({ type: 'SET_MUSIC_COLORS', payload: null });
    }
  }, []);

  // 选择歌曲
  const selectSong = useCallback(
    async (song: Song, index: number) => {
      dispatch({ type: 'SET_CURRENT_SONG', payload: { song, index } });

      // 加载歌词
      await loadLyrics(song);

      // 提取封面颜色
      if (song.cover) {
        await extractMusicColors(song.cover);
      } else {
        dispatch({ type: 'SET_MUSIC_COLORS', payload: null });
      }
    },
    [loadLyrics, extractMusicColors]
  );

  // 播放/暂停
  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (state.isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      dispatch({ type: 'TOGGLE_PLAYING' });
    }
  }, [state.isPlaying]);

  // 下一首
  const nextSong = useCallback(() => {
    dispatch({ type: 'NEXT_SONG' });
  }, []);

  // 上一首
  const prevSong = useCallback(() => {
    dispatch({ type: 'PREV_SONG' });
  }, []);

  // 设置音量
  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    dispatch({ type: 'SET_VOLUME', payload: volume });
  }, []);

  // 跳转到指定时间
  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    dispatch({ type: 'SET_CURRENT_TIME', payload: time });
  }, []);

  // 更新当前时间（由 audio 元素触发）
  const updateCurrentTime = useCallback((time: number) => {
    dispatch({ type: 'SET_CURRENT_TIME', payload: time });

    // 更新歌词索引
    const lyricIndex = getCurrentLyricIndex(state.lyrics, time);
    dispatch({ type: 'SET_CURRENT_LYRIC_INDEX', payload: lyricIndex });
  }, [state.lyrics]);

  // 设置配置
  const setConfig = useCallback(
    (enabled: boolean, source: MusicSource, playlistId: string) => {
      dispatch({ type: 'SET_CONFIG', payload: { enabled, source, playlistId } });
    },
    []
  );

  // 切换视图
  const setView = useCallback((view: 'info' | 'lyrics' | 'playlist') => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, []);

  return {
    state,
    audioRef,
    preloadCacheRef,
    dispatch,

    // 方法
    loadPlaylist,
    selectSong,
    togglePlay,
    nextSong,
    prevSong,
    setVolume,
    seekTo,
    updateCurrentTime,
    setConfig,
    setView,
  };
}
