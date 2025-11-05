/**
 * 前端性能监控工具
 * 监测页面加载性能、FPS、内存使用等指标
 */

interface PerformanceMetrics {
  fcp: number; // First Contentful Paint
  lcp: number; // Largest Contentful Paint
  fid: number; // First Input Delay
  cls: number; // Cumulative Layout Shift
  ttfb: number; // Time to First Byte
  fps: number; // Frames Per Second
}

class PerformanceMonitor {
  private metrics: Partial<PerformanceMetrics> = {};
  private fpsFrames: number[] = [];
  private rafId: number | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === 'undefined') return;

    // 监测Core Web Vitals
    this.measureWebVitals();
    
    // 开始FPS监测
    this.startFPSMonitor();

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopFPSMonitor();
      } else {
        this.startFPSMonitor();
      }
    });
  }

  /**
   * 测量Web Vitals指标
   */
  private measureWebVitals() {
    // 使用Performance Observer API
    if ('PerformanceObserver' in window) {
      // First Contentful Paint (FCP)
      try {
        const fcpObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              this.metrics.fcp = entry.startTime;
              console.log(`✅ FCP: ${entry.startTime.toFixed(2)}ms`);
            }
          }
        });
        fcpObserver.observe({ entryTypes: ['paint'] });
      } catch (e) {
        console.warn('FCP monitoring not supported');
      }

      // Largest Contentful Paint (LCP)
      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          this.metrics.lcp = lastEntry.startTime;
          console.log(`✅ LCP: ${lastEntry.startTime.toFixed(2)}ms`);
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      } catch (e) {
        console.warn('LCP monitoring not supported');
      }

      // Cumulative Layout Shift (CLS)
      try {
        let clsValue = 0;
        const clsObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            // @ts-ignore
            if (!entry.hadRecentInput) {
              // @ts-ignore
              clsValue += entry.value;
              this.metrics.cls = clsValue;
            }
          }
          console.log(`✅ CLS: ${clsValue.toFixed(4)}`);
        });
        clsObserver.observe({ entryTypes: ['layout-shift'] });
      } catch (e) {
        console.warn('CLS monitoring not supported');
      }

      // First Input Delay (FID)
      try {
        const fidObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            // @ts-ignore
            this.metrics.fid = entry.processingStart - entry.startTime;
            console.log(`✅ FID: ${this.metrics.fid.toFixed(2)}ms`);
          }
        });
        fidObserver.observe({ entryTypes: ['first-input'] });
      } catch (e) {
        console.warn('FID monitoring not supported');
      }
    }

    // Time to First Byte (TTFB)
    if (performance.timing) {
      const ttfb = performance.timing.responseStart - performance.timing.requestStart;
      this.metrics.ttfb = ttfb;
      console.log(`✅ TTFB: ${ttfb}ms`);
    }
  }

  /**
   * 开始FPS监测
   */
  private startFPSMonitor() {
    let lastTime = performance.now();
    let frames = 0;

    const measureFPS = (currentTime: number) => {
      frames++;
      const delta = currentTime - lastTime;

      // 每秒计算一次FPS
      if (delta >= 1000) {
        const fps = Math.round((frames * 1000) / delta);
        this.metrics.fps = fps;
        this.fpsFrames.push(fps);
        
        // 只保留最近10秒的数据
        if (this.fpsFrames.length > 10) {
          this.fpsFrames.shift();
        }

        // FPS低于30时发出警告
        if (fps < 30) {
          console.warn(`⚠️ Low FPS detected: ${fps}`);
        }

        frames = 0;
        lastTime = currentTime;
      }

      this.rafId = requestAnimationFrame(measureFPS);
    };

    this.rafId = requestAnimationFrame(measureFPS);
  }

  /**
   * 停止FPS监测
   */
  private stopFPSMonitor() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 获取平均FPS
   */
  public getAverageFPS(): number {
    if (this.fpsFrames.length === 0) return 0;
    const sum = this.fpsFrames.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.fpsFrames.length);
  }

  /**
   * 获取所有性能指标
   */
  public getMetrics(): Partial<PerformanceMetrics> {
    return {
      ...this.metrics,
      fps: this.getAverageFPS(),
    };
  }

  /**
   * 输出性能报告
   */
  public logReport() {
    console.group('📊 Performance Report');
    console.log('FCP (First Contentful Paint):', this.metrics.fcp?.toFixed(2), 'ms');
    console.log('LCP (Largest Contentful Paint):', this.metrics.lcp?.toFixed(2), 'ms');
    console.log('FID (First Input Delay):', this.metrics.fid?.toFixed(2), 'ms');
    console.log('CLS (Cumulative Layout Shift):', this.metrics.cls?.toFixed(4));
    console.log('TTFB (Time to First Byte):', this.metrics.ttfb, 'ms');
    console.log('Average FPS:', this.getAverageFPS());
    console.groupEnd();
  }

  /**
   * 检测长任务
   */
  public detectLongTasks() {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            console.warn(`⚠️ Long task detected: ${entry.duration.toFixed(2)}ms`, entry);
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.warn('Long task monitoring not supported');
      }
    }
  }
}

// 创建单例实例
let monitorInstance: PerformanceMonitor | null = null;

/**
 * 获取性能监控实例
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!monitorInstance && typeof window !== 'undefined') {
    monitorInstance = new PerformanceMonitor();
  }
  return monitorInstance!;
}

/**
 * 快速检查性能
 */
export function quickPerformanceCheck() {
  if (typeof window === 'undefined') return;

  const monitor = getPerformanceMonitor();
  
  // 延迟输出，确保有足够的数据
  setTimeout(() => {
    monitor.logReport();
  }, 3000);
}

// 自动启动性能监控（仅在开发环境）
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.log('🚀 Performance monitoring started');
  quickPerformanceCheck();
  
  // 监测长任务
  getPerformanceMonitor().detectLongTasks();
}
