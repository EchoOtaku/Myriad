/**
 * 音乐播放器小组件
 * Glass风格设计，2x2紧凑布局
 */

import { useState, useEffect, useCallback, memo, useRef, useId, useMemo } from 'react';
import { motionShim as motion, AnimatePresenceShim as AnimatePresence } from '@lib/motionShim';
import { Song, getNeteaseLyrics, getQQLyrics, LyricLine, getCurrentLyricIndex, audioManager } from '../../utils/musicPlayer';
import { WidgetConfig } from '../WidgetGrid';
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext';
import { useWidgetSize } from '../../hooks/useWidgetSize';
import { useAnimationLevel, AnimationConfig } from '../../hooks/useAnimationLevel';
import { useLoopAnimation } from '../../hooks/animation';
import { useI18n } from '../../contexts/I18nContext';

// ==================== 静态动画常量（避免每次渲染创建新对象）====================

// 封面入场动画
const ALBUM_COVER_INITIAL = { scale: 0.5, opacity: 0, rotate: -15 };
const ALBUM_COVER_ANIMATE = { scale: 1, opacity: 1, rotate: 0 };
const ALBUM_COVER_TRANSITION = { duration: 0.6, ease: [0.34, 1.56, 0.64, 1] };

// 播放状态光晕动画 - 有限次数，配合调度器 duration=4000ms
const GLOW_ANIMATE = { opacity: [0.5, 1, 0.5] };
const GLOW_TRANSITION_LOOP = { duration: 2, repeat: 1, ease: "easeInOut" as const }; // 2轮=4s
const GLOW_TRANSITION_ONCE = { duration: 2, repeat: 0, ease: "easeInOut" as const };

// 播放指示器动画 - 有限次数
const INDICATOR_INITIAL = { opacity: 0, scale: 0.8 };
const INDICATOR_ANIMATE = { opacity: 1, scale: 1 };
const INDICATOR_TRANSITION = { duration: 0.3 };

const BAR_ANIMATE_1 = { height: ['30%', '100%', '30%'] };
const BAR_ANIMATE_2 = { height: ['60%', '100%', '60%'] };
const BAR_ANIMATE_3 = { height: ['40%', '100%', '40%'] };
const BAR_TRANSITION_LOOP = (delay: number) => ({ duration: 0.6, repeat: 6, ease: "easeInOut" as const, delay }); // 6轮≈4s
const BAR_TRANSITION_ONCE = (delay: number) => ({ duration: 0.6, repeat: 0, ease: "easeInOut" as const, delay });

// 背景光效动画 - 有限次数
const BG_GLOW_ANIMATE = { opacity: [0.1, 0.2, 0.1], scale: [1, 1.15, 1] };
const BG_GLOW_TRANSITION = { duration: 3, repeat: 1, ease: "easeInOut" as const }; // 1轮=3s

// 光斑动画 - 有限次数
const LIGHT_SPOT_ANIMATE = { scale: [0.8, 1.1, 0.8], opacity: [0.2, 0.4, 0.2] };
const LIGHT_SPOT_TRANSITION = { duration: 4, repeat: 0, ease: "easeInOut" as const }; // 1轮

// 封面浮动动画 - 有限次数
const COVER_FLOAT_ANIMATE_PLAYING = { y: [0, -4, 0] };
const COVER_FLOAT_ANIMATE_STATIC = { y: 0 };
const COVER_FLOAT_TRANSITION_LOOP = { y: { duration: 4, repeat: 0, ease: "easeInOut" as const } };
const COVER_FLOAT_TRANSITION_ONCE = { y: { duration: 4, repeat: 0, ease: "easeInOut" as const } };

// 歌曲切换动画
const SONG_SLIDE_INITIAL = { opacity: 0, x: -10 };
const SONG_SLIDE_ANIMATE = { opacity: 1, x: 0 };
const SONG_SLIDE_TRANSITION = { duration: 0.4, ease: "easeOut" as const };
const SONG_SLIDE_TRANSITION_DELAY = { duration: 0.4, delay: 0.1, ease: "easeOut" as const };

// 歌词切换动画
const LYRIC_INITIAL = { opacity: 0, y: 10, scale: 0.95 };
const LYRIC_ANIMATE = { opacity: 1, y: 0, scale: 1 };
const LYRIC_EXIT = { opacity: 0, y: -10, scale: 0.95 };
const LYRIC_TRANSITION = { duration: 0.4 };

// 底部控制区入场
const CONTROL_INITIAL = { y: 10, opacity: 0 };
const CONTROL_ANIMATE = { y: 0, opacity: 1 };
const CONTROL_TRANSITION = { duration: 0.4, delay: 0.4 };

// 音乐图标入场
const MUSIC_ICON_INITIAL = { scale: 0.5, opacity: 0, rotate: -15 };
const MUSIC_ICON_ANIMATE_STATIC = { scale: 1, opacity: 1, rotate: 0 };
const MUSIC_ICON_ANIMATE_PLAYING = { scale: 1, opacity: 1, rotate: [0, 5, 0, -5, 0] };

