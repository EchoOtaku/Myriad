/**
 * 智能控制面板内容工具
 * 提供天气、问候语、一言等动态内容
 */

import { API_URL } from '../config';

export interface WeatherData {
  city: string;
  weather: string;
  temperature: string;
  icon: string;
  // 扩展信息（用于展开面板）
  humidity?: number;
  windSpeed?: number;
  feelsLike?: number;
}

export interface QuoteData {
  text: string;
  author?: string;
}

export interface GreetingData {
  text: string;
  icon: string;
  time: string;
}

/**
 * 获取时间段问候语
 */
export function getGreeting(username?: string): GreetingData {
  const hour = new Date().getHours();
  const time = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  let text = '';
  let icon = '';

  if (hour >= 5 && hour < 12) {
    icon = '🌅';
    text = '早上好';
  } else if (hour >= 12 && hour < 14) {
    icon = '☀️';
    text = '中午好';
  } else if (hour >= 14 && hour < 18) {
    icon = '🌤️';
    text = '下午好';
  } else if (hour >= 18 && hour < 22) {
    icon = '🌆';
    text = '晚上好';
  } else {
    icon = '🌙';
    text = '夜深了';
  }

  if (username) {
    text += `，${username}`;
  }

  return { text, icon, time };
}

/**
 * 获取天气信息
 * 使用 Open-Meteo API（免费、无需密钥、支持全球）
 */
export async function getWeatherInfo(): Promise<WeatherData | null> {
  try {
    // 从 localStorage 读取缓存
    const cachedWeather = localStorage.getItem('weather_cache');
    const cacheTime = localStorage.getItem('weather_cache_time');

    if (cachedWeather && cacheTime) {
      const cacheAge = Date.now() - parseInt(cacheTime);
      // 缓存 30 分钟
      if (cacheAge < 30 * 60 * 1000) {
        return JSON.parse(cachedWeather);
      }
    }

    // 尝试从多个来源获取地理位置
    let latitude: number | null = null;
    let longitude: number | null = null;
    let city = '本地';

    // 方案1: 通过后端代理获取（优先，可以获取客户端真实IP）
    try {
      const geoResponse = await fetch(`${API_URL}/api/proxy/client-geo`);
      
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        
        if (geoData.status === 'success' && geoData.lat && geoData.lon) {
          latitude = geoData.lat;
          longitude = geoData.lon;
          city = geoData.city || geoData.country || '本地';
        }
      }
    } catch (e) {
      // 静默失败，尝试下一个方案
    }

    // 方案2: 使用 ipapi.co（备用，免费且稳定）
    if (!latitude || !longitude) {
      try {
        const geoResponse = await fetch('https://ipapi.co/json/');
        
        if (geoResponse.ok) {
          const geoData = await geoResponse.json();
          
          if (geoData.latitude && geoData.longitude) {
            latitude = geoData.latitude;
            longitude = geoData.longitude;
            city = geoData.city || geoData.country_name || '本地';
          }
        }
      } catch (e) {
        // 静默失败，尝试下一个方案
      }
    }

    // 方案3: 使用 ip-api.com（第二备用）
    if (!latitude || !longitude) {
      try {
        const geoResponse = await fetch('http://ip-api.com/json/?fields=status,lat,lon,city,country');
        
        if (geoResponse.ok) {
          const geoData = await geoResponse.json();
          
          if (geoData.status === 'success' && geoData.lat && geoData.lon) {
            latitude = geoData.lat;
            longitude = geoData.lon;
            city = geoData.city || geoData.country || '本地';
          }
        }
      } catch (e) {
        // 静默失败
      }
    }

    // 方案4: 如果所有方式都失败，使用默认位置（北京）
    if (!latitude || !longitude) {
      latitude = 39.9042;
      longitude = 116.4074;
      city = '北京';
    }

    // 使用 Open-Meteo 获取天气（包含扩展信息）
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) throw new Error('Weather API failed');

    const weatherData = await weatherResponse.json();
    const current = weatherData.current;

    if (!current) throw new Error('No weather data');

    const result: WeatherData = {
      city: city,
      weather: getWeatherTextFromWMO(current.weather_code),
      temperature: `${Math.round(current.temperature_2m)}°C`,
      icon: getWeatherIconFromWMO(current.weather_code),
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      feelsLike: Math.round(current.apparent_temperature)
    };

    // 缓存结果
    localStorage.setItem('weather_cache', JSON.stringify(result));
    localStorage.setItem('weather_cache_time', Date.now().toString());

    return result;
  } catch (error) {
    console.warn('Failed to fetch weather:', error);
    return null;
  }
}

