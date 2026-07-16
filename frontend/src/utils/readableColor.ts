/**
 * 对比度感知的可读色推导
 *
 * 移植自 Tapp 音乐播放器（com.myriad.music-player）歌词填色逻辑：
 * 1. 在候选色中挑第一个相对背景达到 WCAG 对比度阈值的颜色
 * 2. 若均不达标，保留色相，沿 HSL 明度方向步进，直到对比度够用
 *
 * 用于页面 Hero 标题「自适应」色，以及其它需要主题可读性的着色场景。
 */

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface HslColor {
  h: number
  s: number
  l: number
}

export interface DeriveReadableColorOptions {
  /** 按优先级排列的候选色（hex） */
  candidates: Array<string | null | undefined>
  /** 当前是否深色主题 */
  isDark: boolean
  /** 目标明度（不达标时向该方向拉） */
  targetLightness?: number
  /** 最小对比度（大号装饰字约 3:1 即可） */
  minContrast?: number
  /** 全部失败时的回退色 */
  fallback?: string
  /** 估算背景色；默认按明暗主题取页面底色近似值 */
  backdrop?: RgbColor
}

/** 浅色主题下页面底色近似（--bg-primary: #f5f5f5） */
const LIGHT_BACKDROP: RgbColor = { r: 245, g: 245, b: 245 }
/** 深色主题下页面底色近似（--bg-primary: #0a0a0a） */
const DARK_BACKDROP: RgbColor = { r: 10, g: 10, b: 10 }

const DEFAULT_FALLBACK = '#8b5cf6'

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null
  let hex = String(value).trim()
  if (hex.charAt(0) !== '#') return null
  hex = hex.slice(1)
  if (hex.length === 3) {
    hex =
      hex.charAt(0) +
      hex.charAt(0) +
      hex.charAt(1) +
      hex.charAt(1) +
      hex.charAt(2) +
      hex.charAt(2)
  }
  if (hex.length === 8) {
    hex = hex.slice(0, 6)
  }
  if (hex.length !== 6 || !/^[0-9a-f]+$/i.test(hex)) return null
  return `#${hex.toLowerCase()}`
}

export function hexToRgb(value: string | null | undefined): RgbColor | null {
  const hex = normalizeHexColor(value)
  if (!hex) return null
  const n = Number.parseInt(hex.slice(1), 16)
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  }
}

export function rgbToHex(rgb: RgbColor): string {
  const part = (value: number) => {
    const hex = clampNumber(Math.round(value), 0, 255).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

export function rgbToHsl(rgb: RgbColor): HslColor {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return { h, s, l }
}

export function hslToRgb(hsl: HslColor): RgbColor {
  const { h, s, l } = hsl
  let r: number
  let g: number
  let b: number

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tt = t
      if (tt < 0) tt += 1
      if (tt > 1) tt -= 1
      if (tt < 1 / 6) return p + (q - p) * 6 * tt
      if (tt < 1 / 2) return q
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  return {
    r: r * 255,
    g: g * 255,
    b: b * 255,
  }
}

export function relativeLuminance(rgb: RgbColor): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722
  )
}

export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export function getThemeBackdropRgb(isDark: boolean): RgbColor {
  return isDark ? DARK_BACKDROP : LIGHT_BACKDROP
}

function toColorCandidates(
  value: Array<string | null | undefined> | string | null | undefined,
): Array<string | null | undefined> {
  return Array.isArray(value) ? value : [value]
}

/**
 * 从候选色中挑第一个相对背景达标的 hex；都不行则返回 null
 */
export function pickReadableCandidate(
  candidates: Array<string | null | undefined> | string | null | undefined,
  isDark: boolean,
  minContrast: number,
  backdrop?: RgbColor,
): string | null {
  const bg = backdrop ?? getThemeBackdropRgb(isDark)
  for (const value of toColorCandidates(candidates)) {
    const hex = normalizeHexColor(value)
    const rgb = hexToRgb(hex)
    if (rgb && contrastRatio(rgb, bg) >= minContrast) {
      return hex
    }
  }
  return null
}

function firstUsableRgb(
  candidates: Array<string | null | undefined> | string | null | undefined,
  fallbackColor: string,
): RgbColor {
  for (const value of toColorCandidates(candidates)) {
    const rgb = hexToRgb(value)
    if (rgb) return rgb
  }
  return hexToRgb(fallbackColor) || hexToRgb(DEFAULT_FALLBACK)!
}

/**
 * 推导在当前主题背景下可读的着色
 * （与音乐播放器 `deriveReadableLyricColor` 同策略）
 */
export function deriveReadableColor(
  options: DeriveReadableColorOptions,
): string {
  const {
    candidates,
    isDark,
    targetLightness = isDark ? 0.78 : 0.34,
    minContrast = 3.7,
    fallback = DEFAULT_FALLBACK,
    backdrop,
  } = options

  const bg = backdrop ?? getThemeBackdropRgb(isDark)
  const readable = pickReadableCandidate(candidates, isDark, minContrast, bg)
  if (readable) return readable

  const rgb = firstUsableRgb(candidates, fallback)
  const hsl = rgbToHsl(rgb)
  let l = hsl.l + (targetLightness - hsl.l) * 0.72
  const s = clampNumber(hsl.s, isDark ? 0.34 : 0.3, isDark ? 0.86 : 0.78)
  const step = isDark ? 0.02 : -0.02
  const limit = isDark ? 0.94 : 0.16

  let candidate = hslToRgb({ h: hsl.h, s, l })
  let guard = 0

  do {
    candidate = hslToRgb({ h: hsl.h, s, l })
    if (contrastRatio(candidate, bg) >= minContrast) break
    l += step
    guard += 1
  } while (guard < 24 && (isDark ? l <= limit : l >= limit))

  return rgbToHex(candidate)
}

/**
 * 从壁纸主题 CSS 变量推导 Hero 标题自适应色
 * 候选顺序对齐音乐播放器：primary → light/dark 变体 → secondary → accent
 */
export function deriveAdaptiveTitleColor(isDark: boolean): string {
  if (typeof document === 'undefined') {
    return isDark ? '#ffffff' : '#111111'
  }

  const styles = getComputedStyle(document.documentElement)
  const read = (name: string) => styles.getPropertyValue(name).trim()

  const primary = read('--color-primary') || DEFAULT_FALLBACK
  const secondary = read('--color-secondary') || primary
  const accent = read('--color-accent') || secondary
  const light = read('--color-light') || primary
  const dark = read('--color-dark') || primary
  const themeAlt = isDark ? light : dark

  // 背景优先读 --bg-primary，解析失败再回落到主题近似
  let backdrop = getThemeBackdropRgb(isDark)
  const bgPrimary = normalizeHexColor(read('--bg-primary'))
  const bgRgb = hexToRgb(bgPrimary)
  if (bgRgb) backdrop = bgRgb

  return deriveReadableColor({
    candidates: [primary, themeAlt, secondary, accent],
    isDark,
    targetLightness: isDark ? 0.78 : 0.34,
    minContrast: 3.7,
    fallback: primary,
    backdrop,
  })
}
