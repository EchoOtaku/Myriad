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

type NavMode = 'library' | 'reports' | 'normal';
type RouteContext = 'library' | 'reports' | 'global';
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
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const { notifications } = useNotification();

  // 壁纸管理 Hook
  const { loadWallpaper: loadWallpaperFromHook } = useWallpaper();

  // 导航岛状态管理
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'game' | 'video' | 'music' | 'anime' | 'tv_series'>('all');
  const [showLibraryFilters, setShowLibraryFilters] = useState(false);
  const [reportsTab, setReportsTab] = useState<'platform' | 'comprehensive'>('platform');
  const [showReportsTabs, setShowReportsTabs] = useState(false);
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
    if (mode === 'reports') return 'reports';
    if (location.pathname === '/library') return 'library';
    if (location.pathname === '/reports') return 'reports';
    return 'global';
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
      ['all', 'game', 'video', 'music', 'anime', 'tv_series'].forEach(() => appendIconGroup(parent, 'nav-group-spaced'));
      return;
    }

    if (mode === 'reports') {
      appendIconGroup(parent);
      appendDividerGroup(parent);
      ['platform', 'comprehensive'].forEach(() => appendIconGroup(parent, 'nav-group-spaced'));
      return;
    }

    appendIconGroup(parent);
    appendIconGroup(parent, 'nav-group-spaced');
    appendIconGroup(parent, 'nav-group-spaced');
    if (routeContext === 'library') {
      appendDividerGroup(parent);
      appendIconGroup(parent);
    }
    if (routeContext === 'reports') {
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
      // 移动端：不强制设置宽度，让 CSS width: auto 处理自适应
      // 这样可以避免内容变化时宽度不更新导致的"双重边框"（空白区域）问题
      island.style.removeProperty('width');
      island.style.removeProperty('height');
    }
  };

  // 处理资料库筛选变化
  const handleLibraryFilterChange = useCallback((newFilter: 'all' | 'game' | 'video' | 'music' | 'anime' | 'tv_series') => {
    setLibraryFilter(newFilter);
    // 触发自定义事件通知 Library 组件
    window.dispatchEvent(new CustomEvent('library-filter-change', {
      detail: { filter: newFilter }
    }));
  }, []);

  // 处理报告标签变化
  const handleReportsTabChange = useCallback((newTab: 'platform' | 'comprehensive') => {
    setReportsTab(newTab);
    // 触发自定义事件通知 Reports 组件
    window.dispatchEvent(new CustomEvent('reports-tab-change', {
      detail: { tab: newTab }
    }));
  }, []);

  // 处理从正常模式进入报告标签模式
  const handleEnterReportsTabs = useCallback(() => {
    if (isAnimating || showReportsTabs || renderModeRef.current === 'reports') return;

    const content = navContentRef.current;
    if (!content) {
      setShowReportsTabs(true);
      return;
    }

    setIsAnimating(true);
    renderModeRef.current = 'normal';
    const groups = Array.from(content.querySelectorAll('.nav-group'));
    const island = content.closest('.dynamic-island') as HTMLElement;
    
    if (island) {
      applyModeMetrics('reports', island, 'reports');
    }
    
    const exitTimers: number[] = [];
    
    groups.forEach((group, index) => {
      const el = group as HTMLElement;
      el.removeAttribute('data-animation');
      const timer = window.setTimeout(() => {
        el.setAttribute('data-animation', 'exit');
      }, index * 20);
      exitTimers.push(timer);
    });

    const exitDuration = groups.length * 20 + 280;
    const switchTimer = window.setTimeout(() => {
      groups.forEach(group => {
        (group as HTMLElement).removeAttribute('data-animation');
      });

      renderModeRef.current = 'reports';
      setShowReportsTabs(true);
      setIsAnimating(false);

      setTimeout(() => {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          const href = item.getAttribute('href');
          const ariaLabel = item.getAttribute('aria-label');
          let isActive = false;

          if (href) {
            isActive = href === location.pathname || (location.pathname === '/' && href === '/');
          } else if (ariaLabel) {
            const labelToPathMap: Record<string, string> = {
              '资料库': '/library',
              '数据报告': '/reports',
              '返回主页': '/',
            };
            const targetPath = labelToPathMap[ariaLabel];
            if (targetPath) {
              isActive = location.pathname === targetPath;
            }
          }

          if (isActive) {
            item.setAttribute('aria-current', 'page');
          } else {
            item.removeAttribute('aria-current');
          }
        });
      }, 50);
    }, exitDuration);

    return () => {
      exitTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(switchTimer);
    };
  }, [isAnimating, showReportsTabs, location.pathname, isAdmin]);

  // 处理从报告标签模式退出到正常模式
  const handleExitReportsTabs = useCallback(() => {
    const content = navContentRef.current;
    if (!content || isAnimating || !showReportsTabs || renderModeRef.current === 'normal') return;

    setIsAnimating(true);
    renderModeRef.current = 'reports';
    const groups = Array.from(content.querySelectorAll('.nav-group'));
    const island = content.closest('.dynamic-island') as HTMLElement;
    
    if (island) {
      applyModeMetrics('normal', island, 'reports');
    }
    
    const exitTimers: number[] = [];
    
    groups.forEach((group, index) => {
      const el = group as HTMLElement;
      el.removeAttribute('data-animation');
      const timer = window.setTimeout(() => {
        el.setAttribute('data-animation', 'exit');
      }, index * 20);
      exitTimers.push(timer);
    });

    const exitDuration = groups.length * 20 + 280;
    const switchTimer = window.setTimeout(() => {
      groups.forEach(group => {
        (group as HTMLElement).removeAttribute('data-animation');
      });

      renderModeRef.current = 'normal';
      setShowReportsTabs(false);
      setIsAnimating(false);

      setTimeout(() => {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          const href = item.getAttribute('href');
          const ariaLabel = item.getAttribute('aria-label');
          let isActive = false;

          if (href) {
            isActive = href === location.pathname || (location.pathname === '/' && href === '/');
          } else if (ariaLabel) {
            const labelToPathMap: Record<string, string> = {
              '资料库': '/library',
              '数据报告': '/reports',
              '返回主页': '/',
            };
            const targetPath = labelToPathMap[ariaLabel];
            if (targetPath) {
              isActive = location.pathname === targetPath;
            }
          }

          if (isActive) {
            item.setAttribute('aria-current', 'page');
          } else {
            item.removeAttribute('aria-current');
          }
        });
      }, 50);
    }, exitDuration);

    return () => {
      exitTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(switchTimer);
    };
  }, [isAnimating, isAdmin, showReportsTabs, location.pathname]);

  // Apple 风格动画控制 - 精致的进入动画
  useLayoutEffect(() => {
    // 布局阶段先写入进入状态，避免初次绘制闪烁
    const content = navContentRef.current;
    if (!content) return;
    
    // 如果正在动画中，等待下一次
    if (isAnimating) return;

    const currentMode: NavMode = 
      (location.pathname === '/reports' && showReportsTabs) ? 'reports' :
      (location.pathname === '/library' && showLibraryFilters) ? 'library' : 
      'normal';
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
        // 移动端：移除宽度限制，避免固定宽度导致的布局问题
        island.style.removeProperty('width');
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
  }, [showLibraryFilters, showReportsTabs, location.pathname, isAnimating]);

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

      // 3.4: 重新设置导航选中状态（因为DOM重新渲染）
      setTimeout(() => {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          const href = item.getAttribute('href');
          const ariaLabel = item.getAttribute('aria-label');
          let isActive = false;

          if (href) {
            isActive = href === location.pathname || (location.pathname === '/' && href === '/');
          } else if (ariaLabel) {
            const labelToPathMap: Record<string, string> = {
              '资料库': '/library',
              '数据报告': '/reports',
              '返回主页': '/',
            };
            const targetPath = labelToPathMap[ariaLabel];
            if (targetPath) {
              isActive = location.pathname === targetPath;
            }
          }

          if (isActive) {
            item.setAttribute('aria-current', 'page');
          } else {
            item.removeAttribute('aria-current');
          }
        });
      }, 50);
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

      // 3.4: 重新设置导航选中状态（因为DOM重新渲染）
      setTimeout(() => {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          const href = item.getAttribute('href');
          const ariaLabel = item.getAttribute('aria-label');
          let isActive = false;

          if (href) {
            isActive = href === location.pathname || (location.pathname === '/' && href === '/');
          } else if (ariaLabel) {
            const labelToPathMap: Record<string, string> = {
              '资料库': '/library',
              '数据报告': '/reports',
              '返回主页': '/',
            };
            const targetPath = labelToPathMap[ariaLabel];
            if (targetPath) {
              isActive = location.pathname === targetPath;
            }
          }

          if (isActive) {
            item.setAttribute('aria-current', 'page');
          } else {
            item.removeAttribute('aria-current');
          }
        });
      }, 50);
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

    // 只在从报告页面离开时触发优雅的退出动画
    if (prevPath === '/reports' && currentPath !== '/reports' && !showReportsTabs) {
      const content = navContentRef.current;
      const island = content?.closest('.dynamic-island') as HTMLElement;
      if (!content || !island) return;

      const groups = content.querySelectorAll('[data-group="current-tab"], [data-group="divider"]');
      
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
  }, [location.pathname, showLibraryFilters, showReportsTabs]);

  // 检查认证状态（默认静默处理，不在控制台显示 401 错误）
  const checkAuth = useCallback(async (silent = true) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include',
      });
        
      if (response.ok) {
        const user = await response.json();
        setIsAuthenticated(true);
        setIsAdmin(user.is_admin || false);
        
        // 获取头像
        try {
          const profileResponse = await fetch(`${API_URL}/api/profile/user-info`, {
            credentials: 'include',
          });
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
      } else {
        // 401 是正常的未登录状态，静默处理
        if (!silent && response.status !== 401) {
          console.warn('Authentication check failed:', response.status);
        }
        setIsAuthenticated(false);
        setIsAdmin(false);
        setUserAvatar('');
      }
    } catch (error) {
      // 只在非静默模式下记录网络错误
      if (!silent) {
        console.error('Network error during auth check:', error);
      }
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUserAvatar('');
    }
  }, []);

  // 加载壁纸和颜色（使用 Hook）
  const loadWallpaper = useCallback(async () => {
    const wallpaperResult = await loadWallpaperFromHook();
    
    if (!wallpaperResult) {
      return;
    }
    
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
      } catch (error) {
        console.error('颜色提取失败:', error);
      }
    }
  }, [loadWallpaperFromHook]);

  // 设置当前导航项
  const setActiveNav = useCallback(() => {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      const ariaLabel = item.getAttribute('aria-label');
      let isActive = false;

      // 处理链接元素（通过 href 匹配）
      if (href) {
        isActive = href === location.pathname || (location.pathname === '/' && href === '/');
      }
      // 处理按钮元素（通过 aria-label 匹配路径）
      else if (ariaLabel) {
        const labelToPathMap: Record<string, string> = {
          '资料库': '/library',
          '数据报告': '/reports',
          '返回主页': '/',
        };
        const targetPath = labelToPathMap[ariaLabel];
        if (targetPath) {
          isActive = location.pathname === targetPath;
        }
      }

      if (isActive) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }, [location]);


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

  // 初始化：加载壁纸和检查认证
  useEffect(() => {
    (async () => {
      await loadWallpaper();
    })();
    // ✅ 总是检查认证状态（静默模式），因为使用 HttpOnly Cookie 无法从 JavaScript 读取
    // 即使未登录也会返回 401，但静默处理，不显示错误
    checkAuth(true);
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
      } catch (error) {
        console.error('颜色提取失败:', error);
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
      const isAuth = e.detail?.isAuthenticated ?? false;
      setIsAuthenticated(isAuth);
      
      if (isAuth) {
        // 登录成功，重新检查认证
        checkAuth().then(() => {
          // 认证检查完成后，再次触发事件，携带管理员状态
          const adminStatus = e.detail?.isAdmin ?? false;
          setIsAdmin(adminStatus);
        });
      } else {
        // 退出登录，清理状态
        setIsAdmin(false);
        setUserAvatar('');
      }
    };

    window.addEventListener('auth-state-changed', handleAuthChange as EventListener);
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthChange as EventListener);
    };
  }, [checkAuth]);



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
        <div id="wallpaper" className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700 ease-in-out"></div>
        <div id="bg-gradient" className="absolute inset-0 bg-gradient-to-b from-transparent from-[35%] via-white/40 via-[55%] to-white/90 to-[85%] transition-opacity duration-500 ease-out"></div>
        <div className="absolute inset-0 opacity-20 transition-opacity duration-700">
          <div className="absolute top-[40%] left-10 w-96 h-96 bg-green-400/30 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
          <div className="absolute top-[40%] right-10 w-96 h-96 bg-pink-400/30 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
          <div className="absolute top-[60%] left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-400/25 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
        </div>
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.02]"></div>
      </div>

      {/* 导航栏 */}
      <nav className="nav-container" aria-label="主导航">
        <div className="dynamic-island shadow-2xl" role="navigation">
          <div className="flex flex-row md:flex-col items-center gap-1 relative">
            {(isAnimating ? renderModeRef.current === 'reports' : (location.pathname === '/reports' && showReportsTabs)) ? (
              /* 报告模式 - 显示返回按钮 + 分隔符 + 报告标签 */
              <div ref={navContentRef} className="nav-island-content flex flex-row md:flex-col items-center gap-1" key="reports-mode">
                {/* 返回按钮 */}
                <div className="nav-group" data-group="back">
                  <button 
                    onClick={handleExitReportsTabs}
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

                {/* 平台报告标签 */}
                <div className="nav-group nav-group-spaced" data-group="platform">
                  <button 
                    onClick={() => handleReportsTabChange('platform')}
                    className={`nav-item ${reportsTab === 'platform' ? 'active-secondary' : ''}`}
                    title="平台报告"
                    aria-label="显示平台报告"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0a4 4 0 004-4v-4a2 2 0 012-2h4a2 2 0 012 2v4a4 4 0 01-4 4h-8z" />
                    </svg>
                  </button>
                </div>

                {/* 综合报告标签 */}
                <div className="nav-group nav-group-spaced" data-group="comprehensive">
                  <button 
                    onClick={() => handleReportsTabChange('comprehensive')}
                    className={`nav-item ${reportsTab === 'comprehensive' ? 'active-secondary' : ''}`}
                    title="综合报告"
                    aria-label="显示综合报告"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (isAnimating ? renderModeRef.current === 'library' : (location.pathname === '/library' && showLibraryFilters)) ? (
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
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
                      <rect x="2" y="6" width="20" height="12" rx="3" strokeWidth={2} />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h4m-2-2v4" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 11h.01M17 13h.01" />
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
                <div className="nav-group nav-group-spaced" data-group="anime">
                  <button
                    onClick={() => handleLibraryFilterChange('anime')}
                    className={`nav-item ${libraryFilter === 'anime' ? 'active-secondary' : ''}`}
                    title="追番"
                    aria-label="显示追番"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="bold" className="font-sans">あ</text>
                    </svg>
                  </button>
                </div>
                <div className="nav-group nav-group-spaced" data-group="tv_series">
                  <button
                    onClick={() => handleLibraryFilterChange('tv_series')}
                    className={`nav-item ${libraryFilter === 'tv_series' ? 'active-secondary' : ''}`}
                    title="追剧"
                    aria-label="显示追剧"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
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

                {/* 报告按钮 */}
                <div className="nav-group nav-group-spaced" data-group="reports">
                  <button
                    className="nav-item"
                    title="报告"
                    aria-label="数据报告"
                    onClick={() => {
                      if (location.pathname === '/reports') {
                        // 已在报告页面，直接触发展开动画
                        handleEnterReportsTabs();
                      } else {
                        // 导航到报告页面，延长等待时间确保路径已更新
                        navigate('/reports');
                        // 等待路径更新后再触发动画
                        setTimeout(() => {
                          // 再次检查路径，确保已经导航完成
                          if (window.location.pathname === '/reports') {
                            handleEnterReportsTabs();
                          } else {
                            // 如果路径还没更新，再等待一次
                            setTimeout(() => handleEnterReportsTabs(), 100);
                          }
                        }, 150);
                      }
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                  </button>
                </div>

                {/* 分隔符 - 仅在资料库页面且未显示筛选时显示 */}
                {location.pathname === '/library' && !showLibraryFilters && (
                  <div className="nav-group nav-group-spaced" data-group="divider">
                    <div className="w-px h-6 bg-gray-300/50 dark:bg-gray-600/50 md:w-6 md:h-px md:my-0"></div>
                  </div>
                )}

                {/* 分隔符 - 仅在报告页面且未显示标签时显示 */}
                {location.pathname === '/reports' && !showReportsTabs && (
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
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
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
                          <rect x="2" y="6" width="20" height="12" rx="3" strokeWidth={2} />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h4m-2-2v4" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 11h.01M17 13h.01" />
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
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
                    {libraryFilter === 'anime' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：追番 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="bold" className="font-sans">あ</text>
                        </svg>
                      </button>
                    )}
                    {libraryFilter === 'tv_series' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前筛选：追剧 - 点击展开筛选"
                        onClick={handleEnterFilters}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}

                {/* 当前报告选中标签显示 - 仅在报告页面且未显示标签时显示 */}
                {location.pathname === '/reports' && !showReportsTabs && (
                  <div className="nav-group" data-group="current-tab">
                    {reportsTab === 'platform' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前查看：平台报告 - 点击展开切换"
                        onClick={handleEnterReportsTabs}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0a4 4 0 004-4v-4a2 2 0 012-2h4a2 2 0 012 2v4a4 4 0 01-4 4h-8z" />
                        </svg>
                      </button>
                    )}
                    {reportsTab === 'comprehensive' && (
                      <button 
                        className="nav-item opacity-60 hover:opacity-100 transition-opacity" 
                        title="当前查看：综合报告 - 点击展开切换"
                        onClick={handleEnterReportsTabs}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
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
