/**
 * React 版主布局组件
 * 包含导航栏、背景、全局控制面板
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { extractColorsFromImage, applyColorPalette } from '../utils/colorExtractor';
import GlobalControlPanel from '../components/GlobalControlPanel';
import { useNotification } from '../contexts/NotificationContext';

interface AppLayoutProps {
  children: React.ReactNode;
}

interface ProgressData {
  progress: string;
  progressPercent: number;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAvatar, setUserAvatar] = useState('');
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const { notifications } = useNotification();

  // 导航岛状态管理
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
  const [showLibraryFilters, setShowLibraryFilters] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const navContentRef = useRef<HTMLDivElement>(null);
  const lastModeRef = useRef<'library' | 'normal'>('normal');

  // 处理资料库筛选变化
  const handleLibraryFilterChange = useCallback((newFilter: 'all' | 'game' | 'video' | 'music') => {
    setLibraryFilter(newFilter);
    // 触发自定义事件通知 Library 组件
    window.dispatchEvent(new CustomEvent('library-filter-change', {
      detail: { filter: newFilter }
    }));
  }, []);

  // JavaScript 动画控制 - 只在模式切换时触发
  useEffect(() => {
    const content = navContentRef.current;
    if (!content || isAnimating) return;

    const currentMode = (location.pathname === '/library' && showLibraryFilters) ? 'library' : 'normal';
    
    // 如果模式没有变化，不执行动画
    if (lastModeRef.current === currentMode) return;
    
    lastModeRef.current = currentMode;

    const children = Array.from(content.children) as HTMLElement[];
    
    // 重置所有动画
    children.forEach(child => {
      child.style.opacity = '0';
      child.style.transform = 'translateY(10px)';
      child.style.transition = 'none';
    });

    // 强制重排
    void content.offsetHeight;

    // 依次显示元素
    children.forEach((child, index) => {
      setTimeout(() => {
        child.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        child.style.opacity = '1';
        child.style.transform = 'translateY(0)';
      }, index * 50);
    });
  }, [showLibraryFilters, location.pathname, isAnimating]);

  // 处理从筛选模式退出到正常模式
  const handleExitToNormal = useCallback(() => {
    const content = navContentRef.current;
    if (!content || isAnimating) return;

    setIsAnimating(true);
    const children = Array.from(content.children) as HTMLElement[];
    
    // 反向淡出动画
    children.reverse().forEach((child, index) => {
      setTimeout(() => {
        child.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        child.style.opacity = '0';
        child.style.transform = 'translateY(-10px)';
      }, index * 30);
    });

    // 等待动画完成后切换状态
    setTimeout(() => {
      setShowLibraryFilters(false);
      setIsAnimating(false);
    }, children.length * 30 + 200);
  }, [isAnimating]);

  // 处理从正常模式进入筛选模式（点击筛选指示器）
  const handleEnterFilters = useCallback(() => {
    if (isAnimating) return;

    const content = navContentRef.current;
    if (!content) {
      setShowLibraryFilters(true);
      return;
    }

    setIsAnimating(true);
    
    // 找到当前筛选指示器按钮（最后一个分组）
    const children = Array.from(content.children) as HTMLElement[];
    const filterIndicator = children[children.length - 1];
    
    if (filterIndicator) {
      // 让筛选指示器淡出
      filterIndicator.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      filterIndicator.style.opacity = '0';
      filterIndicator.style.transform = 'scale(0.8)';
    }

    // 等待淡出完成后切换到筛选模式
    setTimeout(() => {
      setShowLibraryFilters(true);
      setIsAnimating(false);
    }, 200);
  }, [isAnimating]);

  // 监听路径变化，处理筛选指示器的退出动画
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;
    
    // 只在从资料库页面离开时触发退出动画
    if (prevPath === '/library' && currentPath !== '/library' && !showLibraryFilters) {
      const content = navContentRef.current;
      if (!content) return;

      const children = Array.from(content.children) as HTMLElement[];
      
      // 查找带有 data-group="current-filter" 的元素
      const filterIndicator = Array.from(children).find(
        child => child.getAttribute('data-group') === 'current-filter'
      ) as HTMLElement;
      
      // 查找分隔符
      const divider = Array.from(children).find(
        child => child.getAttribute('data-group') === 'divider'
      ) as HTMLElement;
      
      // 让分隔符和筛选指示器淡出
      [divider, filterIndicator].filter(Boolean).forEach((element, index) => {
        if (element) {
          setTimeout(() => {
            element.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            element.style.opacity = '0';
            element.style.transform = 'translateY(-8px)';
          }, index * 50);
        }
      });
    }
    
    prevPathRef.current = currentPath;
  }, [location.pathname, showLibraryFilters]);

  // 检查认证状态
  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    setIsAuthenticated(!!token);

    if (token) {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const user = await response.json();
          setIsAdmin(user.is_admin || false);
          
          // 获取头像
          try {
            const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              if (profileData.success && profileData.user_info?.avatar) {
                setUserAvatar(profileData.user_info.avatar);
              } else {
                setUserAvatar(`https://ui-avatars.com/api/?name=${user.username}`);
              }
            }
          } catch {
            setUserAvatar(`https://ui-avatars.com/api/?name=${user.username}`);
          }
        }
      } catch {
        setIsAuthenticated(false);
      }
    }
  }, []);

  // 加载壁纸和颜色
  const loadWallpaper = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/config`);
      const data = await response.json();
      const wallpaperEl = document.getElementById('wallpaper');
      
      if (wallpaperEl && data.ui_config?.wallpaper_url) {
        const apiUrl = data.ui_config.wallpaper_url;
        const blur = data.ui_config.wallpaper_blur || 3;
        
        // 获取实际图片 URL
        const actualResponse = await fetch(apiUrl, { method: 'HEAD' });
        const actualImageUrl = actualResponse.url;
        
        wallpaperEl.style.backgroundImage = `url(${actualImageUrl})`;
        wallpaperEl.style.filter = `blur(${blur}px)`;
        
        // 提取并应用颜色
        const colors = await extractColorsFromImage(actualImageUrl);
        applyColorPalette(colors);
      }
    } catch {
      // 使用默认配色
    }
  }, []);

  // 设置当前导航项
  const setActiveNav = useCallback(() => {
    const navItems = document.querySelectorAll('.nav-item:not(.generate-btn)');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if (href === location.pathname || (location.pathname === '/' && href === '/')) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }, [location]);

  // 处理生成报告
  const handleGenerateReport = useCallback(() => {
    if (location.pathname !== '/') {
      navigate('/');
    }

    // 添加loading类到生成按钮
    const generateBtn = document.getElementById('generate-report-btn');
    if (generateBtn) {
      generateBtn.classList.add('loading');
    }

    setTimeout(() => {
      if (typeof (window as any).generateReport === 'function') {
        (window as any).generateReport();
      }
    }, 100);
  }, [location, navigate]);

  // 检查后端连接状态
  useEffect(() => {
    let isMounted = true;

    const checkBackend = async () => {
      try {
        const response = await fetch(`${API_URL}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000), // 5秒超时
        });
        if (isMounted) {
          setBackendConnected(response.ok);
          if (response.ok) {
            setHasEverConnected(true);
          }
        }
      } catch (error) {
        // 只在组件仍挂载时更新状态
        if (isMounted) {
          setBackendConnected(false);
        }
      }
    };

    // 延迟1秒后首次检查，避免初始加载时的误报
    const initialTimer = setTimeout(() => {
      checkBackend();
    }, 1000);

    // 每30秒检查一次
    const interval = setInterval(checkBackend, 30000);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  // 初始化
  useEffect(() => {
    checkAuth();
    loadWallpaper();
  }, [checkAuth, loadWallpaper]);

  // 路由变化时更新导航状态
  useEffect(() => {
    setActiveNav();
    // 进入资料库页面时显示筛选模式
    if (location.pathname === '/library') {
      setShowLibraryFilters(true);
    }
  }, [location.pathname, setActiveNav]);

  // 监听认证状态变化
  useEffect(() => {
    const handleAuthChange = (e: CustomEvent) => {
      setIsAuthenticated(e.detail?.isAuthenticated ?? false);
      if (e.detail?.isAuthenticated) {
        checkAuth();
      }
    };

    window.addEventListener('auth-state-changed', handleAuthChange as EventListener);
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthChange as EventListener);
    };
  }, [checkAuth]);

  // 监听进度事件
  useEffect(() => {
    const handleProgress = (e: Event) => {
      const customEvent = e as CustomEvent;
      setProgressData(customEvent.detail);
    };

    const handleProgressEnd = () => {
      setProgressData(null);
    };

    window.addEventListener('report-progress', handleProgress);
    window.addEventListener('report-progress-end', handleProgressEnd);

    return () => {
      window.removeEventListener('report-progress', handleProgress);
      window.removeEventListener('report-progress-end', handleProgressEnd);
    };
  }, []);

  // 动态定位进度提示到生成按钮旁边
  useEffect(() => {
    if (!progressData) return;

    const updateProgressPosition = () => {
      const progressTip = document.getElementById('progress-tip');
      const generateBtn = document.getElementById('generate-report-btn');

      if (!progressTip || !generateBtn) return;

      const btnRect = generateBtn.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;

      if (isMobile) {
        // 移动端：在生成按钮上方，距离稍远
        progressTip.style.bottom = `${window.innerHeight - btnRect.top + 24}px`;
        progressTip.style.left = '50%';
        progressTip.style.top = 'auto';
        progressTip.style.right = 'auto';
        progressTip.style.transform = 'translateX(-50%)';
      } else {
        // 桌面端：在生成按钮右侧，距离稍远，稍微偏下
        progressTip.style.left = `${btnRect.right + 24}px`;
        progressTip.style.top = `${btnRect.top + btnRect.height / 2 + 8}px`;
        progressTip.style.bottom = 'auto';
        progressTip.style.right = 'auto';
        progressTip.style.transform = 'translateY(-50%)';
      }
    };

    // 初始定位
    const timer = setTimeout(updateProgressPosition, 50);

    // 监听窗口变化
    window.addEventListener('resize', updateProgressPosition);
    window.addEventListener('scroll', updateProgressPosition);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateProgressPosition);
      window.removeEventListener('scroll', updateProgressPosition);
    };
  }, [progressData]);

  // 导航岛自动隐藏逻辑
  useEffect(() => {
    const navContainer = document.querySelector('.nav-container') as HTMLElement;
    if (!navContainer) return;

    let lastScrollY = window.scrollY;
    let ticking = false;
    let hideTimeout: NodeJS.Timeout;

    const updateNavVisibility = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY;
      const scrollDistance = Math.abs(currentScrollY - lastScrollY);

      // 滚动距离超过50px时才触发隐藏
      if (scrollingDown && scrollDistance > 50 && currentScrollY > 100) {
        navContainer.style.opacity = '0';
        navContainer.style.transform = window.innerWidth >= 768
          ? 'translateY(-50%) translateX(-20px)'
          : 'translateX(-50%) translateY(20px)';
        navContainer.style.pointerEvents = 'none';
      } else if (!scrollingDown || currentScrollY < 100) {
        navContainer.style.opacity = '1';
        navContainer.style.transform = window.innerWidth >= 768
          ? 'translateY(-50%) translateX(0)'
          : 'translateX(-50%) translateY(0)';
        navContainer.style.pointerEvents = 'auto';
      }

      lastScrollY = currentScrollY;
      ticking = false;
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateNavVisibility);
        ticking = true;
      }

      // 停止滚动3秒后自动显示
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        navContainer.style.opacity = '1';
        navContainer.style.transform = window.innerWidth >= 768
          ? 'translateY(-50%) translateX(0)'
          : 'translateX(-50%) translateY(0)';
        navContainer.style.pointerEvents = 'auto';
      }, 3000);
    };

    // 鼠标移动到屏幕边缘时显示
    const handleMouseMove = (e: MouseEvent) => {
      const isNearEdge = window.innerWidth >= 768
        ? e.clientX < 100  // 桌面端：靠近左边缘
        : e.clientY > window.innerHeight - 100; // 移动端：靠近底部

      if (isNearEdge) {
        navContainer.style.opacity = '1';
        navContainer.style.transform = window.innerWidth >= 768
          ? 'translateY(-50%) translateX(0)'
          : 'translateX(-50%) translateY(0)';
        navContainer.style.pointerEvents = 'auto';
      }
    };

    // 添加过渡效果
    navContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(hideTimeout);
    };
  }, []);

  return (
    <>
      {/* 全局控制面板 */}
      <div id="global-control-panel-root">
        <GlobalControlPanel />
      </div>

      {/* 背景 */}
      <div id="bg-container" className="fixed inset-0 -z-10 overflow-hidden">
        <div id="wallpaper" className="absolute inset-0 bg-cover bg-center bg-no-repeat"></div>
        <div id="bg-gradient" className="absolute inset-0 bg-gradient-to-b from-transparent from-[45%] via-white/60 via-[50%] to-white/95"></div>
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[45%] left-10 w-96 h-96 bg-green-400/40 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
          <div className="absolute top-[45%] right-10 w-96 h-96 bg-pink-400/40 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
        </div>
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.02]"></div>
      </div>

      {/* 进度提示 - 动态定位到生成按钮旁边 */}
      {progressData && (
        <div
          id="progress-tip"
          className="fixed z-[60] glass rounded-2xl p-4 shadow-2xl border animate-fade-in w-72 max-w-[calc(100vw-2rem)] pointer-events-none"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">生成报告中</p>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{progressData.progress}</p>
          <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full progress-bar-fill"
              style={{ width: `${progressData.progressPercent}%` }}
            ></div>
          </div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-2">{progressData.progressPercent}%</p>
        </div>
      )}

      {/* 导航栏 */}
      <nav className="nav-container" aria-label="主导航">
        <div className="dynamic-island shadow-2xl" role="navigation">
          <div className="flex flex-row md:flex-col items-center gap-1 relative">
            {location.pathname === '/library' && showLibraryFilters ? (
              /* 资料库模式 - 显示返回按钮 + 分隔符 + 资料库筛选标签 */
              <div ref={navContentRef} className="nav-island-content flex flex-row md:flex-col items-center gap-1" key="library-mode">
                {/* 返回按钮 */}
                <div className="nav-group" data-group="back">
                  <button 
                    onClick={handleExitToNormal}
                    className="nav-item"
                    title="返回"
                    aria-label="返回导航"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                </div>

                {/* 分隔符 */}
                <div className="nav-group nav-group-spaced" data-group="divider">
                  <div className="w-px h-6 bg-gray-300/50 dark:bg-gray-600/50 md:w-6 md:h-px md:my-0"></div>
                </div>

                {/* 资料库筛选标签 */}
                <div className="nav-group nav-group-spaced" data-group="all">
                  <button 
                    onClick={() => handleLibraryFilterChange('all')}
                    className={`nav-item ${libraryFilter === 'all' ? 'active-secondary' : ''}`}
                    title="全部"
                    aria-label="显示全部内容"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </button>
                </div>
                <div className="nav-group nav-group-spaced" data-group="game">
                  <button 
                    onClick={() => handleLibraryFilterChange('game')}
                    className={`nav-item ${libraryFilter === 'game' ? 'active-secondary' : ''}`}
                    title="游戏"
                    aria-label="显示游戏"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                    </svg>
                  </button>
                </div>
                <div className="nav-group nav-group-spaced" data-group="video">
                  <button 
                    onClick={() => handleLibraryFilterChange('video')}
                    className={`nav-item ${libraryFilter === 'video' ? 'active-secondary' : ''}`}
                    title="视频"
                    aria-label="显示视频"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                    </svg>
                  </button>
                </div>
                <div className="nav-group nav-group-spaced" data-group="music">
                  <button 
                    onClick={() => handleLibraryFilterChange('music')}
                    className={`nav-item ${libraryFilter === 'music' ? 'active-secondary' : ''}`}
                    title="音乐"
                    aria-label="显示音乐"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              /* 正常模式 - 显示所有主导航按钮 + 分隔符 + 当前选中的资料库标签 */
              <div ref={navContentRef} className="nav-island-content flex flex-row md:flex-col items-center gap-1" key="normal-mode">
                {/* 主页按钮 */}
                <div className="nav-group" data-group="main">
                  <a href="/" className="nav-item" title="主页" aria-label="返回主页" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
                    </svg>
                  </a>
                </div>

                {/* 资料库按钮 */}
                <div className="nav-group nav-group-spaced" data-group="library">
                  <button 
                    className="nav-item" 
                    title="资料库" 
                    aria-label="资料库" 
                    onClick={() => {
                      if (location.pathname === '/library') {
                        setShowLibraryFilters(true);
                      } else {
                        navigate('/library');
                        // 导航后显示筛选模式
                        setTimeout(() => setShowLibraryFilters(true), 100);
                      }
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                    </svg>
                  </button>
                </div>

                {/* 配置按钮（管理员） */}
                {isAdmin && (
                  <div className="nav-group nav-group-spaced" data-group="config">
                    <a href="/config" id="config-nav-btn" className="nav-item" title="配置" aria-label="系统配置" onClick={(e) => { e.preventDefault(); navigate('/config'); }}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      </svg>
                    </a>
                  </div>
                )}

                {/* 报告功能组（管理员） */}
                {isAdmin && (
                  <div className="nav-group nav-group-spaced" data-group="report">
                    <button id="generate-report-btn" className="nav-item generate-btn" title="生成报告" aria-label="生成数据报告" onClick={handleGenerateReport}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                      </svg>
                    </button>
                  </div>
                )}

                {/* 分隔符 - 仅在资料库页面且未显示筛选时显示 */}
                {location.pathname === '/library' && !showLibraryFilters && (
                  <div className="nav-group nav-group-spaced" data-group="divider">
                    <div className="w-px h-6 bg-gray-300/50 dark:bg-gray-600/50 md:w-6 md:h-px md:my-0"></div>
                  </div>
                )}

                {/* 当前资料库选中标签显示 - 仅在资料库页面且未显示筛选时显示 */}
                {location.pathname === '/library' && !showLibraryFilters && (
                  <div className="nav-group" data-group="current-filter">
                    {libraryFilter === 'all' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：全部 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                      </button>
                    )}
                    {libraryFilter === 'game' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：游戏 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                        </svg>
                      </button>
                    )}
                    {libraryFilter === 'video' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：视频 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                        </svg>
                      </button>
                    )}
                    {libraryFilter === 'music' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：音乐 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/*
        屏幕角落提示容器 - 统一管理所有固定提示，确保不重叠

        使用说明：
        1. 所有需要显示在屏幕角落的提示都应该添加到这个容器内
        2. 容器使用 flex-col gap-3 自动堆叠提示
        3. 父容器 pointer-events-none，子元素需要 pointer-events-auto
        4. 响应式定位已配置好，自动避开导航岛
      */}
      <div className="fixed z-[100] pointer-events-none
        bottom-6 left-6
        md:bottom-6 md:left-[7.5rem]
        flex flex-col gap-3 max-w-xs">

        {/* 后端未连接提示 - 只在曾经连接过但现在断开时显示 */}
        {backendConnected === false && hasEverConnected && (
          <div className="pointer-events-auto animate-fade-in">
            <div className="glass rounded-xl px-4 py-3 shadow-lg border border-red-200/50 dark:border-red-800/50 bg-red-50/80 dark:bg-red-950/80 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                </div>
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-100">后端服务连接中断</p>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">正在尝试重新连接...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 全局通知 - 从 NotificationContext 渲染 */}
        {notifications.map(notification => (
          <div key={notification.id} className="pointer-events-auto animate-fade-in">
            <div className={`glass rounded-xl px-4 py-3 shadow-lg border backdrop-blur-md ${
              notification.type === 'loading' ? 'border-gray-200/50 dark:border-gray-700/50' :
              notification.type === 'error' ? 'border-red-200/50 dark:border-red-800/50 bg-red-50/80 dark:bg-red-950/80' :
              'border-blue-200/50 dark:border-blue-800/50 bg-blue-50/80 dark:bg-blue-950/80'
            }`}>
              <div className="flex items-center gap-3">
                {notification.type === 'loading' && (
                  <div className="w-4 h-4 rounded-full bg-gradient-radial from-indigo-400/30 to-transparent animate-pulse"></div>
                )}
                {notification.type === 'error' && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  </div>
                )}
                {notification.type === 'info' && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  </div>
                )}
                <span className={`text-sm font-medium ${
                  notification.type === 'error' ? 'text-red-900 dark:text-red-100' :
                  notification.type === 'info' ? 'text-blue-900 dark:text-blue-100' :
                  'text-gray-700 dark:text-gray-200'
                }`}>
                  {notification.message}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 主内容区域 */}
      <main className="relative z-10">
        {children}
      </main>
    </>
  );
}

export default AppLayout;
