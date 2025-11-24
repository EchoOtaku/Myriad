/**
 * 可视化编辑的网格小组件系统
 * 16x4 网格布局，支持拖拽编辑
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaEdit, FaSave, FaTimes, FaPlus } from 'react-icons/fa';
import './WidgetGrid.css';

// 小组件尺寸配置
export type WidgetSize = '1x1' | '2x1' | '1x2' | '2x2' | '2x4' | '4x2' | '4x4';

// 小组件配置接口
export interface WidgetConfig {
  id: string;
  type: string; // 小组件类型标识
  size: WidgetSize;
  position: { x: number; y: number }; // 网格坐标 (0-15, 0-3)
  config?: any; // 小组件特定配置
}

// 小组件组件Props
export interface WidgetComponentProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

// 网格尺寸常量
const GRID_WIDTH = 16;
const GRID_HEIGHT = 4;

// 尺寸到宽高的映射
const SIZE_TO_DIMENSIONS: Record<WidgetSize, { w: number; h: number }> = {
  '1x1': { w: 1, h: 1 },
  '2x1': { w: 2, h: 1 },
  '1x2': { w: 1, h: 2 },
  '2x2': { w: 2, h: 2 },
  '2x4': { w: 2, h: 4 },
  '4x2': { w: 4, h: 2 },
  '4x4': { w: 4, h: 4 },
};

// 可用小组件类型定义
export interface WidgetType {
  id: string;
  name: string;
  defaultSize: WidgetSize;
  icon: string;
  component: React.ComponentType<WidgetComponentProps>;
}

interface WidgetGridProps {
  widgets: WidgetConfig[];
  availableWidgets: WidgetType[];
  onWidgetsChange?: (widgets: WidgetConfig[]) => void;
  isEditMode: boolean;
  onToggleEditMode: (isEdit: boolean) => void;
  children?: React.ReactNode;
}

/**
 * 检查小组件位置是否与其他小组件冲突
 */
function checkCollision(
  widget: WidgetConfig,
  allWidgets: WidgetConfig[],
  excludeId?: string
): boolean {
  const dim = SIZE_TO_DIMENSIONS[widget.size];
  const { x, y } = widget.position;

  // 检查是否超出边界
  if (x < 0 || y < 0 || x + dim.w > GRID_WIDTH || y + dim.h > GRID_HEIGHT) {
    return true;
  }

  // 检查与其他小组件的重叠
  for (const other of allWidgets) {
    if (other.id === excludeId || other.id === widget.id) continue;

    const otherDim = SIZE_TO_DIMENSIONS[other.size];
    const { x: ox, y: oy } = other.position;

    // AABB 碰撞检测
    if (
      x < ox + otherDim.w &&
      x + dim.w > ox &&
      y < oy + otherDim.h &&
      y + dim.h > oy
    ) {
      return true;
    }
  }

  return false;
}

