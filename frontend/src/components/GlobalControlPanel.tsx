import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
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
} from '../utils/dynamicContent';
import { clearPlaylistCache } from '../utils/musicPlayer';
import { useWallpaper } from '../hooks/useWallpaper';
import { loadResource } from '../utils/resourceLoader';
import { ControlPanelWidgets } from './ControlPanel/ControlPanelWidgets';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { MusicPlayer } from './ControlPanel/MusicPlayer';
import { usePerformanceProfile } from '../hooks/usePerformanceProfile';
import { useAnimationLevel } from '../hooks/useAnimationLevel';

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

  useEffect(() => {
    // 检查当前主题
    setIsDark(document.documentElement.classList.contains('dark'));

    // 检查登录状态
    checkAuth();

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

    // 1. 问候语（始终显示，立即加载）
    const greeting = getGreeting(user?.username);
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
            
            // 在问候语后插入天气信息
            const newContents = [...prev];
            newContents.splice(1, 0, {
              type: 'weather',
              icon: weather.icon,
              text: `${weather.temperature} ${weather.weather}`,
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
        const quote = await getRandomQuote();
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
      '主题切换',
      '壁纸切换',
      '外观设置'
    ];
    const randomText = themeTexts[Math.floor(Math.random() * themeTexts.length)];
    
    setDynamicContents(prev => [...prev, {
      type: 'theme',
      icon: '⚙️',
      text: randomText,
      subtext: '点击展开设置'
    }]);
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

  // 监听登录成功事件 - 使用 ref 避免频繁重建监听器
  const checkAuthRef = useRef(checkAuth);
  checkAuthRef.current = checkAuth;
  
  useEffect(() => {
    const handleLoginSuccess = () => {
      handleUserModalClose();
      checkAuthRef.current();
    };

    window.addEventListener('auth-login-success', handleLoginSuccess);
    return () => {
      window.removeEventListener('auth-login-success', handleLoginSuccess);
    };
  }, []); // 只在挂载时设置一次

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

  // 初始化时加载音乐配置和GitHub OAuth检查（只在挂载时运行一次）
  useEffect(() => {
    musicPlayer.loadMusicConfig();
    checkGithubOAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在组件挂载时运行一次

  // 动态内容轮播（带淡入淡出效果）
  useEffect(() => {
    // 在以下情况禁用轮播：展开面板 / 悬停 / 动态内容为空 / 低性能设备 / 页面隐藏
    if (dynamicContents.length === 0 || isExpanded || isHovering || document.hidden) return;

    let frameId: number | null = null;
    let timerId: number | null = null;
    let cancelled = false;

    const cycle = () => {
      if (cancelled) return;
      setIsTransitioning(true);
      timerId = window.setTimeout(() => {
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
    frameId = window.requestAnimationFrame(() => {
      timerId = window.setTimeout(cycle, startDelay);
    });

    const handleVisibility = () => {
      if (document.hidden) {
        if (timerId) clearTimeout(timerId);
        if (frameId) cancelAnimationFrame(frameId);
      } else {
        // 页面重新可见时重新启动
        cancelled = true; // 取消旧逻辑
        // 重新触发 effect
        setTimeout(() => setIsTransitioning(false), 0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (frameId) cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dynamicContents.length, isExpanded, isHovering, anim.durationScale]);

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

  // 动态计算展开面板的高度 - 使用克隆测量方案（性能优化版）
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
    let lastUpdateTime = 0;
    // 低性能设备放宽节流间隔
    const THROTTLE_MS = anim.level === 'standard' ? 180 : 360;

    const measure = () => {
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) return;
      lastUpdateTime = now;
      
      // 计算目标宽度用于测量（避免动画过程中的宽度变化导致高度计算错误）
      const isMobile = window.innerWidth <= 640;
      // Desktop: 400px - padding(1.375rem * 2 = 44px) = 356px
      // Mobile: (100vw - 1.5rem) - padding(1rem * 2 = 32px) = 100vw - 56px
      const targetWidth = isMobile 
        ? window.innerWidth - 56 
        : 356;

      // 通过克隆节点精确测量高度
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
      
      if (Math.abs(compensated - lastHeight) > 4) {
        lastHeight = compensated;
        triggerEl.style.height = compensated + 'px';
      }
    };

    // 立即测量，确保动画起始帧即为正确高度
    measure();

    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(contentEl);
    
    const mutationObserver = new MutationObserver(() => measure());
    mutationObserver.observe(contentEl, { childList: true, subtree: true, characterData: true });

    // 可见性变化时重新测量
    const handleVisibility = () => { if (!document.hidden) setTimeout(measure, 100); };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isExpanded, isAuthenticated, perf.lowEndDevice, anim.level]);

  // 统一暂停定时器策略：页面不可见时发事件给子组件停止动画（可选扩展）
  useEffect(() => {
    const handler = () => {
      const hidden = document.hidden;
      window.dispatchEvent(new CustomEvent('app-visibility-changed', { detail: { hidden } }));
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

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
    
    // 清空音乐播放器缓存
    clearPlaylistCache();
    
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
                        <div className="control-item-icon icon-wallpaper">
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

                  {/* 系统配置 - 仅管理员可见 */}
                  {user?.is_admin && (
                    <div className="control-item control-item-compact">
                      <div className="control-item-info">
                        <div className="control-item-icon icon-config">
                          ⚙️
                        </div>
                        <div>
                          <h4 className="control-item-title">配置</h4>
                          <p className="control-item-desc">系统</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          handleClosePanel();
                          navigate('/config');
                        }}
                        className="control-action-btn"
                        aria-label="系统配置"
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
