import { useMemo } from 'react';
import { usePerformanceProfile } from './usePerformanceProfile';

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
  return useMemo(() => {
    // prefers-reduced-motion 优先
    if (perf.reduceMotion) {
      return { level: 'none', loop: false, spring: false, durationScale: 0.0 };
    }
    // 低端设备
    if (perf.lowEndDevice) {
      return { level: 'light', loop: false, spring: false, durationScale: 0.6 };
    }
    // 标准设备
    return { level: 'standard', loop: true, spring: true, durationScale: 1.0 };
  }, [perf.reduceMotion, perf.lowEndDevice]);
}
