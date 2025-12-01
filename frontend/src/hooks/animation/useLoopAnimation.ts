/**
 * 循环动画 Hook
 * 
 * 用于管理持续循环的动画（如天气图标摇摆、音乐播放器动效等）
 * 循环动画与主队列共享槽位，支持优先级抢占
 * 动画结束后自动释放槽位，冷却期结束后自动重新加入队列
 * 
 * 优先级说明：
 * - CORE(0): 核心动画（B站弹幕、网易云、GitHub、Steam），不可被抢占
 * - NORMAL(1): 普通动画（大多数卡片），可被 CORE 抢占
 * - DECORATIVE(2): 装饰动画（背景光晕），优先级最低，最容易被抢占
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { coordinator } from './coordinator';
import { AnimationState, LoopAnimationOptions, LoopPriority } from './types';

interface UseLoopAnimationResult {
  /** 是否正在播放动画 */
  isAnimating: boolean;
  /** 手动请求动画槽位 */
  requestAnimation: () => boolean;
  /** 手动释放动画槽位 */
  releaseAnimation: () => void;
}

let loopIdCounter = 0;

/**
 * 循环动画 Hook
 * 
 * @example
 * ```tsx
 * // 核心动画（B站弹幕，11s播放，10s冷却）
 * const { isAnimating } = useLoopAnimation({
 *   duration: 11000,
 *   cooldown: 10000,
 *   loopPriority: LoopPriority.CORE,
 * });
 * 
 * // 装饰动画（背景光晕）
 * const { isAnimating } = useLoopAnimation({
 *   duration: 5000,
 *   cooldown: 8000,
 *   loopPriority: LoopPriority.DECORATIVE,
 * });
 * ```
 */
export function useLoopAnimation(options: LoopAnimationOptions = {}): UseLoopAnimationResult {
  const {
    duration = 3000,
    cooldown = 10000,
    autoRequest = true,
    releaseOnUnmount = true,
    loopPriority = LoopPriority.NORMAL,
  } = options;

  // 生成稳定的 ID
  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = `loop-${++loopIdCounter}`;
  }
  const id = idRef.current;

  const [isAnimating, setIsAnimating] = useState(false);
  const mountedRef = useRef(true);

  // 订阅状态变化
  useEffect(() => {
    mountedRef.current = true;
    
    const unsubscribe = coordinator.subscribe(id, (state) => {
      if (!mountedRef.current) return;
      
      if (state === AnimationState.RUNNING) {
        setIsAnimating(true);
      } else if (state === AnimationState.COMPLETED || state === AnimationState.SKIPPED) {
        setIsAnimating(false);
      }
    });

    // 自动请求
    if (autoRequest) {
      const success = coordinator.requestLoopSlot(id, duration, cooldown, loopPriority);
      if (success) {
        setIsAnimating(true);
      }
    }

    return () => {
      mountedRef.current = false;
      unsubscribe();
      
      if (releaseOnUnmount) {
        coordinator.releaseLoopSlot(id);
      }
    };
  }, [id, duration, cooldown, autoRequest, releaseOnUnmount, loopPriority]);

  const requestAnimation = useCallback(() => {
    const success = coordinator.requestLoopSlot(id, duration, cooldown, loopPriority);
    if (success) {
      setIsAnimating(true);
    }
    return success;
  }, [id, duration, cooldown, loopPriority]);

  const releaseAnimation = useCallback(() => {
    coordinator.releaseLoopSlot(id);
    setIsAnimating(false);
  }, [id]);

  return {
    isAnimating,
    requestAnimation,
    releaseAnimation,
  };
}

export default useLoopAnimation;
