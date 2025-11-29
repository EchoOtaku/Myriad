/**
 * 壁纸视差效果 Hook - 超轻量版
 * @module useWallpaperParallax
 * @version 1.3
 */

import { useEffect, useRef } from 'react';

// 配置常量
const SCALE = 1.02;
const MAX_OFFSET = 8;
const SMOOTH = 0.08;        // 稍微加快响应
const FRAME_MS = 33;        // ~30fps 节省性能
const GYRO_SENS = 0.5;      // 陀螺仪灵敏度稍微提高
const THRESHOLD = 0.05;     // 更精细的静止检测
const THROTTLE_MS = 32;     // 降低节流，更流畅

interface Options {
  /** 是否启用视差效果 */
  enabled?: boolean;
  enableGyroscope?: boolean;
  enableMouse?: boolean;
  maxOffset?: number;
  scale?: number;
}

interface State {
  tx: number;           // 目标 X
  ty: number;           // 目标 Y
  cx: number;           // 当前 X
  cy: number;           // 当前 Y
  raf: number | null;
  lt: number;           // 上次时间
  active: boolean;
  gyroEnabled: boolean; // 陀螺仪是否已启用
  idle: boolean;
  el: HTMLElement | null;
  lastTf: string;
  offsetMult: number;
  gyroMult: number;
  // iOS 权限请求相关
  permissionRequested: boolean;
  reqHandler: (() => void) | null;
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
    lastTf: '', offsetMult: 0, gyroMult: 0,
    permissionRequested: false, reqHandler: null,
  });

  useEffect(() => {
    const s = stateRef.current;
    
    // 功能禁用时清理
    if (!enabled) {
      const el = document.getElementById(elementId);
      if (el) {
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.willChange = '';
      }
      return;
    }

    const el = document.getElementById(elementId);
    if (!el) return;

    // 初始化状态
    s.tx = 0; s.ty = 0; s.cx = 0; s.cy = 0;
    s.raf = null; s.lt = 0; s.active = true;
    s.gyroEnabled = false; s.idle = true; s.el = el;
    s.lastTf = '';
    s.offsetMult = maxOffset * 2;
    s.gyroMult = maxOffset * GYRO_SENS * 2;
    s.permissionRequested = false;

    // 设置初始样式
    el.style.transformOrigin = 'center';
    el.style.willChange = 'transform';
    const initialTf = `scale(${scale}) translate3d(0,0,0)`;
    el.style.transform = initialTf;
    s.lastTf = initialTf;

    // 动画帧
    const tick = (t: number) => {
      if (!s.active) return;
      
      const delta = t - s.lt;
      if (delta >= FRAME_MS) {
        const factor = Math.min(delta / 16, 2) * SMOOTH; // 根据帧间隔调整
        const dx = (s.tx - s.cx) * factor;
        const dy = (s.ty - s.cy) * factor;
        
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
        
        // 四舍五入到 0.1px
        const rx = Math.round(s.cx * 10) / 10;
        const ry = Math.round(s.cy * 10) / 10;
        const tf = `scale(${scale}) translate3d(${rx}px,${ry}px,0)`;
        if (s.lastTf !== tf) { s.lastTf = tf; el.style.transform = tf; }
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

    // 鼠标事件处理
    let lastMouseTime = 0;
    const onMouse = (e: MouseEvent) => {
      if (s.gyroEnabled) return; // 陀螺仪启用后忽略鼠标
      const now = performance.now();
      if (now - lastMouseTime < THROTTLE_MS) return;
      lastMouseTime = now;
      s.tx = -(e.clientX / innerWidth - 0.5) * s.offsetMult;
      s.ty = -(e.clientY / innerHeight - 0.5) * s.offsetMult;
      wake();
    };
    
    const onMouseLeave = () => { 
      if (s.gyroEnabled) return;
      s.tx = s.ty = 0; 
      wake(); 
    };

    // 陀螺仪事件处理
    let lastGyroTime = 0;
    const onGyro = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      
      const now = performance.now();
      if (now - lastGyroTime < THROTTLE_MS) return;
      lastGyroTime = now;
      
      // 归一化到 -1 ~ 1 范围
      const beta = Math.max(-45, Math.min(45, e.beta)) / 45;   // 前后倾斜
      const gamma = Math.max(-45, Math.min(45, e.gamma)) / 45; // 左右倾斜
      
      s.tx = -gamma * s.gyroMult;
      s.ty = -beta * s.gyroMult;
      wake();
    };

    // 检测设备类型
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // 桌面设备：绑定鼠标事件
    if (enableMouse && !isTouchDevice) {
      window.addEventListener('mousemove', onMouse, { passive: true });
      document.addEventListener('mouseleave', onMouseLeave);
    }

    // 陀螺仪事件绑定
    if (enableGyroscope && 'DeviceOrientationEvent' in window) {
      const DOE = DeviceOrientationEvent as { requestPermission?: () => Promise<string> };
      
      if (typeof DOE.requestPermission === 'function') {
        // iOS 13+ 需要用户交互后请求权限
        const requestPermission = async () => {
          if (s.permissionRequested || !s.active) return;
          s.permissionRequested = true;
          
          try {
            const permission = await DOE.requestPermission!();
            console.log('[WallpaperParallax] iOS gyro permission:', permission);
            
            if (permission === 'granted' && s.active) {
              s.gyroEnabled = true;
              window.addEventListener('deviceorientation', onGyro, { passive: true });
            }
          } catch (e) {
            console.warn('[WallpaperParallax] iOS gyro permission error:', e);
            s.permissionRequested = false; // 允许重试
          }
        };
        
        s.reqHandler = requestPermission;
        document.addEventListener('click', requestPermission);
        document.addEventListener('touchend', requestPermission);
      } else {
        // Android 等设备直接绑定，但需要验证是否真的有陀螺仪数据
        let gyroDataReceived = false;
        const testGyro = (e: DeviceOrientationEvent) => {
          if (e.beta != null && e.gamma != null) {
            gyroDataReceived = true;
            s.gyroEnabled = true;
            window.removeEventListener('deviceorientation', testGyro);
            window.addEventListener('deviceorientation', onGyro, { passive: true });
          }
        };
        window.addEventListener('deviceorientation', testGyro, { passive: true });
        
        // 3秒后如果没收到数据，说明没有陀螺仪
        setTimeout(() => {
          if (!gyroDataReceived) {
            window.removeEventListener('deviceorientation', testGyro);
            console.log('[WallpaperParallax] No gyro data received, fallback to static');
          }
        }, 3000);
      }
    }

    // 清理函数
    return () => {
      s.active = false;
      
      if (s.raf) {
        cancelAnimationFrame(s.raf);
        s.raf = null;
      }
      
      window.removeEventListener('mousemove', onMouse);
      document.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('deviceorientation', onGyro);
      
      // 清理 iOS 权限请求监听
      if (s.reqHandler) {
        document.removeEventListener('click', s.reqHandler);
        document.removeEventListener('touchend', s.reqHandler);
        s.reqHandler = null;
      }
      
      // 重置样式
      if (el) {
        el.style.transform = '';
        el.style.willChange = '';
        el.style.transformOrigin = '';
      }
    };
  }, [enabled, enableMouse, enableGyroscope, scale, maxOffset, elementId]);
}

export default useWallpaperParallax;
