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
 * 获取天气信息 - 完全重构版（改进缓存策略）
 * 
 * 缓存策略：
 * 1. IP→地理位置：缓存24小时（位置很少变化）
 * 2. 位置→天气：缓存30分钟（天气会变化）
 * 3. 每个用户根据自己的IP获取对应位置的天气
 * 
 * 工作流程：
 * 1. 获取客户端IP
 * 2. 检查IP→地理位置缓存（24小时）
 * 3. 如果没有缓存，通过多个服务获取地理位置并缓存
 * 4. 检查位置→天气缓存（30分钟）
 * 5. 如果没有缓存，获取天气数据并缓存
 */
export async function getWeatherInfo(): Promise<WeatherData | null> {
  try {
    // 步骤1: 获取客户端IP
    const clientIP = await getClientIP();
    if (!clientIP) {
      return null;
    }

    // 步骤2: 获取地理位置（带缓存）
    const location = await getGeolocationWithCache(clientIP);
    if (!location) {
      return null;
    }

    // 步骤3: 获取天气数据（带缓存）
    const weatherData = await getWeatherDataWithCache(location);
    if (!weatherData) {
      return null;
    }

    return weatherData;
  } catch (error) {
    console.warn('[天气] 获取失败:', error);
    return null;
  }
}

/**
 * 获取客户端IP地址
 * 优先使用后端代理，失败则使用第三方服务
 */
async function getClientIP(): Promise<string | null> {
  // 方案1: 通过后端代理获取（最准确）
  try {
    const response = await fetch(`${API_URL}/api/proxy/client-geo`, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      // 后端会返回地理位置信息，这里我们只需要提取用于缓存key的标识
      // 使用 lat+lon 作为唯一标识（同一个位置的用户共享缓存）
      if (data.lat && data.lon) {
        return `${data.lat.toFixed(2)},${data.lon.toFixed(2)}`;
      }
    }
  } catch (error) {
    console.warn('[IP] 后端代理失败:', error);
  }

  // 方案2: 使用 ipapi.co
  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.ip) {
        return data.ip;
      }
    }
  } catch (error) {
    console.warn('[IP] ipapi.co 失败:', error);
  }

  // 方案3: 使用 ipify.org
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.ip) {
        return data.ip;
      }
    }
  } catch (error) {
    console.warn('[IP] ipify 失败:', error);
  }

  // 所有方案失败，使用固定标识符（基于浏览器特征）
  // 这样至少同一个浏览器会有一致的体验
  return 'browser-default';
}

/**
 * 获取地理位置（带IP缓存）
 * IP→地理位置的映射缓存24小时
 */
async function getGeolocationWithCache(clientIP: string): Promise<{ latitude: number; longitude: number; city: string } | null> {
  const cacheKey = `geo_location_${clientIP}`;
  const cacheTimeKey = `geo_location_time_${clientIP}`;

  // 检查缓存
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = localStorage.getItem(cacheTimeKey);

  if (cached && cacheTime) {
    const cacheAge = Date.now() - parseInt(cacheTime);
    // IP→位置缓存24小时（位置很少变）
    if (cacheAge < 24 * 60 * 60 * 1000) {
      return JSON.parse(cached);
    }
  }

  // 缓存失效或不存在，重新获取
  const location = await getGeolocation();

  if (location) {
    // 缓存结果
    localStorage.setItem(cacheKey, JSON.stringify(location));
    localStorage.setItem(cacheTimeKey, Date.now().toString());
  }

  return location;
}

/**
 * 获取天气数据（带位置缓存）
 * 位置→天气的映射缓存30分钟
 */
