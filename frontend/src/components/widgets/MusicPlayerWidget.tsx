/**
 * 音乐播放器小组件
 * Glass风格设计，2x2紧凑布局
 */

import { useState, useEffect, useCallback, memo, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Song, getNeteaseLyrics, getQQLyrics, LyricLine, getCurrentLyricIndex, audioManager } from '../../utils/musicPlayer';
import { WidgetConfig } from '../WidgetGrid';
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext';
import { useWidgetSize } from '../../hooks/useWidgetSize';
import { useAnimationLevel, AnimationConfig } from '../../hooks/useAnimationLevel';
import { useAnimationSlot } from '../../hooks/useAnimationScheduler';

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
  scale = 1,
  className,
  style,
  anim
}: { 
  cover: string | undefined; 
  name: string; 
  isPlaying: boolean; 
  themeColor: string;
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
  anim: AnimationConfig;
}) => {
  // 直接使用 cover 作为 key，强制重新渲染，不使用内部状态缓存
  // 这样可以确保封面立即更新，而不是等待加载完成
  
  return (
    <motion.div 
      className={className || "absolute z-10"}
      style={style || { top: `${8 * scale}px`, right: `${8 * scale}px` }}
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
        className="rounded-md overflow-hidden shadow-lg ring-2 ring-white/20 dark:ring-white/10 backdrop-blur-sm"
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
            repeat: anim.loop ? Infinity : 0,
            ease: "easeInOut"
          }}
        />
      )}
    </motion.div>
  );
});

AlbumCover.displayName = 'AlbumCover';

