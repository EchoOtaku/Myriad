/**
 * React 版主布局组件
 * 包含导航栏、背景、全局控制面板
 */

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { extractColorsFromImage, applyColorPalette } from '../utils/colorExtractor';
import { useWallpaper } from '../hooks/useWallpaper';
import GlobalControlPanel from '../components/GlobalControlPanel';
import { useNotification } from '../contexts/NotificationContext';
import {
  shouldApplyColorExtraction,
  getColorFromCache,
  saveColorToCache,
} from '../utils/wallpaperColorCache';
import './AppLayout.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

interface ProgressData {
  progress: string;
  progressPercent: number;
}

type NavMode = 'library' | 'normal';
type RouteContext = 'library' | 'global';
interface ModeMetrics {
  height?: number;
  width?: number;
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

  // 壁纸管理 Hook
  const { loadWallpaper: loadWallpaperFromHook } = useWallpaper();

  // 导航岛状态管理
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
  const [showLibraryFilters, setShowLibraryFilters] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const navContentRef = useRef<HTMLDivElement>(null);
  const lastModeRef = useRef<NavMode>('normal');
  // 渲染锁定：在动画期间保持当前渲染模式不变
  const renderModeRef = useRef<NavMode>('normal');
  const islandMetricsRef = useRef<Record<string, ModeMetrics>>({});

  const getVariant = () => (window.innerWidth >= 768 ? 'desktop' : 'mobile');
  const resolveRouteContext = (mode: NavMode, explicit?: RouteContext): RouteContext => {
    if (explicit) return explicit;
    if (mode === 'library') return 'library';
    return location.pathname === '/library' ? 'library' : 'global';
  };
  const buildMetricsKey = (mode: NavMode, variant: 'desktop' | 'mobile', routeContext: RouteContext) => `${mode}-${variant}-${routeContext}`;

  const updateModeMetrics = (mode: NavMode, metrics: ModeMetrics, explicitContext?: RouteContext) => {
    const variant = getVariant();
    const routeContext = resolveRouteContext(mode, explicitContext);
    const key = buildMetricsKey(mode, variant, routeContext);
    islandMetricsRef.current[key] = {
      ...islandMetricsRef.current[key],
      ...metrics,
    };
  };

  const createIconButtonPlaceholder = (extraClass?: string) => {
    const button = document.createElement('button');
    button.className = extraClass ? `nav-item ${extraClass}` : 'nav-item';
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('div');
    icon.style.width = '20px';
    icon.style.height = '20px';
    button.appendChild(icon);
    return button;
  };

  const appendIconGroup = (parent: HTMLDivElement, extraGroupClass?: string, extraButtonClass?: string) => {
    const group = document.createElement('div');
    group.className = extraGroupClass ? `nav-group ${extraGroupClass}` : 'nav-group';
    group.appendChild(createIconButtonPlaceholder(extraButtonClass));
    parent.appendChild(group);
  };

  const appendDividerGroup = (parent: HTMLDivElement) => {
    const group = document.createElement('div');
    group.className = 'nav-group nav-group-spaced';
    const divider = document.createElement('div');
    divider.style.width = '1px';
    divider.style.height = '24px';
    group.appendChild(divider);
    parent.appendChild(group);
  };

  const populateTempContent = (parent: HTMLDivElement, mode: NavMode, routeContext: RouteContext) => {
    if (mode === 'library') {
      appendIconGroup(parent);
      appendDividerGroup(parent);
      ['all', 'game', 'video', 'music'].forEach(() => appendIconGroup(parent, 'nav-group-spaced'));
      return;
    }

    appendIconGroup(parent);
    appendIconGroup(parent, 'nav-group-spaced');
    if (isAdmin) {
      appendIconGroup(parent, 'nav-group-spaced');
      appendIconGroup(parent, 'nav-group-spaced', 'generate-btn');
    }
    if (routeContext === 'library') {
      appendDividerGroup(parent);
      appendIconGroup(parent);
    }
  };

  const measureModeMetrics = (mode: NavMode, island: HTMLElement, explicitContext?: RouteContext): ModeMetrics | null => {
    const content = navContentRef.current;
    if (!content) return null;

    const tempContent = document.createElement('div');
    tempContent.className = content.className;
    tempContent.style.cssText = 'position: absolute; visibility: hidden; pointer-events: none;';
    tempContent.setAttribute('aria-hidden', 'true');
    const routeContext = resolveRouteContext(mode, explicitContext);
    populateTempContent(tempContent, mode, routeContext);
    const host = content.parentElement;
    if (!host) {
      tempContent.remove();
      return null;
    }
    host.appendChild(tempContent);

    const islandStyles = getComputedStyle(island);
    const paddingVertical = (parseFloat(islandStyles.paddingTop) || 0) + (parseFloat(islandStyles.paddingBottom) || 0);
    const paddingHorizontal = (parseFloat(islandStyles.paddingLeft) || 0) + (parseFloat(islandStyles.paddingRight) || 0);
    const metrics: ModeMetrics = {
      height: tempContent.scrollHeight + paddingVertical,
      width: tempContent.scrollWidth + paddingHorizontal,
    };
    tempContent.remove();
    updateModeMetrics(mode, metrics, routeContext);
    return metrics;
  };

