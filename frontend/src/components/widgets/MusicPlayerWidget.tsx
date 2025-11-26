/**
 * 音乐播放器小组件
 * Glass风格设计，2x2紧凑布局
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import type { Song } from '../../utils/musicPlayer';
import { WidgetConfig } from '../WidgetGrid';
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext';
import { useWidgetSize } from '../../hooks/useWidgetSize';

export interface MusicPlayerWidgetProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

// 专辑封面组件 - 独立优化
const AlbumCover = memo(({ 
  cover, 
  name, 
  isPlaying, 
  themeColor,
  scale = 1
}: { 
  cover: string | undefined; 
  name: string; 
  isPlaying: boolean; 
  themeColor: string;
  scale?: number;
}) => {
  // 直接使用 cover 作为 key，强制重新渲染，不使用内部状态缓存
  // 这样可以确保封面立即更新，而不是等待加载完成
  
  return (
    <motion.div 
      className="absolute z-10"
      style={{ top: `${8 * scale}px`, right: `${8 * scale}px` }}
      initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
      animate={{ 
        scale: 1, 
        opacity: 1, 
        rotate: 0,
      }}
      transition={{ 
        duration: 0.6, 
        ease: [0.34, 1.56, 0.64, 1]
      }}
    >
      <div 
        className="rounded-lg overflow-hidden shadow-lg ring-2 ring-white/20 dark:ring-white/10 backdrop-blur-sm"
        style={{ width: `${48 * scale}px`, height: `${48 * scale}px` }}
      >
        <img
          key={cover} // 关键：使用 key 强制更新
          src={cover || 'https://via.placeholder.com/48?text=♪'}
          alt={name}
          className="w-full h-full object-cover"
          loading="eager" // 立即加载
          onError={(e) => {
            e.currentTarget.src = 'https://via.placeholder.com/48?text=♪';
          }}
        />
      </div>
      {/* 播放状态光晕 */}
      {isPlaying && (
        <motion.div 
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ 
            boxShadow: `0 0 20px ${themeColor}40`,
          }}
          animate={{ 
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      )}
    </motion.div>
  );
});

AlbumCover.displayName = 'AlbumCover';

// 播放状态指示器 - 独立组件
const PlayingIndicator = memo(({ themeColor, scale = 1 }: { themeColor: string; scale?: number }) => (
  <motion.div 
    className="flex items-end"
    style={{ gap: `${2 * scale}px`, height: `${16 * scale}px` }}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.3 }}
  >
    <motion.div 
      className="rounded-full"
      style={{ background: themeColor, width: `${2 * scale}px` }}
      animate={{ height: ['30%', '100%', '30%'] }}
      transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.div 
      className="rounded-full"
      style={{ background: themeColor, width: `${2 * scale}px` }}
      animate={{ height: ['60%', '100%', '60%'] }}
      transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
    />
    <motion.div 
      className="rounded-full"
      style={{ background: themeColor, width: `${2 * scale}px` }}
      animate={{ height: ['40%', '100%', '40%'] }}
      transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
    />
  </motion.div>
));

PlayingIndicator.displayName = 'PlayingIndicator';

