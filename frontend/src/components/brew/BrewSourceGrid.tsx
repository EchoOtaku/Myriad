/**
 * Brew 订阅源网格组件
 * 设计参考 TappCard / UnifiedAppCard 风格
 * 
 * 功能整合：
 * - 订阅源卡片展示
 * - 内置管理工具（搜索、批量选择、编辑、删除）
 * - 浮动操作栏
 * 
 * 性能优化：
 * - 接入统一动画调度器 (useBrewCardStagger)
 * - React.memo + 自定义比较函数避免不必要的重渲染
 * - useMemo/useCallback 缓存计算结果和回调
 * - 根据动画级别自动降级（禁用/简化动画）
 * - 图片懒加载
 */

import React, { useState, forwardRef, useMemo, useCallback, memo, useEffect, useRef } from 'react';
import { 
  RefreshCw, 
  ExternalLink, 
  Rss, 
  Search,
  Edit3,
  Sparkles,
} from 'lucide-react';
import type { BrewSource, CardSize, SourceType } from '../../types/brew';
import * as brewApi from '../../services/brewApi';
import { extractColorsFromLoadedImage } from '../../utils/colorExtractor';
import { useBrewCardStagger } from '../../hooks/animation/pages/brew';
import { useI18n } from '../../contexts/I18nContext';
import type { TranslationKeys } from '../../i18n';

// 管理组件
import EditModal from './manager/EditModal';
import ControlIsland, { type SortMode } from './manager/ControlIsland';

// API URL
const API_URL = import.meta.env.PUBLIC_API_URL || '';

// 处理图标 URL - 如果是外部 URL 则通过代理访问
const getIconUrl = (iconUrl: string | null): string | null => {
  if (!iconUrl) return null;
  // 已经是本地路径，直接使用
  if (iconUrl.startsWith('/api/')) {
    return `${API_URL}${iconUrl}`;
  }
  // 外部 URL，使用图片代理
  if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return `${API_URL}/api/proxy/image?url=${encodeURIComponent(iconUrl)}`;
  }
  return iconUrl;
};

interface BrewSourceGridProps {
  sources: BrewSource[];
  category?: string;  // 分类筛选
  onSourceClick: (source: BrewSource) => void;
  onRefreshSource: (sourceId: number) => void;
  onSourceUpdate?: (source: BrewSource) => void;
  onSourcesChange?: () => void;
  onAddSource?: (url: string, name?: string, category?: string, icon?: string, sourceType?: SourceType) => Promise<void>;
  isAuthenticated?: boolean;  // 是否已登录（用于已读状态等普通用户功能）
  isAdmin?: boolean;  // 是否是管理员（用于添加、编辑、删除等管理功能）
}

// 默认主题色（用于无图标或提取失败的情况）
const DEFAULT_THEME_COLOR = '#6b7280';

// 获取源的主题色 - 优先使用数据库中存储的 theme_color
const getSourceColor = (source: BrewSource): string => {
  // 优先使用从图标提取并存储的颜色
  if (source.theme_color) {
    return source.theme_color;
  }
  // 回退到默认色
  return DEFAULT_THEME_COLOR;
};

// 获取 Feed 类型标签
const getFeedTypeLabel = (type: string, t: TranslationKeys): string => {
  switch (type) {
    case 'atom': return t.brew.feedTypeAtom;
    case 'json_feed': return t.brew.feedTypeJson;
    case 'rss': return t.brew.feedTypeRss;
    default: return type.toUpperCase();
  }
};

// 获取来源类型标签和提示（source_type）
const getSourceTypeInfo = (sourceType: SourceType, t: TranslationKeys): { label: string; tooltip: string; isBrewlia: boolean } => {
  switch (sourceType) {
    case 'brewlia':
      return { 
        label: 'Brewlia AI', 
        tooltip: t.brew.feedTypeBrewliaDesc,
        isBrewlia: true 
      };
    case 'link':
      return { 
        label: t.brew.feedTypeLink, 
        tooltip: t.brew.feedTypeLinkDesc,
        isBrewlia: false 
      };
    case 'rss':
    default:
      return { 
        label: '', 
        tooltip: t.brew.feedTypeRssDesc,
        isBrewlia: false 
      };
  }
};

// 格式化时间
const formatTime = (timestamp: number | null, t: TranslationKeys): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return t.brew.justNow;
  if (diff < 3600000) return t.brew.minutesAgo.replace('{minutes}', String(Math.floor(diff / 60000)));
  if (diff < 86400000) return t.brew.hoursAgo.replace('{hours}', String(Math.floor(diff / 3600000)));
  if (diff < 604800000) return t.brew.daysAgo.replace('{days}', String(Math.floor(diff / 86400000)));
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

// 清理 HTML 标签
const stripHtml = (html: string | null): string => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
};

// 单个订阅源卡片
interface SourceCardProps {
  source: BrewSource;
  index: number;
  onSourceClick: (source: BrewSource) => void;
  onRefreshSource: (sourceId: number) => void;
  onThemeColorExtracted?: (sourceId: number, color: string) => void;
  // 编辑模式
  isEditMode?: boolean;
  isSelected?: boolean;
  isDeleting?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  // 尺寸调整
  onResizeStart?: (e: React.MouseEvent | React.TouchEvent, sourceId: number) => void;
  previewSize?: CardSize;  // 拖拽调整尺寸时的预览尺寸
  // 拖拽排序
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.MouseEvent | React.TouchEvent, sourceId: number) => void;
  sortMode?: SortMode;
}

