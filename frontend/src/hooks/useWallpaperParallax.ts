/**
 * 壁纸视差效果 Hook - 超轻量版
 * @module useWallpaperParallax
 * @version 1.2
 */

import { useEffect, useRef } from 'react';
import { useAnimationLevel } from './useAnimationLevel';

// 配置常量 - 使用位运算友好的数值
const SCALE = 1.02;
const MAX_OFFSET = 8;
const SMOOTH = 0.06;
const FRAME_MS = 33; // ~30fps
const GYRO_SENS = 0.4;
const THRESHOLD = 0.1;
const THROTTLE_MS = 50;

// 预计算常量
const OFFSET_MULT = MAX_OFFSET * 2;
const GYRO_MULT = MAX_OFFSET * GYRO_SENS * 2;

interface Options {
  /** 是否启用视差效果 */
  enabled?: boolean;
  enableGyroscope?: boolean;
  enableMouse?: boolean;
  maxOffset?: number;
  scale?: number;
}

export function useWallpaperParallax(
  elementId = 'wallpaper',
  options: Options = {}
) {
  const {
    enabled = true,
    enableGyroscope = true,
    enableMouse = true,
    maxOffset = MAX_OFFSET,
    scale = SCALE,
  } = options;

  const anim = useAnimationLevel();
  const ref = useRef<{
    tx: number; ty: number; cx: number; cy: number;
    raf: number | null; lt: number; active: boolean;
    gyro: boolean; idle: boolean; el: HTMLElement | null;
    lastTf: string; offsetMult: number; gyroMult: number;
  }>({
    tx: 0, ty: 0, cx: 0, cy: 0,
    raf: null, lt: 0, active: false,
    gyro: false, idle: true, el: null,
    lastTf: '', offsetMult: 0, gyroMult: 0,
  });

  useEffect(() => {
    // 功能禁用时不做任何处理
    if (!enabled) {
      const el = document.getElementById(elementId);
      if (el) {
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.willChange = '';
      }
      return;
    }

    // 低端设备：静态放大
    if (anim.level !== 'standard') {
      const el = document.getElementById(elementId);
      if (el) {
        el.style.transform = `scale(${scale})`;
        el.style.transformOrigin = 'center';
      }
      return;
    }

    const el = document.getElementById(elementId);
    if (!el) return;

    // 初始化状态
    const s = ref.current;
    s.tx = 0; s.ty = 0; s.cx = 0; s.cy = 0;
    s.raf = null; s.lt = 0; s.active = true;
    s.gyro = false; s.idle = true; s.el = el;
    s.lastTf = '';
    s.offsetMult = maxOffset * 2;
    s.gyroMult = maxOffset * GYRO_SENS * 2;

    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';

    // 动画帧
    const tick = (t: number) => {
      if (!s.active) return;
      
      if (t - s.lt >= FRAME_MS) {
        const dx = (s.tx - s.cx) * SMOOTH;
        const dy = (s.ty - s.cy) * SMOOTH;
        
        // 静止检测
        if (Math.abs(s.tx) + Math.abs(s.ty) < THRESHOLD && 
            Math.abs(dx) + Math.abs(dy) < THRESHOLD) {
          s.idle = true;
          s.cx = s.cy = 0;
          const tf = `scale(${scale}) translate3d(0,0,0)`;
          if (s.lastTf !== tf) { s.lastTf = tf; el.style.transform = tf; }
          return;
        }
        
        s.cx += dx;
        s.cy += dy;
        // 使用位或运算快速取整
        const tf = `scale(${scale}) translate3d(${(s.cx * 10 | 0) / 10}px,${(s.cy * 10 | 0) / 10}px,0)`;
        if (s.lastTf !== tf) { s.lastTf = tf; el.style.transform = tf; }
        s.lt = t;
      }
      
      s.raf = requestAnimationFrame(tick);
    };

    const wake = () => { if (s.idle && s.active) { s.idle = false; s.raf = requestAnimationFrame(tick); } };

    // 鼠标 - 节流
    let lmt = 0;
    const onMouse = (e: MouseEvent) => {
      if (s.gyro) return;
      const now = performance.now();
      if (now - lmt < THROTTLE_MS) return;
      lmt = now;
      s.tx = -(e.clientX / innerWidth - 0.5) * s.offsetMult;
      s.ty = -(e.clientY / innerHeight - 0.5) * s.offsetMult;
      wake();
    };
    
    const onLeave = () => { s.tx = s.ty = 0; wake(); };

    // 陀螺仪 - 节流
    let lgt = 0;
    const onGyro = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      s.gyro = true;
      const now = performance.now();
      if (now - lgt < THROTTLE_MS) return;
      lgt = now;
      const b = Math.max(-30, Math.min(30, e.beta)) / 30;
      const g = Math.max(-30, Math.min(30, e.gamma)) / 30;
      s.tx = -g * s.gyroMult;
      s.ty = -b * s.gyroMult;
      wake();
    };

    // 事件绑定
    if (enableMouse) {
      addEventListener('mousemove', onMouse, { passive: true });
      document.addEventListener('mouseleave', onLeave);
    }

    if (enableGyroscope && 'DeviceOrientationEvent' in window) {
      const DOE = DeviceOrientationEvent as { requestPermission?: () => Promise<string> };
      if (DOE.requestPermission) {
        const req = () => {
          DOE.requestPermission!().then(p => {
            if (p === 'granted') addEventListener('deviceorientation', onGyro, { passive: true });
          }).catch(() => {});
          document.removeEventListener('click', req);
          document.removeEventListener('touchstart', req);
        };
        document.addEventListener('click', req, { once: true });
        document.addEventListener('touchstart', req, { once: true });
      } else {
        addEventListener('deviceorientation', onGyro, { passive: true });
      }
    }

    return () => {
      s.active = false;
      if (s.raf) cancelAnimationFrame(s.raf);
      removeEventListener('mousemove', onMouse);
      document.removeEventListener('mouseleave', onLeave);
      removeEventListener('deviceorientation', onGyro);
      el.style.transform = el.style.willChange = el.style.transformOrigin = '';
    };
  }, [anim.level, enabled, enableMouse, enableGyroscope, scale, maxOffset, elementId]);
}

export default useWallpaperParallax;
