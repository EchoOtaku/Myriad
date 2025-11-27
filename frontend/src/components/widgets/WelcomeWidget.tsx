/**
 * 欢迎小组件 - 4x2卡片
 * Glass风格设计，左右布局，动态引导内容
 */

import { useState, useEffect, memo, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { WidgetComponentProps } from '../WidgetGrid';
import { useWidgetSize } from '../../hooks/useWidgetSize';

interface NavigationGuide {
  title: string;
  description: string;
  features: string[];
  path: string;
  color: string;
}

const navigationGuides: NavigationGuide[] = [
  {
    title: '资料库',
    description: '多平台内容聚合',
    features: [
      '展示个性，在一个地方',
    ],
    path: '/library',
    color: '#8b5cf6',
  },
  {
    title: '数据报告',
    description: '双层智能分析',
    features: [
      '平台画像 + AI综合分析',
    ],
    path: '/reports',
    color: '#06b6d4',
  },
];

export const WelcomeWidget = memo(({ config, isEditMode, isPreview }: WidgetComponentProps) => {
  // 如果是预览模式，强制 scale 为 1，因为外部容器已经进行了缩放
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
  const navigate = useNavigate();
  const [currentGuideIndex, setCurrentGuideIndex] = useState(0);
  const [greeting, setGreeting] = useState('');

  // 动态问候语
  useEffect(() => {
    if (isPreview) {
      setGreeting('欢迎回来');
      return;
    }
    const hour = new Date().getHours();
    if (hour < 6) setGreeting('夜深了');
    else if (hour < 9) setGreeting('早上好');
    else if (hour < 12) setGreeting('上午好');
    else if (hour < 14) setGreeting('中午好');
    else if (hour < 18) setGreeting('下午好');
    else if (hour < 22) setGreeting('晚上好');
    else setGreeting('夜深了');
  }, [isPreview]);

  // 轮播引导卡片
  useEffect(() => {
    if (isEditMode || isPreview) return;
    const timer = setInterval(() => {
      setCurrentGuideIndex((prev) => (prev + 1) % navigationGuides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isEditMode, isPreview]);

  const currentGuide = useMemo(
    () => navigationGuides[currentGuideIndex],
    [currentGuideIndex]
  );

  const handleGuideClick = useCallback(() => {
    if (!isEditMode && currentGuide) {
      navigate(currentGuide.path);
    }
  }, [isEditMode, currentGuide, navigate]);

  // 日期格式化 - 提取到 useMemo 避免每次渲染都格式化
  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('zh-CN', { 
      month: 'long', 
      day: 'numeric',
      weekday: 'long'
    });
  }, []);

  // 渲染导航图标 - 使用 useCallback 避免重复创建
  const renderNavIcon = useCallback((guide: NavigationGuide) => {
    if (guide.path === '/library') {
      return (
        <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      );
    }
    return (
      <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    );
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
      {/* 背景装饰 */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent dark:from-white/[0.02] dark:to-transparent" />
      <motion.div 
        className="absolute -right-16 -top-16 w-48 h-48 rounded-full blur-3xl"
        style={{ background: 'var(--color-primary)' }}
        animate={{ 
          opacity: [0.08, 0.15, 0.08],
          scale: [1, 1.1, 1]
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      {/* 主内容 - 左右布局 */}
      <div 
        className="relative h-full flex flex-row"
        style={{ 
          padding: `${16 * scale}px`, 
          gap: `${20 * scale}px` 
        }}
      >
        {/* 左侧：固定问候区 (35%) */}
        <div className="flex flex-col justify-between" style={{ width: '35%' }}>
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <div className="text-3xl mb-2" style={{ fontSize: `${30 * fontScale}px`, marginBottom: `${8 * scale}px` }}>👋</div>
            <h2 
              className="text-3xl font-black text-gray-800 dark:text-gray-100 leading-none mb-1.5"
              style={{ fontSize: `${30 * fontScale}px`, marginBottom: `${6 * scale}px` }}
            >
              {greeting}
            </h2>
            <p 
              className="text-xs text-gray-500 dark:text-gray-400"
              style={{ fontSize: `${12 * fontScale}px` }}
            >
              {formattedDate}
            </p>
          </motion.div>

          {/* 轮播指示器 */}
          <motion.div 
            className="flex gap-2"
            style={{ gap: `${8 * scale}px` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {navigationGuides.map((guide, index) => (
              <motion.div
                key={index}
                className="h-1 rounded-full"
                style={{ 
                  backgroundColor: index === currentGuideIndex ? 'var(--color-primary)' : '#d1d5db',
                  height: `${4 * scale}px`
                }}
                animate={{
                  width: index === currentGuideIndex ? 28 * scale : 8 * scale,
                  opacity: index === currentGuideIndex ? 1 : 0.4,
                }}
                transition={{ duration: 0.3 }}
              />
            ))}
          </motion.div>
        </div>

        {/* 右侧：动态引导卡片 (65%) */}
        <div className="flex-1 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentGuideIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              onClick={handleGuideClick}
              className="absolute inset-0 cursor-pointer"
            >
              <div 
                className="relative h-full w-full rounded-lg bg-white/60 dark:bg-white/[0.03] backdrop-blur-sm hover:bg-white/80 dark:hover:bg-white/[0.05] transition-all hover:scale-[1.02] shadow-lg overflow-hidden p-4"
                style={{ padding: `${16 * scale}px` }}
              >
                {/* 顶部：图标 + 标题 */}
                <div 
                  className="relative flex items-start gap-3 mb-3"
                  style={{ gap: `${12 * scale}px`, marginBottom: `${12 * scale}px` }}
                >
                  <motion.div
                    className="w-10 h-10 flex-shrink-0 text-gray-700 dark:text-white/60"
                    style={{ width: `${40 * scale}px`, height: `${40 * scale}px` }}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                  >
                    {renderNavIcon(currentGuide)}
                  </motion.div>

                  <div className="flex-1 min-w-0">
                    <h3 
                      className="text-lg font-black mb-0.5 leading-tight text-gray-800 dark:text-gray-100"
                      style={{ fontSize: `${18 * fontScale}px`, marginBottom: `${2 * scale}px` }}
                    >
                      {currentGuide.title}
                    </h3>
                    <p 
                      className="text-[10px] text-gray-500 dark:text-gray-400"
                      style={{ fontSize: `${10 * fontScale}px` }}
                    >
                      {currentGuide.description}
                    </p>
                  </div>
                </div>

                {/* 功能特性 */}
                <div className="relative space-y-1.5 mb-3" style={{ marginBottom: `${12 * scale}px` }}>
                  {currentGuide.features.map((feature, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 + index * 0.08 }}
                      className="flex items-start gap-2 text-[10px] text-gray-600 dark:text-gray-400"
                      style={{ 
                        gap: `${8 * scale}px`, 
                        fontSize: `${10 * fontScale}px`,
                        marginBottom: `${6 * scale}px`
                      }}
                    >
                      <div 
                        className="w-1 h-1 rounded-full mt-1 flex-shrink-0 bg-gray-400 dark:bg-white/30" 
                        style={{ 
                          width: `${4 * scale}px`, 
                          height: `${4 * scale}px`,
                          marginTop: `${4 * scale}px`
                        }}
                      />
                      <span>{feature}</span>
                    </motion.div>
                  ))}
                </div>

                {/* 前往按钮 */}
                <motion.div 
                  className="relative flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-700 dark:text-white/60"
                  style={{ 
                    gap: `${4 * scale}px`,
                    fontSize: `${10 * fontScale}px`
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.4 }}
                >
                  <span>前往</span>
                  <motion.svg 
                    className="w-3 h-3"
                    style={{ width: `${12 * scale}px`, height: `${12 * scale}px` }}
                    fill="currentColor" 
                    viewBox="0 0 20 20"
                    animate={{ x: [0, 3, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  >
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </motion.svg>
                </motion.div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {isEditMode && (
        <div className="absolute inset-0 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none" />
      )}
    </div>
  );
}
);

WelcomeWidget.displayName = 'WelcomeWidget';