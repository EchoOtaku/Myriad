/**
 * Brew 控制岛组件
 * 底部浮动控制栏，支持多种模式切换
 * 
 * 模式：
 * - default: 默认模式（动态提示 + 功能按钮）
 * - search: 搜索模式
 * - edit: 编辑模式（含多选、删除、全部刷新、调整卡片尺寸）
 * - keyboard: 快捷键模式
 * - add: 添加订阅模式
 * - feed: 文章列表模式（返回、刷新、全部已读、外部链接）
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Square,
  CheckSquare,
  MinusSquare,
  Trash2,
  X,
  Keyboard,
  Plus,
  Link,
  Loader2,
  Check,
  AlertCircle,
  Rss,
  Upload,
  Download,
  FileText,
  FolderOpen,
  RefreshCw,
  Edit3,
  ExternalLink,
  ChevronLeft,
  CheckCircle,
  ChevronDown,
  Star,
  ArrowUpDown,
  Clock,
  GripVertical,
  Shuffle,
  SortAsc,
  Sparkles,
} from 'lucide-react';
import type { BrewSource, SourceType, FeedType, RSSHubConfig } from '../../../types/brew';
import { BREW_SHORTCUTS } from '../../../hooks/useBrewKeyboard';
import * as brewApi from '../../../services/brewApi';
import RSSHubConfigComponent from './RSSHubConfig';
import { useI18n } from '../../../contexts/I18nContext';

// Notion 品牌图标
const NotionIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.454-.234 4.764 7.28v-6.44l-1.215-.14c-.093-.513.28-.886.747-.933zM2.718 1.321l13.496-.933c1.635-.14 2.055-.047 3.08.7l4.25 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.127-4.06c-.56-.747-.793-1.306-.793-1.96V2.948c0-.84.374-1.54 1.26-1.626z"/>
  </svg>
);

// RSSHub 品牌图标
const RSSHubIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
  </svg>
);

// API URL
const API_URL = import.meta.env.PUBLIC_API_URL || '';

// 处理图标 URL - 确保正确的完整路径
const getIconUrl = (iconUrl: string | null | undefined): string | null => {
  if (!iconUrl) return null;
  // 已经是本地路径，添加 API 前缀
  if (iconUrl.startsWith('/api/')) {
    return `${API_URL}${iconUrl}`;
  }
  // 外部 URL，使用图片代理
  if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return `${API_URL}/api/proxy/image?url=${encodeURIComponent(iconUrl)}`;
  }
  return iconUrl;
};

// 排序模式类型
export type SortMode = 'update' | 'custom' | 'category' | 'random' | 'pinyin';

// 动态提示信息类型
// Framer Motion transition 配置常量 - 避免每次渲染创建新对象
const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 25 } as const;
const SPRING_SMOOTH = { type: 'spring', stiffness: 350, damping: 28 } as const;
const TRANSITION_QUICK = { duration: 0.12 } as const;
const TRANSITION_NORMAL = { duration: 0.15 } as const;
const TRANSITION_SLOW = { duration: 0.25, ease: 'easeOut' as const } as const;

interface DynamicTip {
  icon: string;
  iconUrl?: string;
  main: string;
  sub: string;
}

// 根据订阅源数据生成动态提示
const generateDynamicTips = (sources: BrewSource[], brewTranslations: Record<string, string>): DynamicTip[] => {
  const tips: DynamicTip[] = [];
  const now = Date.now();
  
  // 找出未读最多的源
  const mostUnread = sources
    .filter(s => s.unread_count > 0)
    .sort((a, b) => b.unread_count - a.unread_count)[0];
  
  if (mostUnread && mostUnread.unread_count > 0) {
    tips.push({ 
      icon: '📚', 
      iconUrl: mostUnread.icon || undefined,
      main: `${mostUnread.name}`, 
      sub: (brewTranslations.tipUnreadCount || '{count} 条未读').replace('{count}', String(mostUnread.unread_count))
    });
  }
  
  // 找出最近更新的源（1小时内）
  const recentlyUpdated = sources
    .filter(s => s.last_fetched_at && (now - s.last_fetched_at * 1000) < 3600000)
    .sort((a, b) => (b.last_fetched_at || 0) - (a.last_fetched_at || 0));
  
  if (recentlyUpdated.length > 0) {
    const source = recentlyUpdated[0];
    tips.push({ 
      icon: '🔄', 
      iconUrl: source.icon || undefined,
      main: `${source.name}`, 
      sub: brewTranslations.tipJustUpdated || '刚刚更新'
    });
  }
  
  // 找出有新文章的源
  const withNewItems = sources.filter(s => s.recent_items && s.recent_items.some(item => !item.is_read));
  if (withNewItems.length > 0) {
    const randomSource = withNewItems[Math.floor(Math.random() * withNewItems.length)];
    const newItem = randomSource.recent_items?.find(item => !item.is_read);
    if (newItem) {
      const title = newItem.title.length > 16 ? newItem.title.slice(0, 16) + '...' : newItem.title;
      tips.push({ 
        icon: '📰', 
        iconUrl: randomSource.icon || undefined,
        main: title, 
        sub: (brewTranslations.tipFromSource || '来自 {source}').replace('{source}', randomSource.name)
      });
    }
  }
  
  // 计算总未读数
  const totalUnread = sources.reduce((acc, s) => acc + (s.unread_count || 0), 0);
  if (totalUnread > 0) {
    tips.push({ icon: '📬', main: (brewTranslations.tipUnreadCount || '{count} 条未读').replace('{count}', String(totalUnread)), sub: brewTranslations.tipClickToView || '点击卡片查看' });
  }
  
  // 基础统计
  tips.push({ icon: '📡', main: (brewTranslations.tipSubscriptionCount || '{count} 个订阅').replace('{count}', String(sources.length)), sub: brewTranslations.tipManageSources || '管理你的信息源' });
  
  // 时段问候（作为兜底）
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    tips.push({ icon: '☀️', main: brewTranslations.tipMorning || '早安', sub: brewTranslations.tipStartReading || '开启今日阅读' });
  } else if (hour >= 12 && hour < 18) {
    tips.push({ icon: '🌤️', main: brewTranslations.tipAfternoon || '午后时光', sub: brewTranslations.tipRelaxReading || '适合轻松阅读' });
  } else {
    tips.push({ icon: '🌙', main: brewTranslations.tipEvening || '晚间阅读', sub: brewTranslations.tipQuietTime || '享受安静时刻' });
  }
  
  return tips;
};

// 动态提示 Hook
const useDynamicTips = (sources: BrewSource[], brewTranslations: Record<string, string>) => {
  const tips = useMemo(() => generateDynamicTips(sources, brewTranslations), [sources, brewTranslations]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  useEffect(() => {
    if (tips.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % tips.length);
    }, 8000);
    
    return () => clearInterval(interval);
  }, [tips.length]);
  
  return { tip: tips[currentIndex] || tips[0], key: currentIndex };
};

interface ControlIslandProps {
  sources: BrewSource[];
  filteredSources: BrewSource[];
  categories: string[];
  // 搜索（仅 default/search 模式需要）
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  // 编辑模式（多选/删除/刷新/调整尺寸）- 仅 default/edit 模式需要
  selectedIds?: Set<number>;
  onSelectAll?: () => void;
  onBatchDelete?: () => void;
  onBatchRefresh?: () => void;
  onEnterEditMode?: () => void;
  onExitEditMode?: () => void;
  isEditMode?: boolean;
  isDeleting?: boolean;
  isRefreshing?: boolean;
  // 添加
  onAddSource?: (url: string, name?: string, category?: string, icon?: string, sourceType?: SourceType) => Promise<void>;
  onSourcesChange?: () => void;
  // 排序
  sortMode?: SortMode;
  onSortModeChange?: (mode: SortMode) => void;
  // 是否在子分类视图（子分类不显示自由排序）
  isSubCategory?: boolean;
  // 文章列表模式（可选）
  feedMode?: {
    source: BrewSource;
    total: number;
    onBack: () => void;
    onRefresh: () => void;
    onMarkAllRead: () => void;
    isRefreshing?: boolean;
  };
  // 分类合并文章列表模式（可选）- 用于"我"等特殊分类
  categoryFeedMode?: {
    categoryName: string;
    categoryLabel: string;
    total: number;
    unreadCount: number;
    onBack: () => void;
    onMarkAllRead: () => void;
  };
  // 收藏文章模式（可选）
  starredMode?: {
    total: number;
    selectedIds: Set<number>;
    isEditMode: boolean;
    onBack: () => void;
    onEnterEditMode: () => void;
    onExitEditMode: () => void;
    onSelectAll: () => void;
    onBatchUnstar: () => void;
    isProcessing?: boolean;
  };
  // 是否是管理员（管理员显示管理功能：添加、编辑、删除、刷新等）
  isAdmin?: boolean;
  // 是否已登录（普通用户可用已读/收藏状态功能）
  isAuthenticated?: boolean;
}

type ControlMode = 'default' | 'search' | 'edit' | 'keyboard' | 'add' | 'feed' | 'category-feed' | 'starred' | 'starred-edit';

export default function ControlIsland({
  sources,
  filteredSources,
  categories,
  searchQuery = '',
  setSearchQuery,
  selectedIds = new Set(),
  onSelectAll,
  onBatchDelete,
  onBatchRefresh,
  onEnterEditMode,
  onExitEditMode,
  isEditMode = false,
  isDeleting = false,
  isRefreshing = false,
  onAddSource,
  onSourcesChange,
  sortMode = 'update',
  onSortModeChange,
  isSubCategory = false,
  feedMode,
  categoryFeedMode,
  starredMode,
  isAdmin = false,  // 默认非管理员
  isAuthenticated = false,  // 默认游客模式
}: ControlIslandProps) {
  const { t } = useI18n();
  
  // 根据模式确定初始状态
  const getInitialMode = (): ControlMode => {
    if (starredMode?.isEditMode) return 'starred-edit';
    if (starredMode) return 'starred';
    if (categoryFeedMode) return 'category-feed';
    if (feedMode) return 'feed';
    return 'default';
  };
  
  const [mode, setMode] = useState<ControlMode>(getInitialMode);
  const { tip, key: tipKey } = useDynamicTips(sources, t.brew as unknown as Record<string, string>);
  
  // 当模式变化时，自动切换
  useEffect(() => {
    if (starredMode?.isEditMode) {
      setMode('starred-edit');
    } else if (starredMode) {
      setMode('starred');
    } else if (categoryFeedMode) {
      setMode('category-feed');
    } else if (feedMode) {
      setMode('feed');
    } else {
      setMode('default');
    }
  }, [feedMode, categoryFeedMode, starredMode, starredMode?.isEditMode]);

  // 添加订阅状态
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('rss');
  const [feedType, setFeedType] = useState<FeedType>('rss');
  const [notionToken, setNotionToken] = useState('');
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<{
    title: string;
    description: string | null;
    feed_type: string;
    item_count: number;
    icon: string | null;
  } | null>(null);

  // RSSHub 配置状态
  const [rsshubConfig, setRsshubConfig] = useState<RSSHubConfig | null>(null);
  const [rsshubFullUrl, setRsshubFullUrl] = useState('');
  const [enableBrewliaForRsshub, setEnableBrewliaForRsshub] = useState(false); // RSSHub 是否启用 AI 增强

  // OPML 状态
  const [activeTab, setActiveTab] = useState<'single' | 'opml'>('single');
  const [opmlContent, setOpmlContent] = useState('');
  const [opmlLoading, setOpmlLoading] = useState(false);
  const [opmlResult, setOpmlResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAddCategoryDropdown, setShowAddCategoryDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // 排序菜单状态
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // 点击外部关闭排序下拉菜单
  useEffect(() => {
    if (!showSortDropdown) return;
    
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showSortDropdown]);
  
  // 排序选项（子分类视图不显示自由排序）
  const allSortOptions: { value: SortMode; labelKey: string; icon: React.ReactNode }[] = [
    { value: 'update', labelKey: 'sortByUpdate', icon: <Clock className="w-4 h-4" /> },
    { value: 'custom', labelKey: 'sortByCustom', icon: <GripVertical className="w-4 h-4" /> },
    { value: 'category', labelKey: 'sortByCategory', icon: <FolderOpen className="w-4 h-4" /> },
    { value: 'random', labelKey: 'sortByRandom', icon: <Shuffle className="w-4 h-4" /> },
    { value: 'pinyin', labelKey: 'sortByPinyin', icon: <SortAsc className="w-4 h-4" /> },
  ];
  const sortOptions = isSubCategory 
    ? allSortOptions.filter(o => o.value !== 'custom')
    : allSortOptions;
  
  const currentSortOption = sortOptions.find(o => o.value === sortMode) || sortOptions[0];

  // 预置分类
  const presetCategories = [t.brew.friendLinks, t.brew.me];
  const allAddCategories = [...new Set([...presetCategories, ...categories])];

  const displayIcon = customIcon || discovered?.icon;

  // 同步编辑模式
  useEffect(() => {
    if (isEditMode && mode !== 'edit') {
      setMode('edit');
    } else if (!isEditMode && mode === 'edit') {
      setMode('default');
    }
  }, [isEditMode, mode]);

  // 重置添加状态
  const resetAddState = () => {
    setUrl('');
    setName('');
    setCategory('');
    setSourceType('rss');
    setFeedType('rss');
    setNotionToken('');
    setCustomIcon(null);
    setDiscovered(null);
    setError(null);
    setSuccess(null);
    setOpmlContent('');
    setOpmlResult(null);
    setActiveTab('single');
    setRsshubConfig(null);
    setRsshubFullUrl('');
    setEnableBrewliaForRsshub(false);
  };

  // 探测 Feed
  const handleDiscover = async () => {
    if (!url.trim()) return;
    setDiscovering(true);
    setError(null);
    setDiscovered(null);
    try {
      const result = await brewApi.discoverSource(url.trim());
      setDiscovered(result);
      if (!name && result.title) {
        setName(result.title);
      }
    } catch (err) {
      setError(t.brew.errorDiscoverFailed);
    } finally {
      setDiscovering(false);
    }
  };

  // 提交添加
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddSource) return;
    
    // RSSHub 类型需要配置和完整 URL
    if (sourceType === 'rsshub') {
      if (!rsshubConfig || !rsshubFullUrl) {
        setError(t.brew.errorConfigRsshub);
        return;
      }
    } else if (!url.trim()) {
      setError(t.brew.errorEnterUrl);
      return;
    }
    
    // 纯链接类型必须有名称
    if (sourceType === 'link' && !name.trim()) {
      setError(t.brew.errorLinkNeedName);
      return;
    }
    // Notion 类型必须有 token
    if (feedType === 'notion' && !notionToken.trim()) {
      setError(t.brew.errorNotionToken);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 确定最终的 source_type
      // RSSHub 启用 AI 增强时使用 brewlia，否则使用原值
      const finalSourceType = (sourceType === 'rsshub' && enableBrewliaForRsshub) ? 'brewlia' : sourceType;
      
      // 调用 API，传递 feedType 和 rsshub_route
      await brewApi.addSource({
        url: sourceType === 'rsshub' ? rsshubFullUrl : url.trim(),
        name: name || undefined,
        category: category || undefined,
        source_type: finalSourceType,
        feed_type: sourceType === 'rsshub' ? 'rsshub' : (feedType === 'notion' ? 'notion' : undefined),
        rsshub_route: sourceType === 'rsshub' && rsshubConfig ? rsshubConfig.routePath : undefined,
        extra_config: feedType === 'notion' ? { token: notionToken.trim() } : undefined,
      });
      
      // 如果提供了自定义图标，更新
      // 注意：这需要源已创建后更新
      
      setSuccess(t.brew.addSuccess);
      setTimeout(() => {
        resetAddState();
        setMode('default');
        onSourcesChange?.();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.brew.errorAddFailed);
    } finally {
      setLoading(false);
    }
  };

  // 图标上传
  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.brew.errorSelectImage);
      return;
    }
    if (file.size > 500 * 1024) {
      setError(t.brew.errorImageSize);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomIcon(event.target?.result as string);
      setError(null);
    };
    reader.onerror = () => setError(t.brew.errorImageRead);
    reader.readAsDataURL(file);
  };

  // OPML 处理
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setOpmlContent(event.target?.result as string);
      reader.readAsText(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setOpmlContent(event.target?.result as string);
      reader.readAsText(file);
    }
  };

  const handleImport = async () => {
    if (!opmlContent.trim()) return;
    setOpmlLoading(true);
    setError(null);
    try {
      const result = await brewApi.importOpml(opmlContent);
      setOpmlResult({ imported: result.imported || 0, skipped: result.skipped || 0 });
      onSourcesChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.brew.errorImportFailed);
    } finally {
      setOpmlLoading(false);
    }
  };

  // OPML 导出
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const opml = await brewApi.exportOpml();
      // 下载文件
      const blob = new Blob([opml], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `brew-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(t.brew.errorExportFailed);
    } finally {
      setExporting(false);
    }
  };

  // 切换模式
  const handleModeChange = (newMode: ControlMode) => {
    if (newMode === 'edit') {
      onEnterEditMode?.();
    } else if (mode === 'edit') {
      onExitEditMode?.();
    }
    if (newMode === 'search') {
      setSearchQuery?.('');
    }
    if (newMode === 'add') {
      resetAddState();
    }
    setMode(newMode);
  };

  // 关闭当前模式
  const handleClose = () => {
    if (mode === 'search') {
      setSearchQuery?.('');
    }
    if (mode === 'edit') {
      onExitEditMode?.();
    }
    if (mode === 'add') {
      resetAddState();
    }
    setMode('default');
  };

  // 分组快捷键
  const groupedShortcuts = useMemo(() => ({
    navigation: BREW_SHORTCUTS.filter(s => s.category === 'navigation'),
    article: BREW_SHORTCUTS.filter(s => s.category === 'article'),
    source: BREW_SHORTCUTS.filter(s => s.category === 'source'),
    other: BREW_SHORTCUTS.filter(s => s.category === 'other'),
  }), []);

  const categoryLabels: Record<string, string> = {
    navigation: t.brew.shortcutNavigation,
    article: t.brew.shortcutArticle,
    source: t.brew.shortcutSource,
    other: t.brew.shortcutOther,
  };

  return (
    <>
      {/* 移动端顶部控制条容器 - 内容流内，不浮动，允许触摸穿透 */}
      <div className="sm:hidden w-full mb-4 touch-pan-y relative z-30">
        <AnimatePresence mode="wait">
          {/* 搜索模式 - 移动端 */}
          {mode === 'search' ? (
            <motion.div
              key="search-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <div className="flex items-center gap-2 px-3 h-10 flex-1">
                <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery?.(e.target.value)}
                  placeholder={t.brew.searchSources}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none ring-0 text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-0 focus:border-none appearance-none"
                  style={{ boxShadow: 'none', background: 'transparent', WebkitAppearance: 'none' }}
                />
                <span className="text-xs text-gray-400 flex-shrink-0 pr-1">
                  {t.brew.resultsCount.replace('{count}', String(filteredSources.length))}
                </span>
              </div>
              <button
                onClick={handleClose}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors flex-shrink-0"
                title={t.brew.closeSearch}
                aria-label={t.brew.closeSearch}
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          ) : mode === 'edit' ? (
            /* 编辑模式 - 移动端 */
            <motion.div
              key="edit-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-gray-50/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <button
                onClick={onSelectAll}
                disabled={!onSelectAll}
                className="p-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700/60 rounded-xl transition-colors disabled:opacity-50"
                title={selectedIds.size === filteredSources.length ? t.brew.deselectAll : t.brew.selectAll}
                aria-label={selectedIds.size === filteredSources.length ? t.brew.deselectAll : t.brew.selectAll}
              >
                {selectedIds.size === filteredSources.length ? (
                  <CheckSquare className="w-5 h-5" />
                ) : selectedIds.size > 0 ? (
                  <MinusSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </button>
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300 min-w-[4.5rem] text-center">
                {selectedIds.size} / {filteredSources.length}
              </span>
              <button
                onClick={onBatchDelete}
                disabled={isDeleting || selectedIds.size === 0 || !onBatchDelete}
                className="p-2.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors"
                title={t.brew.deleteSelected}
                aria-label={t.brew.deleteSelected}
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                onClick={onBatchRefresh}
                disabled={isRefreshing || filteredSources.length === 0 || !onBatchRefresh}
                className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700/60 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors"
                title={t.brew.refreshAllSources}
                aria-label={t.brew.refreshAllSources}
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleClose}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700/60 rounded-xl transition-colors"
                title={t.brew.exitEdit}
                aria-label={t.brew.exitEdit}
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          ) : mode === 'feed' && feedMode ? (
            /* 文章列表模式 - 移动端 */
            <motion.div
              key="feed-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <motion.button
                onClick={feedMode.onBack}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                whileTap={{ scale: 0.95 }}
                title={t.brew.backToSourceList}
                aria-label={t.brew.backToSourceList}
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>
              <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
                {feedMode.source.icon ? (
                  <img src={feedMode.source.icon} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: feedMode.source.theme_color || '#F97316' }}>
                    <Rss className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{feedMode.source.name}</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                    <span>{t.brew.articlesCount.replace('{count}', String(feedMode.total))}</span>
                    {feedMode.source.unread_count > 0 && (
                      <span className="font-medium" style={{ color: feedMode.source.theme_color || '#F97316' }}>
                        {t.brew.tipUnreadCount.replace('{count}', String(feedMode.source.unread_count))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />
              {isAuthenticated && feedMode.source.unread_count > 0 && (
                <motion.button
                  onClick={feedMode.onMarkAllRead}
                  className="p-2.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors"
                  whileTap={{ scale: 0.95 }}
                  title={t.brew.markAllAsRead}
                  aria-label={t.brew.markAllAsRead}
                >
                  <CheckCircle className="w-4 h-4" />
                </motion.button>
              )}
              {feedMode.source.site_url && (
                <motion.a
                  href={feedMode.source.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors"
                  whileTap={{ scale: 0.95 }}
                  title={t.brew.visitWebsite}
                  aria-label={t.brew.visitWebsite}
                >
                  <ExternalLink className="w-4 h-4" />
                </motion.a>
              )}
            </motion.div>
          ) : mode === 'category-feed' && categoryFeedMode ? (
            /* 分类合并文章列表模式 - 移动端 */
            <motion.div
              key="category-feed-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <motion.button
                onClick={categoryFeedMode.onBack}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                whileTap={{ scale: 0.95 }}
                title={t.brew.backToAllSources}
                aria-label={t.brew.backToAllSources}
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>
              <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-500">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{categoryFeedMode.categoryLabel}</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                    <span>{t.brew.totalArticles.replace('{count}', String(categoryFeedMode.total))}</span>
                    {categoryFeedMode.unreadCount > 0 && (
                      <span className="font-medium text-blue-500">{t.brew.tipUnreadCount.replace('{count}', String(categoryFeedMode.unreadCount))}</span>
                    )}
                  </div>
                </div>
              </div>
              {isAuthenticated && categoryFeedMode.unreadCount > 0 && (
                <>
                  <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />
                  <motion.button
                    onClick={categoryFeedMode.onMarkAllRead}
                    className="p-2.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors"
                    whileTap={{ scale: 0.95 }}
                    title={t.brew.markAllAsRead}
                    aria-label={t.brew.markAllAsRead}
                  >
                    <CheckCircle className="w-4 h-4" />
                  </motion.button>
                </>
              )}
            </motion.div>
          ) : mode === 'starred-edit' && starredMode ? (
            /* 收藏编辑模式 - 移动端 */
            <motion.div
              key="starred-edit-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <motion.button
                onClick={starredMode.onExitEditMode}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                whileTap={{ scale: 0.95 }}
                title={t.brew.exitEdit}
                aria-label={t.brew.exitEdit}
              >
                <X className="w-5 h-5" />
              </motion.button>
              <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
                <motion.button
                  onClick={starredMode.onSelectAll}
                  className="p-1.5 text-gray-500 hover:text-amber-500 rounded-lg transition-colors"
                  whileTap={{ scale: 0.95 }}
                  title={t.brew.selectAllToggle}
                  aria-label={t.brew.selectAllToggle}
                >
                  {starredMode.selectedIds.size === starredMode.total ? (
                    <CheckSquare className="w-5 h-5 text-amber-500" />
                  ) : starredMode.selectedIds.size > 0 ? (
                    <MinusSquare className="w-5 h-5 text-amber-500" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </motion.button>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {starredMode.selectedIds.size > 0 ? t.brew.selectedCount.replace('{count}', String(starredMode.selectedIds.size)) : t.brew.selectArticles}
                </span>
              </div>
              <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />
              <motion.button
                onClick={starredMode.onBatchUnstar}
                disabled={starredMode.selectedIds.size === 0 || starredMode.isProcessing}
                className="p-2.5 text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl transition-colors disabled:opacity-50"
                whileTap={{ scale: 0.95 }}
                title={t.brew.unstar}
                aria-label={t.brew.unstar}
              >
                {starredMode.isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
              </motion.button>
            </motion.div>
          ) : mode === 'starred' && starredMode ? (
            /* 收藏文章模式 - 移动端 */
            <motion.div
              key="starred-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              <motion.button
                onClick={starredMode.onBack}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                whileTap={{ scale: 0.95 }}
                title={t.brew.backToSourceList}
                aria-label={t.brew.backToSourceList}
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>
              <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
                  <Star className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{t.brew.starredArticles}</h3>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">{t.brew.starredCount.replace('{count}', String(starredMode.total))}</div>
                </div>
              </div>
            </motion.div>
          ) : (
            /* 默认模式 - 移动端（简化版：只保留动态信息和排序） */
            <motion.div
              key="default-bar-mobile"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={SPRING_SNAPPY}
              className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
            >
              {/* 动态提示 */}
              <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1 overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tipKey}
                    initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                    transition={TRANSITION_SLOW}
                    className="flex items-center gap-2"
                  >
                    {tip.iconUrl ? (
                      <img 
                        src={getIconUrl(tip.iconUrl) || ''} 
                        alt="" 
                        className="w-5 h-5 rounded flex-shrink-0 object-cover"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <span className={`text-base flex-shrink-0 ${tip.iconUrl ? 'hidden' : ''}`}>
                      {tip.icon}
                    </span>
                    <div className="flex flex-col justify-center leading-tight min-w-0">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                        {tip.main}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {tip.sub}
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* 排序按钮 */}
              <div className="relative" ref={sortDropdownRef}>
                <motion.button
                  onClick={() => setShowSortDropdown(!showSortDropdown)}
                  className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                  whileTap={{ scale: 0.95 }}
                  title={t.brew.sortMethod}
                  aria-label={t.brew.sortMethod}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </motion.button>
                
                <AnimatePresence>
                  {showSortDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.95 }}
                      transition={TRANSITION_NORMAL}
                      className="absolute top-full mt-2 right-0 w-36 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden py-1 z-[100]"
                    >
                      {sortOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            onSortModeChange?.(option.value);
                            setShowSortDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors ${
                            sortMode === option.value 
                              ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' 
                              : 'text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {option.icon}
                          <span>{(t.brew as Record<string, string>)[option.labelKey]}</span>
                          {sortMode === option.value && <Check className="w-3 h-3 ml-auto" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 桌面端底部浮动控制条容器 */}
      <div className="hidden sm:block fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
        <AnimatePresence mode="wait">
          {/* 搜索模式 */}
          {mode === 'search' ? (
          <motion.div
            key="search-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            <div className="flex items-center gap-2 px-3 h-10">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery?.(e.target.value)}
                placeholder={t.brew.searchSources}
                autoFocus
                className="w-40 sm:w-56 bg-transparent border-none outline-none ring-0 text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-0 focus:border-none appearance-none"
                style={{ boxShadow: 'none', background: 'transparent', WebkitAppearance: 'none' }}
              />
              <span className="text-xs text-gray-400 flex-shrink-0 pr-1">
                {t.brew.resultsCount.replace('{count}', String(filteredSources.length))}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors flex-shrink-0"
              title={t.brew.closeSearch}
              aria-label={t.brew.closeSearch}
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        ) : mode === 'edit' ? (
          /* 编辑模式 - 支持多选删除、全部刷新、调整卡片尺寸 */
          <motion.div
            key="edit-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-gray-50/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 全选按钮 */}
            <button
              onClick={onSelectAll}
              disabled={!onSelectAll}
              className="p-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700/60 rounded-xl transition-colors disabled:opacity-50"
              title={selectedIds.size === filteredSources.length ? t.brew.deselectAll : t.brew.selectAll}
              aria-label={selectedIds.size === filteredSources.length ? t.brew.deselectAll : t.brew.selectAll}
            >
              {selectedIds.size === filteredSources.length ? (
                <CheckSquare className="w-5 h-5" />
              ) : selectedIds.size > 0 ? (
                <MinusSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5" />
              )}
            </button>
            
            {/* 选中数量 */}
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300 min-w-[4.5rem] text-center">
              {selectedIds.size} / {filteredSources.length}
            </span>
            
            {/* 删除按钮 */}
            <button
              onClick={onBatchDelete}
              disabled={isDeleting || selectedIds.size === 0 || !onBatchDelete}
              className="p-2.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors"
              title={t.brew.deleteSelected}
              aria-label={t.brew.deleteSelected}
            >
              <Trash2 className="w-5 h-5" />
            </button>
            
            {/* 全部刷新按钮 */}
            <button
              onClick={onBatchRefresh}
              disabled={isRefreshing || filteredSources.length === 0 || !onBatchRefresh}
              className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700/60 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors"
              title={t.brew.refreshAllSources}
              aria-label={t.brew.refreshAllSources}
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            
            {/* 退出按钮 */}
            <button
              onClick={handleClose}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700/60 rounded-xl transition-colors"
              title={t.brew.exitEdit}
              aria-label={t.brew.exitEdit}
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        ) : mode === 'keyboard' ? (
          /* 快捷键模式 - 完整版 */
          <motion.div
            key="keyboard-bar"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={SPRING_SMOOTH}
            className="flex flex-col rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10 w-[28rem] max-w-[90vw] overflow-hidden"
          >
            {/* 快捷键内容 - 两列布局 */}
            <div className="p-4 max-h-[50vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(groupedShortcuts).map(([cat, shortcuts]) => {
                  if (shortcuts.length === 0) return null;
                  return (
                    <div
                      key={cat}
                      className="p-2.5 rounded-xl bg-gray-50/80 dark:bg-neutral-800/40 border border-gray-100 dark:border-neutral-700/50"
                    >
                      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-100 dark:border-neutral-700/50">
                        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {categoryLabels[cat]}
                        </span>
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-gray-200/60 dark:bg-neutral-700/60 text-gray-400 dark:text-gray-500 ml-auto">
                          {shortcuts.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {shortcuts.map(shortcut => (
                          <div
                            key={shortcut.key}
                            className="flex items-center justify-between py-1 px-0.5"
                          >
                            <span className="text-xs text-gray-600 dark:text-gray-400 truncate mr-2">
                              {shortcut.description}
                            </span>
                            <kbd className="min-w-[18px] px-1.5 py-0.5 bg-white dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded text-[10px] text-gray-500 dark:text-gray-400 font-mono text-center shadow-sm flex-shrink-0">
                              {shortcut.key.split(' / ')[0]}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* 底部标题栏 */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-800/30">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t.brew.keyboardShortcuts}</span>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                title={t.brew.close}
                aria-label={t.brew.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ) : mode === 'add' ? (
          /* 添加订阅模式 - 完整版 */
          <motion.div
            key="add-bar"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={SPRING_SMOOTH}
            className="flex flex-col rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10 w-96 max-w-[90vw] overflow-hidden"
          >
            {/* 内容区域 */}
            <div className="p-4 max-h-[50vh] overflow-y-auto">
              {activeTab === 'single' ? (
                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* 来源类型选择 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{t.brew.sourceTypeLabel}</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setSourceType('link'); setFeedType('rss'); setDiscovered(null); setError(null); }}
                        disabled={loading}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                          sourceType === 'link'
                            ? 'border-gray-500 bg-gray-50 dark:bg-gray-500/10'
                            : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300'
                        }`}
                      >
                        <ExternalLink className={`w-4 h-4 ${sourceType === 'link' ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400'}`} />
                        <span className={`text-[10px] font-medium ${sourceType === 'link' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>{t.brew.pureLink}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSourceType('rss'); setFeedType('rss'); setError(null); }}
                        disabled={loading}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                          (sourceType === 'rss' || sourceType === 'brewlia') && feedType !== 'notion' && feedType !== 'rsshub'
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                            : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300'
                        }`}
                      >
                        <Rss className={`w-4 h-4 ${(sourceType === 'rss' || sourceType === 'brewlia') && feedType !== 'notion' && feedType !== 'rsshub' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`} />
                        <span className={`text-[10px] font-medium ${(sourceType === 'rss' || sourceType === 'brewlia') && feedType !== 'notion' && feedType !== 'rsshub' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>RSS</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSourceType('rsshub'); setFeedType('rsshub'); setDiscovered(null); setError(null); setUrl(''); }}
                        disabled={loading}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                          sourceType === 'rsshub'
                            ? 'border-teal-500 bg-teal-50 dark:bg-teal-500/10'
                            : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300'
                        }`}
                      >
                        <RSSHubIcon className={`w-4 h-4 ${sourceType === 'rsshub' ? 'text-teal-600 dark:text-teal-400' : 'text-gray-400'}`} />
                        <span className={`text-[10px] font-medium ${sourceType === 'rsshub' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>RSSHub</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSourceType('rss'); setFeedType('notion'); setDiscovered(null); setError(null); }}
                        disabled={loading}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                          feedType === 'notion'
                            ? 'border-slate-600 bg-slate-50 dark:bg-slate-500/10'
                            : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300'
                        }`}
                      >
                        <NotionIcon className={`w-4 h-4 ${feedType === 'notion' ? 'text-slate-600 dark:text-slate-400' : 'text-gray-400'}`} />
                        <span className={`text-[10px] font-medium ${feedType === 'notion' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>Notion</span>
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">
                      {feedType === 'notion' 
                        ? t.brew.notionDesc 
                        : sourceType === 'rsshub'
                          ? t.brew.rsshubDesc
                          : sourceType === 'link' 
                            ? t.brew.linkDesc 
                            : t.brew.rssDesc}
                    </p>
                  </div>

                  {/* Brewlia AI 增强开关（仅 RSS/Notion 显示，RSSHub 不显示） */}
                  {sourceType !== 'link' && sourceType !== 'rsshub' && (
                    <div className="flex items-center justify-between px-2.5 py-2 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200/50 dark:border-purple-800/30 rounded-xl">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Sparkles className={`w-4 h-4 flex-shrink-0 ${sourceType === 'brewlia' ? 'text-purple-500' : 'text-purple-400'}`} />
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Brewlia AI</span>
                          <p className="text-[10px] text-gray-400 truncate">{t.brew.brewliaShortDesc}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSourceType(sourceType === 'brewlia' ? 'rss' : 'brewlia')}
                        disabled={loading}
                        title={sourceType === 'brewlia' ? t.brew.disableAI : t.brew.enableAI}
                        aria-label={sourceType === 'brewlia' ? t.brew.disableAI : t.brew.enableAI}
                        className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors ${
                          sourceType === 'brewlia' 
                            ? 'bg-purple-500' 
                            : 'bg-gray-300 dark:bg-neutral-600'
                        }`}
                      >
                        <span 
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            sourceType === 'brewlia' ? 'translate-x-4' : 'translate-x-0'
                          }`} 
                        />
                      </button>
                    </div>
                  )}

                  {/* RSSHub 配置（仅 RSSHub 类型显示） */}
                  {sourceType === 'rsshub' && (
                    <>
                      <RSSHubConfigComponent
                        onConfigChange={(config, fullUrl) => {
                          setRsshubConfig(config);
                          setRsshubFullUrl(fullUrl);
                        }}
                        disabled={loading}
                      />
                      {/* RSSHub 的 Brewlia AI 增强开关 */}
                      <div className="flex items-center justify-between px-2.5 py-2 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200/50 dark:border-purple-800/30 rounded-xl">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Sparkles className={`w-4 h-4 flex-shrink-0 ${enableBrewliaForRsshub ? 'text-purple-500' : 'text-purple-400'}`} />
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Brewlia AI</span>
                            <p className="text-[10px] text-gray-400 truncate">{t.brew.brewliaFeatures}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEnableBrewliaForRsshub(!enableBrewliaForRsshub)}
                          disabled={loading}
                          title={enableBrewliaForRsshub ? t.brew.disableAI : t.brew.enableAI}
                          aria-label={enableBrewliaForRsshub ? t.brew.disableAI : t.brew.enableAI}
                          className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors ${
                            enableBrewliaForRsshub 
                              ? 'bg-purple-500' 
                              : 'bg-gray-300 dark:bg-neutral-600'
                          }`}
                        >
                          <span 
                            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                              enableBrewliaForRsshub ? 'translate-x-4' : 'translate-x-0'
                            }`} 
                          />
                        </button>
                      </div>
                    </>
                  )}

                  {/* URL 输入（非 RSSHub 类型显示） */}
                  {sourceType !== 'rsshub' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {feedType === 'notion' ? t.brew.notionUrlLabel : sourceType === 'link' ? t.brew.linkUrlLabel : t.brew.subscriptionUrlLabel} <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder={feedType === 'notion' ? 'notion://database/xxx 或 https://notion.so/...' : sourceType === 'link' ? 'https://example.com' : 'https://example.com/feed.xml'}
                          className="w-full pl-8 pr-3 py-2 bg-gray-50/80 dark:bg-neutral-800/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all"
                          disabled={loading}
                        />
                      </div>
                      {/* 仅 RSS/Brewlia 显示探测按钮（非 Notion） */}
                      {sourceType !== 'link' && feedType !== 'notion' && (
                        <button
                          type="button"
                          onClick={handleDiscover}
                          disabled={discovering || !url.trim()}
                          className="px-2.5 py-2 bg-gray-100 dark:bg-neutral-700/80 border border-gray-200/80 dark:border-neutral-600/80 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-600 disabled:opacity-50 transition-colors"
                        >
                          {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t.brew.discover}
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Notion Token 输入（仅 Notion 类型显示） */}
                  {feedType === 'notion' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Notion Integration Token <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="password"
                        value={notionToken}
                        onChange={(e) => setNotionToken(e.target.value)}
                        placeholder="secret_xxx..."
                        className="w-full px-3 py-2 bg-gray-50/80 dark:bg-neutral-800/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-xl text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500/30 transition-all font-mono"
                        disabled={loading}
                      />
                      <p className="mt-1 text-[10px] text-gray-400">
                        请在 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:underline">Notion Integrations</a> 创建 Integration 并复制 Token
                      </p>
                    </div>
                  )}

                  {/* 探测结果（仅 RSS/Brewlia 显示，非 Notion） */}
                  {discovered && sourceType !== 'link' && feedType !== 'notion' && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-800/50 rounded-xl"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs text-emerald-700 dark:text-emerald-300 truncate">{discovered.title}</span>
                      <span className="text-[10px] px-1 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded flex-shrink-0">{discovered.feed_type.toUpperCase()}</span>
                      {sourceType === 'brewlia' && (
                        <span className="text-[10px] px-1 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 rounded flex-shrink-0 flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5" /> AI
                        </span>
                      )}
                    </motion.div>
                  )}

                  {/* 名称和分类 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {t.brew.nameLabel} {sourceType === 'link' && <span className="text-rose-500">*</span>}
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={sourceType === 'link' ? t.brew.enterName : t.brew.autoFetch}
                        className="w-full px-2.5 py-2 bg-gray-50/80 dark:bg-neutral-800/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all"
                        disabled={loading}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.brew.category}</label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowAddCategoryDropdown(!showAddCategoryDropdown)}
                          disabled={loading}
                          className="w-full px-2.5 py-2 bg-gray-50/80 dark:bg-neutral-800/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-xl text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all disabled:opacity-50"
                        >
                          <span className={category ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400'}>
                            {category || t.brew.selectCategory}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showAddCategoryDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        <AnimatePresence>
                          {showAddCategoryDropdown && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={TRANSITION_QUICK}
                              className="absolute z-50 w-full mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden"
                            >
                              {/* 输入新分类 */}
                              <div className="p-1.5 border-b border-gray-100 dark:border-neutral-700">
                                <input
                                  type="text"
                                  value={category}
                                  onChange={e => setCategory(e.target.value)}
                                  placeholder={t.brew.inputNewCategory}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-neutral-900 border-0 focus:outline-none focus:ring-2 focus:ring-orange-500/30 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>
                              {/* 分类列表 */}
                              <div className="max-h-32 overflow-y-auto py-0.5">
                                <button
                                  type="button"
                                  onClick={() => { setCategory(''); setShowAddCategoryDropdown(false); }}
                                  className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-neutral-700 flex items-center ${!category ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-600 dark:text-gray-300'}`}
                                >
                                  {t.brew.noCategory}
                                  {!category && <Check className="w-3 h-3 ml-auto" />}
                                </button>
                                {allAddCategories.map(cat => (
                                  <button
                                    key={cat}
                                    type="button"
                                    onClick={() => { setCategory(cat); setShowAddCategoryDropdown(false); }}
                                    className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-neutral-700 flex items-center ${category === cat ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-600 dark:text-gray-300'}`}
                                  >
                                    {cat}
                                    {category === cat && <Check className="w-3 h-3 ml-auto" />}
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* 自定义图标 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.brew.siteIcon}</label>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-neutral-800 flex items-center justify-center overflow-hidden border border-dashed border-gray-300 dark:border-neutral-600">
                        {displayIcon ? (
                          <img src={displayIcon} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Rss className="w-3.5 h-3.5 text-gray-400" />
                        )}
                      </div>
                      <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                        <Upload className="w-3 h-3" />
                        {t.brew.upload}
                        <input
                          ref={iconInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleIconUpload}
                          className="hidden"
                          disabled={loading}
                        />
                      </label>
                      {customIcon && (
                        <button
                          type="button"
                          onClick={() => { setCustomIcon(null); if (iconInputRef.current) iconInputRef.current.value = ''; }}
                          className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title={t.brew.deleteIcon}
                          aria-label={t.brew.deleteCustomIcon}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 错误/成功提示 */}
                  {error && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-500">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                      <Check className="w-3 h-3" />
                      {success}
                    </div>
                  )}

                  {/* 提交按钮 */}
                  <button
                    type="submit"
                    disabled={loading || (sourceType === 'rsshub' ? !rsshubFullUrl : (!url.trim() || (sourceType === 'link' && !name.trim())))}
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all text-white ${
                      sourceType === 'brewlia'
                        ? 'bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 disabled:from-purple-300 disabled:to-violet-300'
                        : sourceType === 'rsshub'
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 disabled:from-teal-300 disabled:to-cyan-300'
                        : sourceType === 'link'
                        ? 'bg-gradient-to-r from-gray-500 to-slate-500 hover:from-gray-600 hover:to-slate-600 disabled:from-gray-300 disabled:to-slate-300'
                        : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:from-orange-300 disabled:to-amber-300'
                    }`}
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {sourceType === 'link' ? t.brew.addLink : sourceType === 'brewlia' ? t.brew.addBrewlia : sourceType === 'rsshub' ? t.brew.addRsshub : t.brew.addSubscription}
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  {/* 导入区域 */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                      dragOver
                        ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20'
                        : 'border-gray-200 dark:border-neutral-700 hover:border-violet-300 dark:hover:border-violet-700'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".opml,.xml"
                      onChange={handleFileSelect}
                      className="hidden"
                      title={t.brew.selectOpmlFile}
                      aria-label={t.brew.selectOpmlFile}
                    />
                    <FolderOpen className={`w-8 h-8 mx-auto mb-1.5 ${dragOver ? 'text-violet-400' : 'text-gray-300 dark:text-gray-600'}`} />
                    <p className="text-xs text-gray-600 dark:text-gray-400">{t.brew.dropOpmlHere}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t.brew.supportedFormats}</p>
                  </div>

                  {/* 导入按钮 */}
                  {opmlContent && (
                    <button
                      onClick={handleImport}
                      disabled={opmlLoading}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white rounded-xl text-sm font-medium transition-all"
                    >
                      {opmlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {t.brew.startImport}
                    </button>
                  )}

                  {/* 导出按钮 */}
                  <button
                    onClick={handleExport}
                    disabled={exporting || sources.length === 0}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-all"
                  >
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t.brew.exportOpml.replace('{count}', String(sources.length))}
                  </button>

                  {opmlResult && (
                    <div className="flex items-center gap-1.5 px-2.5 py-2 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-800/50 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                      {t.brew.importResult.replace('{imported}', String(opmlResult.imported)).replace('{skipped}', opmlResult.skipped > 0 ? t.brew.skippedCount.replace('{count}', String(opmlResult.skipped)) : '')}
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-500">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部栏：标签切换 + 关闭按钮 */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-800/30">
              {/* 标签切换 */}
              <button
                onClick={() => setActiveTab('single')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'single'
                    ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700'
                }`}
              >
                <Link className="w-3.5 h-3.5" />
                {t.brew.singleAdd}
              </button>
              <button
                onClick={() => setActiveTab('opml')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'opml'
                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                OPML
              </button>
              {/* 关闭按钮 */}
              <button
                onClick={handleClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors ml-auto"
                title={t.brew.closeSearch}
                aria-label={t.brew.closeSearch}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ) : mode === 'feed' && feedMode ? (
          /* 文章列表模式 */
          <motion.div
            key="feed-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 返回按钮 */}
            <motion.button
              onClick={feedMode.onBack}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.backToSourceList}
              aria-label={t.brew.backToSourceList}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>

            {/* 订阅源信息 */}
            <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
              {/* 图标 */}
              {feedMode.source.icon ? (
                <img 
                  src={feedMode.source.icon} 
                  alt="" 
                  className="w-7 h-7 rounded-lg object-cover flex-shrink-0" 
                />
              ) : (
                <div 
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: feedMode.source.theme_color || '#F97316' }}
                >
                  <Rss className="w-4 h-4 text-white" />
                </div>
              )}
              
              {/* 名称 + 统计 */}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {feedMode.source.name}
                </h3>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                  <span>{t.brew.articlesCount.replace('{count}', String(feedMode.total))}</span>
                  {feedMode.source.unread_count > 0 && (
                    <span 
                      className="font-medium"
                      style={{ color: feedMode.source.theme_color || '#F97316' }}
                    >
                      {t.brew.tipUnreadCount.replace('{count}', String(feedMode.source.unread_count))}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />

            {/* 刷新按钮 - 仅管理员可见 */}
            {isAdmin && (
              <motion.button
                onClick={feedMode.onRefresh}
                disabled={feedMode.isRefreshing}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors disabled:opacity-50"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={t.brew.refreshSource}
                aria-label={t.brew.refreshSource}
              >
                <RefreshCw className={`w-4 h-4 ${feedMode.isRefreshing ? 'animate-spin' : ''}`} />
              </motion.button>
            )}

            {/* 全部已读按钮 - 登录用户可见 */}
            {isAuthenticated && feedMode.source.unread_count > 0 && (
              <motion.button
                onClick={feedMode.onMarkAllRead}
                className="p-2.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={t.brew.markAllAsRead}
                aria-label={t.brew.markAllAsRead}
              >
                <CheckCircle className="w-4 h-4" />
              </motion.button>
            )}

            {/* 外部链接按钮 */}
            {feedMode.source.site_url && (
              <motion.a
                href={feedMode.source.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={t.brew.visitWebsite}
                aria-label={t.brew.visitWebsite}
              >
                <ExternalLink className="w-4 h-4" />
              </motion.a>
            )}
          </motion.div>
        ) : mode === 'category-feed' && categoryFeedMode ? (
          /* 分类合并文章列表模式 - 用于"我"等特殊分类 */
          <motion.div
            key="category-feed-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 返回按钮 */}
            <motion.button
              onClick={categoryFeedMode.onBack}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.backToAllSources}
              aria-label={t.brew.backToAllSources}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>

            {/* 分类信息 */}
            <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
              {/* 分类图标 */}
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-500"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              
              {/* 名称 + 统计 */}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {categoryFeedMode.categoryLabel}
                </h3>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                  <span>{t.brew.totalArticles.replace('{count}', String(categoryFeedMode.total))}</span>
                  {categoryFeedMode.unreadCount > 0 && (
                    <span className="font-medium text-blue-500">
                      {t.brew.tipUnreadCount.replace('{count}', String(categoryFeedMode.unreadCount))}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 分隔线 + 全部已读按钮 - 登录用户且有未读时显示 */}
            {isAuthenticated && categoryFeedMode.unreadCount > 0 && (
              <>
              <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />
              <motion.button
                onClick={categoryFeedMode.onMarkAllRead}
                className="p-2.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={t.brew.markAllAsRead}
                aria-label={t.brew.markAllAsRead}
              >
                <CheckCircle className="w-4 h-4" />
              </motion.button>
              </>
            )}
          </motion.div>
        ) : mode === 'starred-edit' && starredMode ? (
          /* 收藏编辑模式 */
          <motion.div
            key="starred-edit-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 退出编辑按钮 */}
            <motion.button
              onClick={starredMode.onExitEditMode}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.exitEdit}
              aria-label={t.brew.exitEdit}
            >
              <X className="w-5 h-5" />
            </motion.button>

            {/* 选择状态 */}
            <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
              <motion.button
                onClick={starredMode.onSelectAll}
                className="p-1.5 text-gray-500 hover:text-amber-500 rounded-lg transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={t.brew.selectAllToggle}
                aria-label={t.brew.selectAllToggle}
              >
                {starredMode.selectedIds.size === starredMode.total ? (
                  <CheckSquare className="w-5 h-5 text-amber-500" />
                ) : starredMode.selectedIds.size > 0 ? (
                  <MinusSquare className="w-5 h-5 text-amber-500" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </motion.button>
              
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {starredMode.selectedIds.size > 0 
                  ? t.brew.selectedCount.replace('{count}', String(starredMode.selectedIds.size))
                  : t.brew.selectArticles
                }
              </span>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />

            {/* 批量取消收藏 */}
            <motion.button
              onClick={starredMode.onBatchUnstar}
              disabled={starredMode.selectedIds.size === 0 || starredMode.isProcessing}
              className="p-2.5 text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl transition-colors disabled:opacity-50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.unstar}
              aria-label={t.brew.unstar}
            >
              {starredMode.isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Star className="w-4 h-4" />
              )}
            </motion.button>
          </motion.div>
        ) : mode === 'starred' && starredMode ? (
          /* 收藏文章模式 */
          <motion.div
            key="starred-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 返回按钮 */}
            <motion.button
              onClick={starredMode.onBack}
              className="p-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.backToSourceList}
              aria-label={t.brew.backToSourceList}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>

            {/* 收藏信息 */}
            <div className="flex items-center gap-2 h-10 px-2 min-w-0 flex-1">
              {/* 图标 */}
              <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
                <Star className="w-4 h-4 text-white" />
              </div>
              
              {/* 名称 + 统计 */}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {t.brew.starredArticles}
                </h3>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  {t.brew.starredCount.replace('{count}', String(starredMode.total))}
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-6 bg-gray-200 dark:bg-neutral-700" />

            {/* 编辑按钮 */}
            <motion.button
              onClick={starredMode.onEnterEditMode}
              className="p-2.5 text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={t.brew.batchManage}
              aria-label={t.brew.batchManage}
            >
              <Edit3 className="w-4 h-4" />
            </motion.button>
          </motion.div>
        ) : (
          /* 默认模式 - 移动端隐藏（使用三级导航替代），桌面端显示 */
          <motion.div
            key="default-bar"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="hidden sm:flex flex-col sm:flex-row items-center gap-1.5 px-2 py-2 rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10"
          >
            {/* 动态提示 */}
            <div className="flex items-center gap-2 h-10 px-2.5 min-w-[11rem] overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tipKey}
                  initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                  transition={TRANSITION_SLOW}
                  className="flex items-center gap-2"
                >
                  {/* 图标：优先网站图标，否则 emoji */}
                  {tip.iconUrl ? (
                    <img 
                      src={getIconUrl(tip.iconUrl) || ''} 
                      alt="" 
                      className="w-5 h-5 rounded flex-shrink-0 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <span className={`text-base flex-shrink-0 ${tip.iconUrl ? 'hidden' : ''}`}>
                    {tip.icon}
                  </span>
                  <div className="flex flex-col justify-center leading-tight">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate max-w-[9rem]">
                      {tip.main}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[9rem]">
                      {tip.sub}
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* 第二行：按钮组（移动端独占一行） */}
            <div className="flex items-center gap-1.5">
              {/* 排序按钮 */}
              <div className="relative" ref={sortDropdownRef}>
                <motion.button
                  onClick={() => setShowSortDropdown(!showSortDropdown)}
                  className="group flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  title={t.brew.sortMethod}
                  aria-label={t.brew.sortMethod}
                >
                  <ArrowUpDown className="w-4 h-4" />
                  <span className="text-xs font-medium hidden sm:inline">{(t.brew as Record<string, string>)[currentSortOption.labelKey]}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
                </motion.button>
                
                <AnimatePresence>
                  {showSortDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.95 }}
                      transition={TRANSITION_NORMAL}
                      className="absolute bottom-full mb-2 left-0 w-36 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden py-1"
                    >
                      {sortOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            onSortModeChange?.(option.value);
                            setShowSortDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors ${
                            sortMode === option.value 
                              ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' 
                              : 'text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {option.icon}
                          <span>{(t.brew as Record<string, string>)[option.labelKey]}</span>
                          {sortMode === option.value && <Check className="w-3 h-3 ml-auto" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 搜索按钮 */}
              <motion.button
                onClick={() => handleModeChange('search')}
                className="group flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                title={t.brew.search}
                aria-label={t.brew.search}
              >
                <Search className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:inline">{t.brew.search}</span>
              </motion.button>

              {/* 编辑模式按钮 - 仅管理员可见 */}
              {isAdmin && (
                <motion.button
                  onClick={() => handleModeChange('edit')}
                  className="group flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  title={t.brew.editMode}
                  aria-label={t.brew.editMode}
                >
                  <Edit3 className="w-4 h-4" />
                  <span className="text-xs font-medium hidden sm:inline">{t.brew.edit}</span>
                </motion.button>
              )}

              {/* 快捷键按钮 */}
              <motion.button
                onClick={() => handleModeChange('keyboard')}
                className="group flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                title={t.brew.shortcuts}
                aria-label={t.brew.shortcuts}
              >
                <Keyboard className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:inline">{t.brew.shortcuts}</span>
              </motion.button>

              {/* 添加订阅按钮 - 仅管理员可见 */}
              {isAdmin && onAddSource && (
                <motion.button
                  onClick={() => handleModeChange('add')}
                  className="group flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  title={t.brew.addSubscription}
                  aria-label={t.brew.addSubscription}
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-xs font-medium">{t.brew.add}</span>
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </>
  );
}
