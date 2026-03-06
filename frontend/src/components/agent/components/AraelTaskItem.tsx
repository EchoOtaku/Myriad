/**
 * AraelTaskItem - 单个任务展示组件
 *
 * 与 AraelPanel.tsx 源文件的任务项保持一致
 * 使用 .arael-* CSS 类
 */

import type { ExecutionStep, TaskItem } from '../types'
import React from 'react'

/** TaskItem Props */
export interface AraelTaskItemProps {
  /** 任务数据 */
  task: TaskItem
  /** 是否展开 */
  isExpanded: boolean
  /** 点击展开/收起 */
  onToggleExpand: () => void
  /** 回答问题 */
  onAnswerQuestion?: (task: TaskItem, answer: string) => void
  /** 移除任务 */
  onRemoveTask?: (taskId: string) => void
  /** 添加到收藏 */
  onAddToFavorites?: (input: string) => void
}

/**
 * 任务项组件 - 与源文件一致
 */
export const AraelTaskItem: React.FC<AraelTaskItemProps> = ({
  task,
  isExpanded,
  onToggleExpand,
  onAnswerQuestion,
  onRemoveTask,
  onAddToFavorites,
}) => {
  return (
    <div className={`arael-task-item arael-task-${task.status}`}>
      <div
        className="arael-task-header"
        onClick={onToggleExpand}
      >
        <div className="arael-task-status">
          {task.status === 'processing' && (
            <span className="arael-spinner-small" />
          )}
          {task.status === 'waiting' && (
            <span className="arael-icon-waiting">⏳</span>
          )}
          {task.status === 'completed' && (
            <span className="arael-icon-success">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
          {task.status === 'error' && (
            <span className="arael-icon-error">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
        </div>
        <div className="arael-task-info">
          <span className="arael-task-input">{task.input}</span>
          <span className="arael-task-message">{task.message}</span>
        </div>
        <div className="arael-task-actions">
          {task.status === 'processing' && (
            <span className="arael-task-progress">
              {task.progress}
              %
            </span>
          )}
          {(task.status === 'completed' || task.status === 'error') && onAddToFavorites && (
            <button
              className="arael-task-favorite"
              onClick={(e) => {
                e.stopPropagation()
                onAddToFavorites(task.input)
              }}
              title="添加到收藏"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
          <button
            className="arael-task-expand"
            aria-label={isExpanded ? '收起' : '展开'}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* 展开的任务详情 */}
      <div
        className="arael-task-details-wrapper"
        data-expanded={isExpanded ? 'true' : 'false'}
      >
        <div className="arael-task-details">
          {task.status === 'processing' && (
            <div className="arael-task-progress-bar">
              <div
                className="arael-task-progress-fill"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}

          {task.steps.length > 0 && (
            <div className="arael-task-steps">
              {task.steps.map((step: ExecutionStep) => (
                <div
                  key={step.id}
                  className={`arael-step arael-step-${step.status}`}
                >
                  <span className="arael-step-marker">
                    {step.status === 'pending' && '○'}
                    {step.status === 'running' && '◉'}
                    {step.status === 'completed' && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {step.status === 'error' && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </span>
                  <span className="arael-step-text">{step.name}</span>
                </div>
              ))}
            </div>
          )}

          {task.message && task.message.length > 50 && (
            <div className="arael-task-full-message">
              {task.message}
            </div>
          )}

          {task.status === 'waiting' && task.pendingQuestion?.options && onAnswerQuestion && (
            <div className="arael-question-options">
              {task.pendingQuestion.options.map((option, idx) => (
                <button
                  key={idx}
                  className="arael-option-btn"
                  onClick={() => onAnswerQuestion(task, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {(task.status === 'completed' || task.status === 'error') && onRemoveTask && (
            <div className="arael-task-footer">
              <button
                className="arael-complete-btn"
                onClick={() => onRemoveTask(task.id)}
              >
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AraelTaskItem
