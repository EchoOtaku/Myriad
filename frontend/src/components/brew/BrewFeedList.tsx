/**
 * Brew 文章列表组件
 * 设计参考 TappCard 风格 - 瀑布流卡片展示
 * 
 * 性能优化：
 * - 接入统一动画调度器 (useBrewCardStagger)
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useMemo 缓存计算结果
 * - 使用 useCallback 缓存回调函数
 * - 根据动画级别自动降级
 * - 图片懒加载 + decoding="async"
 */

import { useRef, useCallback, useState, memo, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, ExternalLink, FileText, Sparkles, Mic } from 'lucide-react';
import type { BrewItem } from '../../types/brew';
import { useBrewCardStagger, getBrewTransition } from '../../hooks/animation/pages/brew';
import { useI18n } from '../../contexts/I18nContext';

interface BrewFeedListProps {
  items: BrewItem[];
  selectedItem: BrewItem | null;
  loading: boolean;
  hasMore: boolean;
  total: number;
  onItemSelect: (item: BrewItem) => void;
  onToggleStar: (item: BrewItem) => void;
  onLoadMore: () => void;
  sourceColors?: Map<number, string>;
  // 编辑模式相关
  editMode?: boolean;
  selectedIds?: Set<number>;
  onItemSelectToggle?: (id: number) => void;
  // 是否已登录（游客隐藏收藏按钮）
  isAuthenticated?: boolean;
}

// 时间格式化翻译类型
interface TimeTranslations {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
}

// 格式化时间 - 纯函数，接收翻译对象和 locale
const formatTime = (timestamp: number | null, translations: TimeTranslations, locale: string) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return translations.justNow;
  if (diff < 3600000) return translations.minutesAgo.replace('{count}', String(Math.floor(diff / 60000)));
  if (diff < 86400000) return translations.hoursAgo.replace('{count}', String(Math.floor(diff / 3600000)));
  if (diff < 604800000) return translations.daysAgo.replace('{count}', String(Math.floor(diff / 86400000)));
  
  // 根据 locale 格式化日期
  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : locale === 'ja-JP' ? 'ja-JP' : 'en-US';
  return date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
};

// 提取摘要纯文本 - 纯函数
const getPlainText = (html: string | null) => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').slice(0, 200);
};

// 默认主题色
const DEFAULT_THEME_COLOR = '#F97316';

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

// ==================== ItemCard 组件 ====================

interface ItemCardProps {
  item: BrewItem;
  index: number;
  isSelected: boolean;
  isLast: boolean;
  themeColor: string;
  onItemSelect: (item: BrewItem) => void;
  onToggleStar: (item: BrewItem) => void;
  lastItemRef?: (node: HTMLDivElement | null) => void;
  // 编辑模式相关
  editMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (id: number) => void;
  // 是否已登录（游客隐藏收藏按钮）
  isAuthenticated?: boolean;
  // 国际化
  timeTranslations: TimeTranslations;
  brewTranslations: {
    hasAnnotations: string;
    annotationsLabel: string;
    hasPodcast: string;
    podcastLabel: string;
    unstarArticle: string;
    starArticle: string;
    openInNewTab: string;
  };
  locale: string;
}

