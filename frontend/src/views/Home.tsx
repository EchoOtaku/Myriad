/**
 * 首页视图组件
 * 显示可视化编辑的小组件网格
 */

import AnimatedView from '../components/AnimatedView';
import { API_URL } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaEdit } from 'react-icons/fa';
import WidgetGrid, { WidgetConfig, WidgetType } from '../components/WidgetGrid';
import { WelcomeWidget } from '../components/widgets/WelcomeWidget';
import { QuickStatsWidget } from '../components/widgets/QuickStatsWidget';
import { RecentActivityWidget } from '../components/widgets/RecentActivityWidget';
import { PlatformCardWidget } from '../components/widgets/PlatformCardWidget';
import { WeatherWidget } from '../components/widgets/WeatherWidget';
import { QuoteWidget } from '../components/widgets/QuoteWidget';
import { MusicPlayerWidget } from '../components/widgets/MusicPlayerWidget';
import { ReportCardWidget } from '../components/widgets/ReportCardWidget';
import { SocialNetworkWidget } from '../components/widgets/SocialNetworkWidget';

// 注册所有可用的小组件类型
const AVAILABLE_WIDGETS: WidgetType[] = [
  {
    id: 'welcome',
    name: '欢迎',
    defaultSize: '4x2',
    icon: '👋',
    component: WelcomeWidget,
    supportedSizes: ['2x2', '4x2'],
  },
  {
    id: 'quick-stats',
    name: '内容数据概览',
    defaultSize: '4x2',
    icon: '📊',
    component: QuickStatsWidget,
    supportedSizes: ['4x2'],
  },
  {
    id: 'recent-activity',
    name: '最近活动',
    defaultSize: '4x2',
    icon: '🕐',
    component: RecentActivityWidget,
    supportedSizes: ['2x2', '4x2', '4x4'],
  },
  {
    id: 'weather',
    name: '天气',
    defaultSize: '2x2',
    icon: '🌤️',
    component: WeatherWidget,
    supportedSizes: ['2x2', '4x2', '4x1'],
  },
  {
    id: 'quote',
    name: '一言',
    defaultSize: '2x2',
    icon: '💭',
    component: QuoteWidget,
    supportedSizes: ['2x2', '4x2', '4x1'],
  },
  {
    id: 'music-player',
    name: '音乐播放器',
    defaultSize: '2x2',
    icon: '🎵',
    component: MusicPlayerWidget,
    supportedSizes: ['2x2', '4x2'],
  },
  {
    id: 'report-bilibili',
    name: 'Bilibili报告',
    defaultSize: '4x2',
    icon: '📊',
    component: ReportCardWidget,
    supportedSizes: ['4x2'],
  },
  {
    id: 'report-steam',
    name: 'Steam报告',
    defaultSize: '4x2',
    icon: '🎮',
    component: ReportCardWidget,
    supportedSizes: ['4x2'],
  },
  {
    id: 'report-github',
    name: 'GitHub报告',
    defaultSize: '4x2',
    icon: '💻',
    component: ReportCardWidget,
    supportedSizes: ['4x2'],
  },
  {
    id: 'report-netease',
    name: '网易云报告',
    defaultSize: '4x2',
    icon: '🎵',
    component: ReportCardWidget,
    supportedSizes: ['4x2'],
  },
  {
    id: 'social-network',
    name: '社交网络',
    defaultSize: '1x1',
    icon: '🌐',
    component: SocialNetworkWidget,
    supportedSizes: ['1x1', '2x1', '2x2'],
  },
];