async function getWeatherDataWithCache(location: { latitude: number; longitude: number; city: string }): Promise<WeatherData | null> {
  // 使用经纬度作为缓存key（精确到小数点后2位）
  const locationKey = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
  const cacheKey = `weather_data_${locationKey}`;
  const cacheTimeKey = `weather_time_${locationKey}`;

  // 检查缓存
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = localStorage.getItem(cacheTimeKey);

  if (cached && cacheTime) {
    const cacheAge = Date.now() - parseInt(cacheTime);
    // 天气数据缓存30分钟（天气会变化）
    if (cacheAge < 30 * 60 * 1000) {
      return JSON.parse(cached);
    }
  }

  // 缓存失效或不存在，重新获取

  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m&timezone=auto`;
    
    const weatherResponse = await fetch(weatherUrl, {
      signal: AbortSignal.timeout(10000)
    });

    if (!weatherResponse.ok) {
      return null;
    }

    const weatherData = await weatherResponse.json();
    const current = weatherData.current;

    if (!current) {
      return null;
    }

    const result: WeatherData = {
      city: location.city,
      weather: getWeatherTextFromWMO(current.weather_code),
      temperature: `${Math.round(current.temperature_2m)}°C`,
      icon: getWeatherIconFromWMO(current.weather_code),
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      feelsLike: Math.round(current.apparent_temperature)
    };

    // 缓存结果
    localStorage.setItem(cacheKey, JSON.stringify(result));
    localStorage.setItem(cacheTimeKey, Date.now().toString());

    return result;
  } catch (error) {
    console.warn('[天气数据] 获取失败:', error);
    return null;
  }
}

/**
 * 获取地理位置信息
 * 尝试多个服务，返回第一个成功的结果
 */
async function getGeolocation(): Promise<{ latitude: number; longitude: number; city: string } | null> {
  // 方案1: 通过后端代理获取（最准确，能获取真实客户端IP）
  try {
    const response = await fetch(`${API_URL}/api/proxy/client-geo`, {
      signal: AbortSignal.timeout(10000) // 10秒超时
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.status === 'success' && data.lat && data.lon) {
        const city = data.city || data.regionName || data.country || '未知';
        return {
          latitude: data.lat,
          longitude: data.lon,
          city: city
        };
      }
    }
  } catch (error) {
    // 静默失败，尝试下一个服务
  }

  // 方案2: 使用 ipapi.co（免费，稳定）
  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        const city = data.city || data.region || data.country_name || '未知';
        return {
          latitude: data.latitude,
          longitude: data.longitude,
          city: city
        };
      }
    }
  } catch (error) {
    // 静默失败，尝试下一个服务
  }

  // 方案3: 使用 ip-api.com（备用）
  try {
    const response = await fetch('http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country', {
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.status === 'success' && data.lat && data.lon) {
        const city = data.city || data.regionName || data.country || '未知';
        return {
          latitude: data.lat,
          longitude: data.lon,
          city: city
        };
      }
    }
  } catch (error) {
    // 静默失败，尝试下一个服务
  }

  // 方案4: 使用 geojs.io（第三备用）
  try {
    const response = await fetch('https://get.geojs.io/v1/ip/geo.json', {
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        const city = data.city || data.region || data.country || '未知';
        const lat = typeof data.latitude === 'string' ? parseFloat(data.latitude) : data.latitude;
        const lon = typeof data.longitude === 'string' ? parseFloat(data.longitude) : data.longitude;
        
        return {
          latitude: lat,
          longitude: lon,
          city: city
        };
      }
    }
  } catch (error) {
    // 静默失败，尝试下一个服务
  }

  // 方案5: 所有服务都失败，使用浏览器地理位置 API（需要用户授权）
  if ('geolocation' in navigator) {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 600000 // 10分钟缓存
        });
      });
      // 使用 Nominatim 反向地理编码获取城市名
      const reverseGeoUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10&addressdetails=1`;
      
      let city = '当前位置';
      try {
        const reverseResponse = await fetch(reverseGeoUrl, {
          signal: AbortSignal.timeout(5000),
          headers: {
            'User-Agent': 'Myriad Weather App'
          }
        });
        
        if (reverseResponse.ok) {
          const reverseData = await reverseResponse.json();
          city = reverseData.address?.city || 
                 reverseData.address?.town || 
                 reverseData.address?.village || 
                 reverseData.address?.county || 
                 reverseData.address?.state || 
                 '当前位置';
        }
      } catch (e) {
        // 反向地理编码失败，使用默认城市名
      }

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city: city
      };
    } catch (error) {
      // 浏览器 API 失败（可能用户拒绝授权）
    }
  }

  // 所有方案都失败，返回 null
  return null;
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
