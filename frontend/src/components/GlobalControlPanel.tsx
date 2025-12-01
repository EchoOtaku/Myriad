import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './GlobalControlPanel.css';
import {
  getGreeting,
  getWeatherInfo,
  getRandomQuote,
  getThemeInfo,
  WeatherData,
  QuoteData,
} from '../utils/dynamicContent';
import { useWallpaper } from '../hooks/useWallpaper';
import { loadResource } from '../utils/resourceLoader';
import { ControlPanelWidgets } from './ControlPanel/ControlPanelWidgets';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { MusicPlayer } from './ControlPanel/MusicPlayer';
import { UserSection, User } from './ControlPanel/UserSection';
import { usePerformanceProfile } from '../hooks/usePerformanceProfile';
import { useAnimationLevel } from '../hooks/useAnimationLevel';
import { useAuth } from '../contexts/AuthContext';
import { useAnimationPreference } from '../contexts/AnimationPreferenceContext';
import { useI18n } from '../contexts/I18nContext';
import { useThemeMode } from '../utils/themeSubscriber';

interface DynamicContent {
  type: 'greeting' | 'weather' | 'quote' | 'theme' | 'music';
  icon: string;
  text: string;
  subtext?: string;
}

const GlobalControlPanel: React.FC = () => {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDynamicContent, setShowDynamicContent] = useState(true);
  const [showPanelContent, setShowPanelContent] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  // 使用共享主题订阅器，避免创建多余的 MutationObserver
  const isDark = useThemeMode();
  const [user, setUser] = useState<User | null>(null);

  // 动态内容状态
  const [dynamicContents, setDynamicContents] = useState<DynamicContent[]>([]);
  const [currentContentIndex, setCurrentContentIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);

  // 壁纸管理 Hook（替代之前的独立状态和函数）
  const { wallpaperUrl, canRefresh: canRefreshWallpaper, refreshWallpaper, loadWallpaper } = useWallpaper();
  
  // 音乐播放器 Hook（从 GlobalControlPanel 分离）
  const musicPlayer = useMusicPlayer();
  
  // 音量弹窗状态（UI相关，保留在这里）
  const [showVolumePopup, setShowVolumePopup] = useState(false);

  // DOM 引用
  const triggerRef = useRef<HTMLDivElement>(null);
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const perf = usePerformanceProfile();
  const anim = useAnimationLevel();
  const { preference: animPreference, togglePerformanceMode } = useAnimationPreference();

  useEffect(() => {
    // 主题状态现在由 useThemeMode() hook 自动管理
    // 认证检查现在由 AuthContext 管理，用户信息会自动同步

    // 加载动态内容
    loadDynamicContents();

    // 加载壁纸配置以初始化 canRefresh 状态
    loadWallpaper();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时运行一次，避免循环依赖

  // 点击外部关闭音量弹窗
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (volumeControlRef.current && !volumeControlRef.current.contains(event.target as Node)) {
        setShowVolumePopup(false);
      }
    };

    if (showVolumePopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showVolumePopup]);

  // 注意：壁纸颜色提取完全由 AppLayout 负责
  // GlobalControlPanel 不再处理壁纸颜色，只处理音乐封面颜色

  // 加载动态内容
  const loadDynamicContents = useCallback(async () => {
    const contents: DynamicContent[] = [];

    // 1. 问候语（始终显示，立即加载）
    const greetingTranslations = {
      morning: t.greeting.morning,
      noon: t.greeting.noon,
      afternoon: t.greeting.afternoon,
      evening: t.greeting.evening,
      night: t.greeting.night,
    };
    const greeting = getGreeting(user?.username, greetingTranslations, locale);
    contents.push({
      type: 'greeting',
      icon: greeting.icon,
      text: greeting.text,
      subtext: greeting.time
    });

    // 立即显示问候语
    setDynamicContents([...contents]);

    // 2. 天气信息（高优先级）
    loadResource.high('weather-info', async () => {
      try {
        const weather = await getWeatherInfo();
        if (weather) {
          setWeatherData(weather);
          setDynamicContents(prev => {
            // 检查是否已存在天气信息
            const hasWeather = prev.some(c => c.type === 'weather');
            if (hasWeather) return prev;
            
            // Helper to translate weather code
            const getWeatherText = (code: number) => {
              if (code === 0 || code === 1) return t.weather.sunny;
              if (code === 2 || code === 3) return t.weather.cloudy;
              if (code === 45 || code === 48) return t.weather.foggy;
              if (code >= 51 && code <= 67) return t.weather.rainy;
              if (code >= 80 && code <= 82) return t.weather.rainy;
              if (code >= 71 && code <= 77) return t.weather.snowy;
              if (code >= 85 && code <= 86) return t.weather.snowy;
              if (code >= 95 && code <= 99) return t.weather.thunderstorm;
              return t.weather.unavailable;
            };

            // 在问候语后插入天气信息
            const newContents = [...prev];
            newContents.splice(1, 0, {
              type: 'weather',
              icon: weather.icon,
              text: `${weather.temperature} ${getWeatherText(weather.weatherCode)}`,
              subtext: weather.city
            });
            return newContents;
          });
        }
      } catch (error) {
        // 静默处理错误
      }
    });

    // 3. 一言警句（高优先级）
    loadResource.high('quote-info', async () => {
      try {
        const quote = await getRandomQuote(locale);
        if (quote) {
          setQuoteData(quote);
          setDynamicContents(prev => {
            // 检查是否已存在名言
            const hasQuote = prev.some(c => c.type === 'quote');
            if (hasQuote) return prev;
            
            // 添加到列表中
            return [...prev, {
              type: 'quote',
              icon: '💭',
              text: quote.text,
              subtext: quote.author
            }];
          });
        }
      } catch (error) {
        // 静默处理错误
      }
    });

    // 4. 主题状态 - 立即显示
    const theme = getThemeInfo();
    const themeTexts = [
      t.controlPanel.themeSwitch,
      t.controlPanel.wallpaperSwitch,
      t.controlPanel.appearanceSettings
    ];
    const randomText = themeTexts[Math.floor(Math.random() * themeTexts.length)];
    
    setDynamicContents(prev => [...prev, {
      type: 'theme',
      icon: '⚙️',
      text: randomText,
      subtext: t.controlPanel.clickToExpand
    }]);
  }, [user?.username, t, locale]);

  // 同步 AuthContext 的用户信息到本地状态
  useEffect(() => {
    if (authUser) {
      setUser(authUser as User);
    } else {
      setUser(null);
    }
  }, [authUser]);

  // 当用户信息更新时，重新加载动态内容
  useEffect(() => {
    if (user) {
      loadDynamicContents();
    }
  }, [user, loadDynamicContents]);

  // 壁纸加载和刷新功能已由 useWallpaper Hook 提供
  // loadWallpaperConfig 和 refreshWallpaper 已废弃

  // 初始化时加载音乐配置（只在挂载时运行一次）
  useEffect(() => {
    musicPlayer.loadMusicConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在组件挂载时运行一次

  // 确保 currentContentIndex 在有效范围内
  useEffect(() => {
    if (dynamicContents.length > 0 && currentContentIndex >= dynamicContents.length) {
      setCurrentContentIndex(0);
    }
  }, [dynamicContents.length, currentContentIndex]);

  // 动态内容轮播（带淡入淡出效果）
  useEffect(() => {
    // 在以下情况禁用轮播：展开面板 / 悬停 / 动态内容为空 / 页面隐藏
    if (dynamicContents.length === 0 || isExpanded || isHovering) return;

    let timerId: number | null = null;
    let cancelled = false;

    const cycle = () => {
      if (cancelled || document.hidden) return;
      setIsTransitioning(true);
      timerId = window.setTimeout(() => {
        if (cancelled) return;
        setCurrentContentIndex((prev) => (prev + 1) % dynamicContents.length);
        window.setTimeout(() => setIsTransitioning(false), 50);
        // 下一次循环：低端设备延长到 16s，正常 8s
        const base = 8000;
        const nextDelay = Math.round(base * (anim.durationScale || 1));
        timerId = window.setTimeout(cycle, nextDelay);
      }, 300);
    };

    // 首次延迟启动，避免首屏竞争
    const startDelay = Math.round(3000 * (anim.durationScale || 1));
    timerId = window.setTimeout(cycle, startDelay);

    const handleVisibility = () => {
      if (document.hidden) {
        // 页面隐藏时清除定时器
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      } else if (!cancelled) {
        // 页面重新可见时重新启动轮播
        if (timerId) clearTimeout(timerId);
        const restartDelay = Math.round(2000 * (anim.durationScale || 1));
        timerId = window.setTimeout(cycle, restartDelay);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dynamicContents.length, isExpanded, isHovering, anim.durationScale]);

  // 主题变化已通过 useThemeMode() hook 自动响应
  // 无需额外的 MutationObserver

  // 动态计算展开面板的高度 - 使用克隆测量方案（性能优化版）
  // ⚠️ 关键优化: 移动端改为轻量监测（无 ResizeObserver），桌面保留 Observer
  useLayoutEffect(() => {
    if (!triggerRef.current) return;
    const triggerEl = triggerRef.current;

    if (!isExpanded) {
      triggerEl.style.height = '3rem';
      return;
    }
    if (!expandedContentRef.current) return;
    const contentEl = expandedContentRef.current;

    let lastHeight = 0;
    let lastNaturalHeight = 0;
    let lastUpdateTime = 0;
    let pendingMeasure = false;
    let measureTimeout: number | null = null;

    // ⚠️ 移动端检测 - 使用性能配置而非 window.innerWidth，更可靠
    const isMobileDevice = perf.isMobile || perf.lowEndDevice;
    
    // ⚠️ 移动端使用更长的节流时间，减少测量频率
    const THROTTLE_MS = isMobileDevice ? 1000 : (anim.level === 'standard' ? 300 : 500);

    const measure = () => {
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) {
        // 如果在节流期内,标记待测量,稍后执行
        if (!pendingMeasure) {
          pendingMeasure = true;
          const delay = THROTTLE_MS - (now - lastUpdateTime);
          measureTimeout = window.setTimeout(() => {
            pendingMeasure = false;
            measureTimeout = null;
            measure();
          }, delay);
        }
        return;
      }
      lastUpdateTime = now;

      // 计算目标宽度用于测量（避免动画过程中的宽度变化导致高度计算错误）
      const isMobile = window.innerWidth <= 640;
      // Desktop: 400px - padding(1.375rem * 2 = 44px) = 356px
      // Mobile: (100vw - 1.5rem) - padding(1rem * 2 = 32px) = 100vw - 56px
      const targetWidth = isMobile
        ? window.innerWidth - 56
        : 356;

      // ⚠️ DOM 克隆操作开销大,已添加严格节流
      const clone = contentEl.cloneNode(true) as HTMLElement;
      clone.style.position = 'absolute';
      clone.style.visibility = 'hidden';
      clone.style.height = 'auto';
      // 关键修复：强制使用目标宽度而不是当前宽度
      clone.style.width = targetWidth + 'px';

      document.body.appendChild(clone);
      const raw = clone.offsetHeight;
      document.body.removeChild(clone);

      // 适当补偿 (考虑内边距 + 过渡)
      const compensated = Math.ceil(raw * 1.08);
      lastNaturalHeight = raw;

      if (Math.abs(compensated - lastHeight) > 4) {
        lastHeight = compensated;
        triggerEl.style.height = compensated + 'px';
      }
    };

    // 立即测量，确保动画起始帧即为正确高度
    measure();

    // ⚠️ 关键优化: 移动端/低端设备禁用 Observer，避免滚动时触发性能问题
    // 只在展开时进行一次测量，之后不再监听变化
    if (isMobileDevice) {
      // 移动端: 初始测量后启动轻量监测，避免滚动/视口变化导致高度失准
      const delayedMeasure = setTimeout(measure, 200);

      let scrollIdleId: number | null = null;
      const handleScroll = () => {
        if (scrollIdleId) {
          clearTimeout(scrollIdleId);
        }
        scrollIdleId = window.setTimeout(() => {
          scrollIdleId = null;
          lastUpdateTime = 0; // 强制允许下一次测量
          measure();
        }, 180);
      };
      window.addEventListener('scroll', handleScroll, { passive: true });

      const handleViewportResize = () => {
        lastUpdateTime = 0;
        measure();
      };
      window.addEventListener('resize', handleViewportResize);
      window.addEventListener('orientationchange', handleViewportResize);

      const visualViewport = window.visualViewport;
      const handleVisualViewportResize = visualViewport
        ? () => {
            lastUpdateTime = 0;
            measure();
          }
        : null;
      if (visualViewport && handleVisualViewportResize) {
        visualViewport.addEventListener('resize', handleVisualViewportResize);
      }

      // 轮询内容自然高度，只有在真实高度变化时才触发克隆测量
      let pollId: number | null = null;
      const startPolling = () => {
        pollId = window.setInterval(() => {
          const currentNaturalHeight = contentEl.scrollHeight;
          if (Math.abs(currentNaturalHeight - lastNaturalHeight) > 6) {
            lastUpdateTime = 0;
            measure();
          }
        }, 450);
      };
      startPolling();

      return () => {
        clearTimeout(delayedMeasure);
        if (scrollIdleId) {
          clearTimeout(scrollIdleId);
        }
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        if (visualViewport && handleVisualViewportResize) {
          visualViewport.removeEventListener('resize', handleVisualViewportResize);
        }
        if (pollId) {
          clearInterval(pollId);
        }
        if (measureTimeout !== null) {
          clearTimeout(measureTimeout);
        }
      };
    }

    // 桌面端: 使用 Observer 监听变化
    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(contentEl);

    // ⚠️ 优化: 减少 MutationObserver 的监听范围
    // 只监听直接子节点变化,不监听 subtree 和 characterData
    const mutationObserver = new MutationObserver(() => measure());
    mutationObserver.observe(contentEl, {
      childList: true,
      // subtree: true,  // 移除 subtree 监听,减少触发频率
      // characterData: true  // 移除 characterData 监听
    });

    // 可见性变化时重新测量
    const handleVisibility = () => { if (!document.hidden) setTimeout(measure, 100); };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (measureTimeout !== null) {
        clearTimeout(measureTimeout);
      }
    };
  }, [isExpanded, perf.lowEndDevice, perf.isMobile, anim.level]);

  const toggleTheme = useCallback(() => {
    const html = document.documentElement;
    const newIsDark = !isDark;

    if (newIsDark) {
      html.classList.add('dark');
      html.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
    // isDark 状态由 useThemeMode() hook 自动响应 class 变化，无需手动 setIsDark

    // 更新 meta theme-color - 使用壁纸颜色
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#94a3b8';
      metaThemeColor.setAttribute('content', primaryColor);
    }
  }, [isDark]);

  const handleTogglePanel = useCallback(() => {
    if (isExpanded) {
      // 收缩：面板内容立即淡出，容器开始收缩，动态内容在中途淡入
      setShowPanelContent(false);
      setShowOverlay(false); // 遮罩层开始淡出
      setIsExpanded(false);
      setTimeout(() => {
        setShowDynamicContent(true);
      }, 400); // 容器收缩到一半时显示（0.7s 动画的中点）
    } else {
      // 展开：动态内容立即淡出，容器开始展开，面板内容在中途淡入
      setShowDynamicContent(false);
      setIsExpanded(true);
      // 遮罩层立即显示但透明，然后淡入
      setTimeout(() => {
        setShowOverlay(true);
      }, 0);
      setTimeout(() => {
        setShowPanelContent(true);
      }, 400); // 容器展开到一半时显示（0.7s 动画的中点）
    }
  }, [isExpanded]);

  const handleClosePanel = useCallback(() => {
    handleTogglePanel();
  }, [handleTogglePanel]);

  // 监听打开控制面板事件（来自音乐小组件等点击）
  useEffect(() => {
    const handleOpenPanel = () => {
      if (!isExpanded) {
        handleTogglePanel();
      }
    };

    window.addEventListener('open-control-panel', handleOpenPanel);
    return () => {
      window.removeEventListener('open-control-panel', handleOpenPanel);
    };
  }, [isExpanded, handleTogglePanel]);

  // 当有歌词时，更新动态内容以显示歌词（仅播放时）
  // 使用 useRef 来减少状态更新频率
  const lastLyricTextRef = useRef<string>('');
  const lastSongIdRef = useRef<string>('');
  const lastPlayingStateRef = useRef<boolean>(false);

  useEffect(() => {
    const { currentSong, isPlaying, lyrics, currentLyricIndex } = musicPlayer;
    
    // 早期返回：面板展开时不更新动态内容
    if (isExpanded) return;
    
    if (currentSong && isPlaying && lyrics.length > 0 && currentLyricIndex >= 0) {
      const currentLyric = lyrics[currentLyricIndex];

      // 如果歌词文本没有变化，跳过更新（避免重复渲染）
      if (lastLyricTextRef.current === currentLyric.text) {
        return;
      }
      lastLyricTextRef.current = currentLyric.text;
      lastSongIdRef.current = currentSong.id;
      lastPlayingStateRef.current = true;

      // 播放时显示歌词 - 使用函数式更新避免闭包问题
      setDynamicContents(prev => {
        const filtered = prev.filter(c => c.type !== 'music');
        return [
          {
            type: 'music' as const,
            icon: '🎵',
            text: currentLyric.text,
            subtext: `${currentSong.name} - ${currentSong.artist}`
          },
          ...filtered
        ];
      });
    } else if (currentSong) {
      // 避免重复更新：检查歌曲和播放状态是否真的变化了
      const songChanged = lastSongIdRef.current !== currentSong.id;
      const playingChanged = lastPlayingStateRef.current !== isPlaying;
      
      if (!songChanged && !playingChanged && lastLyricTextRef.current === '') {
        return;
      }
      
      // 重置歌词文本引用
      lastLyricTextRef.current = '';
      lastSongIdRef.current = currentSong.id;
      lastPlayingStateRef.current = isPlaying;

      // 暂停时或没有歌词时只显示歌曲名
      setDynamicContents(prev => {
        const filtered = prev.filter(c => c.type !== 'music');
        return [
          {
            type: 'music' as const,
            icon: isPlaying ? '🎵' : '⏸️',
            text: currentSong.name,
            subtext: currentSong.artist
          },
          ...filtered
        ];
      });
    } else if (lastSongIdRef.current !== '') {
      // 没有歌曲时移除音乐内容（仅当之前有歌曲时）
      lastLyricTextRef.current = '';
      lastSongIdRef.current = '';
      lastPlayingStateRef.current = false;
      setDynamicContents(prev => prev.filter(c => c.type !== 'music'));
    }
  }, [musicPlayer.currentSong?.id, musicPlayer.lyrics.length, musicPlayer.currentLyricIndex, musicPlayer.isPlaying, isExpanded]);

  // 获取当前显示的动态内容
  const currentContent = dynamicContents[currentContentIndex];

  return (
    <React.Fragment>
      {/* 顶部控制栏 - 智能岛 */}
      <div className="global-control-bar">
        <div className="control-bar-content">
          <div
            ref={triggerRef}
            className={`control-bar-trigger ${isExpanded ? 'expanded' : ''}`}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            {/* 动态轮播内容 - 通过 JS 控制显示/隐藏 */}
            {currentContent && (
              <div
                className={`dynamic-content-wrapper ${!showDynamicContent || isTransitioning ? 'hidden' : ''}`}
                onClick={handleTogglePanel}
              >
                <span className="dynamic-icon">
                  {currentContent.icon}
                </span>
                <div className="dynamic-text">
                  <span className="dynamic-text-main">{currentContent.text}</span>
                  {/* 只显示天气和主题的 subtext，问候语和一言不显示 */}
                  {currentContent.subtext && (currentContent.type === 'weather' || currentContent.type === 'theme') && (
                    <span className="dynamic-text-sub">{currentContent.subtext}</span>
                  )}
                </div>
                <svg className="dynamic-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}

            {/* 展开的控制面板内容 - 通过 JS 控制显示/隐藏 */}
            <div ref={expandedContentRef} className={`expanded-panel-content ${showPanelContent ? 'visible' : ''}`}>
                {/* 头部 - 用户信息按钮 */}
                <div className="control-panel-header">
                  <UserSection onClosePanel={handleClosePanel} />
                  <button
                    onClick={handleClosePanel}
                    className="control-close-btn"
                    aria-label={t.common.close}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 动态信息卡片 - 切换显示 */}
                <ControlPanelWidgets isAdmin={user?.is_admin} />

                {/* 音乐播放器 */}
                <MusicPlayer player={musicPlayer} />

              {/* 控制项网格 - 一行两个 */}
                <div className="control-items-grid">
                  {/* 主题切换 */}
                  <div className="control-item control-item-compact">
                    <div className="control-item-info">
                      <div className="control-item-icon icon-theme">
                        {isDark ? '🌙' : '☀️'}
                      </div>
                      <div>
                        <h4 className="control-item-title">{t.controlPanel.appearance}</h4>
                        <p className="control-item-desc">{isDark ? t.controlPanel.dark : t.controlPanel.light}</p>
                      </div>
                    </div>
                    <button
                      onClick={toggleTheme}
                      className={`control-toggle ${isDark ? 'active' : ''}`}
                      aria-label={t.controlPanel.themeSwitch}
                    >
                      <span className="control-toggle-slider"></span>
                    </button>
                  </div>

                  {/* 动效等级切换 */}
                  <div className="control-item control-item-compact">
                    <div className="control-item-info">
                      <div className="control-item-icon icon-performance">
                        {animPreference === 'light' ? '🐌' : animPreference === 'standard' ? '⚡' : '🔄'}
                      </div>
                      <div>
                        <h4 className="control-item-title">{t.controlPanel.animation}</h4>
                        <p className="control-item-desc">
                          {animPreference === 'auto'
                            ? (anim.level === 'light' ? t.controlPanel.lowPerformance : anim.level === 'standard' ? t.controlPanel.highPerformance : t.controlPanel.noAnimation)
                            : animPreference === 'light' ? t.controlPanel.lowPerformance : t.controlPanel.highPerformance
                          }
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={togglePerformanceMode}
                      className={`control-toggle ${(animPreference === 'standard' || (animPreference === 'auto' && anim.level === 'standard')) ? 'active' : ''}`}
                      aria-label={t.controlPanel.animation}
                    >
                      <span className="control-toggle-slider"></span>
                    </button>
                  </div>

                  {/* 语言切换 */}
                  <div className="control-item control-item-compact">
                    <div className="control-item-info">
                      <div className="control-item-icon icon-language">
                        🌐
                      </div>
                      <div>
                        <h4 className="control-item-title">{t.controlPanel.language}</h4>
                        <p className="control-item-desc">{locale === 'zh-CN' ? '简体中文' : locale === 'ja-JP' ? '日本語' : 'English'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        // 循环切换语言列表
                        const locales = ['zh-CN', 'en-US', 'ja-JP'] as const;
                        const currentIndex = locales.indexOf(locale);
                        const nextIndex = (currentIndex + 1) % locales.length;
                        setLocale(locales[nextIndex]);
                      }}
                      onWheel={(e) => {
                        e.preventDefault();
                        const locales = ['zh-CN', 'en-US', 'ja-JP'] as const;
                        const currentIndex = locales.indexOf(locale);
                        // 向下滚动 = 下一个，向上滚动 = 上一个
                        const nextIndex = e.deltaY > 0 
                          ? (currentIndex + 1) % locales.length
                          : (currentIndex - 1 + locales.length) % locales.length;
                        setLocale(locales[nextIndex]);
                      }}
                      className="language-switch-btn"
                      aria-label={t.controlPanel.languageSwitch}
                    >
                      <span className="language-code">{locale === 'zh-CN' ? '中' : locale === 'ja-JP' ? '日' : 'En'}</span>
                    </button>
                  </div>

                  {/* 壁纸切换 - 仅在非单一图片链接时显示 */}
                  {/* Debug: canRefreshWallpaper = {String(canRefreshWallpaper)} */}
                  {canRefreshWallpaper && (
                    <div className="control-item control-item-compact">
                      <div className="control-item-info">
                        <div className="control-item-icon icon-wallpaper">
                          🖼️
                        </div>
                        <div>
                          <h4 className="control-item-title">{t.controlPanel.wallpaper}</h4>
                          <p className="control-item-desc">{t.controlPanel.random}</p>
                        </div>
                      </div>
                      <button
                        onClick={refreshWallpaper}
                        className="control-action-btn"
                        aria-label={t.controlPanel.wallpaperSwitch}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* 系统配置 - 仅管理员可见 */}
                  {user?.is_admin && (
                    <div className="control-item control-item-compact">
                      <div className="control-item-info">
                        <div className="control-item-icon icon-config">
                          ⚙️
                        </div>
                        <div>
                          <h4 className="control-item-title">{t.controlPanel.configuration}</h4>
                          <p className="control-item-desc">{t.controlPanel.system}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          handleClosePanel();
                          navigate('/config');
                        }}
                        className="control-action-btn"
                        aria-label={t.controlPanel.configuration}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </button>
                    </div>
                  )}

                </div>
            </div>
          </div>
        </div>
      </div>

      {/* 遮罩层 - 始终存在，通过 CSS 控制显示 */}
      <div
        className={`control-panel-overlay ${showOverlay ? 'visible' : ''}`}
        onClick={handleClosePanel}
      />
    </React.Fragment>
  );
};

export default GlobalControlPanel;
