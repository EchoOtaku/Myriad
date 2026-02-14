/**
 * AraelHistory - 历史任务组件
 *
 * 与 AraelPanel.tsx 源文件的历史任务区域保持一致
 * 使用 .arael-* CSS 类
 *
 * 支持两种操作模式：
 * - 「重新运行」：使用保存的 input 开始新对话，不加载历史上下文
 * - 「继续对话」：加载完整对话历史，继续之前的对话
 */

import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useMemo } from 'react';

import { SPRING_SNAPPY } from '../types';
import type { TaskPreset } from '../../../services/agent';

/** 历史组件 Props */
export interface AraelHistoryProps {
  /** 历史记录列表 */
  history: TaskPreset[];
  /** 当前页码 */
  currentPage: number;
  /** 每页条数 */
  pageSize?: number;
  /** 页码变更回调 */
  onPageChange: (page: number) => void;
  /** 重新运行预设回调（使用 input 开始新对话） */
  onUsePreset: (preset: TaskPreset) => void;
  /** 继续对话回调（加载完整对话历史） */
  onContinueConversation?: (preset: TaskPreset) => void;
  /** 切换收藏回调 */
  onToggleFavorite: (presetId: number) => void;
  /** 删除预设回调 */
  onDeletePreset: (presetId: number) => void;
}

const HISTORY_ITEM_HEIGHT = 46; // 每个历史记录项的高度（包含 margin）

/**
 * 历史任务组件 - 与源文件一致
 */
export const AraelHistory: React.FC<AraelHistoryProps> = ({
  history,
  currentPage,
  pageSize = 3,
  onPageChange,
  onUsePreset,
  onContinueConversation,
  onToggleFavorite,
  onDeletePreset,
}) => {
  const totalPages = Math.ceil(history.length / pageSize);

  const displayedHistory = useMemo(() =>
    history.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [history, currentPage, pageSize]
  );

  // 计算当前页历史记录的高度
  const historyPageHeight = useMemo(() => {
    const itemCount = displayedHistory.length;
    const paginationHeight = totalPages > 1 ? 28 : 0;
    return itemCount * HISTORY_ITEM_HEIGHT + paginationHeight;
  }, [displayedHistory.length, totalPages]);

  // 历史记录翻页（滚轮控制）
  const handleHistoryWheel = useCallback((e: React.WheelEvent) => {
    if (history.length <= pageSize) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.deltaY > 0) {
      // 向下滚动 - 下一页
      onPageChange(Math.min(currentPage + 1, totalPages - 1));
    } else if (e.deltaY < 0) {
      // 向上滚动 - 上一页
      onPageChange(Math.max(currentPage - 1, 0));
    }
  }, [history.length, pageSize, currentPage, totalPages, onPageChange]);

  if (history.length === 0) {
    return null;
  }

  return (
    <motion.div
      className="arael-history-pager"
      onWheel={handleHistoryWheel}
      animate={{ height: historyPageHeight }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ overflow: 'hidden' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentPage}
          className="arael-history-page"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {displayedHistory.map((preset) => (
            <div
              key={`history-${preset.id}`}
              className="arael-task-item arael-task-history"
              onClick={() => onUsePreset(preset)}
            >
              <div className="arael-task-header">
                <div className="arael-task-status">
                  <span className="arael-icon-history">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </span>
                </div>
                <div className="arael-task-info">
                  <span className="arael-task-input">{preset.title || preset.input}</span>
                </div>
                <div className="arael-task-actions">
                  {/* 继续对话按钮 - 仅当有对话历史时显示 */}
                  {preset.hasConversation && onContinueConversation && (
                    <button
                      className="arael-task-continue"
                      onClick={(e) => {
                        e.stopPropagation();
                        onContinueConversation(preset);
                      }}
                      title="继续对话"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                  )}
                  <button
                    className="arael-task-favorite"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(preset.id);
                    }}
                    title="添加收藏"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                  <button
                    className="arael-task-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePreset(preset.id);
                    }}
                    aria-label="删除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* 分页指示器 */}
      {totalPages > 1 && (
        <div className="arael-history-pagination">
          {Array.from({ length: totalPages }, (_, i) => (
            <span
              key={i}
              className={`arael-history-dot ${i === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(i)}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default AraelHistory;
