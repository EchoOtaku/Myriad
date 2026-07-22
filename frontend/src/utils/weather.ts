import {
  getBrowserGeolocation,
  getClientIdentifier,
  getGeoLocationWithLocalCache,
} from './geoLocation'
import { dedupedFetch } from './requestDedup'

const WEATHER_ICON_BASE = '/icons/weather'

export const WEATHER_ICON_ASSETS = {
  sunny: `${WEATHER_ICON_BASE}/sunny.webp`,
  partlyCloudy: `${WEATHER_ICON_BASE}/partly-cloudy.webp`,
  cloudy: `${WEATHER_ICON_BASE}/cloudy.webp`,
  fog: `${WEATHER_ICON_BASE}/fog.webp`,
  drizzle: `${WEATHER_ICON_BASE}/drizzle.webp`,
  rain: `${WEATHER_ICON_BASE}/rain.webp`,
  snow: `${WEATHER_ICON_BASE}/snow.webp`,
  thunderstorm: `${WEATHER_ICON_BASE}/thunderstorm.webp`,
} as const

export const WEATHER_DETAIL_ICON_ASSETS = {
  humidity: `${WEATHER_ICON_BASE}/humidity.webp`,
  wind: `${WEATHER_ICON_BASE}/wind.webp`,
  airGood: `${WEATHER_ICON_BASE}/air-good.webp`,
  airModerate: `${WEATHER_ICON_BASE}/air-moderate.webp`,
  airPoor: `${WEATHER_ICON_BASE}/air-poor.webp`,
} as const

export interface ForecastDay {
  date: string
  maxTemp: number
  minTemp: number
  weather: string
  weatherCode: number
  icon: string
}

export interface WeatherData {
  city: string
  weather: string
  temperature: string
  icon: string
  weatherCode: number
  // 扩展信息（用于展开面板）
  humidity?: number
  windSpeed?: number
  feelsLike?: number
  aqi?: number
  forecast?: ForecastDay[]
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
    const clientIP = await getClientIP()
    if (!clientIP) {
      return null
    }

    // 步骤2: 获取地理位置（带缓存）
    const location = await getGeolocationWithCache(clientIP)
    if (!location) {
      return null
    }

    // 步骤3: 获取天气数据（带缓存）
    const weatherData = await getWeatherDataWithCache(location)
    if (!weatherData) {
      return null
    }

    return weatherData
  } catch (error) {
    console.warn('[天气] 获取失败:', error)
    return null
  }
}

/**
 * 获取客户端IP地址/标识
 * 使用统一的地理位置服务
 */
async function getClientIP(): Promise<string | null> {
  return getClientIdentifier()
}

/**
 * 获取地理位置（带IP缓存）
 * 使用统一的地理位置服务
 */
async function getGeolocationWithCache(
  clientIP: string,
): Promise<{ latitude: number; longitude: number; city: string } | null> {
  const location = await getGeoLocationWithLocalCache(clientIP)

  if (location) {
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      city: location.city,
    }
  }

  // 最后尝试浏览器地理位置 API
  const browserLocation = await getBrowserGeolocation()
  if (browserLocation) {
    return {
      latitude: browserLocation.latitude,
      longitude: browserLocation.longitude,
      city: browserLocation.city,
    }
  }

  return null
}

/**
 * 获取天气数据（带位置缓存）
 * 位置→天气的映射缓存30分钟
 */
