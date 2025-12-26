/**
 * Brew 阅读器子组件导出
 */

// 类型导出
export type { 
  ThemeKey, 
  LayoutKey, 
  TocItem, 
  ThemeConfig, 
  FontOption, 
  LayoutOption,
  MobileReaderBarProps,
  ReaderLeftPanelProps,
  ReaderRightPanelProps,
} from './types';

// 常量导出
export {
  THEMES,
  THEME_ORDER,
  FONT_OPTIONS,
  LAYOUT_OPTIONS,
  TRANSITION_FAST,
  TRANSITION_NORMAL,
  TRANSITION_SLOW,
  TRANSITION_PANEL,
  DATE_FORMAT_SHORT,
  DATE_FORMAT_FULL,
  STYLE_TRANSFORM_ORIGIN,
  STYLE_READER_CONTAINER,
  STYLE_SCROLL_SMOOTH,
  STYLE_MAX_HEIGHT_320,
  STYLE_MAX_HEIGHT_60VH,
} from './constants';

// Hooks 导出
export {
  useReaderSettings,
  useAnnotations,
  useComments,
  usePodcast,
} from './hooks';
export type {
  UseReaderSettingsReturn,
  UseAnnotationsOptions,
  UseAnnotationsReturn,
  UseCommentsOptions,
  UseCommentsReturn,
  SelectionRange,
  UsePodcastOptions,
  UsePodcastReturn,
} from './hooks';

// 组件导出
export { MobileReaderBar } from './MobileReaderBar';
export { default as ReaderLeftPanel } from './ReaderLeftPanel';
export { default as ReaderRightPanel } from './ReaderRightPanel';
export { default as CommentsListPanel } from './CommentsListPanel';
export { AnnotationTooltip, CommentTooltip, CommentInputPopup } from './ReaderTooltips';
export { Lightbox } from './Lightbox';