// 播放状态指示器 - 独立组件
const PlayingIndicator = memo(({ themeColor, scale = 1, anim }: { themeColor: string; scale?: number; anim: AnimationConfig }) => (
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
      transition={{ duration: 0.6, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" }}
    />
    <motion.div 
      className="rounded-full"
      style={{ background: themeColor, width: `${2 * scale}px` }}
      animate={{ height: ['60%', '100%', '60%'] }}
      transition={{ duration: 0.6, repeat: anim.loop ? Infinity : 0, ease: "easeInOut", delay: 0.1 }}
    />
    <motion.div 
      className="rounded-full"
      style={{ background: themeColor, width: `${2 * scale}px` }}
      animate={{ height: ['40%', '100%', '40%'] }}
      transition={{ duration: 0.6, repeat: anim.loop ? Infinity : 0, ease: "easeInOut", delay: 0.2 }}
    />
  </motion.div>
));

PlayingIndicator.displayName = 'PlayingIndicator';

export const MusicPlayerWidget = memo(({ config, isEditMode, isPreview }: MusicPlayerWidgetProps) => {
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
  const playerControl = useMusicPlayerControl();
  const anim = useAnimationLevel();
  const uniqueId = useId();
  
  // 🆕 接入动画调度器 - 音乐播放器动画优先级中上(4)
  const { isAnimating } = useAnimationSlot(`music-player-${uniqueId}`, {
    priority: 4,
    duration: 4000, // 光效动画约4秒周期
    autoRequest: anim.loop,
    releaseOnUnmount: false, // 确保动画完整完成一轮
  });
  
  const canAnimate = anim.loop && isAnimating;
  
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

  // 歌词状态
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);

  // 获取歌词
  useEffect(() => {
    if (isPreview) {
      setLyrics([
        { time: 0, text: '示例歌词 - 上一句' },
        { time: 5, text: '示例歌词 - 当前句' },
        { time: 10, text: '示例歌词 - 下一句' },
      ]);
      setCurrentLyricIndex(1);
      return;
    }

    if (!currentSong) {
      setLyrics([]);
      setCurrentLyricIndex(-1);
      return;
    }

    const fetchLyrics = async () => {
      let lines: LyricLine[] = [];
      try {
        if (currentSong.source === 'netease') {
          lines = await getNeteaseLyrics(currentSong.id);
        } else if (currentSong.source === 'qq') {
          lines = await getQQLyrics(currentSong.id);
        }
      } catch (e) {
        console.error('Failed to fetch lyrics', e);
      }
      setLyrics(lines);
    };

    fetchLyrics();
  }, [currentSong?.id, currentSong?.source, isPreview]);

  // 同步歌词进度 - 添加节流优化
  useEffect(() => {
    if (isPreview) return;

    if (!isPlaying || !currentSong || lyrics.length === 0) return;

    const audio = audioManager.getCurrentAudio();
    if (!audio) return;

    // 使用节流避免过于频繁的状态更新
    let lastUpdateTime = 0;
    const THROTTLE_MS = 100; // 100ms 节流

    const handleTimeUpdate = () => {
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) return;
      lastUpdateTime = now;
      
      const index = getCurrentLyricIndex(lyrics, audio.currentTime);
      setCurrentLyricIndex(prev => {
        if (prev !== index) return index;
        return prev;
      });
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => audio.removeEventListener('timeupdate', handleTimeUpdate);
  }, [isPlaying, currentSong, lyrics, isPreview]);

  if (!isEnabled) {
    return (
      <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
        {/* 背景光效 - 低端设备使用 blur-xl 减少性能消耗 */}
        <div 
          className={`absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-10 ${anim.level === 'standard' ? 'blur-3xl' : 'blur-xl'}`}
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
      <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
        {/* 背景光效 - 低端设备使用 blur-xl */}
        <div 
          className={`absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-10 ${anim.level === 'standard' ? 'blur-3xl' : 'blur-xl'}`}
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

  // 4x2 布局 - 上下结构重构
  if (config.size === '4x2' && currentSong) {
    return (
      <div 
        ref={containerRef}
        className="relative h-full w-full rounded-xl overflow-hidden glass cursor-pointer group flex flex-col"
        onClick={handleClick}
      >
        {/* 全局背景光效 */}
        <motion.div 
          className="absolute inset-0 opacity-20"
          style={{ 
            background: `linear-gradient(135deg, ${themeColor}40 0%, transparent 100%)` 
          }}
        />

        {/* 上半部分：歌词 (2/3) */}
        <div className="flex-1 relative w-full overflow-hidden flex items-center justify-center px-8 text-center z-10">
           {/* 背景：封面高斯模糊 + 呼吸动效 */}
           <div className="absolute inset-0 z-0 overflow-hidden">
              <motion.div 
                key={currentSong.cover}
                className={`absolute inset-0 bg-cover bg-center ${anim.level === 'standard' ? 'blur-xl' : 'blur-sm'} opacity-30 dark:opacity-20`}
                style={{ backgroundImage: `url(${currentSong.cover || ''})` }}
                initial={{ opacity: 0, scale: 1.2 }}
                animate={anim.level === 'standard' ? { 
                  opacity: 0.3,
                  scale: [1.2, 1.5, 1.2], // 加大呼吸幅度
                  rotate: [0, 15, 0, -15, 0], // 增加旋转角度
                  x: [0, 20, 0, -20, 0], // 添加水平漂移
                  y: [0, -15, 0, 15, 0], // 添加垂直漂移
                } : {
                  opacity: 0.3,
                  scale: 1.2
                }}
                transition={{ 
                  opacity: { duration: 1 },
                  scale: { duration: 20, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" },
                  rotate: { duration: 45, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" },
                  x: { duration: 25, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" },
                  y: { duration: 30, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" },
                }}
              />
              {/* 遮罩层：增强文字对比度 */}
              <div className="absolute inset-0 bg-white/40 dark:bg-black/40 mix-blend-overlay" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/10 dark:to-black/10" />
              
              {/* 动态光斑效果 - 低端设备完全禁用，受调度器控制 */}
              {isPlaying && canAnimate && (
                <motion.div 
                  className="absolute top-1/2 left-1/2 w-full h-full -translate-x-1/2 -translate-y-1/2 bg-gradient-to-tr from-white/20 to-transparent rounded-full blur-xl mix-blend-overlay"
                  animate={{ 
                    scale: [0.8, 1.1, 0.8],
                    opacity: [0.2, 0.4, 0.2],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                />
              )}
           </div>

           {/* 歌词显示 - 低端设备使用简单过渡，标准设备使用 AnimatePresence */}
           {anim.level === 'standard' ? (
             <AnimatePresence mode="wait">
                {lyrics.length > 0 ? (
                  <motion.div 
                    key={currentLyricIndex}
                    className="relative z-10 font-bold text-gray-800 dark:text-white line-clamp-2 w-full transition-all duration-300 ease-out"
                    style={{ fontSize: `${18 * fontScale}px` }}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.4 }}
                  >
                    {lyrics[currentLyricIndex]?.text || (currentLyricIndex === -1 ? '...' : '')}
                  </motion.div>
                ) : (
                  <div className="relative z-10 text-sm text-gray-500 dark:text-gray-400">暂无歌词</div>
                )}
             </AnimatePresence>
           ) : (
             // 低端设备：使用简单的 CSS 过渡，避免频繁的组件挂载/卸载
             <div 
               className="relative z-10 font-bold text-gray-800 dark:text-white line-clamp-2 w-full transition-opacity duration-300 ease-out"
               style={{ fontSize: `${18 * fontScale}px` }}
             >
               {lyrics.length > 0 
                 ? (lyrics[currentLyricIndex]?.text || (currentLyricIndex === -1 ? '...' : ''))
                 : <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">暂无歌词</span>
               }
             </div>
           )}
        </div>

        {/* 下半部分：信息 + 控制 (1/3) */}
        <div className="h-[36%] relative w-full border-t border-gray-200/10 dark:border-white/5 bg-white/30 dark:bg-black/20 backdrop-blur-md flex items-center justify-between px-4 z-20">
           <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
              {/* 封面 - 放大并向上溢出 + 悬浮动效 */}
              <motion.div 
                className="relative shrink-0 origin-bottom-left" 
                style={{ marginTop: `-${24 * scale}px` }}
                animate={{ 
                  y: isPlaying ? [0, -4, 0] : 0,
                }}
                transition={{ 
                  y: { duration: 4, repeat: anim.loop ? Infinity : 0, ease: "easeInOut" }
                }}
              >
                 <AlbumCover 
                  cover={currentSong.cover}
                  name={currentSong.name}
                  isPlaying={isPlaying}
                  themeColor={themeColor}
                  scale={scale * 1.35} // 放大封面
                  className="relative z-10 shadow-xl"
                  style={{}} 
                  anim={anim}
                />
              </motion.div>
              {/* 信息 - 切换时滑入动效 */}
              <div className="flex flex-col justify-center min-w-0 pr-1">
                <motion.div 
                  key={currentSong.name}
                  className="font-bold text-gray-800 dark:text-gray-100 leading-tight truncate"
                  style={{ fontSize: `${14 * fontScale}px` }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  {currentSong.name}
                </motion.div>
                <motion.div 
                  key={currentSong.artist}
                  className="text-gray-600 dark:text-gray-400 truncate text-xs mt-0.5"
                  style={{ fontSize: `${11 * fontScale}px` }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                >
                  {currentSong.artist}
                </motion.div>
              </div>
           </div>
           
           {/* 控制区 */}
           <div className="flex items-center gap-3 shrink-0">
             {isPlaying && <PlayingIndicator themeColor={themeColor} scale={scale * 0.8} anim={anim} />}
             <motion.button
                onClick={handleTogglePlay}
                className="rounded-full bg-white dark:bg-white/10 shadow-sm flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10"
                style={{ 
                  color: themeColor,
                  width: `${34 * scale}px`,
                  height: `${34 * scale}px`
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                {isPlaying ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                ) : (
                  <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                )}
              </motion.button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="relative h-full w-full rounded-xl overflow-hidden glass cursor-pointer group"
      onClick={handleClick}
    >
      {/* 背景光效 - 低端设备禁用动画和减少 blur，受调度器控制 */}
      {canAnimate ? (
        <motion.div 
          className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-xl"
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
      ) : (
        <div 
          className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-xl opacity-10"
          style={{ background: themeColor }}
        />
      )}
      
      {/* 右上角：专辑封面 - 浮动元素 */}
      <AlbumCover 
        cover={currentSong.cover}
        name={currentSong.name}
        isPlaying={isPlaying}
        themeColor={themeColor}
        scale={scale}
        anim={anim}
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
              repeat: anim.loop ? Infinity : 0,
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
            className="font-bold text-gray-800 dark:text-gray-100 truncate mb-0.5 transition-all duration-300 ease-out"
            style={{ fontSize: `${14 * fontScale}px` }}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {currentSong.name}
          </motion.div>
          <motion.div 
            className="text-gray-600 dark:text-gray-400 truncate transition-all duration-300 ease-out"
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
          {isPlaying && <PlayingIndicator themeColor={themeColor} scale={scale} anim={anim} />}
        </motion.div>
      </div>
    </div>
  );
});

MusicPlayerWidget.displayName = 'MusicPlayerWidget';