const ItemCard = memo<ItemCardProps>(({
  item,
  index,
  isSelected,
  isLast,
  themeColor,
  onItemSelect,
  onToggleStar,
  lastItemRef,
  editMode,
  isChecked,
  onToggleCheck,
  isAuthenticated = false,
  timeTranslations,
  brewTranslations,
  locale,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // 接入动画调度器
  const { canAnimate, onComplete, animConfig } = useBrewCardStagger(index, 'item');
  const transition = getBrewTransition(animConfig, 'card');
  const enableHover = animConfig.level !== 'none';

  // 动画属性
  const animProps = useMemo(() => {
    // 动画禁用时直接显示
    if (animConfig.level === 'none') {
      return {
        initial: false as const,
        animate: undefined,
        transition: undefined,
        onAnimationComplete: undefined,
      };
    }

    return {
      initial: { opacity: 0, y: 16, scale: 0.97 },
      animate: canAnimate ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 },
      transition: { duration: transition.duration, ease: [0.22, 1, 0.36, 1] as any },
      onAnimationComplete: canAnimate ? onComplete : undefined,
    };
  }, [canAnimate, transition, onComplete, animConfig.level]);

  // 缓存元信息文本
  const metaText = useMemo(() => [
    item.source_name,
    item.author,
    item.reading_time ? `${item.reading_time}min` : null,
    formatTime(item.published_at, timeTranslations, locale)
  ].filter(Boolean).join(' · '), [item.source_name, item.author, item.reading_time, item.published_at, timeTranslations, locale]);

  // 缓存摘要文本
  const summaryText = useMemo(() => getPlainText(item.summary), [item.summary]);

  // 缓存点击处理
  const handleClick = useCallback(() => {
    if (editMode && onToggleCheck) {
      onToggleCheck(item.id);
    } else {
      onItemSelect(item);
    }
  }, [editMode, onToggleCheck, onItemSelect, item]);
  const handleStarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStar(item);
  }, [onToggleStar, item]);

  // 图片加载错误处理
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const parent = e.currentTarget.parentElement?.parentElement;
    if (parent) parent.style.display = 'none';
  }, []);

  const handleIconError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  }, []);

  return (
    <motion.div
      ref={isLast ? lastItemRef : undefined}
      {...animProps}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative rounded-2xl overflow-hidden bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl cursor-pointer will-change-transform transition-all duration-200 ease-out ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      } ${editMode && isChecked ? 'ring-2 ring-amber-500' : ''} ${item.is_read ? 'opacity-60' : ''} ${
        enableHover ? 'hover:-translate-y-0.5 hover:scale-[1.006]' : ''
      }`}
    >
      {/* 编辑模式复选框 */}
      {editMode && (
        <div className="absolute top-3 left-3 z-20">
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
            isChecked 
              ? 'bg-amber-500 border-amber-500' 
              : 'bg-white/80 dark:bg-neutral-800/80 border-gray-300 dark:border-neutral-600'
          }`}>
            {isChecked && (
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* 装饰光效 - 使用纯 opacity 过渡避免闪现 */}
      <div
        className={`absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl transition-opacity duration-250 ease-out ${isHovered ? 'opacity-30' : 'opacity-10'}`}
        style={{ background: `linear-gradient(135deg, ${themeColor}, transparent 70%)` }}
      />

      {/* 边框高光效果 - 仅使用内边框 */}
      <div
        className={`absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-200 ease-out ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: `inset 0 0 0 1px ${themeColor}40` }}
      />

      {/* 封面图 */}
      {item.image && (
        <div className="px-6 pt-6 relative">
          <div className="aspect-[7/2] overflow-hidden rounded-xl bg-gray-100 dark:bg-neutral-800">
            <img
              src={item.image}
              alt=""
              className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.08]"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
            />
          </div>
          {!item.is_read && (
            <div 
              className="absolute top-7 right-7 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: themeColor, boxShadow: `0 0 8px ${themeColor}80` }}
            />
          )}
        </div>
      )}

      {/* 未读标记 - 无封面 */}
      {!item.is_read && !item.image && (
        <div 
          className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: themeColor, boxShadow: `0 0 8px ${themeColor}80` }}
        />
      )}

      {/* 内容区域 */}
      <div className="relative z-10 p-6">
        {/* 来源栏 - 整合所有元信息和操作 */}
        <div className="flex items-center gap-2 mb-4">
          <div 
            className="flex items-center gap-2 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `${themeColor}15` }}
          >
            {item.source_icon && (
              <img
                src={getIconUrl(item.source_icon) || ''}
                alt=""
                className="w-4 h-4 rounded-full flex-shrink-0"
                loading="lazy"
                onError={handleIconError}
              />
            )}
            <span 
              className="text-xs font-medium"
              style={{ color: themeColor }}
            >
              {item.source_name}
            </span>
          </div>
          
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {formatTime(item.published_at, timeTranslations, locale)}
          </span>
          
          {item.reading_time && (
            <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {item.reading_time}min
            </span>
          )}

          {/* AI 功能标记 */}
          {(item.has_ai_annotations || item.has_ai_podcast) && (
            <div className="flex items-center gap-1.5 ml-auto">
              {item.has_ai_annotations && (
                <span 
                  className="text-xs px-2 py-1 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 inline-flex items-center gap-1 font-medium"
                  title={brewTranslations.hasAnnotations}
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  {brewTranslations.annotationsLabel}
                </span>
              )}
              {item.has_ai_podcast && (
                <span 
                  className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 font-medium"
                  title={brewTranslations.hasPodcast}
                >
                  <Mic className="w-3.5 h-3.5 shrink-0" />
                  {brewTranslations.podcastLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 标题区 - 标题与操作按钮 */}
        <div className="flex items-start gap-3">
          <h4 className={`flex-1 font-bold line-clamp-2 leading-snug text-xl tracking-tight ${
            item.is_read ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-50'
          }`}>
            {item.title}
          </h4>
          
          {/* 操作按钮 */}
          <div className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity duration-300 ease-out ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            {/* 收藏按钮 - 仅登录用户可见 */}
            {isAuthenticated && (
              <button
                onClick={handleStarClick}
                className={`p-1.5 rounded-lg transition-colors ${
                  item.is_starred ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={item.is_starred ? brewTranslations.unstarArticle : brewTranslations.starArticle}
                aria-label={item.is_starred ? brewTranslations.unstarArticle : brewTranslations.starArticle}
              >
                <Star className={`w-4 h-4 ${item.is_starred ? 'fill-current' : ''}`} />
              </button>
            )}
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={brewTranslations.openInNewTab}
              aria-label={brewTranslations.openInNewTab}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 摘要 - 舒适行高 */}
        {summaryText && (
          <p className="mt-3 text-[15px] text-gray-500 dark:text-gray-400 line-clamp-3 leading-[1.7]">
            {summaryText}
          </p>
        )}
      </div>

      {/* 边框 */}
      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06] pointer-events-none" />
      
      {/* 悬浮高光 - 仅使用内边框效果 */}
      <div
        className={`absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-200 ease-out ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: `inset 0 0 0 1.5px ${themeColor}45` }}
      />
    </motion.div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：只在关键属性变化时重渲染
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.is_read === nextProps.item.is_read &&
    prevProps.item.is_starred === nextProps.item.is_starred &&
    prevProps.item.has_ai_annotations === nextProps.item.has_ai_annotations &&
    prevProps.item.has_ai_podcast === nextProps.item.has_ai_podcast &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isLast === nextProps.isLast &&
    prevProps.themeColor === nextProps.themeColor &&
    prevProps.index === nextProps.index &&
    prevProps.editMode === nextProps.editMode &&
    prevProps.isChecked === nextProps.isChecked &&
    prevProps.isAuthenticated === nextProps.isAuthenticated &&
    prevProps.locale === nextProps.locale
  );
});

ItemCard.displayName = 'ItemCard';

// ==================== BrewFeedList 主组件 ====================

export default function BrewFeedList({
  items,
  selectedItem,
  loading,
  hasMore,
  total,
  onItemSelect,
  onToggleStar,
  onLoadMore,
  sourceColors,
  editMode,
  selectedIds,
  onItemSelectToggle,
  isAuthenticated = false,  // 默认游客模式
}: BrewFeedListProps) {
  const { t, locale } = useI18n();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [columnCount, setColumnCount] = useState(2);

  // 缓存翻译对象
  const timeTranslations = useMemo<TimeTranslations>(() => ({
    justNow: t.brew.justNow,
    minutesAgo: t.brew.minutesAgo,
    hoursAgo: t.brew.hoursAgo,
    daysAgo: t.brew.daysAgo,
  }), [t.brew]);

  const brewTranslations = useMemo(() => ({
    hasAnnotations: t.brew.hasAnnotations,
    annotationsLabel: t.brew.annotationsLabel,
    hasPodcast: t.brew.hasPodcast,
    podcastLabel: t.brew.podcastLabel,
    unstarArticle: t.brew.unstarArticle,
    starArticle: t.brew.starArticle,
    openInNewTab: t.brew.openInNewTab,
  }), [t.brew]);

  // 响应式列数 - 使用 ResizeObserver 替代 resize 事件（更高效，避免防抖）
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateColumnCount = (width: number) => {
      setColumnCount(width < 640 ? 1 : 2);
    };
    
    // 初始设置
    updateColumnCount(window.innerWidth);
    
    // 使用 ResizeObserver 监听容器宽度变化
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          updateColumnCount(entry.contentRect.width);
        }
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }
    
    // 降级方案：使用 resize 事件
    const handleResize = () => updateColumnCount(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 缓存主题色获取函数
  const getItemThemeColor = useCallback((item: BrewItem): string => {
    return sourceColors?.get(item.source_id) || DEFAULT_THEME_COLOR;
  }, [sourceColors]);

  // 瀑布流列分配 - 最短列优先算法（根据预估高度平衡列）
  const columns = useMemo(() => {
    const cols: BrewItem[][] = Array.from({ length: columnCount }, () => []);
    const colHeights: number[] = Array(columnCount).fill(0);
    
    // 预估卡片高度：基础高度 + 封面图高度 + 摘要行数
    const estimateHeight = (item: BrewItem): number => {
      let height = 140; // 基础高度（标题、元信息、padding）
      if (item.image) height += 80; // 封面图
      if (item.summary) {
        const textLen = getPlainText(item.summary).length;
        height += Math.min(Math.ceil(textLen / 40) * 22, 66); // 每行约22px，最多3行
      }
      return height;
    };
    
    items.forEach((item) => {
      // 找到当前最短的列
      let shortestCol = 0;
      let minHeight = colHeights[0];
      for (let i = 1; i < columnCount; i++) {
        if (colHeights[i] < minHeight) {
          minHeight = colHeights[i];
          shortestCol = i;
        }
      }
      
      cols[shortestCol].push(item);
      colHeights[shortestCol] += estimateHeight(item);
    });
    
    return cols;
  }, [items, columnCount]);

  // 缓存最后一项 ID
  const lastItemId = useMemo(() => 
    items.length > 0 ? items[items.length - 1].id : null,
  [items]);

  // 无限滚动加载 - 使用 IntersectionObserver
  const lastItemRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore) {
            onLoadMore();
          }
        },
        { rootMargin: '100px' } // 提前 100px 开始加载
      );

      if (node) observerRef.current.observe(node);
    },
    [loading, hasMore, onLoadMore]
  );

  // 空状态
  if (items.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <div className="w-20 h-20 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-4">
          <FileText className="w-10 h-10 text-gray-400/50" />
        </div>
        <p className="text-lg font-medium text-gray-700 dark:text-gray-300">{t.brew.noArticles}</p>
        <p className="text-sm mt-1 opacity-70">{t.brew.subscribeMoreSources}</p>
      </div>
    );
  }

  return (
    <div className="w-full" ref={containerRef}>
      {/* 文章列表 - 瀑布流布局 */}
      <div className="flex gap-4">
        {columns.map((columnItems, colIndex) => (
          <div key={colIndex} className="flex-1 flex flex-col gap-4">
            {columnItems.map((item, itemIndex) => (
              <ItemCard
                key={item.id}
                item={item}
                index={colIndex * columnItems.length + itemIndex}
                isSelected={selectedItem?.id === item.id}
                isLast={item.id === lastItemId}
                themeColor={getItemThemeColor(item)}
                onItemSelect={onItemSelect}
                onToggleStar={onToggleStar}
                lastItemRef={item.id === lastItemId ? lastItemRef : undefined}
                editMode={editMode}
                isChecked={selectedIds?.has(item.id)}
                onToggleCheck={onItemSelectToggle}
                isAuthenticated={isAuthenticated}
                timeTranslations={timeTranslations}
                brewTranslations={brewTranslations}
                locale={locale}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 加载中 */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-7 h-7 border-2 border-gray-300 dark:border-gray-600 border-t-gray-500 dark:border-t-gray-300 rounded-full animate-spin" />
        </div>
      )}

      {/* 没有更多 */}
      {!loading && !hasMore && items.length > 0 && (
        <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          {t.brew.loadedAllArticles.replace('{count}', String(total))}
        </p>
      )}
    </div>
  );
}
