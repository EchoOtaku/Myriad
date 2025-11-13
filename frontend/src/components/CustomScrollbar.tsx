/**
 * 自定义滚动条组件 - 彻底优化版
 * 替代浏览器原生滚动条，避免布局偏移
 * 特点：
 * - 固定30%高度轨道，居中显示
 * - 使用壁纸色（--color-primary）
 * - 流畅的进入/退出/滚动动画
 * - 超跟手的拖拽体验
 * - 仅在桌面端显示，移动端隐藏
 * - 右侧 1rem 定位
 */

import { useEffect, useState, useRef, useCallback } from 'react';

export default function CustomScrollbar() {
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const dragStartRef = useRef({ scrollY: 0, clientY: 0 });
  const hideTimerRef = useRef<number | null>(null);
  const scrollingTimerRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // 轨道容器固定为屏幕30%高度
  const TRACK_HEIGHT_PERCENT = 0.3;
  const THUMB_HEIGHT_RATIO = 0.25; // 增加到25%，更容易抓取

  // 计算滚动条位置 - 使用 useCallback 优化
  const updateScrollbar = useCallback(() => {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    const scrollableHeight = documentHeight - windowHeight;

    if (scrollableHeight <= 0) {
      setIsVisible(false);
      return;
    }

    const percentage = Math.max(0, Math.min(1, scrollTop / scrollableHeight));
    setScrollPercentage(percentage);
  }, []);

  // 监听滚动事件
  useEffect(() => {
    updateScrollbar();
    window.addEventListener('scroll', updateScrollbar);
    window.addEventListener('resize', updateScrollbar);

    return () => {
      window.removeEventListener('scroll', updateScrollbar);
      window.removeEventListener('resize', updateScrollbar);
    };
  }, [updateScrollbar]);

  // 显示/隐藏滚动条 + 滚动状态检测
  useEffect(() => {
    let lastScrollTime = Date.now();

    const handleScroll = () => {
      const now = Date.now();
      lastScrollTime = now;

      setIsVisible(true);
      setIsScrolling(true);

      // 清除之前的计时器
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (scrollingTimerRef.current) clearTimeout(scrollingTimerRef.current);

      // 100ms 检测滚动停止（更灵敏）
      scrollingTimerRef.current = window.setTimeout(() => {
        setIsScrolling(false);
      }, 100);

      // Hover 或拖拽时不隐藏，否则 1.2 秒后隐藏
      hideTimerRef.current = window.setTimeout(() => {
        if (!isDragging && !isHovering) {
          setIsVisible(false);
        }
      }, 1200);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // 初始显示
    const initialCheck = () => {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollableHeight > 0) {
        setIsVisible(true);
        hideTimerRef.current = window.setTimeout(() => {
          if (!isDragging && !isHovering) {
            setIsVisible(false);
          }
        }, 1800);
      }
    };

    initialCheck();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (scrollingTimerRef.current) clearTimeout(scrollingTimerRef.current);
    };
  }, [isDragging, isHovering]);

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      scrollY: window.scrollY,
      clientY: e.clientY,
    };

    document.body.style.userSelect = 'none';
  };

  // 处理拖拽 - 超跟手优化
  useEffect(() => {
    if (!isDragging) return;

    let lastUpdateTime = performance.now();

    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();

      // 取消之前的帧
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        const deltaY = e.clientY - dragStartRef.current.clientY;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollableHeight = documentHeight - windowHeight;

        // 计算滚动距离
        const trackHeight = windowHeight * TRACK_HEIGHT_PERCENT;
        const thumbHeight = trackHeight * THUMB_HEIGHT_RATIO;
        const availableTrackHeight = trackHeight - thumbHeight;

        // 直接映射，不使用比例，更跟手
        const scrollRatio = deltaY / availableTrackHeight;
        const newScrollY = dragStartRef.current.scrollY + scrollRatio * scrollableHeight;
        const clampedScrollY = Math.max(0, Math.min(newScrollY, scrollableHeight));

        // 直接设置，不使用 scrollTo 的 behavior
        window.scrollTo(0, clampedScrollY);

        lastUpdateTime = now;
      });
    };

    const handleMouseUp = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setIsDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    // 全局拖拽光标
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseleave', handleMouseUp);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // 点击轨道跳转
  const handleTrackClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return; // 只响应轨道点击，不响应thumb点击

    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const trackHeight = rect.height;
    const percentage = clickY / trackHeight;

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollableHeight = documentHeight - windowHeight;

    window.scrollTo({
      top: percentage * scrollableHeight,
      behavior: 'smooth',
    });
  };

  if (!isVisible) return null;

  const windowHeight = window.innerHeight;
  const TRACK_HEIGHT = windowHeight * TRACK_HEIGHT_PERCENT;
  const THUMB_HEIGHT = TRACK_HEIGHT * THUMB_HEIGHT_RATIO;
  const availableTrackHeight = TRACK_HEIGHT - THUMB_HEIGHT;
  const thumbRelativeTop = scrollPercentage * availableTrackHeight;

  return (
    <>
      {/* 滚动条轨道容器 */}
      <div
        className="fixed right-4 w-[10px] z-[9999] hidden md:block pointer-events-none"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        style={{
          height: `${TRACK_HEIGHT}px`,
          top: '50%',
          transform: `translateY(-50%) scale(${isVisible ? 1 : 0.85})`,
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: isVisible ? 'auto' : 'none',
        }}
      >
        {/* 轨道背景 */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            backgroundColor: `color-mix(in srgb, var(--color-primary) ${
              isDragging ? '20%' : isScrolling ? '15%' : isHovering ? '12%' : '8%'
            }, transparent)`,
            backdropFilter: isDragging || isScrolling ? 'blur(10px)' : 'blur(6px)',
            boxShadow: isDragging
              ? `inset 0 0 24px color-mix(in srgb, var(--color-primary) 15%, transparent)`
              : isScrolling
              ? `inset 0 0 14px color-mix(in srgb, var(--color-primary) 8%, transparent)`
              : 'none',
            transform: `scaleX(${isDragging ? 1.15 : isScrolling ? 1.08 : isHovering ? 1.05 : 1})`,
            transition: 'all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />

        {/* Thumb滑块 - 使用壁纸色，增强动画和滚动反馈 */}
        <div
          className="absolute left-0 right-0 rounded-full cursor-grab active:cursor-grabbing pointer-events-auto"
          style={{
            top: `${thumbRelativeTop}px`,
            height: `${THUMB_HEIGHT}px`,
            backgroundColor: `color-mix(in srgb, var(--color-primary) ${
              isDragging ? '95%' : isScrolling ? '75%' : '65%'
            }, transparent)`,
            opacity: isDragging ? 1 : isScrolling ? 0.98 : 0.95,
            boxShadow: isDragging
              ? `0 0 24px color-mix(in srgb, var(--color-primary) 85%, transparent),
                 0 6px 16px color-mix(in srgb, var(--color-primary) 65%, transparent),
                 inset 0 1px 3px rgba(255, 255, 255, 0.4)`
              : isScrolling
              ? `0 0 16px color-mix(in srgb, var(--color-primary) 70%, transparent),
                 0 4px 12px color-mix(in srgb, var(--color-primary) 50%, transparent),
                 inset 0 1px 2px rgba(255, 255, 255, 0.25)`
              : `0 0 12px color-mix(in srgb, var(--color-primary) 60%, transparent),
                 0 2px 8px color-mix(in srgb, var(--color-primary) 40%, transparent)`,
            transform: isDragging
              ? 'scaleX(1.6) scaleY(1.08)'
              : isScrolling
              ? 'scaleX(1.2) scaleY(1.02)'
              : 'scaleX(1) scaleY(1)',
            transition: isDragging
              ? 'top 0s, background-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)'
              : 'top 0s, all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
            backdropFilter: 'blur(4px)',
          }}
          onMouseDown={handleMouseDown}
          onMouseEnter={(e) => {
            if (!isDragging && !isScrolling) {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary) 85%, transparent)';
              e.currentTarget.style.transform = 'scaleX(1.35) scaleY(1.04)';
              e.currentTarget.style.boxShadow = `
                0 0 18px color-mix(in srgb, var(--color-primary) 75%, transparent),
                0 4px 12px color-mix(in srgb, var(--color-primary) 55%, transparent),
                inset 0 1px 2px rgba(255, 255, 255, 0.3)
              `;
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging && !isScrolling) {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary) 65%, transparent)';
              e.currentTarget.style.transform = 'scaleX(1) scaleY(1)';
              e.currentTarget.style.boxShadow = `
                0 0 12px color-mix(in srgb, var(--color-primary) 60%, transparent),
                0 2px 8px color-mix(in srgb, var(--color-primary) 40%, transparent)
              `;
            }
          }}
        />

        {/* 滚动进度指示器 - 微妙的脉冲效果 */}
        {isDragging && (
          <div
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              top: `${thumbRelativeTop + THUMB_HEIGHT / 2}px`,
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: `color-mix(in srgb, var(--color-primary) 30%, transparent)`,
              animation: 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.5;
          }
          50% {
            transform: translate(-50%, -50%) scale(1.8);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}