/**
 * 获取一言警句
 */
export async function getRandomQuote(): Promise<QuoteData | null> {
  try {
    // 从 localStorage 读取缓存
    const cachedQuote = localStorage.getItem('quote_cache');
    const cacheTime = localStorage.getItem('quote_cache_time');

    if (cachedQuote && cacheTime) {
      const cacheAge = Date.now() - parseInt(cacheTime);
      // 缓存 10 分钟
      if (cacheAge < 10 * 60 * 1000) {
        return JSON.parse(cachedQuote);
      }
    }

    // 使用一言 API
    const response = await fetch('https://v1.hitokoto.cn/?c=d&c=i&c=k&encode=json');

    if (!response.ok) throw new Error('Hitokoto API failed');

    const data = await response.json();

    const quoteData: QuoteData = {
      text: data.hitokoto,
      author: data.from
    };

    // 缓存结果
    localStorage.setItem('quote_cache', JSON.stringify(quoteData));
    localStorage.setItem('quote_cache_time', Date.now().toString());

    return quoteData;
  } catch (error) {
    console.warn('Failed to fetch quote:', error);
    // 返回本地备用句子
    return getLocalQuote();
  }
}

/**
 * 本地备用句子库
 */
function getLocalQuote(): QuoteData {
  const quotes = [
    { text: '代码如诗，优雅至上', author: '程序员格言' },
    { text: '简洁是可靠的前提', author: 'Edsger Dijkstra' },
    { text: '过早优化是万恶之源', author: 'Donald Knuth' },
    { text: '任何可以被编写成 JavaScript 的程序，最终都会被编写成 JavaScript', author: 'Atwood 定律' },
    { text: '好的代码本身就是最好的文档', author: 'Steve McConnell' },
    { text: '先让它运行起来，再让它变得更好', author: 'Kent Beck' },
    { text: '代码是写给人看的，顺便让机器执行', author: 'Harold Abelson' },
    { text: '测试不能证明程序没有 bug，只能证明 bug 的存在', author: 'Edsger Dijkstra' }
  ];

  return quotes[Math.floor(Math.random() * quotes.length)];
}

/**
 * WMO 天气代码转文字（World Meteorological Organization）
 * Open-Meteo 使用 WMO 标准代码
 */
function getWeatherTextFromWMO(code: number): string {
  const weatherMap: Record<number, string> = {
    0: '晴',
    1: '晴',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '雾',
    51: '小雨',
    53: '小雨',
    55: '小雨',
    56: '冻雨',
    57: '冻雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '冻雨',
    67: '冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '米雪',
    80: '阵雨',
    81: '阵雨',
    82: '暴雨',
    85: '阵雪',
    86: '暴雪',
    95: '雷暴',
    96: '雷暴',
    99: '雷暴'
  };

  return weatherMap[code] || '未知';
}

/**
 * WMO 天气代码转图标
 */
function getWeatherIconFromWMO(code: number): string {
  const iconMap: Record<number, string> = {
    0: '☀️',
    1: '🌤️',
    2: '⛅',
    3: '☁️',
    45: '🌫️',
    48: '🌫️',
    51: '🌦️',
    53: '🌦️',
    55: '🌦️',
    56: '🌧️',
    57: '🌧️',
    61: '🌧️',
    63: '🌧️',
    65: '🌧️',
    66: '🌧️',
    67: '🌧️',
    71: '🌨️',
    73: '🌨️',
    75: '❄️',
    77: '🌨️',
    80: '🌦️',
    81: '🌧️',
    82: '⛈️',
    85: '🌨️',
    86: '❄️',
    95: '⛈️',
    96: '⛈️',
    99: '⛈️'
  };

  return iconMap[code] || '🌤️';
}

/**
 * 获取主题状态信息
 */
export function getThemeInfo(): { text: string; icon: string } {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    text: isDark ? '深色模式' : '浅色模式',
    icon: isDark ? '🌙' : '☀️'
  };
}