  const ensureModeMetrics = (mode: NavMode, island: HTMLElement, explicitContext?: RouteContext): ModeMetrics | null => {
    const variant = getVariant();
    const routeContext = resolveRouteContext(mode, explicitContext);
    const key = buildMetricsKey(mode, variant, routeContext);
    const cached = islandMetricsRef.current[key];
    if (cached?.height && cached?.width) {
      return cached;
    }
    return measureModeMetrics(mode, island, routeContext);
  };

  const applyModeMetrics = (mode: NavMode, island: HTMLElement, explicitContext?: RouteContext) => {
    const metrics = ensureModeMetrics(mode, island, explicitContext);
    if (!metrics) return;
    if (window.innerWidth >= 768) {
      if (metrics.height) {
        island.style.height = `${metrics.height}px`;
      }
      island.style.removeProperty('width');
    } else {
      if (metrics.width) {
        island.style.width = `${metrics.width}px`;
      }
      island.style.removeProperty('height');
    }
  };

  // 处理资料库筛选变化
  const handleLibraryFilterChange = useCallback((newFilter: 'all' | 'game' | 'video' | 'music') => {
    setLibraryFilter(newFilter);
    // 触发自定义事件通知 Library 组件
    window.dispatchEvent(new CustomEvent('library-filter-change', {
      detail: { filter: newFilter }
    }));
  }, []);

  // Apple 风格动画控制 - 精致的进入动画
  useLayoutEffect(() => {
    // 布局阶段先写入进入状态，避免初次绘制闪烁
    const content = navContentRef.current;
    if (!content) return;
    
    // 如果正在动画中，等待下一次
    if (isAnimating) return;

    const currentMode: NavMode = (location.pathname === '/library' && showLibraryFilters) ? 'library' : 'normal';
    const routeContext = resolveRouteContext(currentMode);
    
    // 如果模式没有变化或渲染模式未同步，不执行动画
    if (lastModeRef.current === currentMode || renderModeRef.current !== currentMode) return;
    
    lastModeRef.current = currentMode;

    const groups = content.querySelectorAll('.nav-group');
    const island = content.closest('.dynamic-island') as HTMLElement;
    
    // 步骤 1: 清理所有旧的动画标记（不重置样式，避免闪烁）
    groups.forEach(group => {
      const el = group as HTMLElement;
      el.removeAttribute('data-animation');
    });
    
    // 步骤 2: 标记过渡状态
    if (island) {
      island.setAttribute('data-transitioning', 'true');
    }
    
    // 步骤 3: 设置进入初始状态
    groups.forEach(group => {
      (group as HTMLElement).setAttribute('data-animation', 'enter-initial');
    });

    if (island) {
      const islandStyles = getComputedStyle(island);
      const paddingVertical = (parseFloat(islandStyles.paddingTop) || 0) + (parseFloat(islandStyles.paddingBottom) || 0);
      const paddingHorizontal = (parseFloat(islandStyles.paddingLeft) || 0) + (parseFloat(islandStyles.paddingRight) || 0);
      const metrics: ModeMetrics = {
        height: content.scrollHeight + paddingVertical,
        width: content.scrollWidth + paddingHorizontal,
      };

      if (window.innerWidth >= 768) {
        if (metrics.height) {
          island.style.height = `${metrics.height}px`;
        }
        island.style.removeProperty('width');
      } else {
        if (metrics.width) {
          island.style.width = `${metrics.width}px`;
        }
        island.style.removeProperty('height');
      }

      updateModeMetrics(currentMode, metrics, routeContext);
    }

    // 强制重排，确保初始状态在绘制前稳定
    void content.offsetHeight;

    // 步骤 4: 进入动画 - 级联淡入
    const enterTimers: number[] = [];
    groups.forEach((group, index) => {
      const timer = window.setTimeout(() => {
        (group as HTMLElement).removeAttribute('data-animation');
      }, index * 40 + 50); // 40ms 间隔，50ms 初始延迟
      enterTimers.push(timer);
    });

    // 步骤 5: 清除过渡标记和最终清理
    const cleanupTimer = window.setTimeout(() => {
      if (island) {
        island.removeAttribute('data-transitioning');
      }
      // 最终确认所有元素都已显示
      groups.forEach(group => {
        const el = group as HTMLElement;
        el.removeAttribute('data-animation');
      });
    }, groups.length * 40 + 100);

    // 清理函数
    return () => {
      enterTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(cleanupTimer);
    };
  }, [showLibraryFilters, location.pathname, isAnimating]);

