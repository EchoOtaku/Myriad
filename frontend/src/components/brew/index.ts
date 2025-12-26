/**
 * Brew 模块统一导出入口
 * 组件化架构，便于按需引入
 */

// 主要容器组件
export { default as BrewSourceGrid } from './BrewSourceGrid';
export { default as BrewFeedList } from './BrewFeedList';
export { default as BrewReader } from './BrewReader';
export { default as BrewSidebar } from './BrewSidebar';

// 卡片组件
export { SourceCard, ItemCard, CardSkeleton, EmptyState } from './cards';
export type { SourceCardProps } from './cards';

// 管理组件
export { ControlIsland, EditModal, RSSHubConfig } from './manager';
export type { SortMode } from './manager';

// 阅读器子组件
export * from './reader';

// 类型导出（排除与 cards 冲突的类型）
export type { 
  ItemCardProps, 
  CardSkeletonProps, 
  EmptyStateProps, 
  TimeTranslations, 
  BrewItemTranslations,
  ControlMode,
  DynamicTip,
  FeedModeConfig,
  CategoryFeedModeConfig,
  StarredModeConfig,
  ControlIslandProps,
  BrewExportManifest,
  ImportProgress,
} from './types';

// 常量导出（排除与 reader 冲突的常量）
export { 
  PRESET_CATEGORY_DB_VALUES,
  DEFAULT_THEME_COLOR,
  SIZE_ORDER,
  RESIZE_THRESHOLD,
  SIZE_TO_ROWS,
  SHORT_CONTENT_THRESHOLD,
  SPRING_SNAPPY,
  SPRING_SMOOTH,
  TRANSITION_QUICK,
  API_URL,
  getIconUrl,
  getImageUrl,
  stripHtml,
  getPlainText,
  getFullPlainText,
  isBase64Image,
  getBase64Info,
  getSourceColor,
} from './constants';
