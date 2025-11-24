/**
 * 一言小组件
 * 现代化Glass风格设计
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getRandomQuote, QuoteData } from '../../utils/smartWidgets';
import { WidgetConfig } from '../WidgetGrid';

export interface QuoteWidgetProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

export function QuoteWidget({ config, isEditMode, isPreview }: QuoteWidgetProps) {
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeColor, setThemeColor] = useState('#a855f7');

  useEffect(() => {
    if (isPreview) {
      setQuoteData({ text: '生活明朗，万物可爱。', author: '佚名' });
      setLoading(false);
      return;
    }

    const fetchQuote = async () => {
      try {
        const quote = await getRandomQuote();
        if (quote) {
          setQuoteData(quote);
        }
      } catch (error) {
        console.error('获取一言失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchQuote();
    // 每小时更新一次一言
    const interval = setInterval(fetchQuote, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateThemeColor = () => {
      const primaryColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-primary')
        .trim() || '#a855f7';
      setThemeColor(primaryColor);
    };

    updateThemeColor();
    // 监听主题色变化
    const observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    });

    return () => observer.disconnect();
  }, []);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!quoteData) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        <span>一言不可用</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden glass">
      {/* 背景光效 - 呼吸效果 */}
      <motion.div 
        className="absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl"
        style={{ background: themeColor }}
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
      
      {/* 主内容区：2x2紧凑布局 */}
      <div className="absolute inset-0 flex flex-col p-3">
        {/* 顶部：图标 */}
        <motion.div 
          className="mb-1"
          initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
          animate={{ 
            scale: 1, 
            opacity: 1, 
            rotate: 0,
          }}
          transition={{ 
            duration: 0.6, 
            ease: [0.34, 1.56, 0.64, 1]
          }}
        >
          <svg 
            className="w-6 h-6" 
            style={{ color: themeColor }}
            fill="currentColor" 
            viewBox="0 0 24 24"
          >
            <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
          </svg>
        </motion.div>

        {/* 中部：引言内容 */}
        <div className="flex-1 flex flex-col justify-center min-h-0">
          <motion.p 
            className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-relaxed line-clamp-3"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ 
              duration: 0.6, 
              delay: 0.2,
              ease: [0.34, 1.56, 0.64, 1]
            }}
          >
            {quoteData.text}
          </motion.p>
        </div>

        {/* 底部：作者信息 */}
        {quoteData.author && (
          <motion.div 
            className="text-[10px] text-gray-500 dark:text-gray-500 text-right"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            — {quoteData.author}
          </motion.div>
        )}
      </div>
    </div>
  );
}
