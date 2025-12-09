/**
 * 壁纸视差效果 Hook - 超轻量版
 * @module useWallpaperParallax
 * @version 1.4
 */

import { useEffect, useRef } from 'react';

// 配置常量
const SCALE = 1.02;
const MAX_OFFSET = 8;
const SMOOTH = 0.08;
const SMOOTH_RETURN = 0.03;  // 归正时使用更慢的速度
const FRAME_MS = 33;        // ~30fps
const MAX_DELTA = 100;      // 最大时间间隔，防止长时间暂停后位置超调
const GYRO_SENS = 0.5;
const THRESHOLD = 0.05;
const THROTTLE_MS = 50;     // 节流间隔，降低事件处理频率

// 预计算的静态 transform 字符串
const STATIC_TF_PREFIX = `scale(${SCALE}) translate3d(`;
const STATIC_TF_SUFFIX = ',0)';
const IDLE_TF = `scale(${SCALE}) translate3d(0,0,0)`;

interface Options {
  enabled?: boolean;
  enableGyroscope?: boolean;
  enableMouse?: boolean;
  maxOffset?: number;
  scale?: number;
}

interface State {
  tx: number; ty: number; cx: number; cy: number;
  raf: number | null;
  lt: number;
  active: boolean;
  gyroEnabled: boolean;
  idle: boolean;
  el: HTMLElement | null;
  lastRx: number; lastRy: number;  // 上次渲染的坐标，避免字符串比较
  offsetMult: number;
  gyroMult: number;
  permissionRequested: boolean;
  reqHandler: (() => void) | null;
  returning: boolean;  // 是否正在归正（鼠标离开窗口后）
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

  const stateRef = useRef<State>({
    tx: 0, ty: 0, cx: 0, cy: 0,
    raf: null, lt: 0, active: false,
    gyroEnabled: false, idle: true, el: null,
    lastRx: 0, lastRy: 0,
    offsetMult: 0, gyroMult: 0,
    permissionRequested: false, reqHandler: null,
    returning: false,
  });

