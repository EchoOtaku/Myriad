import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { getCSRFToken } from '../utils/csrf';
import './GlobalControlPanel.css';
import LoginForm from './LoginForm';
import {
  getGreeting,
  getWeatherInfo,
  getRandomQuote,
  getThemeInfo,
  WeatherData,
  QuoteData,
  GreetingData
} from '../utils/smartWidgets';
import {
  Song,
  LyricLine,
  MusicSource,
  getNeteasePlaylist,
  getQQPlaylist,
  getNeteaseLyrics,
  getQQLyrics,
  getCurrentLyricIndex,
  formatTime
} from '../utils/musicPlayer';
import { extractColorsFromImage, applyColorPalette } from '../utils/colorExtractor';
import { useWallpaper } from '../hooks/useWallpaper';

interface User {
  username: string;
  is_admin: boolean;
  auth_provider: string;
  display_name?: string;
  linked_github_id?: string;
}

interface DynamicContent {
  type: 'greeting' | 'weather' | 'quote' | 'theme' | 'music';
  icon: string;
  text: string;
  subtext?: string;
}

const GlobalControlPanel: React.FC = () => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDynamicContent, setShowDynamicContent] = useState(true);
  const [showPanelContent, setShowPanelContent] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<{
    name: string;
    avatar: string;
    bio: string;
    platform: string;
  } | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [isUserModalClosing, setIsUserModalClosing] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  // 动态内容状态
  const [dynamicContents, setDynamicContents] = useState<DynamicContent[]>([]);
  const [currentContentIndex, setCurrentContentIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [expandedCardIndex, setExpandedCardIndex] = useState(0); // 0=天气, 1=名言

  // 壁纸管理 Hook（替代之前的独立状态和函数）
  const { wallpaperUrl, canRefresh: canRefreshWallpaper, refreshWallpaper, loadWallpaper } = useWallpaper();
  
  // 音乐播放器状态
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicSource, setMusicSource] = useState<MusicSource>('netease');
  const [playlistId, setPlaylistId] = useState('');
  const [musicError, setMusicError] = useState<string>('');
  const [musicPlayerView, setMusicPlayerView] = useState<'info' | 'lyrics' | 'playlist'>('info');
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [musicColors, setMusicColors] = useState<{
    primary: string;
    secondary: string;
    accent: string;
    light: string;
    dark: string;
  } | null>(null);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const playlistScrollRef = useRef<HTMLDivElement>(null);
  
  // 播放列表搜索状态
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  
  // 预加载系统
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const [preloadedSongIndex, setPreloadedSongIndex] = useState<number>(-1);
  const preloadCacheRef = useRef<Map<number, boolean>>(new Map());
  const preloadErrorCountRef = useRef<number>(0);
  const preloadDisabledRef = useRef<boolean>(false);

  // 验证并规范化颜色值（确保是有效的十六进制格式）
  const normalizeColor = (color: string): string => {
    // 移除所有空格和非法字符
    const cleaned = color.trim().replace(/\s+/g, '');
    // 验证是否为有效的十六进制颜色（#RRGGBB 或 #RGB）
    if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(cleaned)) {
      return cleaned.toLowerCase();
    }
    // 如果无效，返回灰色作为后备
    console.warn(`Invalid color format: "${color}", using fallback`);
    return '#999999';
  };

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
      // 清除音乐颜色变量，使用默认值
      root.style.removeProperty('--music-primary');
      root.style.removeProperty('--music-secondary');
      root.style.removeProperty('--music-accent');
      root.style.removeProperty('--music-light');
      root.style.removeProperty('--music-dark');
    }

    // 组件卸载时清除音乐颜色变量
    return () => {
      root.style.removeProperty('--music-primary');
      root.style.removeProperty('--music-secondary');
      root.style.removeProperty('--music-accent');
      root.style.removeProperty('--music-light');
      root.style.removeProperty('--music-dark');
    };
  }, [musicColors]);

  // DOM 引用
  const triggerRef = useRef<HTMLDivElement>(null);
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 检查当前主题
    setIsDark(document.documentElement.classList.contains('dark'));

    // 检查登录状态
    checkAuth();

    // 加载动态内容
    loadDynamicContents();
    
    // 加载壁纸配置以初始化 canRefresh 状态
    loadWallpaper();
  }, [loadWallpaper]);

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

  // 用户弹窗滚动锁定
  useEffect(() => {
    if (showUserModal) {
      // 禁止背景滚动
      document.body.style.overflow = 'hidden';
    } else {
      // 恢复背景滚动
      document.body.style.overflow = '';
    }

    return () => {
      // 清理：组件卸载时恢复滚动
      document.body.style.overflow = '';
    };
  }, [showUserModal]);

  // 注意：壁纸颜色提取完全由 AppLayout 负责
  // GlobalControlPanel 不再处理壁纸颜色，只处理音乐封面颜色

  // 加载动态内容
  const loadDynamicContents = useCallback(async () => {
    const contents: DynamicContent[] = [];

    // 1. 问候语（始终显示）
    const greeting = getGreeting(user?.username);
    contents.push({
      type: 'greeting',
      icon: greeting.icon,
      text: greeting.text,
      subtext: greeting.time
    });

    // 2. 天气信息
    try {
      const weather = await getWeatherInfo();
      if (weather) {
        setWeatherData(weather);
        contents.push({
          type: 'weather',
          icon: weather.icon,
          text: `${weather.temperature} ${weather.weather}`,
          subtext: weather.city
        });
      }
    } catch (error) {
      // 静默处理错误
    }

    // 3. 一言警句
    try {
      const quote = await getRandomQuote();
      if (quote) {
        setQuoteData(quote);
        contents.push({
          type: 'quote',
          icon: '💭',
          text: quote.text,
          subtext: quote.author
        });
      }
    } catch (error) {
      // 静默处理错误
    }

    // 4. 主题状态 - 随机提示可配置选项
    const theme = getThemeInfo();
    const themeTexts = [
      '主题切换',
      '壁纸切换',
      '外观设置'
    ];
    const randomText = themeTexts[Math.floor(Math.random() * themeTexts.length)];
    
    contents.push({
      type: 'theme',
      icon: '⚙️',
      text: randomText,
      subtext: '点击展开设置'
    });

    setDynamicContents(contents);
  }, [user?.username]);

  // 获取平台用户信息
  const fetchUserInfo = useCallback(async () => {
    try {
      const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        if (profileData.success && profileData.user_info) {
          setUserInfo({
            name: profileData.user_info.name || '未知用户',
            avatar: profileData.user_info.avatar || '',
            bio: profileData.user_info.bio || '这家伙很懒，没有介绍呢',
            platform: profileData.user_info.platform || 'Unknown'
          });
        }
      }
    } catch (error) {
      // 静默处理错误
    }
  }, []);

  const checkAuth = useCallback(async () => {
    // ✅ 静默检查认证状态（不在控制台显示 401 错误）
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include', // ✅ 自动发送 HttpOnly Cookie
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setIsAuthenticated(true); // ✅ API 调用成功，设置为已认证

          // 获取头像
          let avatar = `https://ui-avatars.com/api/?name=${userData.username}`;
          try {
            const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              if (profileData.success && profileData.user_info?.avatar) {
                avatar = profileData.user_info.avatar;
              }
            }
          } catch {
            // 使用默认头像
          }
          setAvatarUrl(avatar);
          
          // 同时获取平台用户信息
          fetchUserInfo();
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    }
  }, [fetchUserInfo]);

  // 检查GitHub OAuth是否启用
  const checkGithubOAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/setup/config`);
      const data = await response.json();
      setGithubEnabled(data.github_oauth?.client_id_set || false);
    } catch (err) {
      // 静默处理错误
    }
  }, []);

  // 处理用户信息区域点击
  const handleUserInfoClick = () => {
    setIsUserModalClosing(false);
    setShowUserModal(true);
    setShowChangePassword(false);
    setPasswordError('');
  };

  // 处理用户弹窗关闭
  const handleUserModalClose = () => {
    setIsUserModalClosing(true);
    setTimeout(() => {
      setShowUserModal(false);
      setIsUserModalClosing(false);
    }, 300); // 等待动画完成
  };

  // 处理修改密码
  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordError('');

    const formData = new FormData(e.currentTarget);
    const oldPassword = formData.get('old-password') as string;
    const newPassword = formData.get('new-password') as string;
    const confirmPassword = formData.get('confirm-password') as string;

    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 个字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }

    if (oldPassword === newPassword) {
      setPasswordError('新密码不能与当前密码相同');
      return;
    }

    setPasswordSubmitting(true);

    try {
      // 获取 CSRF Token
      const csrfToken = await getCSRFToken(true);
      if (!csrfToken) {
        setPasswordError('无法获取 CSRF Token，请刷新页面后重试');
        setPasswordSubmitting(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert('✓ 密码修改成功！');
        e.currentTarget.reset();
        setShowChangePassword(false);
      } else {
        setPasswordError(result.message || result.error || '修改失败，请重试');
      }
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  // 当用户信息更新时，重新加载动态内容
  useEffect(() => {
    if (user) {
      loadDynamicContents();
    }
  }, [user, loadDynamicContents]);

  // 壁纸加载和刷新功能已由 useWallpaper Hook 提供
  // loadWallpaperConfig 和 refreshWallpaper 已废弃

  // 加载音乐配置
  const loadMusicConfig = useCallback(async () => {
    try {
      // 页面加载时重置预加载错误计数和状态
      preloadErrorCountRef.current = 0;
      preloadDisabledRef.current = false;
      
      const response = await fetch(`${API_URL}/api/config/ui`);
      const data = await response.json();

      const enabled = data.music_enabled === 'true';
      const source = data.music_source || 'netease';
      const plistId = data.music_playlist_id || '';

      setMusicEnabled(enabled);
      setMusicSource(source as MusicSource);
      setPlaylistId(plistId);

      // 如果启用音乐且有歌单ID，加载歌单
      if (enabled && plistId) {
        loadPlaylist(source as MusicSource, plistId);
      }
    } catch (error) {
      // 静默处理错误
    }
  }, []);

  // 预加载下一首歌曲
  const preloadNextSong = useCallback((nextIndex: number) => {
    // 如果预加载已被禁用（连续失败3次），跳过
    if (preloadDisabledRef.current) {
      return;
    }
    
    if (!preloadAudioRef.current || nextIndex < 0 || nextIndex >= playlist.length) {
      return;
    }
    
    // 如果已经预加载过这首歌，跳过
    if (preloadCacheRef.current.has(nextIndex)) {
      return;
    }
    
    const nextSong = playlist[nextIndex];
    if (nextSong) {
      const preloadAudio = preloadAudioRef.current;
      
      // 监听加载错误
      const handleError = () => {
        preloadErrorCountRef.current += 1;
        
        // 连续3次失败，禁用预加载
        if (preloadErrorCountRef.current >= 3) {
          preloadDisabledRef.current = true;
          console.warn('音乐预加载已禁用：连续3次失败（可能因版权或地理限制）');
        }
        
        // 清理事件监听
        preloadAudio.removeEventListener('error', handleError);
        preloadAudio.removeEventListener('canplay', handleCanPlay);
      };
      
      // 监听加载成功
      const handleCanPlay = () => {
        // 重置错误计数
        preloadErrorCountRef.current = 0;
        
        // 清理事件监听
        preloadAudio.removeEventListener('error', handleError);
        preloadAudio.removeEventListener('canplay', handleCanPlay);
      };
      
      preloadAudio.addEventListener('error', handleError);
      preloadAudio.addEventListener('canplay', handleCanPlay);
      
      preloadAudio.src = nextSong.url;
      preloadAudio.load();
      setPreloadedSongIndex(nextIndex);
      preloadCacheRef.current.set(nextIndex, true);
      
      // 保持缓存大小：只保留最近的3首
      if (preloadCacheRef.current.size > 3) {
        const oldestKey = Array.from(preloadCacheRef.current.keys())[0];
        preloadCacheRef.current.delete(oldestKey);
      }
    }
  }, [playlist]);

  // 选择歌曲
  const selectSong = useCallback(async (song: Song, index: number) => {
    setCurrentSong(song);
    setCurrentSongIndex(index);

    // 提取封面颜色 - 添加淡出淡入效果
    if (song.cover) {
      try {
        // 先淡出当前颜色
        const musicContainer = document.querySelector('.music-player-container');
        if (musicContainer) {
          musicContainer.classList.add('color-transitioning');
        }

        // 提取新颜色 - 标记为音乐上下文，不会取消壁纸颜色提取
        const colors = await extractColorsFromImage(song.cover, { context: 'music' });
        
        // 短暂延迟后应用新颜色并淡入
        setTimeout(() => {
          setMusicColors(colors);
          if (musicContainer) {
            setTimeout(() => {
              musicContainer.classList.remove('color-transitioning');
            }, 50);
          }
        }, 300);
      } catch (error) {
        // 静默处理错误
        setMusicColors(null);
        const musicContainer = document.querySelector('.music-player-container');
        if (musicContainer) {
          musicContainer.classList.remove('color-transitioning');
        }
      }
    } else {
      setMusicColors(null);
    }

    // 加载歌词
    setLyrics([]); // 先清空旧歌词
    setCurrentLyricIndex(-1);
    
    try {
      const fetchedLyrics = song.source === 'netease'
        ? await getNeteaseLyrics(song.id)
        : await getQQLyrics(song.id);
      
      if (fetchedLyrics && fetchedLyrics.length > 0) {
        setLyrics(fetchedLyrics);
        setCurrentLyricIndex(-1); // 初始化为-1，等待时间更新
      } else {
        setLyrics([]);
      }
    } catch (error) {
      // 静默处理错误
      setLyrics([]);
      setCurrentLyricIndex(-1);
    }

    // 加载歌曲但不自动播放，等待用户点击播放按钮
    if (audioRef.current) {
      audioRef.current.src = song.url;
      audioRef.current.load();
      setIsPlaying(false);
      setCurrentTime(0);
    }

    // 预加载下一首歌曲
    const nextIndex = (index + 1) % playlist.length;
    if (nextIndex !== index && playlist.length > 1) {
      // 延迟500ms预加载，避免影响当前歌曲加载
      setTimeout(() => {
        preloadNextSong(nextIndex);
      }, 500);
    }

    // 更新动态内容
    loadDynamicContents();
  }, [loadDynamicContents, playlist.length, preloadNextSong]);

  // 加载歌单
  const loadPlaylist = useCallback(async (source: MusicSource, plistId: string) => {
    try {
      setMusicError(''); // 清除之前的错误
      const songs = source === 'netease'
        ? await getNeteasePlaylist(plistId)
        : await getQQPlaylist(plistId);

      setPlaylist(songs);

      // 加载第一首歌但不自动播放
      if (songs.length > 0) {
        selectSong(songs[0], 0);
      }
    } catch (error) {
      // 静默处理错误
      const errorMessage = error instanceof Error ? error.message : '加载歌单失败';
      setMusicError(errorMessage);
      setPlaylist([]);
    }
  }, [selectSong]);

  // 监听登录成功事件
  useEffect(() => {
    const handleLoginSuccess = () => {
      handleUserModalClose();
      checkAuth();
    };

    window.addEventListener('auth-login-success', handleLoginSuccess);
    return () => {
      window.removeEventListener('auth-login-success', handleLoginSuccess);
    };
  }, [checkAuth]);

  // 监听打开用户弹窗事件（从其他组件触发）
  useEffect(() => {
    const handleOpenUserModal = () => {
      setIsUserModalClosing(false);
      setShowUserModal(true);
      setShowChangePassword(false);
      setPasswordError('');
    };

    window.addEventListener('open-user-modal', handleOpenUserModal);
    return () => {
      window.removeEventListener('open-user-modal', handleOpenUserModal);
    };
  }, []);

  // 初始化时加载音乐配置和GitHub OAuth检查
  useEffect(() => {
    loadMusicConfig();
    checkGithubOAuth();
  }, [loadMusicConfig, checkGithubOAuth]);

  // 动态内容轮播（带淡入淡出效果）
  useEffect(() => {
    if (dynamicContents.length === 0 || isExpanded || isHovering) return;

    const interval = setInterval(() => {
      // 先淡出
      setIsTransitioning(true);

      // 300ms 后切换内容
      setTimeout(() => {
        setCurrentContentIndex((prev) => (prev + 1) % dynamicContents.length);
        // 再淡入
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 300);
    }, 8000); // 每8秒切换

    return () => clearInterval(interval);
  }, [dynamicContents.length, isExpanded, isHovering]);

  // 监听主题变化，仅更新主题状态（不重新请求数据）
  useEffect(() => {
    const handleThemeChange = () => {
      const newIsDark = document.documentElement.classList.contains('dark');
      setIsDark(newIsDark);
      // 移除 loadDynamicContents() 调用，避免主题切换时重复请求天气等数据
      // 天气等数据已有缓存机制，不需要在主题切换时重新加载
    };

    // 使用 MutationObserver 监听主题变化
    const observer = new MutationObserver(handleThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []); // 移除 loadDynamicContents 依赖

  // 展开后的卡片轮播
  useEffect(() => {
    if (!isExpanded || !weatherData || !quoteData) return;

    const interval = setInterval(() => {
      setExpandedCardIndex(prev => (prev + 1) % 2);
    }, 6000); // 每6秒切换

    return () => clearInterval(interval);
  }, [isExpanded, weatherData, quoteData]);

  // 动态计算展开面板的高度
  useEffect(() => {
    if (!triggerRef.current) return;
    
    const triggerEl = triggerRef.current;
    
    // 收缩时恢复默认高度
    if (!isExpanded) {
      triggerEl.style.height = '3rem';
      return;
    }
    
    // 展开时计算高度
    if (expandedContentRef.current) {
      const contentEl = expandedContentRef.current;
      const triggerStyle = window.getComputedStyle(triggerEl);
      
      // 创建临时测量容器
      const measureContainer = document.createElement('div');
      measureContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        width: 420px;
        padding: ${triggerStyle.paddingTop} ${triggerStyle.paddingRight} ${triggerStyle.paddingBottom} ${triggerStyle.paddingLeft};
        top: -9999px;
        left: -9999px;
        box-sizing: border-box;
      `;
      
      // 克隆内容元素
      const clonedContent = contentEl.cloneNode(true) as HTMLElement;
      clonedContent.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
        width: 100%;
        opacity: 1;
        transform: none;
        visibility: visible;
      `;
      
      measureContainer.appendChild(clonedContent);
      document.body.appendChild(measureContainer);
      
      // 测量并应用高度
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const measuredHeight = measureContainer.offsetHeight;
          const compensatedHeight = Math.ceil(measuredHeight * 1.06);
          
          document.body.removeChild(measureContainer);
          triggerEl.style.height = `${compensatedHeight}px`;
        });
      });
    }
  }, [isExpanded, isAuthenticated]);

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

    setIsDark(newIsDark);

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

  const handleLogout = useCallback(async () => {
    // 先关闭面板
    handleClosePanel();
    
    // 触发认证状态变化事件
    window.dispatchEvent(new CustomEvent('auth-state-changed', { 
      detail: { 
        isAuthenticated: false,
        isAdmin: false
      }
    }));
    
    try {
      // 调用后端退出API清除HttpOnly Cookie
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include', // 发送cookie
      });
    } catch (error) {
      // 静默处理退出错误
    }
    
    // 彻底清理所有本地状态和存储
    localStorage.clear();
    sessionStorage.clear();
    
    // 手动删除所有Cookie（双保险）
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      // 删除当前路径的cookie
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`;
      // 删除根路径的cookie
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    });
    
    // 🔥 直接使用 window.location 强制重定向到登录页并刷新
    // 这会清除所有 React 状态、内存中的数据，是最彻底的清理方式
    window.location.href = '/login';
  }, [handleClosePanel]);

  // 音乐播放器逻辑
  useEffect(() => {
    // 创建 audio 元素
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
    }
    
    // 创建预加载 audio 元素
    if (!preloadAudioRef.current) {
      preloadAudioRef.current = new Audio();
      preloadAudioRef.current.preload = 'auto';
    }

    const audio = audioRef.current;

    // 监听播放时间更新
    const handleTimeUpdate = () => {
      const currentTime = audio.currentTime;
      setCurrentTime(currentTime);

      // 更新当前歌词索引
      if (lyrics.length > 0) {
        const index = getCurrentLyricIndex(lyrics, currentTime);
        if (index !== currentLyricIndex) {
          setCurrentLyricIndex(index);
        }
      }
    };

    // 监听播放结束 - 自动播放下一首
    const handleEnded = async () => {
      if (playlist.length > 0) {
        const newIndex = (currentSongIndex + 1) % playlist.length;
        const nextSong = playlist[newIndex];
        
        // 如果下一首已经预加载，优先使用预加载的数据
        if (preloadedSongIndex === newIndex && preloadAudioRef.current && preloadAudioRef.current.readyState >= 2) {
          // 交换 audioRef 和 preloadAudioRef
          const temp = audioRef.current;
          audioRef.current = preloadAudioRef.current;
          preloadAudioRef.current = temp;
          
          if (audioRef.current) {
            audioRef.current.volume = volume;
            audioRef.current.play().catch(() => setIsPlaying(false));
            setIsPlaying(true);
          }
          
          setCurrentSong(nextSong);
          setCurrentSongIndex(newIndex);
          setCurrentTime(0);
          
          // 更新卡片状态：提取颜色
          if (nextSong.cover) {
            try {
              const musicContainer = document.querySelector('.music-player-container');
              if (musicContainer) {
                musicContainer.classList.add('color-transitioning');
              }
              
              const colors = await extractColorsFromImage(nextSong.cover, { context: 'music' });
              
              setTimeout(() => {
                setMusicColors(colors);
                if (musicContainer) {
                  setTimeout(() => {
                    musicContainer.classList.remove('color-transitioning');
                  }, 50);
                }
              }, 300);
            } catch (error) {
              setMusicColors(null);
            }
          } else {
            setMusicColors(null);
          }
          
          // 加载歌词
          setLyrics([]);
          setCurrentLyricIndex(-1);
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
          
          // 预加载再下一首
          const nextNextIndex = (newIndex + 1) % playlist.length;
          if (nextNextIndex !== newIndex) {
            setTimeout(() => preloadNextSong(nextNextIndex), 500);
          }
          
          // 更新动态内容
          loadDynamicContents();
        } else {
          // 没有预加载或预加载未完成，正常加载（这个会自动更新所有状态）
          selectSong(playlist[newIndex], newIndex);
          // 自动播放下一首
          if (audioRef.current) {
            setTimeout(() => {
              audioRef.current?.play().catch(() => setIsPlaying(false));
              setIsPlaying(true);
            }, 100);
          }
        }
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [lyrics, currentLyricIndex, volume, playlist, currentSongIndex, selectSong, preloadedSongIndex, preloadNextSong]);

  // 播放/暂停
  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentSong) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, currentSong]);

  // 上一首
  const playPrevious = useCallback(() => {
    if (playlist.length === 0) return;

    const newIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
    selectSong(playlist[newIndex], newIndex);
  }, [playlist, currentSongIndex, selectSong]);

  // 下一首
  const playNext = useCallback(() => {
    if (playlist.length === 0) return;

    const newIndex = (currentSongIndex + 1) % playlist.length;
    selectSong(playlist[newIndex], newIndex);
  }, [playlist, currentSongIndex, selectSong]);

  // 调整音量
  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  }, []);

  // 调整播放进度
  const handleSeek = useCallback((time: number) => {
    if (audioRef.current && currentSong) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, [currentSong]);

  // 歌词自动滚动 - 重构版
  useEffect(() => {
    if (!lyricsScrollRef.current || musicPlayerView !== 'lyrics' || lyrics.length === 0) {
      return;
    }

    const container = lyricsScrollRef.current;
    
    // 如果没有当前歌词索引（-1），滚动到顶部
    if (currentLyricIndex < 0) {
      container.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      return;
    }

    const activeElement = container.children[currentLyricIndex] as HTMLElement;
    
    if (!activeElement) return;

    // 计算滚动位置：将当前歌词居中
    const containerHeight = container.clientHeight;
    const elementTop = activeElement.offsetTop;
    const elementHeight = activeElement.clientHeight;
    const scrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);

    // 平滑滚动
    container.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });
  }, [currentLyricIndex, musicPlayerView, lyrics.length]);

  // 播放列表自动滚动到当前歌曲
  useEffect(() => {
    if (musicPlayerView !== 'playlist' || !playlistScrollRef.current || playlist.length === 0) {
      return;
    }

    const container = playlistScrollRef.current;
    
    // 如果有搜索查询，不自动滚动
    if (playlistSearchQuery.trim()) {
      return;
    }

    // 延迟执行，确保 DOM 已渲染
    setTimeout(() => {
      const activeElement = container.querySelector('.music-playlist-item.active') as HTMLElement;
      
      if (!activeElement) return;

      // 计算滚动位置：将当前歌曲居中
      const containerHeight = container.clientHeight;
      const elementTop = activeElement.offsetTop;
      const elementHeight = activeElement.clientHeight;
      const scrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);

      // 平滑滚动
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      });
    }, 100);
  }, [musicPlayerView, currentSongIndex, playlist.length, playlistSearchQuery]);

  // 当有歌词时，更新动态内容以显示歌词（仅播放时）
  useEffect(() => {
    if (currentSong && isPlaying && lyrics.length > 0 && currentLyricIndex >= 0 && !isExpanded) {
      const currentLyric = lyrics[currentLyricIndex];

      // 播放时显示歌词
      setDynamicContents(prev => {
        // 移除之前的音乐内容
        const filtered = prev.filter(c => c.type !== 'music');

        // 添加新的歌词内容
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
    } else if (currentSong && !isExpanded) {
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
    } else {
      // 没有歌曲时移除音乐内容
      setDynamicContents(prev => prev.filter(c => c.type !== 'music'));
    }
  }, [currentSong, lyrics, currentLyricIndex, isPlaying, isExpanded]);

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
                  <button
                    onClick={handleUserInfoClick}
                    className="user-info-button flex items-center gap-3"
                  >
                    {isAuthenticated && userInfo ? (
                      <>
                        <img
                          src={userInfo.avatar}
                          alt={userInfo.name}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          onError={(e) => {
                            e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}`;
                          }}
                        />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                            {userInfo.name}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {userInfo.bio.length > 30 ? `${userInfo.bio.substring(0, 30)}...` : userInfo.bio}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">请先登录</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleClosePanel}
                    className="control-close-btn"
                    aria-label="关闭"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 动态信息卡片 - 切换显示 */}
                <div className="info-card-wrapper">
                  {/* 天气卡片 */}
                  {weatherData && expandedCardIndex === 0 && (
                    <div className="info-card weather-card animated">
                      <div className="info-card-header">
                        <span className="info-card-icon">{weatherData.icon}</span>
                        <span className="info-card-title">天气</span>
                      </div>
                      <div className="weather-details">
                        <div className="weather-primary">
                          <div className="weather-temp-large">{weatherData.temperature}</div>
                          <div className="weather-location">{weatherData.city}</div>
                        </div>
                        <div className="weather-secondary">
                          <div className="weather-status">{weatherData.weather}</div>
                          {(weatherData.feelsLike !== undefined || weatherData.humidity !== undefined || weatherData.windSpeed !== undefined) && (
                            <div className="weather-extra-info">
                              {weatherData.feelsLike !== undefined && (
                                <span>体感 {weatherData.feelsLike}°C</span>
                              )}
                              {weatherData.humidity !== undefined && (
                                <span>💧 {weatherData.humidity}%</span>
                              )}
                              {weatherData.windSpeed !== undefined && (
                                <span>🍃 {Math.round(weatherData.windSpeed)} km/h</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 名言卡片 */}
                  {quoteData && expandedCardIndex === 1 && (
                    <div className="info-card quote-card animated">
                      <div className="info-card-header">
                        <span className="info-card-icon">💭</span>
                        <span className="info-card-title">一言</span>
                      </div>
                      <div className="quote-details">
                        <div className="quote-text-main">{quoteData.text}</div>
                        {quoteData.author && (
                          <div className="quote-author-main">— {quoteData.author}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 切换按钮 */}
                  {weatherData && quoteData && (
                    <div className="card-nav-dots">
                      <button 
                        className={`nav-dot ${expandedCardIndex === 0 ? 'active' : ''}`}
                        onClick={() => setExpandedCardIndex(0)}
                        aria-label="显示天气"
                      />
                      <button 
                        className={`nav-dot ${expandedCardIndex === 1 ? 'active' : ''}`}
                        onClick={() => setExpandedCardIndex(1)}
                        aria-label="显示名言"
                      />
                    </div>
                  )}
                </div>

                {/* 音乐播放器 */}
                {musicEnabled && (
                  <div className="music-player-container">
                    {/* 状态：音乐信息（主状态） */}
                    {musicPlayerView === 'info' && (
                      <div className="music-view music-view-info">
                        {currentSong ? (
                          <>
                            {/* 封面和歌曲信息 + 进度条 */}
                            <div className="music-info-main">
                              <div className="music-album-cover-large">
                                <img
                                  src={currentSong.cover || 'https://via.placeholder.com/70'}
                                  alt={currentSong.name}
                                  onError={(e) => {
                                    e.currentTarget.src = 'https://via.placeholder.com/70?text=♪';
                                  }}
                                />
                                {isPlaying && (
                                  <div className="music-playing-indicator">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                                    </svg>
                                  </div>
                                )}
                              </div>
                              
                              <div className="music-info-right">
                                <div className="music-song-info">
                                  <div className="music-song-name">{currentSong.name}</div>
                                  <div className="music-song-artist">{currentSong.artist}</div>
                                </div>
                                
                                <div className="music-progress-container">
                                  <span className="music-time">{formatTime(currentTime)}</span>
                                  <input
                                    type="range"
                                    min="0"
                                    max={currentSong.duration || 0}
                                    value={currentTime}
                                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                                    className="music-progress-bar"
                                    aria-label="音乐进度"
                                  />
                                  <span className="music-time">-{formatTime((currentSong.duration || 0) - currentTime)}</span>
                                </div>
                              </div>
                            </div>

                            {/* 播放控制按钮 + 音量 + 视图切换 */}
                            <div className="music-control-row">
                              {/* 左侧：歌词按钮 */}
                              <div className="music-view-switcher">
                                {lyrics.length > 0 && (
                                  <button
                                    onClick={() => setMusicPlayerView('lyrics')}
                                    className="music-view-switch-btn"
                                    aria-label="查看歌词"
                                    title="歌词"
                                  >
                                    <svg fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                              </div>

                              {/* 中间：核心控制按钮 */}
                              <div className="music-control-buttons">
                                <button
                                  onClick={playPrevious}
                                  className="music-control-btn"
                                  aria-label="上一首"
                                >
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                                  </svg>
                                </button>

                                <button
                                  onClick={togglePlay}
                                  className="music-play-btn"
                                  aria-label={isPlaying ? '暂停' : '播放'}
                                >
                                  {isPlaying ? (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                    </svg>
                                  ) : (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z" />
                                    </svg>
                                  )}
                                </button>

                                <button
                                  onClick={playNext}
                                  className="music-control-btn"
                                  aria-label="下一首"
                                >
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                  </svg>
                                </button>
                              </div>

                              {/* 右侧：音量和播放列表 */}
                              <div className="music-view-switcher music-view-switcher-right">
                                {/* 音量控制（弹出式） */}
                                <div className="music-volume-control" ref={volumeControlRef}>
                                  <button
                                    onClick={() => setShowVolumePopup(!showVolumePopup)}
                                    className="music-volume-btn"
                                    aria-label="音量调节"
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                                    </svg>
                                  </button>
                                  <div className={`music-volume-popup ${showVolumePopup ? 'visible' : ''}`}>
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                                    </svg>
                                    <input
                                      type="range"
                                      min="0"
                                      max="1"
                                      step="0.01"
                                      value={volume}
                                      onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                                      className="music-volume-slider"
                                      aria-label="音量调节"
                                    />
                                  </div>
                                </div>

                                {/* 播放列表按钮 */}
                                {playlist.length > 0 && (
                                  <button
                                    onClick={() => setMusicPlayerView('playlist')}
                                    className="music-view-switch-btn"
                                    aria-label="查看播放列表"
                                    title="列表"
                                  >
                                    <svg fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                                      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="music-no-song">
                            <div className="music-no-song-icon">{musicError ? '⚠️' : '🎵'}</div>
                            <div className={`music-no-song-text ${musicError ? 'error' : ''}`}>
                              {musicError || (playlist.length === 0 ? '请在配置中设置歌单' : '暂无播放')}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 状态：歌词滚动 */}
                    {musicPlayerView === 'lyrics' && currentSong && lyrics.length > 0 && (
                      <div className="music-view music-view-lyrics">
                        <div className="music-lyrics-header">
                          <button
                            onClick={() => setMusicPlayerView('info')}
                            className="music-back-btn"
                            aria-label="返回"
                          >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </button>
                          <div className="music-lyrics-title">
                            <div className="music-lyrics-song-name">{currentSong.name}</div>
                            <div className="music-lyrics-artist">{currentSong.artist}</div>
                          </div>
                        </div>

                        <div 
                          className="music-lyrics-scroll" 
                          ref={lyricsScrollRef}
                          data-total-lyrics={lyrics.length}
                          data-current-index={currentLyricIndex}
                        >
                          {lyrics.length > 0 ? (
                            lyrics.map((line, index) => (
                              <div
                                key={`lyric-${index}-${line.time}`}
                                className={`music-lyric-line ${
                                  index === currentLyricIndex ? 'active' : ''
                                } ${
                                  currentLyricIndex >= 0 && index < currentLyricIndex ? 'passed' : ''
                                }`}
                                data-time={line.time.toFixed(2)}
                                data-index={index}
                                data-active={index === currentLyricIndex}
                              >
                                {line.text}
                              </div>
                            ))
                          ) : (
                            <div className="music-no-lyrics">
                              <div className="music-no-lyrics-icon">🎵</div>
                              <div className="music-no-lyrics-text">暂无歌词</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 状态：播放列表 */}
                    {musicPlayerView === 'playlist' && playlist.length > 0 && (() => {
                      // 过滤播放列表
                      const filteredPlaylist = playlistSearchQuery.trim()
                        ? playlist.filter((song) => {
                            const query = playlistSearchQuery.toLowerCase();
                            return song.name.toLowerCase().includes(query) || 
                                   song.artist.toLowerCase().includes(query);
                          })
                        : playlist;
                      
                      return (
                        <div className="music-view music-view-playlist">
                          <div className="music-playlist-header">
                            <button
                              onClick={() => {
                                setMusicPlayerView('info');
                                setPlaylistSearchQuery('');
                              }}
                              className="music-back-btn"
                              aria-label="返回"
                            >
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </button>
                            <div className="music-playlist-title">
                              播放列表 ({filteredPlaylist.length}/{playlist.length}首)
                            </div>
                            
                            {/* 搜索框 - 紧凑版 */}
                            <div className="music-playlist-search-compact">
                              <svg className="music-search-icon" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                              </svg>
                              <input
                                type="text"
                                placeholder="搜索..."
                                value={playlistSearchQuery}
                                onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                                className="music-search-input"
                              />
                              {playlistSearchQuery && (
                                <button
                                  onClick={() => setPlaylistSearchQuery('')}
                                  className="music-search-clear"
                                  aria-label="清除搜索"
                                >
                                  <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="music-playlist-scroll" ref={playlistScrollRef}>
                            {filteredPlaylist.length > 0 ? (
                              filteredPlaylist.map((song, filteredIndex) => {
                                // 获取原始索引
                                const originalIndex = playlist.findIndex(s => s.id === song.id);
                                return (
                                  <div
                                    key={song.id}
                                    onClick={() => {
                                      selectSong(song, originalIndex);
                                      setMusicPlayerView('info');
                                      setPlaylistSearchQuery('');
                                    }}
                                    className={`music-playlist-item ${currentSongIndex === originalIndex ? 'active' : ''}`}
                                  >
                                    <span className="music-playlist-index">{originalIndex + 1}</span>
                                    <div className="music-playlist-info">
                                      <div className="music-playlist-name">{song.name}</div>
                                      <div className="music-playlist-artist">{song.artist}</div>
                                    </div>
                                    {currentSongIndex === originalIndex && (
                                      <span className="music-playlist-playing">
                                        {isPlaying ? '▶' : '⏸'}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="music-no-results">
                                <div className="music-no-results-icon">🔍</div>
                                <div className="music-no-results-text">未找到匹配的歌曲</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

              {/* 控制项网格 - 一行两个 */}
                <div className="control-items-grid">
                  {/* 主题切换 */}
                  <div className="control-item control-item-compact">
                    <div className="control-item-info">
                      <div className="control-item-icon">
                        {isDark ? '🌙' : '☀️'}
                      </div>
                      <div>
                        <h4 className="control-item-title">外观</h4>
                        <p className="control-item-desc">{isDark ? '深色' : '浅色'}</p>
                      </div>
                    </div>
                    <button
                      onClick={toggleTheme}
                      className={`control-toggle ${isDark ? 'active' : ''}`}
                      aria-label="切换主题"
                    >
                      <span className="control-toggle-slider"></span>
                    </button>
                  </div>

                  {/* 壁纸切换 - 仅在非单一图片链接时显示 */}
                  {/* Debug: canRefreshWallpaper = {String(canRefreshWallpaper)} */}
                  {canRefreshWallpaper && (
                    <div className="control-item control-item-compact">
                      <div className="control-item-info">
                        <div className="control-item-icon">
                          🖼️
                        </div>
                        <div>
                          <h4 className="control-item-title">壁纸</h4>
                          <p className="control-item-desc">随机</p>
                        </div>
                      </div>
                      <button
                        onClick={refreshWallpaper}
                        className="control-action-btn"
                        aria-label="刷新壁纸"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      </div>

      {/* 用户信息/登录弹窗 */}
      {showUserModal && (
        <>
          <div className={`user-modal-overlay ${isUserModalClosing ? 'closing' : ''}`} onClick={handleUserModalClose} />
          {isAuthenticated && user && userInfo ? (
            /* 已登录 - 显示用户详细信息（带框架） */
            <div className={`user-modal ${isUserModalClosing ? 'closing' : ''}`}>
              <div className="user-modal-header">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">用户信息</h3>
                <button
                  onClick={handleUserModalClose}
                  className="control-close-btn"
                  aria-label="关闭"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="user-modal-content">
                <div className="user-profile-section max-w-md mx-auto">
                  <div className="user-profile-header">
                    <img
                      src={userInfo.avatar}
                      alt={userInfo.name}
                      className="user-profile-avatar"
                      onError={(e) => {
                        e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}`;
                      }}
                    />
                    <div className="user-profile-info">
                      <h4 className="user-profile-name">{userInfo.name}</h4>
                      <p className="user-profile-platform">来自 {userInfo.platform}</p>
                    </div>
                  </div>

                  <div className="user-profile-bio">
                    <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">个人简介</h5>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{userInfo.bio}</p>
                  </div>

                  <div className="user-profile-meta">
                    <div className="user-meta-item">
                      <span className="user-meta-label">账户</span>
                      <span className="user-meta-value">{user.username}</span>
                    </div>
                    <div className="user-meta-item">
                      <span className="user-meta-label">角色</span>
                      <span className="user-meta-value">
                        {user.is_admin ? '👑 管理员' : '👤 普通用户'}
                      </span>
                    </div>
                    <div className="user-meta-item">
                      <span className="user-meta-label">认证方式</span>
                      <span className="user-meta-value">{user.auth_provider}</span>
                    </div>
                    {user.linked_github_id && (
                      <div className="user-meta-item">
                        <span className="user-meta-label">GitHub</span>
                        <span className="user-meta-value text-green-600 dark:text-green-400">✓ 已绑定</span>
                      </div>
                    )}
                  </div>

                  {/* 绑定 GitHub 按钮 */}
                  {user.auth_provider === 'local' && !user.linked_github_id && (
                    <a
                      href={`${API_URL}/api/auth/github/link`}
                      className="user-action-btn user-action-github"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd"/>
                      </svg>
                      绑定 GitHub 账户
                    </a>
                  )}

                  {/* 修改密码按钮（仅本地账户且未绑定GitHub） */}
                  {user.auth_provider === 'local' && !user.linked_github_id && (
                    <>
                      {!showChangePassword ? (
                        <button
                          onClick={() => setShowChangePassword(true)}
                          className="user-action-btn user-action-secondary"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          修改密码
                        </button>
                      ) : (
                        <div className="change-password-form">
                          <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">修改密码</h5>
                          <form onSubmit={handleChangePassword} className="space-y-3">
                            <div>
                              <label htmlFor="old-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                当前密码
                              </label>
                              <input
                                type="password"
                                id="old-password"
                                name="old-password"
                                required
                                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="请输入当前密码"
                              />
                            </div>
                            <div>
                              <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                新密码
                              </label>
                              <input
                                type="password"
                                id="new-password"
                                name="new-password"
                                required
                                minLength={8}
                                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="至少 8 个字符"
                              />
                            </div>
                            <div>
                              <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                确认新密码
                              </label>
                              <input
                                type="password"
                                id="confirm-password"
                                name="confirm-password"
                                required
                                minLength={8}
                                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="再次输入新密码"
                              />
                            </div>
                            {passwordError && (
                              <div className="text-red-500 dark:text-red-400 text-xs">
                                {passwordError}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={passwordSubmitting}
                                className="flex-1 px-3 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-all disabled:opacity-50"
                              >
                                {passwordSubmitting ? '修改中...' : '确认修改'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowChangePassword(false);
                                  setPasswordError('');
                                }}
                                className="px-3 py-2 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-all"
                              >
                                取消
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </>
                  )}

                  <button
                    onClick={handleLogout}
                    className="user-logout-btn"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    退出登录
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 未登录 - 直接使用 LoginForm，无额外框架 */
            <div className={`user-modal-login-only ${isUserModalClosing ? 'closing' : ''}`}>
              <button
                onClick={handleUserModalClose}
                className="login-close-btn"
                aria-label="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <LoginForm />
            </div>
          )}
        </>
      )}

      {/* 遮罩层 - 始终存在，通过 CSS 控制显示 */}
      <div
        className={`control-panel-overlay ${showOverlay ? 'visible' : ''}`}
        onClick={handleClosePanel}
      />
    </React.Fragment>
  );
};

export default GlobalControlPanel;
