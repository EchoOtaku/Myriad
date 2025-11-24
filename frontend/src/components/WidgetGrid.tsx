/**
 * 可视化编辑的网格小组件系统
 * 16x4 网格布局，支持拖拽编辑
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaEdit, FaSave, FaTimes, FaPlus } from 'react-icons/fa';
import React from 'react';
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
// 移除 MOBILE_GRID_WIDTH，改为动态计算

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

// Memoized Widget Item Component
const WidgetGridItem = React.memo(({ 
  widget, 
  widgetType, 
  isEditMode, 
  isHovered, 
  onDragStart, 
  onMouseEnter, 
  onMouseLeave, 
  onRemove,
  gridWidth,
  gridHeight,
  cellWidth,
  cellHeight
}: {
  widget: WidgetConfig;
  widgetType: WidgetType;
  isEditMode: boolean;
  isHovered: boolean;
  onDragStart: (e: React.MouseEvent, id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
  onRemove: (id: string) => void;
  gridWidth?: number;
  gridHeight?: number;
  cellWidth?: number;
  cellHeight?: number;
}) => {
  const dim = SIZE_TO_DIMENSIONS[widget.size];
  const WidgetComponent = widgetType.component;
  
  // 使用传入的网格尺寸或默认值
  const gw = gridWidth || GRID_WIDTH;
  const gh = gridHeight || GRID_HEIGHT;

  // 如果有像素级尺寸，优先使用
  const style: React.CSSProperties = (cellWidth && cellHeight) ? {
    left: widget.position.x * cellWidth,
    top: widget.position.y * cellHeight,
    width: dim.w * cellWidth,
    height: dim.h * cellHeight,
    zIndex: isHovered ? 20 : 10,
    willChange: isEditMode ? 'transform, left, top' : 'auto'
  } : {
    left: `${(widget.position.x / gw) * 100}%`,
    top: `${(widget.position.y / gh) * 100}%`,
    width: `${(dim.w / gw) * 100}%`,
    height: `${(dim.h / gh) * 100}%`,
    zIndex: isHovered ? 20 : 10,
    willChange: isEditMode ? 'transform, left, top' : 'auto'
  };

  return (
    <motion.div
      layoutId={widget.id}
      className="absolute"
      style={style}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ 
        type: 'spring', 
        stiffness: 400, 
        damping: 30
      }}
    >
      <div className="relative h-full w-full p-1 group">
        <div
          className={`h-full w-full rounded-lg overflow-hidden transition-all ${
            isEditMode 
              ? 'cursor-move ring-1 ring-transparent hover:ring-blue-400/50' 
              : ''
          } ${isHovered && isEditMode ? 'ring-blue-400/50 shadow-lg' : ''}`}
          onMouseDown={(e) => onDragStart(e, widget.id)}
          onMouseEnter={() => isEditMode && onMouseEnter(widget.id)}
          onMouseLeave={onMouseLeave}
        >
          <WidgetComponent config={widget} isEditMode={isEditMode} />
        </div>

        {/* 删除按钮（编辑模式） */}
        {isEditMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(widget.id);
            }}
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
}, (prev, next) => {
  return (
    prev.widget === next.widget &&
    prev.isEditMode === next.isEditMode &&
    prev.isHovered === next.isHovered &&
    prev.widgetType === next.widgetType &&
    prev.gridWidth === next.gridWidth &&
    prev.gridHeight === next.gridHeight &&
    prev.cellWidth === next.cellWidth &&
    prev.cellHeight === next.cellHeight
  );
});

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
  gridWidth: number,
  gridHeight: number,
  excludeId?: string
): boolean {
  const dim = SIZE_TO_DIMENSIONS[widget.size];
  const { x, y } = widget.position;

  // 检查是否超出边界
  if (x < 0 || y < 0 || x + dim.w > gridWidth || y + dim.h > gridHeight) {
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
  const [gridColumns, setGridColumns] = useState(GRID_WIDTH);
  const isCompact = gridColumns < GRID_WIDTH; // 是否为紧凑模式（移动端/平板）
  const [containerWidth, setContainerWidth] = useState(0);

  // 响应式布局检测
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setGridColumns(4); // 手机
      } else if (width < 1024) {
        setGridColumns(8); // 平板
      } else {
        setGridColumns(16); // 桌面
      }
    };
    
    handleResize(); // 初始化
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 紧凑模式布局计算 (自动重排)
  const compactLayout = useMemo(() => {
    if (!isCompact) return null;

    // 按原始位置排序 (y 优先, 然后 x)
    const sortedWidgets = [...widgets].sort((a, b) => {
      if (a.position.y === b.position.y) return a.position.x - b.position.x;
      return a.position.y - b.position.y;
    });

    const occupied = new Set<string>();
    const newWidgets: WidgetConfig[] = [];
    let maxY = 0;

    const isOccupied = (x: number, y: number, w: number, h: number) => {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          if (occupied.has(`${x + i},${y + j}`)) return true;
        }
      }
      return false;
    };

    const markOccupied = (x: number, y: number, w: number, h: number) => {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          occupied.add(`${x + i},${y + j}`);
        }
      }
    };

    for (const widget of sortedWidgets) {
      const dim = SIZE_TO_DIMENSIONS[widget.size];
      // 限制宽度不超过当前网格列数
      const w = Math.min(dim.w, gridColumns);
      const h = dim.h;

      // 寻找第一个可用位置
      let x = 0;
      let y = 0;
      let placed = false;
      
      while (!placed) {
        if (x + w <= gridColumns && !isOccupied(x, y, w, h)) {
          markOccupied(x, y, w, h);
          newWidgets.push({
            ...widget,
            position: { x, y },
          });
          maxY = Math.max(maxY, y + h);
          placed = true;
        } else {
          x++;
          if (x >= gridColumns) {
            x = 0;
            y++;
          }
        }
        // 防止死循环
        if (y > 100) break; 
      }
    }

    return { widgets: newWidgets, height: Math.max(4, maxY) };
  }, [widgets, isCompact, gridColumns]);

  const currentWidgets = isCompact && compactLayout ? compactLayout.widgets : widgets;
  const currentGridWidth = gridColumns;
  const currentGridHeight = isCompact && compactLayout ? compactLayout.height : GRID_HEIGHT;

  // 计算像素级单元格尺寸 (仅在紧凑模式下使用)
  const cellWidth = isCompact && containerWidth ? containerWidth / gridColumns : undefined;
  const cellHeight = cellWidth; // 正方形单元格
  const totalPixelHeight = isCompact && cellHeight ? currentGridHeight * cellHeight : undefined;

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

  // RAF ref for drag handling
  const rafRef = useRef<number | null>(null);

  // 计算网格单元格尺寸
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const rect = node.getBoundingClientRect();
      // 存储网格尺寸供拖拽计算使用
      (window as any).__widgetGridRect = rect;
      
      // 更新容器宽度
      setContainerWidth(rect.width);
      
      // 使用 ResizeObserver 监听宽度变化
      const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      resizeObserver.observe(node);
      
      // 清理函数需要存储在 ref 中或者使用 useEffect
      // 这里简化处理，因为 gridRef 可能会被多次调用
      (node as any).__resizeObserver = resizeObserver;
    }
  }, []);

  // 清理 ResizeObserver
  useEffect(() => {
    return () => {
      const node = document.querySelector('.widget-grid-container');
      if (node && (node as any).__resizeObserver) {
        (node as any).__resizeObserver.disconnect();
      }
    };
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

      // Use requestAnimationFrame to throttle updates
      if (rafRef.current) {
        return;
      }

      rafRef.current = requestAnimationFrame(() => {
        const gridRect = (window as any).__widgetGridRect;
        if (!gridRect) {
          rafRef.current = null;
          return;
        }

        // 计算单元格尺寸
        const cellWidth = gridRect.width / currentGridWidth;
        const cellHeight = gridRect.height / currentGridHeight;

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
        gridX = Math.max(0, Math.min(currentGridWidth - dim.w, gridX));
        gridY = Math.max(0, Math.min(currentGridHeight - dim.h, gridY));

        setHoveredCell((prev) => {
          if (prev?.x === gridX && prev?.y === gridY) return prev;
          return { x: gridX, y: gridY };
        });
        
        rafRef.current = null;
      });
    },
    [draggedWidget, widgets, availableWidgets, currentGridWidth, currentGridHeight]
  );

  // 结束拖拽
  const handleDragEnd = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

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
      // 注意：在移动端模式下，我们可能需要禁用拖拽或者使用不同的碰撞检测逻辑
      // 这里暂时保持原样，但使用 currentWidgets 进行检测可能不准确，因为 currentWidgets 是计算出来的
      // 如果在移动端拖拽，我们应该更新原始 widgets 的顺序？这比较复杂。
      // 建议：移动端禁用编辑模式
      if (!checkCollision(newWidget, widgets, GRID_WIDTH, GRID_HEIGHT, widget.id)) {
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
      if (!checkCollision(newWidget, widgets, GRID_WIDTH, GRID_HEIGHT)) {
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
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
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
      GRID_WIDTH,
      GRID_HEIGHT,
      draggedWidget.type === 'existing' ? draggedWidget.widgetId : undefined
    );

    return { position: hoveredCell, size: dim, hasCollision };
  }, [draggedWidget, hoveredCell, widgets, availableWidgets]);

  // Memoize grid background
  const gridBackground = useMemo(() => (
    <div 
      className="widget-grid-background absolute inset-0 pointer-events-none z-0"
      style={{
        gridTemplateColumns: `repeat(${currentGridWidth}, 1fr)`,
        gridTemplateRows: `repeat(${currentGridHeight}, 1fr)`,
      }}
    >
      {Array.from({ length: currentGridWidth * currentGridHeight }).map((_, i) => (
        <div
          key={i}
          className="border border-gray-200 dark:border-gray-700 border-opacity-30"
        />
      ))}
    </div>
  ), [currentGridWidth, currentGridHeight]);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* 编辑模式：小组件库（顶部悬浮） */}
      <AnimatePresence>
        {isEditMode && !isCompact && (
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
      <div className={`relative w-full flex-1 flex flex-col ${isCompact ? 'justify-start overflow-visible pb-20' : 'justify-end pb-2'} min-h-0`}>
        {/* 插入 children (InfoBar) */}
        {children}

        <div
          ref={gridRef}
          className={`widget-grid-container relative w-full rounded-xl ${isCompact ? 'overflow-visible' : 'overflow-hidden'}`}
          style={isCompact && totalPixelHeight ? {
            height: totalPixelHeight,
            // 移除 aspectRatio，使用固定高度
          } : {
            aspectRatio: `${currentGridWidth} / ${currentGridHeight}`,
          }}
        >
          {/* 背景网格线（编辑模式） */}
          {isEditMode && !isCompact && gridBackground}

        {/* 拖拽预览 */}
        {dragPreview && !isCompact && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`absolute z-20 rounded-xl border-2 transition-all pointer-events-none ${
              dragPreview.hasCollision
                ? 'bg-red-500/20 border-red-500'
                : 'bg-green-500/20 border-green-500'
            }`}
            style={{
              left: `${(dragPreview.position.x / currentGridWidth) * 100}%`,
              top: `${(dragPreview.position.y / currentGridHeight) * 100}%`,
              width: `${(dragPreview.size.w / currentGridWidth) * 100}%`,
              height: `${(dragPreview.size.h / currentGridHeight) * 100}%`,
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
          {currentWidgets.map((widget, index) => {
            const widgetType = availableWidgets.find((w) => w.id === widget.type);
            if (!widgetType) return null;

            return (
              <WidgetGridItem
                key={widget.id}
                widget={widget}
                widgetType={widgetType}
                isEditMode={isEditMode && !isCompact}
                isHovered={hoveredWidgetId === widget.id}
                onDragStart={handleWidgetDragStart}
                onMouseEnter={setHoveredWidgetId}
                onMouseLeave={() => setHoveredWidgetId(null)}
                onRemove={handleRemoveWidget}
                gridWidth={currentGridWidth}
                gridHeight={currentGridHeight}
                cellWidth={cellWidth}
                cellHeight={cellHeight}
              />
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}
