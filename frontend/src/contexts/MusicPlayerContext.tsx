import { useEffect, useState } from 'react';
import type { Song } from '../utils/musicPlayer';

/**
 * 全局音乐播放器控制 - 使用事件通信
 * 
 * GlobalControlPanel 监听 'play-song' 事件并播放歌曲
 * 其他组件可以通过 useMusicPlayerControl hook 发送播放请求
 */

// Hook 供其他组件使用
export function useMusicPlayerControl() {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicColor, setMusicColor] = useState<string>('#ef4444'); // 封面提取的主色调
  const [isTempPlay, setIsTempPlay] = useState(false); // 是否为临时播放模式

  // 监听音乐播放器状态变化
  useEffect(() => {
    const handleMusicStateChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setCurrentSong(customEvent.detail?.currentSong || null);
      setIsEnabled(customEvent.detail?.isEnabled || false);
      setIsPlaying(customEvent.detail?.isPlaying || false);
      setMusicColor(customEvent.detail?.musicColor || '#ef4444');
      setIsTempPlay(customEvent.detail?.isTempPlay || false);
    };

    window.addEventListener('music-player-state-change', handleMusicStateChange);
    return () => {
      window.removeEventListener('music-player-state-change', handleMusicStateChange);
    };
  }, []);

  // 播放歌曲
  const playSong = (song: Song) => {
    window.dispatchEvent(new CustomEvent('play-song', { detail: { song } }));
  };

  // 切换播放/暂停
  const togglePlayPause = () => {
    window.dispatchEvent(new CustomEvent('toggle-play-pause'));
  };

  // 停止临时播放并恢复原播放列表
  const stopTempPlay = () => {
    window.dispatchEvent(new CustomEvent('stop-temp-play'));
  };

  return {
    playSong,
    togglePlayPause,
    stopTempPlay,
    currentSong,
    isEnabled,
    isPlaying,
    musicColor,
    isTempPlay,
  };
}