const SourceCard = memo(forwardRef<HTMLDivElement, SourceCardProps>(({
  source,
  index,
  onSourceClick,
  onRefreshSource,
  onThemeColorExtracted,
  isEditMode = false,
  isSelected = false,
  isDeleting = false,
  onEdit,
  onDelete,
  onResizeStart,
  previewSize,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  sortMode,
}, ref) => {
  const [isHovered, setIsHovered] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useI18n();

  // 接入动画调度器 - 使用调度器提供的样式
  const { canAnimate, delay, onComplete, animConfig, initialStyle, animateStyle } = useBrewCardStagger(index, 'source');

  // 根据动画级别决定是否启用悬浮效果
  const enableHover = animConfig.level !== 'none';

  const color = getSourceColor(source);
  const hasUnread = source.unread_count > 0;
  const recentItems = source.recent_items || [];
  // 如果正在调整尺寸，使用预览尺寸；否则使用实际尺寸
  // 纯链接类型强制使用 tiny 尺寸
  const size: CardSize = source.source_type === 'link' 
    ? 'tiny' 
    : (previewSize || source.card_size || 'mini');

  // 图标加载后提取颜色
  const handleIconLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    if (source.theme_color || !source.icon) return;
    
    try {
      const img = e.currentTarget;
      const palette = extractColorsFromLoadedImage(img);
      if (palette.primary && palette.primary !== DEFAULT_THEME_COLOR && palette.primary !== '#6b7280') {
        onThemeColorExtracted?.(source.id, palette.primary);
      }
    } catch (err) {
      console.debug('[BrewSourceGrid] Failed to extract icon color:', err);
    }
  }, [source.id, source.theme_color, source.icon, onThemeColorExtracted]);

  // 刷新处理 - 缓存回调
  const handleRefresh = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await onRefreshSource(source.id);
    } finally {
      setRefreshing(false);
    }
  }, [source.id, onRefreshSource]);

  // 点击卡片处理 - 链接类型直接跳转（非编辑模式），其他类型进入文章列表
  const handleCardClick = useCallback(() => {
    // 纯链接类型且非编辑模式：直接在新窗口打开链接
    if (source.source_type === 'link' && !isEditMode) {
      const targetUrl = source.site_url || source.url;
      if (targetUrl) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    // 其他情况：调用 onSourceClick（编辑模式下为选中切换，非编辑模式为进入文章列表）
    onSourceClick(source);
  }, [source, onSourceClick, isEditMode]);

  // 鼠标事件 - 缓存回调
  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  // 获取 row-span 样式（基础行高 1.5rem = 24px）
  const rowSpan = useMemo(() => {
    switch (size) {
      case 'full': return 8;   // 8 × 24px = 192px (保持原4行高度)
      case 'mini': return 4;   // 4 × 24px = 96px (保持原2行高度)
      case 'tiny': return 2;   // 2 × 24px = 48px (1行)
    }
  }, [size]);

  // 合并 ref（forwarded ref 用于 FLIP 动画记录位置）
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (typeof ref === 'function') {
      ref(el);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
  }, [ref]);

  // 通知调度器动画完成
  useEffect(() => {
    if (canAnimate) {
      onComplete?.();
    }
  }, [canAnimate, onComplete]);

  // 处理编辑点击
  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  }, [onEdit]);

  // 处理删除点击
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  }, [onDelete]);

  // 处理拉伸开始
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onResizeStart?.(e, source.id);
  }, [source.id, onResizeStart]);

  // 处理拖拽开始
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDragStart?.(e, source.id);
  }, [source.id, onDragStart]);

  // 是否显示拖拽手柄（编辑模式 + 自由排序模式下显示）
  const showDragHandle = isEditMode && sortMode === 'custom';

  // 计算卡片样式 - 简化以提升 WebKit 性能
  // 只计算必要的样式，避免每次渲染创建复杂对象
  const cardStyle = useMemo<React.CSSProperties>(() => {
    // 基础样式
    const base: React.CSSProperties = {
      gridRow: `span ${rowSpan}`,
    };

    // 拖拽状态 - 使用简单的 transform
    if (isDragging) {
      return {
        ...base,
        transform: 'scale(1.02)',
        opacity: 0.9,
        zIndex: 100,
      };
    }

    // 拖拽悬停状态
    if (isDragOver) {
      return {
        ...base,
        transform: 'scale(0.98)',
        opacity: 0.85,
        zIndex: 50,
      };
    }

    // 选中状态
    if (isSelected) {
      return {
        ...base,
        ...animateStyle,
        boxShadow: `inset 0 0 0 2px ${color}`,
      };
    }

    // 默认状态 - 使用调度器提供的入场动画样式
    return {
      ...base,
      ...animateStyle,
    };
  }, [rowSpan, isDragging, isDragOver, isSelected, color, animateStyle]);

  // 悬停过渡类名 - 简化，仅在非拖拽状态启用
  const hoverClasses = useMemo(() => {
    if (!enableHover || isDragging || isDragOver) return '';
    // WebKit 优化：移除 scale，只使用 translate，减少 GPU 负担
    return 'hover:-translate-y-px';
  }, [enableHover, isDragging, isDragOver]);

  // 尺寸相关的样式类
  const sizeClasses = useMemo(() => {
    // tiny: 48px, mini: 96px, full: 192px
    const paddingMap = { tiny: 'p-2.5 px-3.5', mini: 'p-4', full: 'p-5' };
    const roundedMap = { tiny: 'rounded-xl', mini: 'rounded-xl', full: 'rounded-2xl' };
    return {
      padding: paddingMap[size],
      rounded: roundedMap[size],
    };
  }, [size]);

  // WebKit 性能优化：移除内容区 transition，只在必要时使用
  // transition-all 在 Safari 上会导致严重性能问题
  const contentTransition = '';

  // ===== 统一卡片结构 - WebKit 性能优化版本 =====
  return (
    <div
      ref={setRef}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`group relative ${sizeClasses.rounded} overflow-hidden bg-white/90 dark:bg-neutral-900/90 cursor-pointer ${isDeleting ? 'opacity-50 pointer-events-none' : ''} ${hoverClasses}`}
      style={cardStyle}
    >

      {/* 拖拽手柄 - 编辑模式 + 自由排序模式 */}
      {showDragHandle && (
        <div
          className={`absolute left-0 right-0 top-0 ${size === 'tiny' ? 'h-6' : size === 'mini' ? 'h-8' : 'h-10'} flex items-center justify-center cursor-grab active:cursor-grabbing z-10 opacity-0 group-hover:opacity-100 touch-none`}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="flex items-center gap-[3px] px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10">
            <div className={`${size === 'full' ? 'w-[5px] h-[5px]' : 'w-[3px] h-[3px]'} rounded-full bg-gray-400/80`} />
            <div className={`${size === 'full' ? 'w-[5px] h-[5px]' : 'w-[3px] h-[3px]'} rounded-full bg-gray-400/80`} />
            <div className={`${size === 'full' ? 'w-[5px] h-[5px]' : 'w-[3px] h-[3px]'} rounded-full bg-gray-400/80`} />
          </div>
        </div>
      )}

      {/* 背景光效 - 简化，移除 transition */}
      <div
        className={`absolute inset-0 ${isHovered ? 'opacity-[0.12]' : 'opacity-[0.06]'}`}
        style={{ background: `linear-gradient(135deg, ${color}, transparent 65%)` }}
      />

      {/* 装饰光效 - 右上 (mini/full) - 简化 */}
      {size !== 'tiny' && (
        <div
          className={`absolute -right-4 -top-4 w-16 h-16 rounded-full blur-2xl ${
            hasUnread ? 'opacity-20' : 'opacity-10'
          }`}
          style={{ background: `linear-gradient(135deg, ${color}, transparent 70%)` }}
        />
      )}

      {/* 装饰光效 - 左下 (full only) - 简化 */}
      {size === 'full' && (
        <div
          className="absolute -left-6 -bottom-6 w-16 h-16 rounded-full blur-xl opacity-10"
          style={{ background: `radial-gradient(circle, ${color}, transparent 60%)` }}
        />
      )}

      {/* 主内容区域 */}
      <div className={`absolute inset-0 ${sizeClasses.padding} flex flex-col ${contentTransition}`}>
        
        {/* 顶部：图标 + 名称 + 元信息 */}
        <div className={`flex items-center gap-3 flex-shrink-0 ${contentTransition}`}>
          {/* 图标 */}
          <div className={`${size === 'tiny' ? 'w-10 h-10' : size === 'mini' ? 'w-9 h-9' : 'w-11 h-11'} rounded-xl flex items-center justify-center relative overflow-hidden flex-shrink-0 ${contentTransition}`}>
            {source.icon ? (
              <img
                src={getIconUrl(source.icon) || ''}
                alt=""
                crossOrigin="anonymous"
                className={`${size === 'tiny' ? 'w-9 h-9' : size === 'mini' ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg object-cover ${contentTransition}`}
                loading="lazy"
                decoding="async"
                onLoad={handleIconLoad}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div 
                className="w-full h-full rounded-xl flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)` }}
              >
                <Rss className={`${size === 'full' ? 'w-5 h-5' : 'w-4 h-4'} text-white`} />
              </div>
            )}
          </div>

          {/* 名称 + 元信息 */}
          <div className="flex-1 min-w-0">
            {/* 第一行：名称 + 未读指示 */}
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-gray-800 dark:text-gray-100 truncate leading-none ${size === 'full' ? 'text-[17px]' : 'text-[15px]'} ${contentTransition}`}>
                {source.name}
              </h3>
              {hasUnread && (
                <span 
                  className={`${size === 'full' ? 'w-2.5 h-2.5' : 'w-2 h-2'} rounded-full flex-shrink-0 ${size === 'tiny' ? 'animate-pulse' : ''}`} 
                  style={{ backgroundColor: color }} 
                />
              )}
            </div>
            {/* 第二行：标签 + 统计 */}
            <div className={`flex items-center gap-2 mt-1 ${contentTransition}`}>
              {/* Feed 类型标签（RSS/Atom/JSON）+ 来源类型提示 */}
              {(() => {
                const sourceInfo = getSourceTypeInfo(source.source_type, t);
                const feedLabel = source.source_type === 'link' ? t.brew.feedTypeLink : getFeedTypeLabel(source.feed_type, t);
                const tooltip = sourceInfo.isBrewlia 
                  ? `${getFeedTypeLabel(source.feed_type, t)} · ${sourceInfo.tooltip}`
                  : sourceInfo.tooltip;
                return (
                  <span 
                    className={`${size === 'full' ? 'text-[12px] px-2.5 py-1 rounded-md' : 'text-[10px] px-1.5 py-0.5 rounded'} font-medium leading-none cursor-help flex items-center gap-1`}
                    style={{ background: `${color}15`, color: color }}
                    title={tooltip}
                  >
                    {sourceInfo.isBrewlia && (
                      <Sparkles className={`${size === 'full' ? 'w-3 h-3' : 'w-2.5 h-2.5'}`} />
                    )}
                    {sourceInfo.isBrewlia ? 'Brewlia' : feedLabel}
                  </span>
                );
              })()}
              {/* 纯链接类型不显示篇数信息 */}
              {source.source_type !== 'link' && (
                <span className={`${size === 'full' ? 'text-[13px]' : 'text-[11px]'} leading-none`}>
                  {hasUnread ? (
                    <>
                      <span style={{ color }} className="font-medium">{source.unread_count}</span>
                      <span className="text-gray-400 dark:text-gray-500">/{t.brew.articlesCount.replace('{count}', String(source.item_count))}</span>
                    </>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">{t.brew.articlesCount.replace('{count}', String(source.item_count))}</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* AI 风格标签 - 非编辑模式显示在右侧 */}
          {!isEditMode && size !== 'tiny' && source.ai_style_tags && source.ai_style_tags.length > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {source.ai_style_tags.slice(0, 2).map((tag, idx) => (
                <span
                  key={idx}
                  className={`${size === 'full' ? 'text-[12px] px-2.5 py-1 rounded-md' : 'text-[10px] px-1.5 py-0.5 rounded'} font-medium leading-none`}
                  style={{ background: `${color}15`, color: color }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 操作按钮 - 仅编辑模式显示 */}
          {isEditMode && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={handleEdit}
                className={`${size === 'tiny' ? 'p-1' : 'p-1.5'} rounded-lg transition-all duration-200 ease-out text-gray-400 hover:text-blue-500 hover:bg-blue-500/10`}
                title={t.brew.editSubscription}
                aria-label={t.brew.editSubscription}
              >
                <Edit3 className={`${size === 'tiny' ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
              </button>
              <button
                onClick={handleRefresh}
                className={`${size === 'tiny' ? 'p-1' : 'p-1.5'} rounded-lg transition-all duration-200 ease-out text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-500/10`}
                title={t.brew.refreshSubscription}
                aria-label={t.brew.refreshSubscription}
                disabled={refreshing}
              >
                <RefreshCw className={`${size === 'tiny' ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              {size === 'full' && source.site_url && (
                <a
                  href={source.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-lg transition-all duration-200 ease-out text-gray-400 hover:text-blue-500 hover:bg-blue-500/10"
                  title={t.brew.visitWebsite}
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* 文章预览区域 - mini/full 尺寸显示 */}
        <div 
          className={`flex-1 mt-2 flex flex-col overflow-hidden min-h-0 ${contentTransition} ${
            size === 'tiny' 
              ? 'opacity-0 max-h-0 mt-0 pointer-events-none' 
              : 'opacity-100 max-h-[500px]'
          }`}
        >
          {recentItems.length > 0 ? (
            <>
              {/* 最新文章预览 */}
              <div className={`flex-1 ${size === 'mini' ? 'px-3 py-2.5 min-h-[44px]' : 'p-4'} rounded-xl bg-black/[0.03] dark:bg-white/[0.04] flex overflow-hidden ${contentTransition}`}>
                {/* 封面图 (full only) */}
                {size === 'full' && recentItems[0].image && (
                  <div className="w-24 h-full flex-shrink-0 mr-4 rounded-lg overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img
                      src={recentItems[0].image.startsWith('http') 
                        ? `${API_URL}/api/proxy/image?url=${encodeURIComponent(recentItems[0].image)}`
                        : recentItems[0].image
                      }
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                    />
                  </div>
                )}
                {/* 文章内容 */}
                <div className="flex items-start gap-2 flex-1 min-w-0 min-h-0">
                  {!recentItems[0].is_read && (
                    <span className={`${size === 'full' ? 'w-2.5 h-2.5 mt-1' : 'w-1.5 h-1.5 mt-[5px]'} rounded-full shrink-0`} style={{ backgroundColor: color }} />
                  )}
                  <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
                    {/* mini: 标题+摘要紧凑布局 */}
                    {size === 'mini' ? (
                      <>
                        <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300 truncate leading-snug">
                          {recentItems[0].title}
                        </p>
                        {recentItems[0].summary && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5 leading-snug">
                            {stripHtml(recentItems[0].summary)}
                          </p>
                        )}
                      </>
                    ) : (
                      /* full: 标题+时间+摘要 */
                      <>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className="text-[15px] font-semibold text-gray-700 dark:text-gray-300 truncate leading-tight flex-1 min-w-0">
                            {recentItems[0].title}
                          </p>
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {formatTime(recentItems[0].published_at, t)}
                          </span>
                        </div>
                        {recentItems[0].summary && (
                          <p className={`text-[13px] text-gray-500 dark:text-gray-400 ${recentItems[0].image ? 'line-clamp-2' : 'line-clamp-3'} mt-1 leading-relaxed overflow-hidden`}>
                            {stripHtml(recentItems[0].summary)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 次新文章列表 (full only) */}
              <div 
                className={`flex flex-col justify-evenly overflow-hidden ${contentTransition} ${
                  size === 'full' 
                    ? 'flex-1 min-h-0 mt-2.5 opacity-100 max-h-[200px]' 
                    : 'flex-none h-0 mt-0 opacity-0 pointer-events-none'
                }`}
              >
                {recentItems.slice(1, 4).map((item, idx) => (
                  <div 
                    key={item.id || idx}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
                      !isEditMode ? 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]' : ''
                    }`}
                  >
                    {!item.is_read && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.7 }} />
                    )}
                    <span className="text-[14px] text-gray-600 dark:text-gray-400 truncate flex-1">
                      {item.title}
                    </span>
                    <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">
                      {formatTime(item.published_at, t)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* 无文章时 */
            <div className={`flex-1 ${size === 'mini' ? 'p-3' : 'p-4'} rounded-xl bg-black/[0.03] dark:bg-white/[0.04] flex items-start overflow-hidden`}>
              {source.description && size === 'full' ? (
                <p className="text-[14px] text-gray-500 dark:text-gray-400 line-clamp-6 leading-relaxed">
                  {source.description}
                </p>
              ) : (
                <div className="flex items-center gap-2 text-[13px] text-gray-400 dark:text-gray-500">
                  <Rss className="w-4 h-4" />
                  <span>{t.brew.noArticles}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 编辑模式 - 右下角拉伸条（链接类型不显示，固定 tiny 尺寸） */}
      {isEditMode && source.source_type !== 'link' && (
        <div
          className={`absolute bottom-0 right-0 ${size === 'tiny' ? 'w-10 h-10 p-1.5' : size === 'mini' ? 'w-12 h-12 p-2' : 'w-14 h-14 p-2.5'} cursor-se-resize z-50 flex items-end justify-end touch-none group/resize`}
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
        >
          <div 
            className={`${size === 'tiny' ? 'w-4 h-4 border-b-[4px] border-r-[4px] rounded-br-lg' : size === 'mini' ? 'w-5 h-5 border-b-[5px] border-r-[5px] rounded-br-lg' : 'w-6 h-6 border-b-[6px] border-r-[6px] rounded-br-xl'} opacity-50 group-hover/resize:opacity-100 transition-opacity duration-200`}
            style={{ borderColor: color }}
          />
        </div>
      )}

      {/* 边框 - 简化 */}
      <div className={`absolute inset-0 ${sizeClasses.rounded} ring-1 ring-inset ring-black/5 dark:ring-white/10 pointer-events-none`} />

      {/* 悬浮高光边框 - WebKit 优化：移除 transition */}
      {isHovered && (
        <div
          className={`absolute inset-0 ${sizeClasses.rounded} pointer-events-none`}
          style={{ boxShadow: `inset 0 0 0 1px ${color}40` }}
        />
      )}
    </div>
  );
}), (prevProps, nextProps) => {
  // 自定义比较：只在关键属性变化时重渲染
  // 检查 recent_items 的 is_read 状态
  const prevItems = prevProps.source.recent_items;
  const nextItems = nextProps.source.recent_items;
  const recentItemsEqual = 
    (prevItems?.length ?? 0) === (nextItems?.length ?? 0) &&
    (prevItems?.every((item, i) => 
      item.id === nextItems?.[i]?.id && 
      item.is_read === nextItems?.[i]?.is_read
    ) ?? true);
  
  return (
    prevProps.source.id === nextProps.source.id &&
    prevProps.source.card_size === nextProps.source.card_size &&
    prevProps.source.theme_color === nextProps.source.theme_color &&
    prevProps.source.unread_count === nextProps.source.unread_count &&
    prevProps.source.item_count === nextProps.source.item_count &&
    prevProps.source.name === nextProps.source.name &&
    prevProps.index === nextProps.index &&
    prevProps.isEditMode === nextProps.isEditMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isDeleting === nextProps.isDeleting &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.isDragOver === nextProps.isDragOver &&
    prevProps.sortMode === nextProps.sortMode &&
    prevProps.previewSize === nextProps.previewSize &&
    prevProps.onSourceClick === nextProps.onSourceClick &&
    recentItemsEqual
  );
});

