/**
 * 页面切换动画优化
 * 使用自定义加载器实现流畅自然的页面切换体验
 */

/**
 * 页面切换配置
 */
interface TransitionConfig {
  /** 最小加载显示时间（毫秒） */
  minLoadingTime?: number;
  /** 是否预加载 */
  preload?: boolean;
}

/**
 * 获取页面加载器实例
 */
function getPageLoader(): any {
  return (window as any).pageLoader;
}

/**
 * 优化的页面导航函数
 * @param url 目标URL
 * @param config 配置选项
 */
export async function navigateWithTransition(
  url: string, 
  config: TransitionConfig = {}
): Promise<void> {
  const {
    minLoadingTime = 300,
    preload = true
  } = config;

  const loader = getPageLoader();
  
  // 如果当前已在目标页面，不执行跳转
  if (window.location.href === url) {
    return;
  }

  try {
    // 1. 显示加载器
    if (loader) {
      loader.show();
    }

    const startTime = Date.now();

    // 2. 预加载页面（可选）
    if (preload) {
      await preloadPage(url);
    }

    // 3. 确保最小加载时间
    const elapsed = Date.now() - startTime;
    if (elapsed < minLoadingTime) {
      await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsed));
    }

    // 4. 导航到新页面
    window.location.href = url;

  } catch (error) {
    console.error('❌ [PageTransition] Navigation failed:', error);
    
    // 隐藏加载器
    if (loader) {
      loader.hide(0);
    }
    
    // 降级：直接跳转
    window.location.href = url;
  }
}

/**
 * 预加载页面资源
 */
async function preloadPage(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      console.warn('⚠️ [PageTransition] Preload failed, status:', response.status);
    }
  } catch (error) {
    console.warn('⚠️ [PageTransition] Preload error:', error);
  }
}

/**
 * 为所有链接添加平滑过渡
 */
export function initPageTransitions(): void {
  // 只在客户端执行
  if (typeof window === 'undefined') return;

  console.log('🔄 [PageTransition] Initializing page transitions');

  // 拦截所有内部链接点击
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    
    // 检查是否是内部链接
    if (
      link && 
      link.href && 
      link.origin === location.origin && 
      !link.hasAttribute('data-no-transition') &&
      !link.hasAttribute('download') &&
      !link.target &&
      !link.href.includes('#') // 排除锚点链接
    ) {
      e.preventDefault();
      
      // 使用页面切换动画
      navigateWithTransition(link.href, {
        minLoadingTime: 300
      });
    }
  });

  // 浏览器后退/前进 - 直接跳转，不使用加载器
  window.addEventListener('popstate', () => {
    // 浏览器后退/前进时会自动加载页面
    // 我们只需要在页面加载完成后隐藏加载器
    const loader = getPageLoader();
    if (loader && loader.isActive()) {
      loader.hide(0);
    }
  });

  console.log('✅ [PageTransition] Transitions initialized');
}

/**
 * 添加页面进入动画
 */
export function animatePageEnter(): void {
  if (typeof window === 'undefined') return;

  // 页面加载完成，隐藏加载器
  const loader = getPageLoader();
  if (loader && loader.isActive()) {
    loader.hide(300);
  }

  // 为主要内容区域添加淡入动画
  const main = document.querySelector('main');
  if (main) {
    main.style.opacity = '0';
    main.style.transform = 'translateY(10px)';
    
    // 使用 requestAnimationFrame 确保动画平滑
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        main.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        main.style.opacity = '1';
        main.style.transform = 'translateY(0)';
      });
    });
  }
}

/**
 * 预加载关键页面
 * @param urls 需要预加载的URL列表
 */
export function preloadPages(urls: string[]): void {
  if (typeof document === 'undefined') return;

  console.log('🔄 [PageTransition] Preloading pages:', urls);

  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  });
}

/**
 * 初始化页面切换系统
 * 应该在 DOMContentLoaded 后调用
 */
export function initTransitionSystem(): void {
  if (typeof window === 'undefined') return;

  // 初始化链接拦截
  initPageTransitions();

  // 播放页面进入动画
  animatePageEnter();

  // 预加载常用页面
  const commonPages = ['/', '/config', '/account', '/login'];
  preloadPages(commonPages);

  console.log('✅ [PageTransition] Transition system ready');
}

// 兼容旧版API：保留 pageTransitionStyles 导出
export const pageTransitionStyles = `
  /* 页面切换动画样式已移至 PageLoader 组件 */
`;