// 歌曲信息入场
const INFO_INITIAL = { x: -20, opacity: 0 };
const INFO_ANIMATE = { x: 0, opacity: 1 };
const INFO_TRANSITION_1 = { duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] };
const INFO_TRANSITION_2 = { duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] };

export interface MusicPlayerWidgetProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

// 专辑封面组件 - 独立优化（使用静态动画常量）
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
  // 缓存 transition 避免重复创建
  const glowTransition = anim.loop ? GLOW_TRANSITION_LOOP : GLOW_TRANSITION_ONCE;
  
  return (
    <motion.div 
      className={className || "absolute z-10"}
      style={style || { top: `${8 * scale}px`, right: `${8 * scale}px` }}
      initial={ALBUM_COVER_INITIAL}
      animate={ALBUM_COVER_ANIMATE}
      transition={ALBUM_COVER_TRANSITION}
    >
      <div 
        className="rounded-md overflow-hidden shadow-lg ring-2 ring-white/20 dark:ring-white/10 backdrop-blur-sm"
        style={{ width: `${48 * scale}px`, height: `${48 * scale}px` }}
      >
        {cover ? (
          <img
            key={cover}
            src={cover}
            alt={name}
            className="w-full h-full object-cover"
            loading="eager"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 ${cover ? 'hidden' : ''}`}>
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        </div>
      </div>
      {/* 播放状态光晕 */}
      {isPlaying && (
        <motion.div 
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ boxShadow: `0 0 20px ${themeColor}40` }}
          animate={GLOW_ANIMATE}
          transition={glowTransition}
        />
      )}
    </motion.div>
  );
});

AlbumCover.displayName = 'AlbumCover';

// 播放状态指示器 - 使用静态动画常量
const PlayingIndicator = memo(({ themeColor, scale = 1, anim }: { themeColor: string; scale?: number; anim: AnimationConfig }) => {
  // 缓存 transitions
  const barTransition1 = anim.loop ? BAR_TRANSITION_LOOP(0) : BAR_TRANSITION_ONCE(0);
  const barTransition2 = anim.loop ? BAR_TRANSITION_LOOP(0.1) : BAR_TRANSITION_ONCE(0.1);
  const barTransition3 = anim.loop ? BAR_TRANSITION_LOOP(0.2) : BAR_TRANSITION_ONCE(0.2);
  
  return (
    <motion.div 
      className="flex items-end"
      style={{ gap: `${2 * scale}px`, height: `${16 * scale}px` }}
      initial={INDICATOR_INITIAL}
      animate={INDICATOR_ANIMATE}
      transition={INDICATOR_TRANSITION}
    >
      <motion.div 
        className="rounded-full"
        style={{ background: themeColor, width: `${2 * scale}px` }}
        animate={BAR_ANIMATE_1}
        transition={barTransition1}
      />
      <motion.div 
        className="rounded-full"
        style={{ background: themeColor, width: `${2 * scale}px` }}
        animate={BAR_ANIMATE_2}
        transition={barTransition2}
      />
      <motion.div 
        className="rounded-full"
        style={{ background: themeColor, width: `${2 * scale}px` }}
        animate={BAR_ANIMATE_3}
        transition={barTransition3}
      />
    </motion.div>
  );
});

PlayingIndicator.displayName = 'PlayingIndicator';

export const MusicPlayerWidget = memo(({ config, isEditMode, isPreview }: MusicPlayerWidgetProps) => {
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
  const playerControl = useMusicPlayerControl();
  const anim = useAnimationLevel();
  const uniqueId = useId();
  const { t } = useI18n();
  
  // 🆕 使用触发式动画 - 组件挂载时播放一次光效动画
  const { isAnimating } = useLoopAnimation({
    duration: 4000, // 光效动画约4秒周期
    trigger: 'mount', // 固定值，组件首次渲染时触发一次
    enabled: anim.loop, // 低端设备禁用
  });
  
  const canAnimate = anim.loop && isAnimating;
  
  const currentSong = isPreview ? { 
    name: t.musicPlayer.sampleSong, 
    artist: t.musicPlayer.sampleArtist, 
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
        { time: 0, text: t.musicPlayer.sampleLyricPrev },
        { time: 5, text: t.musicPlayer.sampleLyricCurrent },
        { time: 10, text: t.musicPlayer.sampleLyricNext },
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
            {t.music.noPlaying}
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
                    repeat: 1, // 有限次数
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
                  <div className="relative z-10 text-sm text-gray-500 dark:text-gray-400">{t.musicPlayer.noLyrics}</div>
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
                 : <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">{t.musicPlayer.noLyrics}</span>
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
                aria-label={isPlaying ? t.music.pause : t.music.play}
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
            repeat: 1, // 有限次数
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
            aria-label={isPlaying ? t.music.pause : t.music.play}
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