async function getWeatherDataWithCache(location: {
  latitude: number
  longitude: number
  city: string
}): Promise<WeatherData | null> {
  // 使用经纬度作为缓存key（精确到小数点后2位）
  const locationKey = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`
  const cacheKey = `weather_data_${locationKey}`
  const cacheTimeKey = `weather_time_${locationKey}`

  // 检查缓存
  const cached = localStorage.getItem(cacheKey)
  const cacheTime = localStorage.getItem(cacheTimeKey)

  // 启用缓存（30分钟）
  if (cached && cacheTime) {
    const cacheAge = Date.now() - Number.parseInt(cacheTime)
    // 天气数据缓存30分钟（天气会变化）
    if (cacheAge < 30 * 60 * 1000) {
      return normalizeWeatherIconAssets(JSON.parse(cached))
    }
  }

  // 缓存失效或不存在，重新获取（使用去重避免并发请求）

  try {
    // 使用去重机制获取天气和空气质量数据，避免并发重复请求
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.latitude}&longitude=${location.longitude}&current=us_aqi`

    const [weatherData, aqiData] = await Promise.all([
      dedupedFetch(
        weatherUrl,
        async () => {
          const response = await fetch(weatherUrl, {
            signal: AbortSignal.timeout(10000),
          })
          if (!response.ok) throw new Error('Weather fetch failed')
          return response.json()
        },
        { cacheTTL: 30 * 60 * 1000 },
      ), // 30分钟缓存

      dedupedFetch(
        aqiUrl,
        async () => {
          const response = await fetch(aqiUrl, {
            signal: AbortSignal.timeout(10000),
          })
          if (!response.ok) return null
          return response.json()
        },
        { cacheTTL: 30 * 60 * 1000 },
      ).catch(() => null), // AQI 失败不影响天气
    ])

    const current = weatherData.current
    const daily = weatherData.daily

    // 处理 AQI 数据
    let aqi
    if (aqiData && aqiData.current && aqiData.current.us_aqi) {
      aqi = aqiData.current.us_aqi
    }

    if (!current) {
      return null
    }

    // 处理预报数据
    const forecast: ForecastDay[] = []
    if (daily && daily.time && daily.time.length > 0) {
      // 获取未来3天的数据 (跳过今天)
      for (let i = 1; i < Math.min(daily.time.length, 4); i++) {
        forecast.push({
          date: daily.time[i],
          maxTemp: Math.round(daily.temperature_2m_max[i]),
          minTemp: Math.round(daily.temperature_2m_min[i]),
          weather: getWeatherTextFromWMO(daily.weather_code[i]),
          weatherCode: daily.weather_code[i],
          icon: getWeatherIconFromWMO(daily.weather_code[i]),
        })
      }
    }

    const result: WeatherData = {
      city: location.city,
      weather: getWeatherTextFromWMO(current.weather_code),
      weatherCode: current.weather_code,
      temperature: `${Math.round(current.temperature_2m)}°C`,
      icon: getWeatherIconFromWMO(current.weather_code),
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      feelsLike: Math.round(current.apparent_temperature),
      aqi,
      forecast,
    }

    // 缓存结果
    localStorage.setItem(cacheKey, JSON.stringify(result))
    localStorage.setItem(cacheTimeKey, Date.now().toString())

    return result
  } catch (error) {
    console.warn('[天气数据] 获取失败:', error)
    return null
  }
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
    99: '雷暴',
  }

  return weatherMap[code] || '未知'
}

/**
 * WMO 天气代码转图标
 */
export function getWeatherIconFromWMO(code: number): string {
  const iconMap: Record<number, string> = {
    0: WEATHER_ICON_ASSETS.sunny,
    1: WEATHER_ICON_ASSETS.partlyCloudy,
    2: WEATHER_ICON_ASSETS.partlyCloudy,
    3: WEATHER_ICON_ASSETS.cloudy,
    45: WEATHER_ICON_ASSETS.fog,
    48: WEATHER_ICON_ASSETS.fog,
    51: WEATHER_ICON_ASSETS.drizzle,
    53: WEATHER_ICON_ASSETS.drizzle,
    55: WEATHER_ICON_ASSETS.drizzle,
    56: WEATHER_ICON_ASSETS.drizzle,
    57: WEATHER_ICON_ASSETS.drizzle,
    61: WEATHER_ICON_ASSETS.rain,
    63: WEATHER_ICON_ASSETS.rain,
    65: WEATHER_ICON_ASSETS.rain,
    66: WEATHER_ICON_ASSETS.rain,
    67: WEATHER_ICON_ASSETS.rain,
    71: WEATHER_ICON_ASSETS.snow,
    73: WEATHER_ICON_ASSETS.snow,
    75: WEATHER_ICON_ASSETS.snow,
    77: WEATHER_ICON_ASSETS.snow,
    80: WEATHER_ICON_ASSETS.drizzle,
    81: WEATHER_ICON_ASSETS.rain,
    82: WEATHER_ICON_ASSETS.thunderstorm,
    85: WEATHER_ICON_ASSETS.snow,
    86: WEATHER_ICON_ASSETS.snow,
    95: WEATHER_ICON_ASSETS.thunderstorm,
    96: WEATHER_ICON_ASSETS.thunderstorm,
    99: WEATHER_ICON_ASSETS.thunderstorm,
  }

  return iconMap[code] || WEATHER_ICON_ASSETS.partlyCloudy
}

export function getAirQualityIcon(aqi: number): string {
  if (aqi <= 50) return WEATHER_DETAIL_ICON_ASSETS.airGood
  if (aqi <= 100) return WEATHER_DETAIL_ICON_ASSETS.airModerate
  return WEATHER_DETAIL_ICON_ASSETS.airPoor
}

export function normalizeWeatherIconAssets(data: WeatherData): WeatherData {
  return {
    ...data,
    icon: getWeatherIconFromWMO(data.weatherCode),
    forecast: data.forecast?.map((day) => ({
      ...day,
      icon: getWeatherIconFromWMO(day.weatherCode),
    })),
  }
}