  useEffect(() => {
    const handleResize = () => {
      const content = navContentRef.current;
      const island = content?.closest('.dynamic-island') as HTMLElement | null;
      if (!island) return;
      applyModeMetrics(lastModeRef.current, island);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isAdmin, location.pathname]);

  // 处理从筛选模式退出到正常模式 - Apple 风格优雅退出
  const handleExitToNormal = useCallback(() => {
    const content = navContentRef.current;
    // 防抗：如果正在动画或已经不是筛选模式，不重复执行
    if (!content || isAnimating || !showLibraryFilters || renderModeRef.current === 'normal') return;

    setIsAnimating(true);
    // 锁定当前渲染模式，防止动画过程中切换
    renderModeRef.current = 'library';
    const groups = Array.from(content.querySelectorAll('.nav-group')); // 不再反向
    const island = content.closest('.dynamic-island') as HTMLElement;
    
    if (island) {
      applyModeMetrics('normal', island, 'library');
    }
    
    // 步骤 1: 退出动画 - 级联淡出（使用类名控制）
    const exitTimers: number[] = [];
    
    // 立即开始退出动画
    groups.forEach((group, index) => {
      const el = group as HTMLElement;
      // 先移除可能存在的进入状态
      el.removeAttribute('data-animation');
      // 延迟添加退出状态
      const timer = window.setTimeout(() => {
        el.setAttribute('data-animation', 'exit');
      }, index * 20); // 加快节奏
      exitTimers.push(timer);
    });

    // 步骤 2: 等待退出动画完成，清理并切换状态
    const exitDuration = groups.length * 20 + 280; // 匹配动画时序
    const switchTimer = window.setTimeout(() => {
      // 3.1: 清除所有退出标记
      groups.forEach(group => {
        (group as HTMLElement).removeAttribute('data-animation');
      });
      
      // 3.2: 解锁渲染模式并切换状态
      renderModeRef.current = 'normal';
      setShowLibraryFilters(false);
      
      // 3.3: 重置动画状态，触发进入动画
      setIsAnimating(false);
    }, exitDuration);

    // 清理函数
    return () => {
      exitTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(switchTimer);
    };
  }, [isAnimating, isAdmin, showLibraryFilters, location.pathname]);

  // 处理从正常模式进入筛选模式 - 与 handleExitToNormal 完全对称
  const handleEnterFilters = useCallback(() => {
    // 防抗：如果正在动画或已经是筛选模式，不重复执行
    if (isAnimating || showLibraryFilters || renderModeRef.current === 'library') return;

    const content = navContentRef.current;
    if (!content) {
      setShowLibraryFilters(true);
      return;
    }

    setIsAnimating(true);
    // 锁定当前渲染模式，防止动画过程中切换
    renderModeRef.current = 'normal';
    const groups = Array.from(content.querySelectorAll('.nav-group')); // 不反向，与退出一致
    const island = content.closest('.dynamic-island') as HTMLElement;
    
    if (island) {
      applyModeMetrics('library', island, 'library');
    }
    
    // 步骤 1: 退出动画 - 级联淡出（与 handleExitToNormal 完全一致）
    const exitTimers: number[] = [];
    
    // 立即开始退出动画
    groups.forEach((group, index) => {
      const el = group as HTMLElement;
      // 先移除可能存在的进入状态
      el.removeAttribute('data-animation');
      // 延迟添加退出状态
      const timer = window.setTimeout(() => {
        el.setAttribute('data-animation', 'exit');
      }, index * 20); // 与 handleExitToNormal 保持一致
      exitTimers.push(timer);
    });

    // 步骤 2: 等待退出动画完成，清理并切换状态
    const exitDuration = groups.length * 20 + 280; // 与 handleExitToNormal 保持一致
    const switchTimer = window.setTimeout(() => {
      // 3.1: 清除所有退出标记
      groups.forEach(group => {
        (group as HTMLElement).removeAttribute('data-animation');
      });
      
      // 3.2: 解锁渲染模式并切换状态
      renderModeRef.current = 'library';
      setShowLibraryFilters(true);
      
      // 3.3: 重置动画状态，触发进入动画
      setIsAnimating(false);
    }, exitDuration);

    // 清理函数
    return () => {
      exitTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(switchTimer);
    };
  }, [isAnimating, showLibraryFilters, location.pathname, isAdmin]);

  // 监听路径变化，处理筛选指示器的退出动画
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;
    
    // 只在从资料库页面离开时触发优雅的退出动画
    if (prevPath === '/library' && currentPath !== '/library' && !showLibraryFilters) {
      const content = navContentRef.current;
      const island = content?.closest('.dynamic-island') as HTMLElement;
      if (!content || !island) return;

      const groups = content.querySelectorAll('[data-group="current-filter"], [data-group="divider"]');
      
      // 级联淡出 - 与其他退出动画保持一致
      Array.from(groups).forEach((group, index) => {
        setTimeout(() => {
          (group as HTMLElement).setAttribute('data-animation', 'exit');
        }, index * 35);
      });

      // 同步调整导航岛尺寸，区分桌面/移动端
      setTimeout(() => {
        applyModeMetrics('normal', island, 'global');
      }, 30);
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

  // 加载壁纸和颜色（使用 Hook）
  const loadWallpaper = useCallback(async () => {
    const wallpaperResult = await loadWallpaperFromHook();
    if (wallpaperResult) {
      const { actualUrl } = wallpaperResult;

      // 先检查缓存
      const cachedColors = getColorFromCache(actualUrl);
      if (cachedColors) {
        applyColorPalette(cachedColors);
        return;
      }

      // 检查是否为有效壁纸
      const checkResult = await shouldApplyColorExtraction(actualUrl);
      if (!checkResult.shouldApply) {
        return;
      }

      // 提取颜色
      try {
        const colors = await extractColorsFromImage(actualUrl, { context: 'wallpaper' });
        applyColorPalette(colors);
        saveColorToCache(actualUrl, colors);
      } catch {
        // 提取失败，静默处理
      }
    }
  }, [loadWallpaperFromHook]);

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

  // 初始化导航岛高度 - 仅在组件首次挂载时执行
  useEffect(() => {
    const content = navContentRef.current;
    if (!content) return;

    const island = content.closest('.dynamic-island') as HTMLElement;
    if (!island) return;

    // 等待 DOM 渲染完成后计算初始高度（仅桌面端）
    const initTimer = setTimeout(() => {
      if (window.innerWidth >= 768) {
        const currentHeight = content.scrollHeight + parseFloat(getComputedStyle(island).paddingTop) * 2;
        island.style.height = `${currentHeight}px`;
      }
    }, 50);

    return () => clearTimeout(initTimer);
    // 只在首次挂载和 isAdmin 变化时执行，不依赖 showLibraryFilters 和 location.pathname
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // 监听壁纸变化事件（由 GlobalControlPanel 触发）
  useEffect(() => {
    const handleWallpaperChanged = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const newUrl = customEvent.detail?.url;

      if (!newUrl) return;

      // 先检查缓存
      const cachedColors = getColorFromCache(newUrl);
      if (cachedColors) {
        applyColorPalette(cachedColors);
        return;
      }

      // 检查是否为有效壁纸
      const checkResult = await shouldApplyColorExtraction(newUrl);
      if (!checkResult.shouldApply) {
        return;
      }

      // 提取颜色
      try {
        const colors = await extractColorsFromImage(newUrl, { context: 'wallpaper' });
        applyColorPalette(colors);
        saveColorToCache(newUrl, colors);
      } catch {
        // 提取失败，静默处理
      }
    };

    window.addEventListener('wallpaperChanged', handleWallpaperChanged);
    return () => {
      window.removeEventListener('wallpaperChanged', handleWallpaperChanged);
    };
  }, []);

  // 路由变化时更新导航状态
  useEffect(() => {
    setActiveNav();
    // 注意：不在这里自动设置 showLibraryFilters，由按钮点击触发
    // 防止与 handleEnterFilters 冲突导致重复加载
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
            {(isAnimating ? renderModeRef.current === 'library' : (location.pathname === '/library' && showLibraryFilters)) ? (
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
                        // 已在资料库页面，直接触发展开动画
                        handleEnterFilters();
                      } else {
                        // 导航到资料库页面，延长等待时间确保路径已更新
                        navigate('/library');
                        // 等待路径更新后再触发动画
                        setTimeout(() => {
                          // 再次检查路径，确保已经导航完成
                          if (window.location.pathname === '/library') {
                            handleEnterFilters();
                          } else {
                            // 如果路径还没更新，再等待一次
                            setTimeout(() => handleEnterFilters(), 100);
                          }
                        }, 150);
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
