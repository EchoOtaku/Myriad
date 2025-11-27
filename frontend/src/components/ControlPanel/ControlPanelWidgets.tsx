import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import WidgetGrid, { WidgetConfig, WidgetType } from '../WidgetGrid';
import { WelcomeWidget } from '../widgets/WelcomeWidget';
import { QuickStatsWidget } from '../widgets/QuickStatsWidget';
import { RecentActivityWidget } from '../widgets/RecentActivityWidget';
import { PlatformCardWidget } from '../widgets/PlatformCardWidget';
import { WeatherWidget } from '../widgets/WeatherWidget';
import { QuoteWidget } from '../widgets/QuoteWidget';
import { MusicPlayerWidget } from '../widgets/MusicPlayerWidget';
import { ReportCardWidget } from '../widgets/ReportCardWidget';
import { getCSRFToken } from '../../utils/csrf';

const API_URL = import.meta.env.PUBLIC_API_URL || '';

const CONTROL_PANEL_WIDGETS: WidgetType[] = [
  {
    id: 'welcome',
    name: '欢迎',
    defaultSize: '4x2',
    icon: '👋',
    component: WelcomeWidget,
    supportedSizes: ['4x2'],
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
    supportedSizes: ['2x2', '4x2'],
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
];

const DEFAULT_CONTROL_PANEL_LAYOUT: WidgetConfig[] = [
  {
    id: 'cp-weather',
    type: 'weather',
    size: '2x2',
    position: { x: 0, y: 0 },
  },
  {
    id: 'cp-quote',
    type: 'quote',
    size: '2x2',
    position: { x: 2, y: 0 },
  },
];

interface ControlPanelWidgetsProps {
  isAdmin?: boolean;
}

export const ControlPanelWidgets: React.FC<ControlPanelWidgetsProps> = ({ isAdmin = false }) => {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_CONTROL_PANEL_LAYOUT);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [gridRows, setGridRows] = useState(2);
  const [isLoading, setIsLoading] = useState(true);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const wheelCooldown = useRef(false);
  const startYRef = useRef(0);
  const startRowsRef = useRef(2);
  const currentDragRowsRef = useRef(2);
  const isDraggingRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 从后端加载配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(`${API_URL}/api/config/ui`);
        if (response.ok) {
          const data = await response.json();
          if (data.control_panel_layout) {
            try {
              const layout = JSON.parse(data.control_panel_layout);
              if (Array.isArray(layout) && layout.length > 0) {
                setWidgets(layout);
              }
            } catch (e) {
              console.error('Failed to parse control panel layout', e);
            }
          }
          if (data.control_panel_rows) {
            setGridRows(data.control_panel_rows);
          }
        }
      } catch (e) {
        console.error('Failed to load control panel config', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  // 保存配置到后端（防抖，仅管理员）
  const saveToBackend = useCallback(async (layout: WidgetConfig[], rows: number) => {
    if (!isAdmin) return;

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 防抖 500ms
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const csrfToken = await getCSRFToken(true);
        if (!csrfToken) return;

        await fetch(`${API_URL}/api/config/control-panel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            control_panel_layout: JSON.stringify(layout),
            control_panel_rows: rows
          }),
        });
      } catch (err) {
        console.error('Failed to save control panel config:', err);
      }
    }, 500);
  }, [isAdmin]);

  const handleWidgetsChange = useCallback((newWidgets: WidgetConfig[]) => {
    setWidgets(newWidgets);
    saveToBackend(newWidgets, gridRows);
  }, [gridRows, saveToBackend]);

  const handleRowsChange = useCallback((rows: number) => {
    setGridRows(rows);
    
    // 当切换到 1 行模式时，自动调整小组件尺寸为 4x1
    // 当切换到 2 行模式时，恢复为默认尺寸
    let updatedWidgets: WidgetConfig[];
    if (rows === 1) {
      updatedWidgets = widgets.map(w => {
        const widgetType = CONTROL_PANEL_WIDGETS.find(t => t.id === w.type);
        if (widgetType?.supportedSizes?.includes('4x1')) {
          return { ...w, size: '4x1' as const, position: { x: w.position.x, y: 0 } };
        }
        return w;
      }).filter(w => {
        // 过滤掉不支持 4x1 的小组件
        const widgetType = CONTROL_PANEL_WIDGETS.find(t => t.id === w.type);
        return widgetType?.supportedSizes?.includes('4x1');
      });
    } else {
      // 切换回 2 行模式时，恢复为 2x2 尺寸
      updatedWidgets = widgets.map(w => {
        if (w.size === '4x1') {
          const widgetType = CONTROL_PANEL_WIDGETS.find(t => t.id === w.type);
          const defaultSize = widgetType?.defaultSize || '2x2';
          return { ...w, size: defaultSize };
        }
        return w;
      });
    }
    
    setWidgets(updatedWidgets);
    saveToBackend(updatedWidgets, rows);
  }, [widgets, saveToBackend]);

  // 监听 WidgetGrid 的高度变化，通知父级控制面板重新计算高度
  useEffect(() => {
    const widgetContainer = containerRef.current;
    if (!widgetContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // 触发自定义事件通知 GlobalControlPanel 重新计算高度
      window.dispatchEvent(new CustomEvent('control-panel-content-resize'));
    });

    resizeObserver.observe(widgetContainer);
    return () => resizeObserver.disconnect();
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startYRef.current = e.clientY;
    startRowsRef.current = gridRows;
    currentDragRowsRef.current = gridRows;
    isDraggingRef.current = false;
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    const deltaY = e.clientY - startYRef.current;
    
    // Mark as dragging if moved more than small threshold
    if (Math.abs(deltaY) > 5) {
      isDraggingRef.current = true;
    }

    const threshold = 10; // 10px threshold for switch
    let targetRows = startRowsRef.current;

    if (startRowsRef.current === 2) {
      // If expanded, drag up to shrink
      if (deltaY < -threshold) {
        targetRows = 1;
      } else {
        targetRows = 2;
      }
    } else {
      // If compact, drag down to expand
      if (deltaY > threshold) {
        targetRows = 2;
      } else {
        targetRows = 1;
      }
    }

    if (targetRows !== currentDragRowsRef.current) {
      currentDragRowsRef.current = targetRows;
      handleRowsChange(targetRows);
    }
  };

  const handleResizeEnd = () => {
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };

  const handleMouseDown = useCallback(() => {
    // 只有管理员可以进入编辑模式
    if (!isAdmin || isEditMode) return;
    longPressTimer.current = setTimeout(() => {
      setIsEditMode(true);
    }, 800);
  }, [isAdmin, isEditMode]);

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => {
    if (!isEditMode) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditMode(false);
      }
    };
    
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isEditMode]);

  // 计算最大页数 (基于内容)
  const maxPage = useMemo(() => {
    let maxX = -1;
    widgets.forEach(w => {
      // 简单判断：如果 x >= 8 则在第3页，x >= 4 则在第2页
      if (w.position.x > maxX) maxX = w.position.x;
    });
    
    const lastOccupiedPage = Math.floor(maxX / 4);
    // 编辑模式下允许访问下一页（最多3页，即索引2）
    if (isEditMode) return Math.min(2, lastOccupiedPage + 1);
    // 浏览模式下仅允许访问有内容的页
    return Math.max(0, lastOccupiedPage);
  }, [widgets, isEditMode]);

  // 确保当前页不超过最大页
  useEffect(() => {
    if (currentPage > maxPage) {
      setCurrentPage(maxPage);
    }
  }, [maxPage, currentPage]);

  // 自动切换页面 (10秒一次，仅在非编辑模式且有多页时)
  useEffect(() => {
    if (isEditMode || maxPage <= 0) return;

    const interval = setInterval(() => {
      setCurrentPage(prev => (prev >= maxPage ? 0 : prev + 1));
    }, 10000);

    return () => clearInterval(interval);
  }, [isEditMode, maxPage]);

  // 根据 gridRows 过滤可用小组件（4x1 模式只显示支持 4x1 的小组件）
  const filteredWidgets = useMemo((): WidgetType[] => {
    if (gridRows === 1) {
      // 只显示支持 4x1 的小组件，并将 defaultSize 设为 4x1
      return CONTROL_PANEL_WIDGETS
        .filter(w => w.supportedSizes?.includes('4x1'))
        .map(w => ({
          ...w,
          defaultSize: '4x1' as WidgetType['defaultSize'],
          supportedSizes: ['4x1'] as WidgetType['supportedSizes']
        }));
    }
    return CONTROL_PANEL_WIDGETS;
  }, [gridRows]);

  // 滚轮切换页面处理
  const handleWheel = (e: React.WheelEvent) => {
    if (wheelCooldown.current) return;

    // 阈值判断，避免过于灵敏
    if (Math.abs(e.deltaY) > 30) {
      if (e.deltaY > 0) {
        // 向下/向右滚动 -> 下一页
        if (currentPage < maxPage) {
          setCurrentPage(p => p + 1);
          wheelCooldown.current = true;
          setTimeout(() => wheelCooldown.current = false, 400);
        }
      } else {
        // 向上/向左滚动 -> 上一页
        if (currentPage > 0) {
          setCurrentPage(p => p - 1);
          wheelCooldown.current = true;
          setTimeout(() => wheelCooldown.current = false, 400);
        }
      }
    }
  };

  return (
    <>
      {/* 遮罩层 - 点击退出编辑模式 (Portal 到 body 以避免被裁剪) */}
      {isEditMode && createPortal(
        <div 
          className="fixed inset-0 z-[9998] bg-black/20 backdrop-blur-sm cursor-default"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditMode(false);
          }}
        />,
        document.body
      )}

      <div 
        ref={containerRef}
        className={`control-panel-widgets-container relative w-full transition-all rounded-xl ${isEditMode ? 'z-[9999]' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
      >
         {/* 浅色大框架卡片 */}
         <div className="bg-gray-100/50 dark:bg-white/5 rounded-2xl p-1 border border-gray-200/50 dark:border-white/5 shadow-inner overflow-hidden relative group/container transition-all duration-300 ease-in-out">
           {/* 页面容器 - 通过 transform 切换 */}
           <div 
             className="w-full overflow-hidden"
             onWheel={handleWheel}
           >
             <div 
               className="flex transition-transform duration-500 cubic-bezier(0.25, 1, 0.5, 1)"
               style={{ 
                 width: '300%', // 3页宽度
                 transform: `translateX(-${currentPage * (100 / 3)}%)` 
               }}
             >
               <div 
                 className="w-full transition-all duration-300 ease-in-out"
               >
                 <WidgetGrid
                   widgets={widgets}
                   availableWidgets={filteredWidgets}
                   onWidgetsChange={handleWidgetsChange}
                   isEditMode={isEditMode}
                   onToggleEditMode={setIsEditMode}
                   customGridColumns={12} // 3页宽度 (4 * 3)
                   customGridRows={gridRows}
                   autoHeight={true}
                   libraryContainerClassName="fixed top-20 right-[450px] w-80 rounded-xl border border-gray-200/50 dark:border-white/5 z-[10000] bg-white/80 dark:bg-black/80 backdrop-blur-xl shadow-2xl overflow-hidden"
                   // 优化：改为 flex-col 避免重叠
                   libraryContentClassName="flex flex-col items-center gap-6 p-6 overflow-y-auto max-h-[60vh] scrollbar-hide w-full"
                   libraryAnimation={{
                     initial: { opacity: 0, x: -20 },
                     animate: { opacity: 1, x: 0 },
                     exit: { opacity: 0, x: -20 }
                   }}
                 />
               </div>
             </div>
           </div>

           {/* 底部拉伸条 - 仅在编辑模式下显示 */}
           {isEditMode && (
             <div 
               className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize z-20 flex items-end justify-center opacity-0 group-hover/container:opacity-100 transition-opacity hover:!opacity-100"
               onMouseDown={handleResizeStart}
               onClick={(e) => {
                 e.stopPropagation();
                 if (isDraggingRef.current) return;
                 handleRowsChange(gridRows === 1 ? 2 : 1);
               }}
             >
               <div className="w-16 h-1 bg-gray-300/50 dark:bg-white/20 rounded-full backdrop-blur-sm mb-1 hover:bg-gray-400/50 dark:hover:bg-white/40 transition-colors" />
             </div>
           )}
         </div>
      </div>
    </>
  );
};