export const MusicPlayerWidget = memo(({ config, isEditMode, isPreview }: MusicPlayerWidgetProps) => {
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
  const playerControl = useMusicPlayerControl();
  
  const currentSong = isPreview ? { 
    name: '示例歌曲', 
    artist: '示例歌手', 
    cover: '', 
    duration: 180, 
    id: '0', 
    url: '', 
    source: 'netease' as const,
    isVip: false
  } : playerControl.currentSong;
  
  const isEnabled = isPreview ? true : playerControl.isEnabled;
  const isPlaying = isPreview ? false : playerControl.isPlaying;
  const musicColor = isPreview ? '#ef4444' : playerControl.musicColor;

  const handleClick = useCallback(() => {
    if (isPreview) return;
    // 打开全局控制面板
    window.dispatchEvent(new Event('open-control-panel'));
  }, [isPreview]);

  const handleTogglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPreview) return;
    window.dispatchEvent(new Event('toggle-play-pause'));
  }, [isPreview]);

  const themeColor = currentSong ? musicColor : '#ef4444';

  if (!isEnabled) {
    return (
      <div ref={containerRef} className="relative h-full w-full rounded-2xl overflow-hidden glass">
        <motion.div 
          className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-10"
          style={{ background: themeColor }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3" style={{ padding: `${12 * scale}px` }}>
          <motion.span 
            className="mb-2"
            style={{ fontSize: `${30 * scale}px` }}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          >🎵</motion.span>
          <span 
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: `${12 * fontScale}px` }}
          >
            音乐播放器未启用
          </span>
        </div>
      </div>
    );
  }

  if (!currentSong) {
    return (
      <div ref={containerRef} className="relative h-full w-full rounded-2xl overflow-hidden glass">
        <motion.div 
          className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-10"
          style={{ background: themeColor }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3" style={{ padding: `${12 * scale}px` }}>
          <motion.span 
            className="mb-2"
            style={{ fontSize: `${30 * scale}px` }}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          >🎵</motion.span>
          <span 
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: `${12 * fontScale}px` }}
          >
            暂无播放
          </span>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="relative h-full w-full rounded-2xl overflow-hidden glass cursor-pointer group"
      onClick={handleClick}
    >
      {/* 背景光效 - 呼吸效果 */}
      <motion.div 
        className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl"
        style={{ background: themeColor }}
        animate={{ 
          opacity: [0.1, 0.2, 0.1],
          scale: [1, 1.15, 1]
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* 右上角：专辑封面 - 浮动元素 */}
      <AlbumCover 
        cover={currentSong.cover}
        name={currentSong.name}
        isPlaying={isPlaying}
        themeColor={themeColor}
        scale={scale}
      />

      {/* 主内容区：2x2紧凑布局 */}
      <div className="absolute inset-0 flex flex-col p-3" style={{ padding: `${12 * scale}px` }}>
        {/* 顶部：音乐图标 */}
        <motion.div 
          className="mb-1"
          initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
          animate={{ 
            scale: 1, 
            opacity: 1, 
            rotate: isPlaying ? [0, 5, 0, -5, 0] : 0,
          }}
          transition={{ 
            scale: { duration: 0.6, ease: [0.34, 1.56, 0.64, 1] },
            opacity: { duration: 0.6 },
            rotate: isPlaying ? {
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            } : {}
          }}
        >
          <svg 
            className="w-6 h-6" 
            style={{ color: themeColor, width: `${24 * scale}px`, height: `${24 * scale}px` }}
            fill="currentColor" 
            viewBox="0 0 24 24"
          >
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </motion.div>

        {/* 中部：歌曲信息 */}
        <div className="flex-1 flex flex-col justify-center min-h-0 translate-y-1.5">
          <motion.div 
            className="font-bold text-gray-800 dark:text-gray-100 truncate mb-0.5"
            style={{ fontSize: `${14 * fontScale}px` }}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {currentSong.name}
          </motion.div>
          <motion.div 
            className="text-gray-600 dark:text-gray-400 truncate"
            style={{ fontSize: `${12 * fontScale}px` }}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {currentSong.artist}
          </motion.div>
        </div>

        {/* 底部：播放控制 */}
        <motion.div 
          className="flex items-center justify-between"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          <button
            onClick={handleTogglePlay}
            className="rounded-full bg-white/80 dark:bg-black/80 backdrop-blur-sm shadow-md flex items-center justify-center hover:scale-110 transition-transform"
            style={{ 
              color: themeColor,
              width: `${32 * scale}px`,
              height: `${32 * scale}px`
            }}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? (
              <svg style={{ width: `${14 * scale}px`, height: `${14 * scale}px` }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg style={{ width: `${14 * scale}px`, height: `${14 * scale}px` }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          
          {/* 播放状态指示器 */}
          {isPlaying && <PlayingIndicator themeColor={themeColor} scale={scale} />}
        </motion.div>
      </div>
    </div>
  );
});

MusicPlayerWidget.displayName = 'MusicPlayerWidget';