SourceCard.displayName = 'SourceCard';

export default function BrewSourceGrid({
  sources,
  category,
  onSourceClick,
  onRefreshSource,
  onSourceUpdate,
  onSourcesChange,
  onAddSource,
  isAuthenticated = false,  // 默认游客模式（用于已读状态）
  isAdmin = false,  // 默认非管理员（用于管理功能）
}: BrewSourceGridProps) {
  const { t } = useI18n();
  // 管理功能状态（仅登录用户可用）
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingSource, setEditingSource] = useState<BrewSource | null>(null);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // 排序状态
  const [sortMode, setSortMode] = useState<SortMode>('custom'); // 默认自由排序
  const [customOrder, setCustomOrder] = useState<number[]>([]); // 自由排序的顺序
  const [randomSeed, setRandomSeed] = useState(Date.now()); // 随机排序种子

  // 拖拽排序状态（仅登录用户可用）
  const [draggingSourceId, setDraggingSourceId] = useState<number | null>(null);
  const [dragOverSourceId, setDragOverSourceId] = useState<number | null>(null);
  const cardRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // FLIP 动画：存储卡片位置快照
  const cardRectsRef = useRef<Map<number, DOMRect>>(new Map());
  const flipAnimationsRef = useRef<Map<number, Animation>>(new Map());
  
  // 记录所有卡片的当前位置（在排序变化前调用）
  const recordCardPositions = useCallback(() => {
    cardRectsRef.current.clear();
    cardRefsRef.current.forEach((el, id) => {
      cardRectsRef.current.set(id, el.getBoundingClientRect());
    });
  }, []);
  
  // 播放 FLIP 动画（在排序变化后调用）- 支持位置和尺寸变化
  const playFlipAnimations = useCallback(() => {
    // 取消所有正在进行的动画
    flipAnimationsRef.current.forEach(anim => anim.cancel());
    flipAnimationsRef.current.clear();
    
    // 用 requestAnimationFrame 确保 DOM 已更新
    requestAnimationFrame(() => {
      cardRefsRef.current.forEach((el, id) => {
        const firstRect = cardRectsRef.current.get(id);
        if (!firstRect) return;
        
        const lastRect = el.getBoundingClientRect();
        
        // 计算位移差
        const deltaX = firstRect.left - lastRect.left;
        const deltaY = firstRect.top - lastRect.top;
        
        // 计算尺寸比例差（FLIP 的核心：用 scale 模拟尺寸变化）
        const scaleX = firstRect.width / lastRect.width;
        const scaleY = firstRect.height / lastRect.height;
        
        // 检查是否有位置或尺寸变化
        const hasPositionChange = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;
        const hasSizeChange = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
        
        if (!hasPositionChange && !hasSizeChange) {
          return;
        }
        
        // 使用 Web Animations API 执行流畅动画
        // transformOrigin 设为 top left 确保缩放从正确的位置开始
        const animation = el.animate(
          [
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
            },
            {
              transform: 'translate(0, 0) scale(1, 1)',
              transformOrigin: 'top left',
            },
          ],
          {
            duration: 650,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)', // 更优雅的缓动曲线
            fill: 'none',
          }
        );
        
        flipAnimationsRef.current.set(id, animation);
        
        animation.onfinish = () => {
          flipAnimationsRef.current.delete(id);
        };
      });
    });
  }, []);

  // 获取所有分类（用于编辑弹窗）- 支持多分类
  const categories = useMemo(() => {
    const cats = new Set<string>();
    sources.forEach(s => {
      if (s.category) {
        // 解析逗号分隔的多分类
        s.category.split(',').forEach(c => {
          const trimmed = c.trim();
          if (trimmed) cats.add(trimmed);
        });
      }
    });
    return Array.from(cats);
  }, [sources]);

  // 根据分类和搜索筛选源
  const filteredSources = useMemo(() => {
    let result = sources;
    if (category) {
      // 支持多分类：检查 category 字段是否包含目标分类（用逗号分隔）
      result = result.filter(s => {
        if (!s.category) return false;
        const cats = s.category.split(',').map(c => c.trim());
        return cats.includes(category);
      });
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.url.toLowerCase().includes(query) ||
        (s.description?.toLowerCase().includes(query))
      );
    }
    return result;
  }, [sources, category, searchQuery]);

  // 初始化自定义排序顺序（从数据库加载或默认）
  useEffect(() => {
    if (customOrder.length === 0 && filteredSources.length > 0) {
      // 检查是否有已保存的 sort_order
      const sourcesWithOrder = filteredSources.filter(s => s.sort_order !== null && s.sort_order !== undefined);
      
      if (sourcesWithOrder.length > 0) {
        // 按 sort_order 排序，然后提取 id 作为 customOrder
        const sortedByOrder = [...filteredSources].sort((a, b) => {
          const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
        setCustomOrder(sortedByOrder.map(s => s.id));
      } else {
        // 没有保存的排序，使用默认顺序
        setCustomOrder(filteredSources.map(s => s.id));
      }
    }
  }, [filteredSources, customOrder.length]);

  // 排序后的源列表
  const sortedSources = useMemo(() => {
    const result = [...filteredSources];
    
    switch (sortMode) {
      case 'update':
        // 按最新文章发布时间排序（最新的在前）
        return result.sort((a, b) => {
          // 获取每个订阅源最新文章的发布时间
          const latestA = a.recent_items?.[0]?.published_at || a.last_fetched_at || 0;
          const latestB = b.recent_items?.[0]?.published_at || b.last_fetched_at || 0;
          return latestB - latestA;
        });
        
      case 'custom':
        // 按自定义顺序排序
        if (customOrder.length === 0) {
          return result; // 如果没有自定义顺序，保持原样
        }
        return result.sort((a, b) => {
          const indexA = customOrder.indexOf(a.id);
          const indexB = customOrder.indexOf(b.id);
          // 如果不在自定义顺序中，放到最后
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          return indexA - indexB;
        });
        
      case 'category':
        // 按分类排序（同分类内按名称排序）
        // 预置分类（友情链接、我）在排序时被忽略，取主分类进行排序
        const presetCats = ['友情链接', '我'];
        const getMainCategory = (cat: string | null): string => {
          if (!cat) return '';
          const cats = cat.split(',').map(c => c.trim()).filter(Boolean);
          // 过滤掉预置分类，取第一个非预置分类
          const mainCat = cats.find(c => !presetCats.includes(c));
          return mainCat || cats[0] || '';
        };
        return result.sort((a, b) => {
          const catA = getMainCategory(a.category);
          const catB = getMainCategory(b.category);
          if (catA !== catB) {
            return catA.localeCompare(catB, 'zh-CN');
          }
          return a.name.localeCompare(b.name, 'zh-CN');
        });
        
      case 'random':
        // 随机排序（使用种子确保同一会话内稳定）
        return result.sort((a, b) => {
          const hashA = (a.id * randomSeed) % 1000;
          const hashB = (b.id * randomSeed) % 1000;
          return hashA - hashB;
        });
        
      case 'pinyin':
        // 按拼音排序（使用 localeCompare）
        return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        
      default:
        return result;
    }
  }, [filteredSources, sortMode, customOrder, randomSeed]);

  // 分类排序时的分类标题生成
  const presetCatsForRender = ['友情链接', '我'];
  const getMainCategoryForRender = (cat: string | null): string => {
    if (!cat) return '未分类';
    const cats = cat.split(',').map(c => c.trim()).filter(Boolean);
    const mainCat = cats.find(c => !presetCatsForRender.includes(c));
    return mainCat || '未分类';
  };

  // 切换排序模式时的处理 - 带 FLIP 动画
  const handleSortModeChange = useCallback((mode: SortMode) => {
    // 1. 记录当前所有卡片的位置
    recordCardPositions();
    
    // 2. 更新排序模式（触发重排序）
    setSortMode(mode);
    
    // 如果切换到随机排序，更新种子
    if (mode === 'random') {
      setRandomSeed(Date.now());
    }
    // 如果切换到自由排序，初始化顺序
    if (mode === 'custom' && customOrder.length === 0) {
      // 优先按已保存的 sort_order 排序
      const sourcesWithOrder = filteredSources.filter(s => s.sort_order !== null && s.sort_order !== undefined);
      if (sourcesWithOrder.length > 0) {
        const sortedByOrder = [...filteredSources].sort((a, b) => {
          const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
        setCustomOrder(sortedByOrder.map(s => s.id));
      } else {
        setCustomOrder(filteredSources.map(s => s.id));
      }
    }
    
    // 3. 下一帧播放 FLIP 动画
    // 使用 setTimeout 确保 React 已经完成 DOM 更新
    setTimeout(() => {
      playFlipAnimations();
    }, 0);
  }, [filteredSources, customOrder.length, recordCardPositions, playFlipAnimations]);

  // 拖拽排序 - 开始拖拽（仅编辑模式 + 自由排序模式）
  const handleCardDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, sourceId: number) => {
    if (!isEditMode || sortMode !== 'custom') return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    dragStartPosRef.current = { x: clientX, y: clientY };
    setDraggingSourceId(sourceId);
  }, [isEditMode, sortMode]);

  // 拖拽排序 - 移动和结束
  useEffect(() => {
    if (draggingSourceId === null) return;

    let rafId: number | null = null;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (rafId !== null) return;
      
      rafId = requestAnimationFrame(() => {
        rafId = null;
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        // 遍历卡片，找到鼠标下的卡片
        let targetId: number | null = null;
        cardRefsRef.current.forEach((element, id) => {
          if (id === draggingSourceId) return;
          const rect = element.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            targetId = id;
          }
        });
        
        setDragOverSourceId(targetId);
      });
    };

    const handleEnd = async () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      
      // 如果有目标卡片，交换两者位置（1对1交换）
      if (dragOverSourceId !== null && draggingSourceId !== null) {
        let newFromIndex = -1;
        let newToIndex = -1;
        
        // 记录当前位置用于 FLIP 动画
        recordCardPositions();
        
        setCustomOrder(prev => {
          const newOrder = [...prev];
          const fromIndex = newOrder.indexOf(draggingSourceId);
          const toIndex = newOrder.indexOf(dragOverSourceId);
          
          if (fromIndex !== -1 && toIndex !== -1) {
            // 1对1位置交换
            newOrder[fromIndex] = dragOverSourceId;
            newOrder[toIndex] = draggingSourceId;
            newFromIndex = fromIndex;
            newToIndex = toIndex;
          }
          
          return newOrder;
        });
        
        // 播放 FLIP 动画
        setTimeout(() => playFlipAnimations(), 0);
        
        // 保存交换后的排序到数据库
        if (newFromIndex !== -1 && newToIndex !== -1) {
          try {
            await Promise.all([
              brewApi.updateSource(draggingSourceId, { sort_order: newToIndex }),
              brewApi.updateSource(dragOverSourceId, { sort_order: newFromIndex }),
            ]);
          } catch (err) {
            console.error('Failed to save sort order:', err);
          }
        }
      }
      
      setDraggingSourceId(null);
      setDragOverSourceId(null);
      dragStartPosRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [draggingSourceId, dragOverSourceId, recordCardPositions, playFlipAnimations]);

  // 保存卡片ref
  const setCardRef = useCallback((id: number, element: HTMLDivElement | null) => {
    if (element) {
      cardRefsRef.current.set(id, element);
    } else {
      cardRefsRef.current.delete(id);
    }
  }, []);

  // 图标颜色提取后保存到数据库
  const handleThemeColorExtracted = useCallback(async (sourceId: number, color: string) => {
    try {
      const updatedSource = await brewApi.updateSource(sourceId, { theme_color: color });
      // 通知父组件更新
      if (onSourceUpdate) {
        onSourceUpdate(updatedSource);
      }
      console.debug('[BrewSourceGrid] Theme color saved:', sourceId, color);
    } catch (err) {
      console.error('Failed to save theme color:', err);
    }
  }, [onSourceUpdate]);

  // 处理选择切换
  const handleToggleSelect = useCallback((sourceId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  }, []);

  // 全选/取消全选
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredSources.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSources.map(s => s.id)));
    }
  }, [filteredSources, selectedIds.size]);

  // 进入编辑模式
  const handleEnterEditMode = useCallback(() => {
    setIsEditMode(true);
  }, []);

  // 退出编辑模式
  const handleExitEditMode = useCallback(() => {
    setIsEditMode(false);
    setSelectedIds(new Set());
  }, []);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    setDeletingIds(ids);
    setIsDeleting(true);
    
    try {
      await Promise.all(ids.map(id => brewApi.deleteSource(id)));
      setSelectedIds(new Set());
      onSourcesChange?.();
    } catch (err) {
      console.error('Failed to delete sources:', err);
    } finally {
      setDeletingIds([]);
      setIsDeleting(false);
    }
  }, [selectedIds, onSourcesChange]);

  // 批量刷新全部订阅
  const handleBatchRefresh = useCallback(async () => {
    if (filteredSources.length === 0) return;
    
    setIsRefreshing(true);
    
    try {
      // 并行刷新所有订阅源
      await Promise.all(filteredSources.map(source => onRefreshSource(source.id)));
    } catch (err) {
      console.error('Failed to refresh sources:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [filteredSources, onRefreshSource]);

  // 全部订阅标记已读
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const handleMarkAllSourcesRead = useCallback(async () => {
    if (!isAuthenticated) return;
    
    setIsMarkingAllRead(true);
    try {
      // 按当前分类过滤
      await brewApi.markAllRead({ category: category || undefined });
      // 触发刷新
      onSourcesChange?.();
    } catch (err) {
      console.error('Failed to mark all sources read:', err);
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [isAuthenticated, category, onSourcesChange]);

  // Resize 状态
  const [resizingSource, setResizingSource] = useState<{
    sourceId: number;
    startY: number;
    startSize: CardSize;
    previewSize: CardSize;  // 预览尺寸（拖拽时显示）
  } | null>(null);

  // 尺寸阈值配置（基于拖动距离）
  const SIZE_ORDER: CardSize[] = ['tiny', 'mini', 'full'];
  const RESIZE_THRESHOLD = 100; // 每个尺寸变化需要的像素距离

  // 开始拖拽调整尺寸
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent, sourceId: number) => {
    if (!isEditMode) return;
    
    const source = sources.find(s => s.id === sourceId);
    if (!source) return;
    
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const currentSize = source.card_size || 'mini';
    
    setResizingSource({
      sourceId,
      startY: clientY,
      startSize: currentSize,
      previewSize: currentSize,
    });
  }, [isEditMode, sources]);

  // 尺寸对应的 row-span 高度（与 SourceCard 中一致）
  const SIZE_TO_ROWS: Record<CardSize, number> = {
    full: 8,   // 8 × 24px = 192px
    mini: 4,   // 4 × 24px = 96px
    tiny: 2,   // 2 × 24px = 48px
  };

  // 拖拽移动处理 - 更新预览尺寸并触发 FLIP 动画
  useEffect(() => {
    if (!resizingSource) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaY = clientY - resizingSource.startY;
      
      // 计算目标尺寸
      const startIndex = SIZE_ORDER.indexOf(resizingSource.startSize);
      const sizeChange = Math.round(deltaY / RESIZE_THRESHOLD);
      const targetIndex = Math.max(0, Math.min(SIZE_ORDER.length - 1, startIndex + sizeChange));
      const targetSize = SIZE_ORDER[targetIndex];
      
      // 尺寸变化时触发 FLIP 动画
      if (targetSize !== resizingSource.previewSize) {
        // 1. 记录当前位置（在 DOM 更新前）
        recordCardPositions();
        // 2. 更新预览尺寸（触发重渲染）
        setResizingSource(prev => prev ? { ...prev, previewSize: targetSize } : null);
        // 3. 双层 RAF 确保 React 渲染完成后再播放动画
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            playFlipAnimations();
          });
        });
      }
    };

    const handleEnd = async () => {
      if (!resizingSource) return;
      
      const source = sources.find(s => s.id === resizingSource.sourceId);
      const finalSize = resizingSource.previewSize;
      
      // 尺寸有变化时才更新
      if (source && finalSize !== resizingSource.startSize) {
        // 记录所有卡片位置用于 FLIP 动画
        recordCardPositions();
        
        // 更新数据
        const optimisticSource: BrewSource = { ...source, card_size: finalSize };
        onSourceUpdate?.(optimisticSource);
        
        // 播放 FLIP 动画
        setTimeout(() => playFlipAnimations(), 0);
        
        // 保存到数据库
        try {
          await brewApi.updateSource(source.id, { card_size: finalSize });
        } catch (err) {
          console.error('Failed to save card size:', err);
          // 失败时回滚
          const rollbackSource: BrewSource = { ...source, card_size: resizingSource.startSize };
          onSourceUpdate?.(rollbackSource);
        }
      }
      
      setResizingSource(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [resizingSource, sources, onSourceUpdate, recordCardPositions, playFlipAnimations]);

  // 处理编辑保存
  const handleEditSave = useCallback(async (id: number, data: {
    name?: string;
    category?: string;
    update_interval?: number;
    enabled?: boolean;
    icon?: string;
  }) => {
    // 如果更新了图标，同时清除主题色，让图标加载时重新提取
    const updateData = data.icon !== undefined 
      ? { ...data, theme_color: '' }  // 清除主题色
      : data;
    const updatedSource = await brewApi.updateSource(id, updateData);
    onSourceUpdate?.(updatedSource);
    onSourcesChange?.();
  }, [onSourceUpdate, onSourcesChange]);

  // 处理单个删除
  const handleDeleteSource = useCallback(async (sourceId: number) => {
    setDeletingIds([sourceId]);
    try {
      await brewApi.deleteSource(sourceId);
      onSourcesChange?.();
    } catch (err) {
      console.error('Failed to delete source:', err);
    } finally {
      setDeletingIds([]);
    }
  }, [onSourcesChange]);

  if (filteredSources.length === 0 && !searchQuery) {
    return (
      <div className="relative min-h-[60vh]">
        {/* 控制岛 - 放在内容顶部 */}
        <ControlIsland
          sources={sources}
          filteredSources={sortedSources}
          categories={categories}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedIds={selectedIds}
          onSelectAll={handleSelectAll}
          onBatchDelete={handleBatchDelete}
          onBatchRefresh={handleBatchRefresh}
          onMarkAllSourcesRead={handleMarkAllSourcesRead}
          onEnterEditMode={handleEnterEditMode}
          onExitEditMode={handleExitEditMode}
          isEditMode={isEditMode}
          isDeleting={isDeleting}
          isRefreshing={isRefreshing}
          onAddSource={onAddSource}
          onSourcesChange={onSourcesChange}
          sortMode={sortMode}
          onSortModeChange={handleSortModeChange}
          isSubCategory={!!category}
          isAdmin={isAdmin}
          isAuthenticated={isAuthenticated}
        />

        <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
          <div className="w-20 h-20 rounded-2xl bg-orange-500/10 flex items-center justify-center mb-4">
            <Rss className="w-10 h-10 text-orange-500/50" />
          </div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
            {category ? t.brew.emptyCategoryNoSources.replace('{category}', category) : t.brew.emptyNoSources}
          </p>
          <p className="text-sm mt-1 opacity-70">
            点击右下角的添加按钮开始订阅
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative pb-24 sm:pb-16">
      {/* 移动端控制岛 - 放在内容顶部 */}
      <ControlIsland
        sources={sources}
        filteredSources={sortedSources}
        categories={categories}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedIds={selectedIds}
        onSelectAll={handleSelectAll}
        onBatchDelete={handleBatchDelete}
        onBatchRefresh={handleBatchRefresh}
        onMarkAllSourcesRead={handleMarkAllSourcesRead}
        onEnterEditMode={handleEnterEditMode}
        onExitEditMode={handleExitEditMode}
        isEditMode={isEditMode}
        isDeleting={isDeleting}
        isRefreshing={isRefreshing}
        onAddSource={onAddSource}
        onSourcesChange={onSourcesChange}
        sortMode={sortMode}
        onSortModeChange={handleSortModeChange}
        isSubCategory={!!category}
        isAdmin={isAdmin}
        isAuthenticated={isAuthenticated}
      />

      {/* 空搜索结果 */}
      {filteredSources.length === 0 && searchQuery && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
          <Search className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
            未找到匹配的订阅源
          </p>
          <p className="text-sm mt-1 opacity-70">
            尝试其他关键词
          </p>
        </div>
      )}

      {/* 卡片网格 */}
      {sortedSources.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4" style={{ gridAutoRows: '1.5rem' }}>
          {sortedSources.map((source, index) => {
            // 分类排序模式下，检查是否需要显示分类标题
            const showCategoryHeader = sortMode === 'category' && (
              index === 0 || 
              getMainCategoryForRender(sortedSources[index - 1].category) !== getMainCategoryForRender(source.category)
            );
            const currentCategory = getMainCategoryForRender(source.category);
            
            return (
              <React.Fragment key={source.id}>
                {/* 分类标题 */}
                {showCategoryHeader && (
                  <div 
                    className="col-span-1 md:col-span-2 xl:col-span-3 flex items-center gap-2 pt-6 pb-1 first:pt-0"
                    style={{ gridRow: 'span 2' }}
                  >
                    <span className="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-black/40 backdrop-blur-sm text-[13px] font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                      {currentCategory}
                      <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                        {sortedSources.filter(s => getMainCategoryForRender(s.category) === currentCategory).length}
                      </span>
                    </span>
                  </div>
                )}
                <SourceCard
                  ref={(el) => setCardRef(source.id, el)}
                  source={source}
                  index={index}
                  onSourceClick={isEditMode ? () => handleToggleSelect(source.id) : onSourceClick}
                  onRefreshSource={onRefreshSource}
                  onThemeColorExtracted={handleThemeColorExtracted}
                  isEditMode={isEditMode}
                  isSelected={selectedIds.has(source.id)}
                  isDeleting={deletingIds.includes(source.id)}
                  onEdit={() => setEditingSource(source)}
                  onDelete={() => handleDeleteSource(source.id)}
                  onResizeStart={handleResizeStart}
                  previewSize={resizingSource?.sourceId === source.id ? resizingSource.previewSize : undefined}
                  isDragging={draggingSourceId === source.id}
                  isDragOver={dragOverSourceId === source.id}
                  onDragStart={handleCardDragStart}
                  sortMode={sortMode}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingSource && (
        <EditModal
          source={editingSource}
          categories={categories}
          onClose={() => setEditingSource(null)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
