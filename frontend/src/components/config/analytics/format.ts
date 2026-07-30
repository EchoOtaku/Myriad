/**
 * 访客统计图表共用：数值 / 时长格式化与坐标轴取整
 */

export function formatCount(n: number, locale: string): string {
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(locale, {
      notation: Math.abs(n) >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(n)
  } catch {
    return String(n)
  }
}

export function formatDuration(ms: number, locale: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) {
    return locale.startsWith('zh')
      ? `${sec} 秒`
      : locale.startsWith('ja')
        ? `${sec} 秒`
        : `${sec}s`
  }
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (locale.startsWith('zh')) return rem ? `${min} 分 ${rem} 秒` : `${min} 分`
  if (locale.startsWith('ja')) return rem ? `${min} 分 ${rem} 秒` : `${min} 分`
  return rem ? `${min}m ${rem}s` : `${min}m`
}

/** `2026-07-30` → `07-30`（轴与行内标签用短日期） */
export function shortDay(day: string): string {
  return day.length > 5 ? day.slice(5) : day
}

const NICE_STEPS = [1, 2, 5, 10]

/** 把一格的粗略高度吸附到 1/2/5/10×10ⁿ 的整数刻度 */
function niceStep(rough: number): number {
  if (rough <= 1) return 1
  const mag = 10 ** Math.floor(Math.log10(rough))
  for (const n of NICE_STEPS) {
    const step = n * mag
    if (step >= rough) return Math.max(1, Math.round(step))
  }
  return Math.max(1, Math.round(10 * mag))
}

/**
 * 计数轴刻度：2~4 格里挑「上限最贴近数据」的一组，
 * 刻度值保持整数（浏览量没有半次），留白不会浪费半张图。
 */
export function niceAxis(rawMax: number): { max: number; ticks: number[] } {
  const target = Math.max(1, Math.ceil(rawMax))
  let best = { max: Number.POSITIVE_INFINITY, step: 1, count: 2 }
  for (const count of [2, 3, 4]) {
    const step = niceStep(target / count)
    const max = step * count
    if (max >= target && max < best.max) best = { max, step, count }
  }
  const ticks: number[] = []
  for (let i = 0; i <= best.count; i += 1) ticks.push(best.step * i)
  return { max: best.max, ticks }
}
