import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { Song } from '../utils/musicPlayer';

/**
 * 全局音乐播放器状态管理 - 使用 React Context 实现实时状态同步
 * 
 * GlobalControlPanel 通过 Context 暴露状态，其他组件通过 useMusicPlayerControl hook 访问
 * 这样可以确保状态实时同步，无需依赖事件
 */

interface MusicPlayerState {
  currentSong: Song | null;
  isEnabled: boolean;
  isPlaying: boolean;
  musicColor: string;
  isTempPlay: boolean;
  currentSongIndex: number;
  playlistLength: number;
  playlist: Song[];
}

interface MusicPlayerContextType extends MusicPlayerState {
  playSong: (song: Song) => void;
  togglePlayPause: () => void;
  stopTempPlay: () => void;
  updateState: (state: Partial<MusicPlayerState>) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | null>(null);

// Provider 组件 - 在 AppLayout 或 App 中使用
export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MusicPlayerState>({
    currentSong: null,
    isEnabled: false,
    isPlaying: false,
    musicColor: '#ef4444',
    isTempPlay: false,
    currentSongIndex: 0,
    playlistLength: 0,
    playlist: [],
  });

  // 在客户端初始化时从全局状态读取
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const globalState = (window as any).__musicPlayerState;
      if (globalState) {
        setState({
          currentSong: globalState.currentSong || null,
          isEnabled: globalState.isEnabled || false,
          isPlaying: globalState.isPlaying || false,
          musicColor: globalState.musicColor || '#ef4444',
          isTempPlay: globalState.isTempPlay || false,
          currentSongIndex: globalState.currentSongIndex || 0,
          playlistLength: globalState.playlistLength || 0,
          playlist: globalState.playlist || [],
        });
      }
    }
  }, []);

  // 监听音乐播放器状态变化事件（向后兼容）
  useEffect(() => {
    const handleMusicStateChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      
      setState({
        currentSong: detail?.currentSong || null,
        isEnabled: detail?.isEnabled || false,
        isPlaying: detail?.isPlaying || false,
        musicColor: detail?.musicColor || '#ef4444',
        isTempPlay: detail?.isTempPlay || false,
        currentSongIndex: detail?.currentSongIndex || 0,
        playlistLength: detail?.playlistLength || 0,
        playlist: detail?.playlist || [],
      });

      // 同步到全局状态
      (window as any).__musicPlayerState = detail;
    };

    window.addEventListener('music-player-state-change', handleMusicStateChange);
    return () => {
      window.removeEventListener('music-player-state-change', handleMusicStateChange);
    };
  }, []);

  // 更新状态的方法
  const updateState = useCallback((newState: Partial<MusicPlayerState>) => {
    setState(prev => {
      const updated = { ...prev, ...newState };
      // 同步到全局状态
      (window as any).__musicPlayerState = updated;
      return updated;
    });
  }, []);

  // 播放歌曲
  const playSong = useCallback((song: Song) => {
    window.dispatchEvent(new CustomEvent('play-song', { detail: { song } }));
  }, []);

  // 切换播放/暂停
  const togglePlayPause = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-play-pause'));
  }, []);

  // 停止临时播放并恢复原播放列表
  const stopTempPlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('stop-temp-play'));
  }, []);

  return (
    <MusicPlayerContext.Provider value={{ ...state, playSong, togglePlayPause, stopTempPlay, updateState }}>
      {children}
    </MusicPlayerContext.Provider>
  );
}

// Hook 供其他组件使用
export function useMusicPlayerControl() {
  const context = useContext(MusicPlayerContext);
  
  if (!context) {
    // 如果没有 Provider，使用降级方案（事件监听）
    console.warn('MusicPlayerProvider not found, using fallback event-based approach');
    return useFallbackMusicPlayerControl();
  }
  
  return context;
}

// 降级方案：基于事件的实现（向后兼容）- 优化：使用单个 state 对象减少重渲染
function useFallbackMusicPlayerControl() {
  const [state, setState] = useState<MusicPlayerState>({
    currentSong: null,
    isEnabled: false,
    isPlaying: false,
    musicColor: '#ef4444',
    isTempPlay: false,
    currentSongIndex: 0,
    playlistLength: 0,
    playlist: [],
  });

  // 在客户端初始化时从全局状态读取
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const globalState = (window as any).__musicPlayerState;
      if (globalState) {
        setState({
          currentSong: globalState.currentSong || null,
          isEnabled: globalState.isEnabled || false,
          isPlaying: globalState.isPlaying || false,
          musicColor: globalState.musicColor || '#ef4444',
          isTempPlay: globalState.isTempPlay || false,
          currentSongIndex: globalState.currentSongIndex || 0,
          playlistLength: globalState.playlistLength || 0,
          playlist: globalState.playlist || [],
        });
      }
    }
  }, []);

  useEffect(() => {
    const handleMusicStateChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      
      // 单次 setState 更新所有状态，避免多次重渲染
      setState({
        currentSong: detail?.currentSong || null,
        isEnabled: detail?.isEnabled || false,
        isPlaying: detail?.isPlaying || false,
        musicColor: detail?.musicColor || '#ef4444',
        isTempPlay: detail?.isTempPlay || false,
        currentSongIndex: detail?.currentSongIndex || 0,
        playlistLength: detail?.playlistLength || 0,
        playlist: detail?.playlist || [],
      });
    };

    window.addEventListener('music-player-state-change', handleMusicStateChange);
    return () => {
      window.removeEventListener('music-player-state-change', handleMusicStateChange);
    };
  }, []);

  const playSong = useCallback((song: Song) => {
    window.dispatchEvent(new CustomEvent('play-song', { detail: { song } }));
  }, []);

  const togglePlayPause = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-play-pause'));
  }, []);

  const stopTempPlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('stop-temp-play'));
  }, []);

  const updateState = useCallback(() => {
    console.warn('updateState not available in fallback mode');
  }, []);

  return {
    ...state,
    playSong,
    togglePlayPause,
    stopTempPlay,
    updateState,
  };
}
