/**
 * 天气小组件 - 重构版
 * 使用glass毛玻璃效果和现代化设计
 */

import { useState, useEffect, memo, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getWeatherInfo, WeatherData } from '../../utils/dynamicContent';
import { WidgetConfig } from '../WidgetGrid';
import { useWidgetSize } from '../../hooks/useWidgetSize';

// 缓存配置
const CACHE_KEY = 'weather_data_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30分钟

export interface WeatherWidgetProps {
  config: WidgetConfig;
  isEditMode: boolean;
  isPreview?: boolean;
}

export const WeatherWidget = memo(({ config, isEditMode, isPreview }: WeatherWidgetProps) => {
  const { containerRef, scale, fontScale } = useWidgetSize(config.size, isPreview ? 1 : undefined);
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

  // 4x2 宽版布局 - 左右结构重构 (左3/5 右2/5)
  if (config.size === '4x2') {
    return (
      <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
        {/* 动态背景光效 */}
        <motion.div 
          className="absolute -right-8 -top-8 w-48 h-48 rounded-full blur-3xl"
          style={{ background: themeColor }}
          animate={{ opacity: [0.1, 0.2, 0.1], scale: [1, 1.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        
        <div className="absolute inset-0 flex flex-row px-4 py-3" style={{ padding: `${12 * scale}px` }}>
          {/* 左侧：主要信息 (60%) */}
          <div className="w-[60%] flex flex-col justify-between pr-2 border-r border-gray-200/10 dark:border-white/10">
            {/* 顶部：城市 */}
            <div className="flex justify-between items-start">
               <div className="font-bold text-gray-700 dark:text-gray-200 truncate" style={{ fontSize: `${16 * fontScale}px` }}>
                 {weatherData.city}
               </div>
            </div>

            {/* 中部：温度和图标 */}
            <div className="flex items-center gap-3 my-auto">
              <motion.div 
                className="text-4xl drop-shadow-md flex-shrink-0"
                style={{ fontSize: `${42 * fontScale}px` }}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                {weatherData.icon}
              </motion.div>
              
              <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-baseline gap-2 overflow-hidden">
                  <span className="font-black text-gray-800 dark:text-gray-100 leading-none tracking-tight truncate" style={{ fontSize: `${36 * fontScale}px` }}>
                    {weatherData.temperature}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-base text-gray-600 dark:text-gray-400 font-medium truncate" style={{ fontSize: `${14 * fontScale}px` }}>
                    {weatherData.weather}
                  </span>
                  {weatherData.feelsLike !== undefined && (
                    <span className="text-xs text-gray-500 dark:text-gray-500" style={{ fontSize: `${12 * fontScale}px` }}>
                      体感 {weatherData.feelsLike}°
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 底部：详细信息 (一行排列) */}
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 overflow-hidden whitespace-nowrap" style={{ fontSize: `${10 * fontScale}px` }}>
              {weatherData.humidity !== undefined && (
                <div className="flex items-center gap-1" title="湿度">
                  <span>💧</span>
                  <span>{weatherData.humidity}%</span>
                </div>
              )}
              {weatherData.windSpeed !== undefined && (
                <div className="flex items-center gap-1" title="风速">
                  <span>🍃</span>
                  <span>{Math.round(weatherData.windSpeed)}km/h</span>
                </div>
              )}
              {weatherData.aqi !== undefined && (
                <div className="flex items-center gap-1" title="空气质量">
                  <span>{
                    weatherData.aqi <= 50 ? '🌿' : 
                    weatherData.aqi <= 100 ? '🌫️' : 
                    '😷'
                  }</span>
                  <span className={
                    weatherData.aqi <= 50 ? 'text-green-500' :
                    weatherData.aqi <= 100 ? 'text-yellow-500' :
                    weatherData.aqi <= 150 ? 'text-orange-500' :
                    'text-red-500'
                  }>AQI {weatherData.aqi}</span>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：未来天气预报 (40%) */}
          <div className="w-[40%] pl-2 flex flex-col justify-between gap-1 h-full">
            {weatherData.forecast ? (
              weatherData.forecast.slice(0, 3).map((day, i) => (
                <motion.div 
                  key={day.date}
                  className="flex-1 flex items-center justify-between px-2 rounded-md hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * i }}
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400 w-8" style={{ fontSize: `${11 * fontScale}px` }}>
                    {new Date(day.date).toLocaleDateString('zh-CN', { weekday: 'short' })}
                  </div>
                  <div className="flex-shrink-0 leading-none mx-1" style={{ fontSize: `${16 * fontScale}px` }}>{day.icon}</div>
                  <div className="flex items-center gap-1 justify-end flex-1">
                    <span className="font-bold text-gray-800 dark:text-gray-100" style={{ fontSize: `${12 * fontScale}px` }}>{day.maxTemp}°</span>
                    <span className="text-gray-400 dark:text-gray-500 text-[10px]" style={{ fontSize: `${10 * fontScale}px` }}>{day.minTemp}°</span>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                更新中...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4x1 紧凑横版布局 (参考 4x2 但只显示1天预报)
  if (config.size === '4x1') {
    // 获取明天预报 (通常是索引1，索引0为今天)
    const tomorrow = weatherData.forecast && weatherData.forecast.length > 1 ? weatherData.forecast[1] : null;

    return (
      <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
        {/* 动态背景光效 */}
        <motion.div 
          className="absolute -right-8 -top-8 w-48 h-48 rounded-full blur-3xl"
          style={{ background: themeColor }}
          animate={{ opacity: [0.1, 0.2, 0.1], scale: [1, 1.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        
        <div className="absolute inset-0 flex flex-row px-4 py-2" style={{ padding: `${8 * scale}px` }}>
          {/* 左侧：主要信息 (75%) */}
          <div className="w-[75%] flex items-center pr-3 border-r border-gray-200/10 dark:border-white/10 gap-3">
             {/* 图标 & 温度 */}
             <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-3xl" style={{ fontSize: `${32 * fontScale}px` }}>{weatherData.icon}</div>
                <div className="flex flex-col justify-center">
                    <div className="font-black text-gray-800 dark:text-gray-100 leading-none" style={{ fontSize: `${28 * fontScale}px` }}>
                      {weatherData.temperature}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium" style={{ fontSize: `${12 * fontScale}px` }}>
                      {weatherData.weather}
                    </div>
                </div>
             </div>

             {/* 城市 & 详情 */}
             <div className="flex flex-col justify-center gap-1 min-w-0 flex-1">
                <div className="font-bold text-gray-700 dark:text-gray-200 truncate" style={{ fontSize: `${14 * fontScale}px` }}>
                   {weatherData.city}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" style={{ fontSize: `${10 * fontScale}px` }}>
                    {weatherData.humidity !== undefined && (
                      <span className="flex items-center gap-0.5 whitespace-nowrap">
                        <span>💧</span>{weatherData.humidity}%
                      </span>
                    )}
                    {weatherData.windSpeed !== undefined && (
                      <span className="flex items-center gap-0.5 whitespace-nowrap">
                        <span>🍃</span>{Math.round(weatherData.windSpeed)}
                      </span>
                    )}
                </div>
             </div>
          </div>

          {/* 右侧：明天预报 (25%) - 极简模式 */}
          <div className="w-[25%] pl-1 flex flex-col items-center justify-center h-full">
            {tomorrow ? (
                <>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5 scale-90 origin-bottom" style={{ fontSize: `${10 * fontScale}px` }}>明天</div>
                  <div className="flex items-center gap-1.5">
                     <span className="leading-none" style={{ fontSize: `${18 * fontScale}px` }}>{tomorrow.icon}</span>
                     <div className="flex flex-col items-end leading-none gap-0.5">
                        <span className="font-bold text-gray-800 dark:text-gray-100" style={{ fontSize: `${13 * fontScale}px` }}>{tomorrow.maxTemp}°</span>
                        <span className="text-gray-400 dark:text-gray-500" style={{ fontSize: `${10 * fontScale}px` }}>{tomorrow.minTemp}°</span>
                     </div>
                  </div>
                </>
            ) : (
              <div className="text-xs text-gray-400 text-center">暂无预报</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full rounded-xl overflow-hidden glass">
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
      <div className="absolute inset-0 flex flex-col p-3" style={{ padding: `${12 * scale}px` }}>
        {/* 顶部：图标 - 轻微摆动 */}
        <motion.div 
          className="text-3xl mb-1"
          style={{ fontSize: `${30 * fontScale}px` }}
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
            style={{ gap: `${8 * scale}px`, marginBottom: `${4 * scale}px` }}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ 
              duration: 0.6, 
              delay: 0.2,
              ease: [0.34, 1.56, 0.64, 1]
            }}
          >
            <span 
              className="text-4xl font-black text-gray-800 dark:text-gray-100 leading-none"
              style={{ fontSize: `${36 * fontScale}px` }}
            >
              {weatherData.temperature}
            </span>
            <motion.span 
              className="text-base text-gray-600 dark:text-gray-400 font-medium"
              style={{ fontSize: `${16 * fontScale}px` }}
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
            style={{ fontSize: `${12 * fontScale}px`, marginBottom: `${8 * scale}px` }}
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
            style={{ gap: `${8 * scale}px`, fontSize: `${10 * fontScale}px` }}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            {weatherData.humidity !== undefined && (
              <div className="flex items-center gap-0.5" title="湿度">
                <span>💧</span>
                <span className="text-gray-600 dark:text-gray-400">{weatherData.humidity}%</span>
              </div>
            )}
            {weatherData.windSpeed !== undefined && (
              <div className="flex items-center gap-0.5" title="风速">
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