export default function WidgetGrid({
  widgets,
  availableWidgets,
  onWidgetsChange,
  isEditMode,
  onToggleEditMode,
  children,
}: WidgetGridProps) {
  const [draggedWidget, setDraggedWidget] = useState<{
    type: 'existing' | 'new';
    widgetId?: string;
    widgetTypeId?: string;
    offset: { x: number; y: number };
  } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [widgetHistory, setWidgetHistory] = useState<WidgetConfig[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);

  // 计算网格单元格尺寸
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const rect = node.getBoundingClientRect();
      // 存储网格尺寸供拖拽计算使用
      (window as any).__widgetGridRect = rect;
    }
  }, []);

  // 开始拖拽现有小组件
  const handleWidgetDragStart = useCallback(
    (e: React.MouseEvent, widgetId: string) => {
      if (!isEditMode) return;
      e.stopPropagation();
      e.preventDefault();

      const widget = widgets.find((w) => w.id === widgetId);
      if (!widget) return;

      // 获取小组件容器的实际位置
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      
      setDraggedWidget({
        type: 'existing',
        widgetId,
        offset: {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        },
      });
    },
    [isEditMode, widgets]
  );

  // 开始拖拽新小组件
  const handleNewWidgetDragStart = useCallback(
    (e: React.MouseEvent, widgetTypeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      
      // 立即触发一次位置计算
      setDraggedWidget({
        type: 'new',
        widgetTypeId,
        offset: { x: 0, y: 0 },
      });
    },
    []
  );

  // 拖拽移动
  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!draggedWidget) return;

      const gridRect = (window as any).__widgetGridRect;
      if (!gridRect) return;

      // 计算单元格尺寸
      const cellWidth = gridRect.width / GRID_WIDTH;
      const cellHeight = gridRect.height / GRID_HEIGHT;

      // 获取当前拖拽的小组件尺寸
      let size: WidgetSize = '1x1';
      if (draggedWidget.type === 'existing' && draggedWidget.widgetId) {
        const widget = widgets.find((w) => w.id === draggedWidget.widgetId);
        size = widget?.size || '1x1';
      } else if (draggedWidget.type === 'new' && draggedWidget.widgetTypeId) {
        const widgetType = availableWidgets.find(
          (w) => w.id === draggedWidget.widgetTypeId
        );
        size = widgetType?.defaultSize || '1x1';
      }
      const dim = SIZE_TO_DIMENSIONS[size];

      // 计算鼠标在网格中的位置
      let mouseX = e.clientX - gridRect.left;
      let mouseY = e.clientY - gridRect.top;

      // 对于新小组件，以中心点为参考；对于现有小组件，使用拖拽偏移
      if (draggedWidget.type === 'new') {
        // 新小组件：鼠标位于小组件中心
        mouseX -= (dim.w * cellWidth) / 2;
        mouseY -= (dim.h * cellHeight) / 2;
      } else if (draggedWidget.type === 'existing') {
        // 现有小组件：保持拖拽时的相对位置
        mouseX -= draggedWidget.offset.x;
        mouseY -= draggedWidget.offset.y;
      }

      // 转换为网格坐标
      let gridX = Math.floor(mouseX / cellWidth);
      let gridY = Math.floor(mouseY / cellHeight);

      // 确保小组件不会超出边界（考虑小组件尺寸）
      gridX = Math.max(0, Math.min(GRID_WIDTH - dim.w, gridX));
      gridY = Math.max(0, Math.min(GRID_HEIGHT - dim.h, gridY));

      setHoveredCell({ x: gridX, y: gridY });
    },
    [draggedWidget, widgets, availableWidgets]
  );

  // 结束拖拽
  const handleDragEnd = useCallback(() => {
    if (!draggedWidget || !hoveredCell) {
      setDraggedWidget(null);
      setHoveredCell(null);
      return;
    }

    if (draggedWidget.type === 'existing' && draggedWidget.widgetId) {
      // 移动现有小组件
      const widget = widgets.find((w) => w.id === draggedWidget.widgetId);
      if (!widget) return;

      const newWidget = {
        ...widget,
        position: hoveredCell,
      };

      // 检查碰撞
      if (!checkCollision(newWidget, widgets, widget.id)) {
        const updatedWidgets = widgets.map((w) =>
          w.id === widget.id ? newWidget : w
        );
        onWidgetsChange?.(updatedWidgets);
        saveToHistory(updatedWidgets);
      }
    } else if (draggedWidget.type === 'new' && draggedWidget.widgetTypeId) {
      // 添加新小组件
      const widgetType = availableWidgets.find(
        (w) => w.id === draggedWidget.widgetTypeId
      );
      if (!widgetType) return;

      const newWidget: WidgetConfig = {
        id: `widget_${Date.now()}`,
        type: widgetType.id,
        size: widgetType.defaultSize,
        position: hoveredCell,
      };

      // 为特定类型的小组件自动设置配置
      if (widgetType.id.startsWith('platform-')) {
        // 平台卡片小组件
        const platformId = widgetType.id.replace('platform-', '');
        newWidget.config = { platformId };
      } else if (widgetType.id.startsWith('report-')) {
        // 报告卡片小组件
        const platformId = widgetType.id.replace('report-', '');
        newWidget.config = { platformId };
      }

      // 检查碰撞
      if (!checkCollision(newWidget, widgets)) {
        const newWidgets = [...widgets, newWidget];
        onWidgetsChange?.(newWidgets);
        saveToHistory(newWidgets);
      }
    }

    setDraggedWidget(null);
    setHoveredCell(null);
  }, [draggedWidget, hoveredCell, widgets, availableWidgets, onWidgetsChange]);

  // 移除小组件
  const handleRemoveWidget = useCallback(
    (widgetId: string) => {
      const newWidgets = widgets.filter((w) => w.id !== widgetId);
      onWidgetsChange?.(newWidgets);
      // 添加到历史记录
      saveToHistory(newWidgets);
    },
    [widgets, onWidgetsChange]
  );

  // 撤销功能
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevWidgets = widgetHistory[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onWidgetsChange?.(prevWidgets);
    }
  }, [historyIndex, widgetHistory, onWidgetsChange]);

  // 重做功能
  const handleRedo = useCallback(() => {
    if (historyIndex < widgetHistory.length - 1) {
      const nextWidgets = widgetHistory[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onWidgetsChange?.(nextWidgets);
    }
  }, [historyIndex, widgetHistory, onWidgetsChange]);

  // 保存到历史记录
  const saveToHistory = useCallback((newWidgets: WidgetConfig[]) => {
    const newHistory = widgetHistory.slice(0, historyIndex + 1);
    newHistory.push(newWidgets);
    // 限制历史记录数量为20
    if (newHistory.length > 20) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    setWidgetHistory(newHistory);
  }, [widgetHistory, historyIndex]);

  // 注册拖拽事件
  useEffect(() => {
    if (draggedWidget) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [draggedWidget, handleDragMove, handleDragEnd]);

  // 键盘快捷键支持（编辑模式）
  useEffect(() => {
    if (!isEditMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Z: 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y: 重做
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
      // ESC: 取消编辑
      if (e.key === 'Escape') {
        onToggleEditMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, handleUndo, handleRedo, onToggleEditMode]);

  // 预览拖拽位置
  const dragPreview = useMemo(() => {
    if (!draggedWidget || !hoveredCell) return null;

    let size: WidgetSize = '1x1';
    if (draggedWidget.type === 'existing' && draggedWidget.widgetId) {
      const widget = widgets.find((w) => w.id === draggedWidget.widgetId);
      size = widget?.size || '1x1';
    } else if (draggedWidget.type === 'new' && draggedWidget.widgetTypeId) {
      const widgetType = availableWidgets.find(
        (w) => w.id === draggedWidget.widgetTypeId
      );
      size = widgetType?.defaultSize || '1x1';
    }

    const dim = SIZE_TO_DIMENSIONS[size];
    const testWidget: WidgetConfig = {
      id: 'preview',
      type: '',
      size,
      position: hoveredCell,
    };

    const hasCollision = checkCollision(
      testWidget,
      widgets,
      draggedWidget.type === 'existing' ? draggedWidget.widgetId : undefined
    );

    return { position: hoveredCell, size: dim, hasCollision };
  }, [draggedWidget, hoveredCell, widgets, availableWidgets]);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* 编辑模式：小组件库（顶部悬浮） */}
      <AnimatePresence>
        {isEditMode && (
          <motion.div
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 shadow-2xl"
          >
            <div className="w-full max-w-[1920px] mx-auto">
              {/* 控制栏 */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200/30 dark:border-gray-700/30">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <span className="text-lg">📦</span>
                    <span className="font-bold">小组件库</span>
                  </div>
                  
                  <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-2" />
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="撤销 (Ctrl+Z)"
                    >
                      <span className="text-sm font-bold">↶ 撤销</span>
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={historyIndex >= widgetHistory.length - 1}
                      className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="重做 (Ctrl+Shift+Z)"
                    >
                      <span className="text-sm font-bold">↷ 重做</span>
                    </button>
                  </div>
                </div>
              </div>
              
              {/* 组件列表 - 横向滚动 */}
              <div 
                className="flex items-center gap-6 p-6 overflow-x-auto overflow-y-hidden scrollbar-hide min-h-[160px]"
                onWheel={(e) => {
                  if (e.deltaY !== 0) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
              >
                {availableWidgets.map((widgetType) => {
                  const WidgetComponent = widgetType.component;
                  const dim = SIZE_TO_DIMENSIONS[widgetType.defaultSize];
                  
                  // 预览缩放比例
                  const scale = 0.65;
                  // 模拟的标准单元格大小 (px)
                  const baseSize = 90; 
                  
                  // 实际渲染尺寸
                  const renderWidth = dim.w * baseSize;
                  const renderHeight = dim.h * baseSize;
                  
                  // 占位尺寸 (缩小后)
                  const wrapperWidth = renderWidth * scale;
                  const wrapperHeight = renderHeight * scale;

                  // 构造预览配置
                  const previewConfig: WidgetConfig = {
                    id: `preview-${widgetType.id}`,
                    type: widgetType.id,
                    size: widgetType.defaultSize,
                    position: { x: 0, y: 0 },
                    config: widgetType.id.startsWith('platform-') ? { platformId: widgetType.id.replace('platform-', '') } : 
                            widgetType.id.startsWith('report-') ? { platformId: widgetType.id.replace('report-', '') } : undefined
                  };

                  return (
                    <motion.div
                      key={widgetType.id}
                      className="relative group cursor-move flex-shrink-0"
                      style={{ 
                        width: wrapperWidth, 
                        height: wrapperHeight 
                      }}
                      draggable
                      onMouseDown={(e) => handleNewWidgetDragStart(e, widgetType.id)}
                      whileHover={{ scale: 1.05, zIndex: 10 }}
                      whileTap={{ scale: 0.95 }}
                      layout
                    >
                      {/* 缩放容器 */}
                      <div 
                        className="absolute top-0 left-0 origin-top-left pointer-events-none shadow-sm rounded-2xl overflow-hidden ring-1 ring-black/5 dark:ring-white/5"
                        style={{
                          width: renderWidth,
                          height: renderHeight,
                          transform: `scale(${scale})`,
                        }}
                      >
                        <WidgetComponent 
                          config={previewConfig}
                          isEditMode={true}
                          isPreview={true}
                        />
                      </div>

                      {/* 遮罩层 - 用于拖拽交互和高亮 */}
                      <div className="absolute inset-0 z-20 rounded-xl ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-2 group-hover:ring-blue-500 transition-all bg-transparent" />

                      {/* 悬浮提示 */}
                      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-gray-600 dark:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-white/90 dark:bg-gray-800/90 px-3 py-1 rounded-full backdrop-blur-sm shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                        {widgetType.name}
                      </div>
                    </motion.div>
                  );
                })}
                
                {/* 占位符，确保最后一个元素右侧有间距 */}
                <div className="w-2 flex-shrink-0" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 网格区域 */}
      <div className="relative w-full flex-1 flex flex-col justify-end min-h-0 pb-2">
        {/* 插入 children (InfoBar) */}
        {children}

        <div
          ref={gridRef}
          className="widget-grid-container relative w-full rounded-xl overflow-hidden max-h-full"
        >
          {/* 背景网格线（编辑模式） */}
          {isEditMode && (
            <div className="widget-grid-background absolute inset-0 pointer-events-none z-0">

              {Array.from({ length: GRID_WIDTH * GRID_HEIGHT }).map((_, i) => (
                <div
                  key={i}
                  className="border border-gray-200 dark:border-gray-700 border-opacity-30"
                />
              ))}
            </div>
          )}

        {/* 拖拽预览 */}
        {dragPreview && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`absolute z-20 rounded-xl border-2 transition-all pointer-events-none ${
              dragPreview.hasCollision
                ? 'bg-red-500/20 border-red-500'
                : 'bg-green-500/20 border-green-500'
            }`}
            style={{
              left: `${(dragPreview.position.x / GRID_WIDTH) * 100}%`,
              top: `${(dragPreview.position.y / GRID_HEIGHT) * 100}%`,
              width: `${(dragPreview.size.w / GRID_WIDTH) * 100}%`,
              height: `${(dragPreview.size.h / GRID_HEIGHT) * 100}%`,
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
              <span className={dragPreview.hasCollision ? 'text-red-600' : 'text-green-600'}>
                {dragPreview.hasCollision ? '位置冲突' : '可以放置'}
              </span>
            </div>
          </motion.div>
        )}

        {/* 小组件 */}
        <div className="absolute inset-0 z-10">
          {widgets.map((widget, index) => {
            const dim = SIZE_TO_DIMENSIONS[widget.size];
            const widgetType = availableWidgets.find((w) => w.id === widget.type);
            if (!widgetType) return null;

            const WidgetComponent = widgetType.component;

            return (
              <motion.div
                key={widget.id}
                className="absolute"
                style={{
                  left: `${(widget.position.x / GRID_WIDTH) * 100}%`,
                  top: `${(widget.position.y / GRID_HEIGHT) * 100}%`,
                  width: `${(dim.w / GRID_WIDTH) * 100}%`,
                  height: `${(dim.h / GRID_HEIGHT) * 100}%`,
                }}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                layout
                transition={{ 
                  type: 'spring', 
                  stiffness: 300, 
                  damping: 30,
                  opacity: { duration: 0.4 },
                  scale: { duration: 0.4 },
                  y: { duration: 0.4 },
                  delay: index * 0.05 
                }}
              >
                <div className="relative h-full w-full p-1 group">
                  <div
                    className={`h-full w-full rounded-lg overflow-hidden transition-all ${
                      isEditMode 
                        ? 'cursor-move ring-1 ring-transparent hover:ring-blue-400/50' 
                        : ''
                    } ${hoveredWidgetId === widget.id && isEditMode ? 'ring-blue-400/50 shadow-lg' : ''}`}
                    onMouseDown={(e) => handleWidgetDragStart(e, widget.id)}
                    onMouseEnter={() => isEditMode && setHoveredWidgetId(widget.id)}
                    onMouseLeave={() => setHoveredWidgetId(null)}
                  >
                    <WidgetComponent config={widget} isEditMode={isEditMode} />
                  </div>

                  {/* 删除按钮（编辑模式） */}
                  {isEditMode && (
                    <button
                      onClick={() => handleRemoveWidget(widget.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/90 hover:bg-red-600 text-white flex items-center justify-center shadow-md z-30 transition-all hover:scale-110 opacity-0 group-hover:opacity-100"
                      title="删除小组件"
                      aria-label="删除小组件"
                    >
                      <FaTimes size={10} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}
