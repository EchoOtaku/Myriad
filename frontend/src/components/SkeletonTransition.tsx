/**
 * 统一骨架屏过渡组件
 * 用于内容加载和切换时的平滑过渡
 */

import { useEffect, useState, ReactNode } from 'react';
import './Skeleton.css';

interface SkeletonTransitionProps {
  /** 是否显示骨架屏 */
  loading: boolean;
  /** 骨架屏内容 */
  skeleton: ReactNode;
  /** 实际内容 */
  children: ReactNode;
  /** 过渡延迟（毫秒） */
  delay?: number;
  /** 最小显示时间（毫秒），避免闪烁 */
  minDuration?: number;
  /** 自定义类名 */
  className?: string;
}

export default function SkeletonTransition({
  loading,
  skeleton,
  children,
  delay = 0,
  minDuration = 300,
  className = ''
}: SkeletonTransitionProps) {
  const [showSkeleton, setShowSkeleton] = useState(loading);
  const [contentReady, setContentReady] = useState(!loading);
  const [startTime, setStartTime] = useState<number>(0);

  useEffect(() => {
    if (loading) {
      // 开始加载
      setShowSkeleton(true);
      setContentReady(false);
      setStartTime(Date.now());
    } else {
      // 加载完成，检查是否满足最小显示时间
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minDuration - elapsed);

      setTimeout(() => {
        // 淡出骨架屏
        setShowSkeleton(false);
        
        // 延迟后显示内容
        setTimeout(() => {
          setContentReady(true);
        }, delay);
      }, remaining);
    }
  }, [loading, delay, minDuration, startTime]);

  return (
    <div className={`skeleton-transition-container ${className}`}>
      {/* 骨架屏层 */}
      <div
        className={`skeleton-transition-layer ${showSkeleton ? 'skeleton-visible' : 'skeleton-hidden'}`}
      >
        {skeleton}
      </div>

      {/* 内容层 */}
      <div
        className={`skeleton-transition-layer content-layer ${contentReady ? 'content-visible' : 'content-hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 简化版：仅用于标签切换等快速过渡
 */
interface QuickTransitionProps {
  /** 是否处于过渡状态 */
  transitioning: boolean;
  /** 内容 */
  children: ReactNode;
  /** 自定义类名 */
  className?: string;
}

export function QuickTransition({
  transitioning,
  children,
  className = ''
}: QuickTransitionProps) {
  return (
    <div
      className={`quick-transition ${transitioning ? 'transitioning' : 'visible'} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * 微粒消散效果骨架屏
 * 高级灰透明质感，介于透明与磨砂之间
 */
interface LiquidGlassSkeletonProps {
  /** 加载文本 */
  text?: string;
  /** 自定义类名 */
  className?: string;
}

export function LiquidGlassSkeleton({
  text = '加载中',
  className = ''
}: LiquidGlassSkeletonProps) {
  // 生成微粒 - 更多更细腻
  const particles = Array.from({ length: 80 }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 400 + 200;
    return {
      id: i,
      size: Math.random() * 3 + 1,
      startX: 50,
      startY: 50,
      tx: Math.cos(angle) * distance,
      ty: Math.sin(angle) * distance,
      delay: Math.random() * 4,
      duration: Math.random() * 6 + 4
    };
  });

  return (
    <div className={`liquid-glass-skeleton ${className}`}>
      {/* 网格噪点背景 */}
      <div className="noise-grid" />
      
      {/* 微粒消散层 */}
      <div className="liquid-wave">
        <div className="particle-layer">
          {particles.map(particle => (
            <div
              key={particle.id}
              className="particle"
              style={{
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                left: `${particle.startX}%`,
                top: `${particle.startY}%`,
                '--tx': `${particle.tx}px`,
                '--ty': `${particle.ty}px`,
                animationDelay: `${particle.delay}s`,
                animationDuration: `${particle.duration}s`
              } as React.CSSProperties}
            />
          ))}
        </div>
      </div>
      
      {/* 内容区 */}
      <div className="glass-content">
        {/* 呼吸光环 */}
        <div className="pulse-ring" />
        
        {/* 加载文本 */}
        <div className="loading-text">
          {text}
        </div>
        
        {/* 消散点 */}
        <div className="loading-dots">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    </div>
  );
}