// 默认小组件布局
const DEFAULT_WIDGETS: WidgetConfig[] = [
  {
    id: 'default-welcome',
    type: 'welcome',
    size: '4x2',
    position: { x: 0, y: 0 },
  },
  {
    id: 'default-weather',
    type: 'weather',
    size: '2x2',
    position: { x: 4, y: 0 },
  },
  {
    id: 'default-quote',
    type: 'quote',
    size: '2x2',
    position: { x: 6, y: 0 },
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [dashboardTitle, setDashboardTitle] = useState('Dashboard');
  const [csrfToken, setCsrfToken] = useState<string>('');

  // 检查是否需要初始化设置
  useEffect(() => {
    async function checkSetup() {
      try {
        const response = await fetch(`${API_URL}/api/setup/status`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (data.is_setup_required) {
          navigate('/setup', { replace: true });
        }
      } catch (error) {
        // 允许用户访问应用
      }
    }

    checkSetup();
  }, [navigate]);

  // 获取用户信息
  useEffect(() => {
    async function fetchUserInfo() {
      // 默认状态（访客/未加载）
      let currentInfo = {
        name: 'Myriad Dashboard',
        avatar: `https://ui-avatars.com/api/?name=Myriad&background=random`,
        bio: '欢迎访问我的个人仪表盘',
        is_admin: false
      };

      try {
        // 1. 尝试获取登录信息 (确定权限)
        const authResponse = await fetch(`${API_URL}/api/auth/me`, {
          credentials: 'include',
        });
        
        if (authResponse.ok) {
          const authData = await authResponse.json();
          // 登录后先使用账号信息
          currentInfo = {
            name: authData.display_name || authData.username,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(authData.username)}&background=random`,
            bio: '这家伙很懒，没有介绍呢',
            is_admin: authData.is_admin || false
          };

          // 获取 CSRF Token (仅登录用户需要)
          try {
            const csrfResponse = await fetch(`${API_URL}/api/csrf-token`, {
              credentials: 'include',
            });
            if (csrfResponse.ok) {
              const csrfData = await csrfResponse.json();
              if (csrfData.csrf_token) {
                setCsrfToken(csrfData.csrf_token);
              }
            }
          } catch (e) {
            console.warn('获取 CSRF Token 失败', e);
          }
        }
      } catch (error) {
        // 忽略 401 等错误，保持默认访客状态
        console.debug('未登录或验证失败:', error);
      }

      // 2. 获取公开的个人资料 (作为介绍展示)
      // 无论是否登录，都尝试获取这个信息来丰富展示
      try {
        const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          if (profileData.success && profileData.user_info) {
            // 覆盖显示信息（优先显示站长/公开资料）
            if (profileData.user_info.name) currentInfo.name = profileData.user_info.name;
            if (profileData.user_info.avatar) currentInfo.avatar = profileData.user_info.avatar;
            if (profileData.user_info.bio) currentInfo.bio = profileData.user_info.bio;
          }
        }
      } catch (e) {
        console.warn('获取详细资料失败', e);
      }

      setUserInfo(currentInfo);
    }
    fetchUserInfo();
  }, []);

  // 从后端加载小组件配置
  useEffect(() => {
    async function loadDashboardConfig() {
      try {
        const response = await fetch(`${API_URL}/api/config/ui`);
        if (response.ok) {
          const data = await response.json();
          let loadedWidgets = null;

          if (data.dashboard_layout) {
            try {
              const parsedLayout = JSON.parse(data.dashboard_layout);
              if (Array.isArray(parsedLayout)) {
                // 过滤掉未注册的小组件
                const registeredWidgetIds = new Set(AVAILABLE_WIDGETS.map(w => w.id));
                loadedWidgets = parsedLayout.filter((w: WidgetConfig) => registeredWidgetIds.has(w.type));
              }
            } catch (e) {
              console.error('解析仪表盘布局失败:', e);
            }
          }

          setWidgets(loadedWidgets || DEFAULT_WIDGETS);

          if (data.dashboard_title) {
            setDashboardTitle(data.dashboard_title);
          }
        } else {
          setWidgets(DEFAULT_WIDGETS);
        }
      } catch (err) {
        console.error('加载配置失败:', err);
        setWidgets(DEFAULT_WIDGETS);
      } finally {
        setIsLoading(false);
      }
    }
    loadDashboardConfig();
  }, []);

  // 保存小组件配置到后端
  const handleWidgetsChange = async (newWidgets: WidgetConfig[]) => {
    // 过滤掉未注册的小组件（已丢失/删除的组件）
    const registeredWidgetIds = new Set(AVAILABLE_WIDGETS.map(w => w.id));
    const validWidgets = newWidgets.filter(w => registeredWidgetIds.has(w.type));
    
    setWidgets(validWidgets);
    
    // 只有管理员可以保存
    if (!userInfo?.is_admin) return;

    try {
      await fetch(`${API_URL}/api/config/dashboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          layout: JSON.stringify(validWidgets) // 序列化为字符串存储
        }),
      });
    } catch (err) {
      console.error('保存小组件配置失败:', err);
    }
  };

  // 保存标题
  const handleTitleChange = async (newTitle: string) => {
    setDashboardTitle(newTitle);
    
    // 只有管理员可以保存
    if (!userInfo?.is_admin) return;

    try {
      await fetch(`${API_URL}/api/config/dashboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          title: newTitle
        }),
      });
    } catch (err) {
      console.error('保存标题失败:', err);
    }
  };

  // 监听自定义平台更新事件
  useEffect(() => {
    const handleCustomPlatformsUpdate = async (event: Event) => {
      const customEvent = event as CustomEvent<{ platforms: any[] }>;
      // 只有管理员可以保存
      if (!userInfo?.is_admin) return;

      try {
        await fetch(`${API_URL}/api/config/dashboard`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            custom_platforms: JSON.stringify(customEvent.detail.platforms)
          }),
        });
      } catch (err) {
        console.error('保存自定义平台失败:', err);
      }
    };

    window.addEventListener('custom-platforms-update', handleCustomPlatformsUpdate);
    return () => {
      window.removeEventListener('custom-platforms-update', handleCustomPlatformsUpdate);
    };
  }, [userInfo?.is_admin, csrfToken]);

  return (
    <AnimatedView className="min-h-screen lg:h-screen lg:overflow-hidden">
      <div className="h-full flex flex-col pt-20 pb-6 px-3 xs:px-4 sm:px-6">
        <div className="flex-1 max-w-7xl mx-auto w-full flex flex-col gap-4 p-2 relative min-h-0">
          {/* 小组件网格区域 - 占满整个可用空间 */}
          <WidgetGrid
            widgets={widgets}
            availableWidgets={AVAILABLE_WIDGETS}
            onWidgetsChange={handleWidgetsChange}
            isEditMode={isEditMode}
            onToggleEditMode={setIsEditMode}
          >
            {/* 顶部信息条 - 作为 children 传入 WidgetGrid */}
            <div className="relative h-[60px] flex-shrink-0 z-10 mb-2 p-1">
              {/* 背景标题 */}
              {isEditMode ? (
                <input
                  type="text"
                  aria-label="Dashboard Title"
                  value={dashboardTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="absolute left-1 text-8xl whitespace-nowrap z-0 qwitcher-grypen-bold hidden md:block bg-transparent border-none outline-none p-0 m-0 w-full"
                  style={{ 
                    top: 'calc(30px - 1em)',
                    color: 'color-mix(in srgb, var(--color-primary) 70%, transparent)',
                    WebkitTextStroke: '0.5px color-mix(in srgb, var(--color-primary) 30%, transparent)',
                    lineHeight: 1
                  }}
                />
              ) : (
                <div 
                  className="absolute left-1 text-8xl whitespace-nowrap pointer-events-none z-0 qwitcher-grypen-bold hidden md:block" 
                  style={{ 
                    top: 'calc(30px - 1em)',
                    color: 'color-mix(in srgb, var(--color-primary) 70%, transparent)',
                    WebkitTextStroke: '0.5px color-mix(in srgb, var(--color-primary) 30%, transparent)'
                  }}
                >
                  {dashboardTitle}
                </div>
              )}

              <motion.div 
                className="h-full flex items-center justify-between"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {/* 用户信息卡片 */}
                <motion.div 
                  className="h-full glass rounded-xl px-4 py-1 flex items-center gap-3 shadow-sm relative z-10"
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                >
                  {userInfo ? (
                    <>
                      <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-200 dark:border-white/10">
                        <img 
                          src={userInfo.avatar} 
                          alt={userInfo.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col justify-center">
                        <div className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">
                          {userInfo.name}
                        </div>
                        {userInfo.bio && (
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 max-w-[200px] truncate leading-tight">
                            {userInfo.bio}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-white/5 animate-pulse" />
                      <div className="flex flex-col gap-1">
                        <div className="w-20 h-3 bg-gray-200 dark:bg-white/5 rounded animate-pulse" />
                        <div className="w-32 h-2 bg-gray-200 dark:bg-white/5 rounded animate-pulse" />
                      </div>
                    </div>
                  )}

                  {/* 编辑按钮 - 仅管理员可见，且仅在桌面端显示 */}
                  {userInfo?.is_admin && (
                    <>
                      <div className="hidden lg:block h-6 w-px bg-gray-200 dark:bg-white/10 mx-1" />

                      <button
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`
                          hidden lg:flex px-4 py-1.5 rounded-lg text-xs font-bold items-center gap-2 transition-all
                          ${isEditMode
                            ? 'text-white shadow-md hover:opacity-90'
                            : 'bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10'
                          }
                        `}
                        style={{
                          backgroundColor: isEditMode ? 'var(--color-primary)' : undefined,
                          color: isEditMode ? '#fff' : 'var(--color-primary)',
                        }}
                      >
                        <FaEdit size={12} />
                        {isEditMode ? '完成' : '编辑'}
                      </button>
                    </>
                  )}
                </motion.div>
              </motion.div>
            </div>
          </WidgetGrid>

          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-[1px] rounded-xl">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200/20 border-t-white/80"></div>
            </div>
          )}
        </div>
      </div>
    </AnimatedView>
  );
}
