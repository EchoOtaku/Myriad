import { useMemo, useEffect, useContext } from 'react';
import { usePerformanceProfile } from './usePerformanceProfile';
import { configureAnimationScheduler } from './useAnimationScheduler';
import { AnimationPreferenceContext } from '../contexts/AnimationPreferenceContext';

export type AnimationLevel = 'none' | 'light' | 'standard';

export interface AnimationConfig {
  level: AnimationLevel;
  // helpers
  loop: boolean; // allow infinite loops
  spring: boolean; // allow spring physics
  durationScale: number; // multiply base duration
}

export function useAnimationLevel(): AnimationConfig {
  const perf = usePerformanceProfile();
  const prefContext = useContext(AnimationPreferenceContext);

  const config = useMemo(() => {
    // prefers-reduced-motion 优先（无法被手动覆盖）
    if (perf.reduceMotion) {
      return { level: 'none' as const, loop: false, spring: false, durationScale: 0.0 };
    }

    // 如果有手动设置的偏好，使用手动偏好
    if (prefContext?.preference && prefContext.preference !== 'auto') {
      if (prefContext.preference === 'light') {
        return { level: 'light' as const, loop: false, spring: false, durationScale: 0.6 };
      } else if (prefContext.preference === 'standard') {
        return { level: 'standard' as const, loop: true, spring: true, durationScale: 1.0 };
      }
    }

    // 自动检测：低端设备
    if (perf.lowEndDevice) {
      return { level: 'light' as const, loop: false, spring: false, durationScale: 0.6 };
    }
    // 自动检测：标准设备
    return { level: 'standard' as const, loop: true, spring: true, durationScale: 1.0 };
  }, [perf.reduceMotion, perf.lowEndDevice, prefContext?.preference]);

  // Debug 日志
  useEffect(() => {
    console.log('[AnimationLevel]', { level: config.level, isMobile: perf.isMobile, lowEndDevice: perf.lowEndDevice });
  }, [config.level, perf.isMobile, perf.lowEndDevice]);

  // 根据性能级别自动配置动画调度器
  useEffect(() => {
    const isMobile = perf.isMobile;
    
    switch (config.level) {
      case 'none':
        // 完全禁用动画时，只允许 1 个同时运行（基本的 UI 反馈）
        configureAnimationScheduler({ 
          maxConcurrent: 1, 
          minInterval: 200,
          defaultDuration: 200,
        });
        break;
      case 'light':
        // 低端设备，限制同时动画数量
        configureAnimationScheduler({ 
          maxConcurrent: isMobile ? 2 : 4,  // 移动端低端: 2, 桌面端低端: 4
          minInterval: isMobile ? 120 : 100,
          defaultDuration: 400,
        });
        break;
      case 'standard':
        // 标准设备，允许较多动画
        configureAnimationScheduler({ 
          maxConcurrent: isMobile ? 6 : 8,  // 移动端中高端: 6, 桌面端: 8
          minInterval: isMobile ? 60 : 50,
          defaultDuration: 500,
        });
        break;
    }
  }, [config.level, perf.isMobile]);

  return config;
}

