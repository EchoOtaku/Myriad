/**
 * 社交网络小组件 - 显示平台链接入口
 * 支持 1x1, 2x1, 2x2 三种尺寸
 * glass风格 + 微动态效果
 * 长按设置面板选择平台
 * 
 * 性能优化:
 * - 使用 memo 包裹组件和子组件
 * - 使用 useMemo 缓存计算结果
 * - 使用 useCallback 缓存事件处理器
 * - 条件渲染减少不必要的 DOM 节点
 * - 懒加载设置弹窗
 * - 使用 CSS 变量减少重渲染
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { WidgetComponentProps } from '../WidgetGrid';
import { SiBilibili, SiNeteasecloudmusic } from 'react-icons/si';
import { FaSteam, FaGithub, FaTimes } from 'react-icons/fa';
import { API_URL } from '../../config';
import { useAnimationLevel } from '../../hooks/useAnimationLevel';
import { useWidgetSize } from '../../hooks/useWidgetSize';

// 平台配置定义 - 移到组件外部避免重复创建
interface PlatformInfo {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  darkColor: string;
  getUserUrl: (userId: string) => string;
  configKey: string;
}

// 静态平台配置 - 使用 Object.freeze 防止意外修改
const PLATFORMS: readonly PlatformInfo[] = Object.freeze([
  {
    id: 'bilibili',
    name: 'Bilibili',
    icon: <SiBilibili />,
    color: '#00A1D6',
    darkColor: '#00A1D6',
    getUserUrl: (uid: string) => `https://space.bilibili.com/${uid}`,
    configKey: 'bilibili_uid',
  },
  {
    id: 'steam',
    name: 'Steam',
    icon: <FaSteam />,
    color: '#1B2838',
    darkColor: '#c7d5e0',
    getUserUrl: (steamId: string) => `https://steamcommunity.com/profiles/${steamId}`,
    configKey: 'steam_id',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: <FaGithub />,
    color: '#24292E',
    darkColor: '#e6edf3',
    getUserUrl: (username: string) => `https://github.com/${username}`,
    configKey: 'github_username',
  },
  {
    id: 'netease',
    name: '网易云音乐',
    icon: <SiNeteasecloudmusic />,
    color: '#E60026',
    darkColor: '#E60026',
    getUserUrl: (userId: string) => `https://music.163.com/#/user/home?id=${userId}`,
    configKey: 'netease_user_id',
  },
]);

// 平台ID到索引的映射 - 避免重复查找
const PLATFORM_INDEX_MAP: Record<string, number> = {
  bilibili: 0,
  steam: 1,
  github: 2,
  netease: 3,
};

// 缓存平台配置数据
interface PlatformUserIds {
  bilibili_uid?: string;
  steam_id?: string;
  github_username?: string;
  netease_user_id?: string;
}

// 全局缓存 - 避免重复请求
let cachedPlatformUserIds: PlatformUserIds | null = null;
let fetchPromise: Promise<PlatformUserIds> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

const fetchPlatformUserIds = async (): Promise<PlatformUserIds> => {
  const now = Date.now();
  
  // 检查缓存是否有效
  if (cachedPlatformUserIds && now - cacheTimestamp < CACHE_TTL) {
    return cachedPlatformUserIds;
  }
  
  // 复用进行中的请求
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}/api/config`);
      if (!response.ok) return cachedPlatformUserIds || {};
      
      const data = await response.json();
      const result: PlatformUserIds = {};

      // 从 platforms 数组提取用户ID配置
      if (data.platforms && Array.isArray(data.platforms)) {
        for (const platform of data.platforms) {
          if (!platform.enabled) continue;

          for (const field of platform.config_fields || []) {
            if (platform.name === 'GitHub' && field.key === 'username' && field.value) {
              result.github_username = field.value;
            } else if (platform.name === 'Bilibili' && field.key === 'uid' && field.value) {
              result.bilibili_uid = field.value;
            } else if (platform.name === 'Steam' && field.key === 'steam_id' && field.value) {
              result.steam_id = field.value;
            } else if (platform.name === 'Netease Music' && field.key === 'user_id' && field.value) {
              result.netease_user_id = field.value;
            }
          }
        }
      }

      cachedPlatformUserIds = result;
      cacheTimestamp = now;
      return result;
    } catch {
      return cachedPlatformUserIds || {};
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
};

// 设置弹窗组件 - 使用 memo 优化
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPlatformId: string;
  onSelectPlatform: (platformId: string) => void;
  anchorRect?: DOMRect;
}

// 平台按钮组件 - 单独 memo 避免列表重渲染
const PlatformButton = memo(({ 
  platform, 
  isSelected, 
  onSelect 
}: { 
  platform: PlatformInfo; 
  isSelected: boolean; 
  onSelect: (platformId: string) => void;
}) => {
  const handleClick = useCallback(() => {
    onSelect(platform.id);
  }, [onSelect, platform.id]);

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
        isSelected
          ? 'bg-black/5 dark:bg-white/10 ring-1 ring-black/10 dark:ring-white/20'
          : 'hover:bg-black/8 dark:hover:bg-white/8 hover:shadow-sm active:scale-[0.98]'
      }`}
    >
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-lg"
        style={{ backgroundColor: platform.color }}
      >
        {platform.icon}
      </div>
      <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
        {platform.name}
      </span>
      {isSelected && (
        <div
          className="ml-auto w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: platform.color }}
        >
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </button>
  );
});

PlatformButton.displayName = 'PlatformButton';

const SettingsModal = memo(({ 
  isOpen, 
  onClose, 
  selectedPlatformId, 
  onSelectPlatform,
  anchorRect,
}: SettingsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  
  // 使用 useMemo 计算位置，避免重复计算
  const position = useMemo(() => {
    if (!anchorRect) return { top: 0, left: 0 };

    const modalWidth = 280;
    const modalHeight = 280;
    const padding = 16;

    let top = anchorRect.bottom + 8;
    let left = anchorRect.left + (anchorRect.width - modalWidth) / 2;

    if (left + modalWidth > window.innerWidth - padding) {
      left = window.innerWidth - modalWidth - padding;
    }
    if (left < padding) left = padding;
    if (top + modalHeight > window.innerHeight - padding) {
      top = anchorRect.top - modalHeight - 8;
    }
    if (top < padding) top = padding;

    return { top, left };
  }, [anchorRect]);

  // 合并事件监听器
  useEffect(() => {
    if (!isOpen) return;

    const handleEvent = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') {
        onClose();
      } else if (e instanceof MouseEvent && modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加事件监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleEvent);
      document.addEventListener('keydown', handleEvent);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleEvent);
      document.removeEventListener('keydown', handleEvent);
    };
  }, [isOpen, onClose]);

  // 使用 useCallback 缓存选择处理器
  const handleSelect = useCallback((platformId: string) => {
    onSelectPlatform(platformId);
    onClose();
  }, [onSelectPlatform, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000]"
        style={{ pointerEvents: 'none' }}
      >
        <motion.div
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.15 }}
          className="absolute glass rounded-2xl shadow-2xl overflow-hidden border border-white/20 dark:border-white/10"
          style={{ 
            top: position.top, 
            left: position.left,
            width: 280,
            pointerEvents: 'auto',
          }}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-white/10">
            <span className="font-bold text-sm text-gray-800 dark:text-gray-200">选择平台</span>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title="关闭"
              aria-label="关闭"
            >
              <FaTimes size={12} className="text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* 平台列表 - 使用优化后的 PlatformButton */}
          <div className="p-3 space-y-1.5">
            {PLATFORMS.map((platform) => (
              <PlatformButton
                key={platform.id}
                platform={platform}
                isSelected={selectedPlatformId === platform.id}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
});

SettingsModal.displayName = 'SettingsModal';

// 主组件
export const SocialNetworkWidget = memo(({ config, isEditMode, isPreview, onConfigChange }: WidgetComponentProps) => {
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
  const anim = useAnimationLevel();
  const widgetRef = useRef<HTMLDivElement>(null);

  // 深色模式检测
  const [isDark, setIsDark] = useState(() => 
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  // 监听主题变化
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // 从配置获取选中的平台ID
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>(
    config.config?.platformId || 'bilibili'
  );
  const [platformUserIds, setPlatformUserIds] = useState<PlatformUserIds>({});
  const [showSettings, setShowSettings] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | undefined>();
  const [isHovered, setIsHovered] = useState(false);

  // 长按检测
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  // 获取当前选中的平台信息
  const selectedPlatform = useMemo(
    () => PLATFORMS.find(p => p.id === selectedPlatformId) || PLATFORMS[0],
    [selectedPlatformId]
  );

  // 获取用户ID
  const userId = useMemo(() => {
    switch (selectedPlatformId) {
      case 'bilibili': return platformUserIds.bilibili_uid;
      case 'steam': return platformUserIds.steam_id;
      case 'github': return platformUserIds.github_username;
      case 'netease': return platformUserIds.netease_user_id;
      default: return undefined;
    }
  }, [selectedPlatformId, platformUserIds]);

  // 加载平台用户ID
  useEffect(() => {
    if (isPreview) return;
    fetchPlatformUserIds().then(setPlatformUserIds);
  }, [isPreview]);

  // 同步配置中的 platformId
  useEffect(() => {
    if (config.config?.platformId && config.config.platformId !== selectedPlatformId) {
      setSelectedPlatformId(config.config.platformId);
    }
  }, [config.config?.platformId]);

  // 处理平台选择变化
  const handleSelectPlatform = useCallback((platformId: string) => {
    setSelectedPlatformId(platformId);
    // 优先通过 props.onConfigChange 上报
    if (typeof onConfigChange === 'function') {
      onConfigChange({ ...config.config, platformId });
    } else {
      // 兼容旧逻辑
      window.dispatchEvent(new CustomEvent('widget-config-update', {
        detail: {
          widgetId: config.id,
          config: { ...config.config, platformId }
        }
      }));
    }
  }, [config.id, config.config, onConfigChange]);

  // 长按开始
  const handlePressStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isEditMode) return;
    
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      // 获取组件位置
      if (widgetRef.current) {
        setAnchorRect(widgetRef.current.getBoundingClientRect());
      }
      setShowSettings(true);
    }, 500);
  }, [isEditMode]);

  // 长按取消
  const handlePressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // 点击处理（跳转到用户页面）
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 如果是长按触发的设置弹窗，不处理点击
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }

    // 编辑模式下不跳转
    if (isEditMode) return;

    // 如果有用户ID，则跳转
    if (userId) {
      const url = selectedPlatform.getUserUrl(userId);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [isEditMode, userId, selectedPlatform]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // 计算图标颜色 - 使用 useMemo 避免重复计算
  const iconColor = useMemo(() => 
    isDark ? selectedPlatform.darkColor : selectedPlatform.color,
    [isDark, selectedPlatform.darkColor, selectedPlatform.color]
  );

  // 静态动画配置 - 避免每次渲染创建新对象
  const hoverAnimation = useMemo(() => ({
    scale: [1, 1.08, 1],
    rotate: [0, 5, -5, 0],
  }), []);
  
  const staticAnimation = useMemo(() => ({
    scale: 1,
    rotate: 0,
  }), []);
  
  const hoverTransition = useMemo(() => ({
    duration: 0.6,
    repeat: Infinity,
    ease: 'easeInOut' as const,
  }), []);

  // 使用 useMemo 渲染内容区域，避免不必要的重渲染
  const content = useMemo(() => {
    // 1x1 尺寸 - 仅图标
    if (config.size === '1x1') {
      return (
        <div className="h-full w-full flex items-center justify-center">
          <motion.div
            className="text-3xl"
            style={{ color: iconColor }}
            animate={isHovered ? hoverAnimation : staticAnimation}
            transition={isHovered ? hoverTransition : { duration: 0.3 }}
          >
            {selectedPlatform.icon}
          </motion.div>
        </div>
      );
    }

    // 2x1 尺寸 - 图标 + 平台名称
    if (config.size === '2x1') {
      return (
        <div className="h-full w-full flex items-center justify-center gap-3 px-4">
          <motion.div
            className="text-2xl flex-shrink-0"
            style={{ color: iconColor }}
            animate={isHovered ? {
              scale: [1, 1.1, 1],
              rotate: [0, 8, -8, 0],
            } : staticAnimation}
            transition={isHovered ? {
              duration: 0.5,
              repeat: Infinity,
              ease: 'easeInOut',
            } : { duration: 0.3 }}
          >
            {selectedPlatform.icon}
          </motion.div>
          <span 
            className="font-bold text-gray-800 dark:text-gray-100 truncate"
            style={{ fontSize: `${18 * fontScale}px` }}
          >
            {selectedPlatform.name}
          </span>
          {/* 箭头指示 */}
          {userId && !isEditMode && (
            <motion.div 
              className="ml-auto text-gray-400 dark:text-gray-500"
              animate={{ x: [0, 3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </motion.div>
          )}
        </div>
      );
    }

    // 2x2 尺寸 - 图标 + 平台名称 + 描述
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-4">
        <motion.div
          className="text-4xl"
          style={{ color: iconColor }}
          animate={isHovered ? {
            scale: [1, 1.1, 1],
            rotate: [0, 10, -10, 0],
          } : staticAnimation}
          transition={isHovered ? {
            duration: 0.5,
            repeat: Infinity,
            ease: 'easeInOut',
          } : { duration: 0.3 }}
        >
          {selectedPlatform.icon}
        </motion.div>
        <div className="text-center">
          <div 
            className="font-bold text-gray-800 dark:text-gray-100"
            style={{ fontSize: `${16 * fontScale}px` }}
          >
            {selectedPlatform.name}
          </div>
          <motion.div 
            className={`mt-1 flex items-center justify-center gap-1 ${userId ? 'text-gray-500 dark:text-gray-400' : 'text-amber-500 dark:text-amber-400'}`}
            style={{ fontSize: `${10 * fontScale}px` }}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {userId ? (
              <>
                <span>点击访问个人主页</span>
                <motion.span
                  animate={{ x: [0, 2, 0] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  →
                </motion.span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>未配置</span>
              </>
            )}
          </motion.div>
        </div>
      </div>
    );
  }, [config.size, iconColor, isHovered, hoverAnimation, staticAnimation, hoverTransition, selectedPlatform, fontScale, userId, isEditMode]);

  // 缓存容器的 hover/tap 动画配置
  const containerHoverProps = useMemo(() => ({
    whileHover: !isEditMode && userId ? { filter: 'brightness(1.03)' } : {},
    whileTap: !isEditMode && userId ? { scale: 0.98 } : {},
  }), [isEditMode, userId]);

  // 缓存背景光晕动画配置
  const glowAnimation1 = useMemo(() => anim.loop ? {
    opacity: [0.06, 0.15, 0.06],
    scale: [1, 1.15, 1],
  } : { opacity: 0.1, scale: 1 }, [anim.loop]);

  const glowTransition1 = useMemo(() => anim.loop ? {
    duration: 4,
    repeat: Infinity,
    ease: 'easeInOut' as const,
  } : { duration: 0 }, [anim.loop]);

  const glowAnimation2 = useMemo(() => anim.loop ? {
    opacity: [0.03, 0.08, 0.03],
    scale: [1.1, 1, 1.1],
  } : { opacity: 0.05, scale: 1 }, [anim.loop]);

  const glowTransition2 = useMemo(() => anim.loop ? {
    duration: 5,
    repeat: Infinity,
    ease: 'easeInOut' as const,
    delay: 1,
  } : { duration: 0 }, [anim.loop]);

  // 缓存 onMouseLeave 和 onMouseEnter 回调
  const handleMouseLeave = useCallback(() => {
    handlePressEnd();
    setIsHovered(false);
  }, [handlePressEnd]);

  const handleMouseEnter = useCallback(() => {
    if (!isEditMode && userId) {
      setIsHovered(true);
    }
  }, [isEditMode, userId]);

  return (
    <>
      <motion.div
        ref={(node) => {
          // 同时设置两个 ref
          (containerRef as unknown as React.MutableRefObject<HTMLDivElement | null>).current = node;
          (widgetRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        className={`relative h-full w-full rounded-xl overflow-hidden glass ${
          !isEditMode && userId ? 'cursor-pointer' : ''
        } ${isEditMode ? 'cursor-grab' : ''}`}
        style={{
          // 使用 filter 替代 box-shadow 避免布局影响
          transition: 'filter 0.3s ease, border-color 0.3s ease',
        }}
        {...containerHoverProps}
        onClick={handleClick}
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handleMouseLeave}
        onMouseEnter={handleMouseEnter}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressEnd}
      >
        {/* 背景装饰 - 平台色微光效果 */}
        <motion.div
          className={`absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none ${
            anim.level === 'standard' ? 'blur-3xl' : 'blur-2xl'
          }`}
          style={{ backgroundColor: selectedPlatform.color }}
          animate={glowAnimation1}
          transition={glowTransition1}
        />
        {/* 第二个光晕 */}
        <motion.div
          className={`absolute -left-6 -bottom-6 w-24 h-24 rounded-full pointer-events-none ${
            anim.level === 'standard' ? 'blur-3xl' : 'blur-2xl'
          }`}
          style={{ backgroundColor: selectedPlatform.color }}
          animate={glowAnimation2}
          transition={glowTransition2}
        />

        {/* 内容区域 */}
        {content}

        {/* 编辑模式指示器 */}
        {isEditMode && (
          <div className="absolute inset-0 border-2 border-dashed border-blue-400/50 rounded-xl pointer-events-none" />
        )}

        {/* 长按设置图标（编辑模式） */}
        {isEditMode && (
          <motion.div
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center bg-black/15 dark:bg-white/15 backdrop-blur-sm cursor-pointer hover:bg-black/30 dark:hover:bg-white/30 transition-all duration-200"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            title="长按进行设置"
            onClick={(e) => {
              e.stopPropagation();
              if (widgetRef.current) {
                setAnchorRect(widgetRef.current.getBoundingClientRect());
              }
              setShowSettings(true);
            }}
          >
            <svg className="w-3 h-3 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </motion.div>
        )}
      </motion.div>

      {/* 设置弹窗 */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        selectedPlatformId={selectedPlatformId}
        onSelectPlatform={handleSelectPlatform}
        anchorRect={anchorRect}
      />
    </>
  );
});

SocialNetworkWidget.displayName = 'SocialNetworkWidget';
