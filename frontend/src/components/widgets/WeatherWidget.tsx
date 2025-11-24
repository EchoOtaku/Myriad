/**
 * 天气小组件 - 重构版
 * 使用glass毛玻璃效果和现代化设计
 */

import { useState, useEffect, memo, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getWeatherInfo, WeatherData } from '../../utils/smartWidgets';
import { WidgetConfig } from '../WidgetGrid';

// 缓存配置
const CACHE_KEY = 'weather_data_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30分钟

export interface WeatherWidgetProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

export const WeatherWidget = memo(({ config, isEditMode, isPreview }: WeatherWidgetProps) => {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  // 从缓存加载
  const loadFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setWeatherData(data);
          return true;
        }
      }
    } catch (err) {
      console.error('加载天气缓存失败:', err);
    }
    return false;
  }, []);

  // 保存到缓存
  const saveToCache = useCallback((data: WeatherData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.error('保存天气缓存失败:', err);
    }
  }, []);

  const fetchWeather = useCallback(async () => {
    try {
      const weather = await getWeatherInfo();
      if (weather) {
        setWeatherData(weather);
        saveToCache(weather);
      }
    } catch (error) {
      console.error('获取天气信息失败:', error);
    } finally {
      setLoading(false);
    }
  }, [saveToCache]);

  useEffect(() => {
    if (isPreview) {
      setWeatherData({
        temperature: '24°',
        weather: '晴',
        city: '示例城市',
        icon: '☀️',
        humidity: 45,
        windSpeed: 12
      });
      setLoading(false);
      return;
    }

    // 先尝试从缓存加载
    const hasCache = loadFromCache();
    if (hasCache) {
      setLoading(false);
    }
    
    // 然后获取最新天气
    fetchWeather();
    
    // 每30分钟更新一次天气
    const interval = setInterval(fetchWeather, CACHE_DURATION);
    return () => clearInterval(interval);
  }, [loadFromCache, fetchWeather, isPreview]);

  // 根据天气状况选择主题色 - 使用 useMemo 缓存
  const themeColor = useMemo(() => {
    if (!weatherData) return '#10b981';
    const weather = weatherData.weather.toLowerCase();
    if (weather.includes('晴')) return '#f59e0b';
    if (weather.includes('雨')) return '#3b82f6';
    if (weather.includes('雪')) return '#6366f1';
    if (weather.includes('云') || weather.includes('阴')) return '#6b7280';
    return '#10b981';
  }, [weatherData]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!weatherData) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        <span>天气信息不可用</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden glass">
      {/* 动态背景光效 - 呼吸效果 */}
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
        {/* 顶部：图标 - 轻微摆动 */}
        <motion.div 
          className="text-3xl mb-1"
          initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
          animate={{ 
            scale: 1, 
            opacity: 1, 
            rotate: [-2, 2, -2],
          }}
          transition={{ 
            scale: { duration: 0.6, ease: [0.34, 1.56, 0.64, 1] },
            opacity: { duration: 0.6 },
            rotate: {
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }
          }}
        >
          {weatherData.icon}
        </motion.div>

        {/* 主要信息：温度和天气状态 */}
        <div className="flex-1 flex flex-col justify-center">
          <motion.div 
            className="flex items-baseline gap-2 mb-1"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ 
              duration: 0.6, 
              delay: 0.2,
              ease: [0.34, 1.56, 0.64, 1]
            }}
          >
            <span className="text-4xl font-black text-gray-800 dark:text-gray-100 leading-none">
              {weatherData.temperature}
            </span>
            <motion.span 
              className="text-base text-gray-600 dark:text-gray-400 font-medium"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              {weatherData.weather}
            </motion.span>
          </motion.div>
          <motion.div 
            className="text-xs text-gray-600 dark:text-gray-400 mb-2"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ 
              duration: 0.6, 
              delay: 0.3,
              ease: [0.34, 1.56, 0.64, 1]
            }}
          >
            {weatherData.city}
          </motion.div>
        </div>

        {/* 次要信息：湿度/风速 - 横向紧凑排列 */}
        {(weatherData.humidity !== undefined || weatherData.windSpeed !== undefined) && (
          <motion.div 
            className="flex items-center gap-2 text-[10px]"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            {weatherData.humidity !== undefined && (
              <div className="flex items-center gap-0.5">
                <span>💧</span>
                <span className="text-gray-600 dark:text-gray-400">{weatherData.humidity}%</span>
              </div>
            )}
            {weatherData.windSpeed !== undefined && (
              <div className="flex items-center gap-0.5">
                <span>🍃</span>
                <span className="text-gray-600 dark:text-gray-400">{Math.round(weatherData.windSpeed)}km/h</span>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
});

WeatherWidget.displayName = 'WeatherWidget';