  useEffect(() => {
    const s = stateRef.current;
    
    // 🔍 调试日志
    console.log('[WallpaperParallax] Hook init', {
      enabled,
      enableMouse,
      enableGyroscope,
      elementId,
    });
    
    if (!enabled) {
      console.log('[WallpaperParallax] Disabled, cleaning up');
      const el = document.getElementById(elementId);
      if (el) {
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.willChange = '';
      }
      return;
    }

    const el = document.getElementById(elementId);
    if (!el) {
      console.warn('[WallpaperParallax] Element not found:', elementId);
      return;
    }
    
    console.log('[WallpaperParallax] Element found:', el);

    // 初始化
    s.tx = 0; s.ty = 0; s.cx = 0; s.cy = 0;
    s.raf = null; s.lt = 0; s.active = true;
    s.gyroEnabled = false; s.idle = true; s.el = el;
    s.lastRx = 0; s.lastRy = 0;
    s.offsetMult = maxOffset * 2;
    s.gyroMult = maxOffset * GYRO_SENS * 2;
    s.permissionRequested = false;
    s.returning = false;

    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';
    el.style.transform = scale === SCALE ? IDLE_TF : `scale(${scale}) translate3d(0,0,0)`;

    // 动画帧 - 优化：减少对象创建和字符串操作
    const tick = (t: number) => {
      if (!s.active) return;

      let delta = t - s.lt;
      if (delta >= FRAME_MS) {
        // 限制 delta 上限，防止长时间暂停后位置超调
        if (delta > MAX_DELTA) delta = MAX_DELTA;

        // 归正模式使用更慢的速度
        const smoothFactor = s.returning ? SMOOTH_RETURN : SMOOTH;
        const factor = delta * smoothFactor * 0.0625; // delta/16 * SMOOTH
        const dx = (s.tx - s.cx) * factor;
        const dy = (s.ty - s.cy) * factor;
        
        // 静止检测
        const txAbs = s.tx < 0 ? -s.tx : s.tx;
        const tyAbs = s.ty < 0 ? -s.ty : s.ty;
        const dxAbs = dx < 0 ? -dx : dx;
        const dyAbs = dy < 0 ? -dy : dy;
        
        if (txAbs + tyAbs < THRESHOLD && dxAbs + dyAbs < THRESHOLD) {
          s.idle = true;
          s.cx = s.cy = 0;
          if (s.lastRx !== 0 || s.lastRy !== 0) {
            s.lastRx = s.lastRy = 0;
            el.style.transform = scale === SCALE ? IDLE_TF : `scale(${scale}) translate3d(0,0,0)`;
          }
          return;
        }
        
        s.cx += dx;
        s.cy += dy;
        
        // 使用位运算快速取整到 0.1px（避免 Math.round）
        const rx = ((s.cx * 10 + 0.5) | 0) / 10;
        const ry = ((s.cy * 10 + 0.5) | 0) / 10;
        
        // 只在坐标变化时更新 DOM
        if (rx !== s.lastRx || ry !== s.lastRy) {
          s.lastRx = rx;
          s.lastRy = ry;
          el.style.transform = scale === SCALE 
            ? `${STATIC_TF_PREFIX}${rx}px,${ry}px${STATIC_TF_SUFFIX}`
            : `scale(${scale}) translate3d(${rx}px,${ry}px,0)`;
        }
        s.lt = t;
      }
      
      s.raf = requestAnimationFrame(tick);
    };

    const wake = () => { 
      if (s.idle && s.active) { 
        s.idle = false; 
        s.lt = performance.now();
        s.raf = requestAnimationFrame(tick); 
      } 
    };

    // 鼠标事件 - 使用闭包变量避免创建对象
    let lastMouseTime = 0;
    const onMouse = (e: MouseEvent) => {
      if (s.gyroEnabled) return;
      const now = performance.now();
      if (now - lastMouseTime < THROTTLE_MS) return;
      lastMouseTime = now;
      s.returning = false;  // 鼠标移动时退出归正模式
      s.tx = -(e.clientX / innerWidth - 0.5) * s.offsetMult;
      s.ty = -(e.clientY / innerHeight - 0.5) * s.offsetMult;
      wake();
    };

    const onMouseLeave = () => {
      if (s.gyroEnabled) return;
      s.returning = true;  // 进入归正模式，使用更慢的动画
      s.tx = s.ty = 0;
      wake();
    };

    // 陀螺仪事件
    let lastGyroTime = 0;
    const onGyro = (e: DeviceOrientationEvent) => {
      const beta = e.beta;
      const gamma = e.gamma;
      if (beta == null || gamma == null) return;
      
      const now = performance.now();
      if (now - lastGyroTime < THROTTLE_MS) return;
      lastGyroTime = now;
      
      // 内联 clamp 避免函数调用
      const b = (beta < -45 ? -45 : beta > 45 ? 45 : beta) / 45;
      const g = (gamma < -45 ? -45 : gamma > 45 ? 45 : gamma) / 45;
      
      s.tx = -g * s.gyroMult;
      s.ty = -b * s.gyroMult;
      wake();
    };

    // 设备检测
    // 🔧 修复：不再使用 maxTouchPoints 来禁用鼠标事件
    // 很多 Windows 笔记本有触摸屏（maxTouchPoints > 0）但用户主要使用鼠标操作
    // 改为：检测是否为纯移动设备（无鼠标指针）
    const isMobileOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    
    console.log('[WallpaperParallax] Device detection', {
      isMobileOnly,
      enableMouse,
      maxTouchPoints: navigator.maxTouchPoints,
      hoverNone: window.matchMedia('(hover: none)').matches,
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    });
    
    // 桌面设备（包括带触摸屏的笔记本）：启用鼠标事件
    // 纯移动设备（手机/平板无鼠标）：跳过鼠标事件，使用陀螺仪
    if (enableMouse && !isMobileOnly) {
      console.log('[WallpaperParallax] Registering mouse events');
      window.addEventListener('mousemove', onMouse, { passive: true });
      document.addEventListener('mouseleave', onMouseLeave);
    } else {
      console.log('[WallpaperParallax] Mouse events SKIPPED (mobile-only device)');
    }

    if (enableGyroscope && 'DeviceOrientationEvent' in window) {
      const DOE = DeviceOrientationEvent as { requestPermission?: () => Promise<string> };
      
      if (typeof DOE.requestPermission === 'function') {
        const requestPermission = async () => {
          if (s.permissionRequested || !s.active) return;
          s.permissionRequested = true;
          
          try {
            const permission = await DOE.requestPermission!();
            if (permission === 'granted' && s.active) {
              s.gyroEnabled = true;
              window.addEventListener('deviceorientation', onGyro, { passive: true });
            }
          } catch {
            s.permissionRequested = false;
          }
        };
        
        s.reqHandler = requestPermission;
        document.addEventListener('click', requestPermission);
        document.addEventListener('touchend', requestPermission);
      } else {
        // Android: 验证陀螺仪是否可用
        let received = false;
        const testGyro = (e: DeviceOrientationEvent) => {
          if (e.beta != null && e.gamma != null) {
            received = true;
            s.gyroEnabled = true;
            window.removeEventListener('deviceorientation', testGyro);
            window.addEventListener('deviceorientation', onGyro, { passive: true });
          }
        };
        window.addEventListener('deviceorientation', testGyro, { passive: true });
        
        setTimeout(() => {
          if (!received) window.removeEventListener('deviceorientation', testGyro);
        }, 3000);
      }
    }

    return () => {
      s.active = false;
      if (s.raf) cancelAnimationFrame(s.raf);
      
      window.removeEventListener('mousemove', onMouse);
      document.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('deviceorientation', onGyro);
      
      if (s.reqHandler) {
        document.removeEventListener('click', s.reqHandler);
        document.removeEventListener('touchend', s.reqHandler);
        s.reqHandler = null;
      }
      
      el.style.transform = '';
      el.style.willChange = '';
      el.style.transformOrigin = '';
    };
  }, [enabled, enableMouse, enableGyroscope, scale, maxOffset, elementId]);
}

export default useWallpaperParallax;
