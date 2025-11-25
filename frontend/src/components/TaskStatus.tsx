/**
 * 后台任务状态显示组件
 * 
 * 功能：
 * 1. 实时轮询任务状态
 * 2. 显示处理进度条
 * 3. 错误提示
 * 4. 完成通知
 */

import React, { useEffect, useState, useCallback } from 'react';
import { FaTimes, FaCheckCircle, FaExclamationCircle, FaSpinner } from 'react-icons/fa';

export interface Task {
  id: string;
  platform: string;
  status: 'Pending' | 'Processing' | 'Completed' | 'Failed';
  progress: number;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

interface TaskStatusProps {
  taskId: string;
  onComplete?: (task: Task) => void;
  onError?: (task: Task) => void;
  onClose?: () => void;
  autoClose?: boolean; // 完成后自动关闭
  autoCloseDelay?: number; // 自动关闭延迟（毫秒）
}

export function TaskStatus({
  taskId,
  onComplete,
  onError,
  onClose,
  autoClose = true,
  autoCloseDelay = 3000,
}: TaskStatusProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTaskStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.task) {
        const updatedTask = data.task as Task;
        setTask(updatedTask);

        // 任务完成或失败时停止轮询
        if (updatedTask.status === 'Completed') {
          setIsPolling(false);
          onComplete?.(updatedTask);
          
          if (autoClose) {
            setTimeout(() => {
              onClose?.();
            }, autoCloseDelay);
          }
        } else if (updatedTask.status === 'Failed') {
          setIsPolling(false);
          onError?.(updatedTask);
        }
      } else {
        throw new Error(data.error || 'Failed to fetch task status');
      }
    } catch (err) {
      console.error('Error fetching task status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsPolling(false);
    }
  }, [taskId, onComplete, onError, onClose, autoClose, autoCloseDelay]);

  useEffect(() => {
    // 立即执行一次
    fetchTaskStatus();

    if (!isPolling) return;

    // 每秒轮询一次
    const interval = setInterval(fetchTaskStatus, 1000);

    return () => clearInterval(interval);
  }, [fetchTaskStatus, isPolling]);

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <FaExclamationCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-900 dark:text-red-100">获取任务状态失败</h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-red-400 hover:text-red-600 transition-colors"
              aria-label="关闭错误提示"
              title="关闭"
            >
              <FaTimes className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <FaSpinner className="w-5 h-5 text-gray-400 animate-spin" />
          <span className="text-gray-600 dark:text-gray-300">加载任务信息...</span>
        </div>
      </div>
    );
  }

  const statusConfig = {
    Pending: {
      icon: FaSpinner,
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
      label: '等待中',
    },
    Processing: {
      icon: FaSpinner,
      color: 'text-yellow-500',
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      label: '处理中',
    },
    Completed: {
      icon: FaCheckCircle,
      color: 'text-green-500',
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      label: '已完成',
    },
    Failed: {
      icon: FaExclamationCircle,
      color: 'text-red-500',
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      label: '失败',
    },
  };

  const config = statusConfig[task.status];
  const Icon = config.icon;
  const shouldAnimate = task.status === 'Pending' || task.status === 'Processing';

  return (
    <div className={`${config.bg} border ${config.border} rounded-lg p-4 transition-all`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <Icon
            className={`w-5 h-5 ${config.color} flex-shrink-0 mt-0.5 ${
              shouldAnimate ? 'animate-spin' : ''
            }`}
          />
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {task.platform} - {config.label}
            </h3>
            {task.error && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{task.error}</p>
            )}
          </div>
        </div>
        {onClose && (task.status === 'Completed' || task.status === 'Failed') && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="关闭任务状态"
            title="关闭"
          >
            <FaTimes className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 进度条 */}
      {(task.status === 'Processing' || task.status === 'Pending') && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>处理进度</span>
            <span>{task.progress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 时间信息 */}
      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <div>创建时间: {new Date(task.created_at).toLocaleString('zh-CN')}</div>
        {task.completed_at && (
          <div>完成时间: {new Date(task.completed_at).toLocaleString('zh-CN')}</div>
        )}
      </div>
    </div>
  );
}
