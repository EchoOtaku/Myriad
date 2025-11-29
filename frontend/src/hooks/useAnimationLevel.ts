import { useMemo, useEffect } from 'react';
import { usePerformanceProfile } from './usePerformanceProfile';
import { configureAnimationScheduler } from './useAnimationScheduler';

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
  
  const config = useMemo(() => {
    // prefers-reduced-motion 优先
    if (perf.reduceMotion) {
      return { level: 'none' as const, loop: false, spring: false, durationScale: 0.0 };
    }
    // 低端设备
    if (perf.lowEndDevice) {
      return { level: 'light' as const, loop: false, spring: false, durationScale: 0.6 };
    }
    // 标准设备
    return { level: 'standard' as const, loop: true, spring: true, durationScale: 1.0 };
  }, [perf.reduceMotion, perf.lowEndDevice]);

  // 根据性能级别自动配置动画调度器
  useEffect(() => {
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
          maxConcurrent: 4, 
          minInterval: 100,
          defaultDuration: 400,
        });
        break;
      case 'standard':
        // 标准设备，允许较多动画
        configureAnimationScheduler({ 
          maxConcurrent: 8, 
          minInterval: 50,
          defaultDuration: 500,
        });
        break;
    }
  }, [config.level]);

  return config;
}

