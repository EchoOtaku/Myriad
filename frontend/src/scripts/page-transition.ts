/**
 * 页面切换动画优化
 * 使用View Transition API实现流畅的页面切换效果
 */

// 检查浏览器是否支持View Transition API
const supportsViewTransitions = 'startViewTransition' in document;

/**
 * 优化的页面导航函数
 * @param url 目标URL
 */
export async function navigateWithTransition(url: string) {
  // 如果不支持View Transition，直接跳转
  if (!supportsViewTransitions) {
    window.location.href = url;
    return;
  }

  // 使用View Transition API
  // @ts-ignore - View Transition API可能未在类型定义中
  const transition = document.startViewTransition(async () => {
    // 预加载新页面
    const response = await fetch(url);
    const html = await response.text();
    
    // 解析新页面的body内容
    const parser = new DOMParser();
    const newDocument = parser.parseFromString(html, 'text/html');
    const newBody = newDocument.body;
    
    // 替换当前页面的body
    document.body.replaceWith(newBody);
    
    // 更新浏览器历史
    window.history.pushState({}, '', url);
  });

  // 等待过渡完成
  await transition.finished;
}

/**
 * 为所有链接添加平滑过渡
 */
export function initPageTransitions() {
  // 只在客户端执行
  if (typeof window === 'undefined') return;

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
      !link.target
    ) {
      e.preventDefault();
      navigateWithTransition(link.href);
    }
  });

  // 处理浏览器后退/前进
  window.addEventListener('popstate', () => {
    navigateWithTransition(location.href);
  });
}

/**
 * 添加页面进入动画
 */
export function animatePageEnter() {
  if (typeof document === 'undefined') return;

  // 为主要内容区域添加淡入动画
  const main = document.querySelector('main');
  if (main) {
    main.style.opacity = '0';
    main.style.transform = 'translateY(20px)';
    
    requestAnimationFrame(() => {
      main.style.transition = 'opacity 0.3s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      main.style.opacity = '1';
      main.style.transform = 'translateY(0)';
    });
  }
}

/**
 * 预加载关键页面
 * @param urls 需要预加载的URL列表
 */
export function preloadPages(urls: string[]) {
  if (typeof document === 'undefined') return;

  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  });
}

// CSS动画定义（需要在全局样式中）
export const pageTransitionStyles = `
  /* View Transition API 自定义动画 */
  ::view-transition-old(root) {
    animation: fade-out 0.2s ease-out;
  }

  ::view-transition-new(root) {
    animation: fade-in 0.3s ease-in;
  }

  @keyframes fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* 为不支持View Transition的浏览器提供后备 */
  @supports not (view-transition-name: none) {
    .page-transition-enter {
      animation: fade-in 0.3s ease-in;
    }
  }
`;
