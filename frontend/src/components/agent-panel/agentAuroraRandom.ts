/**
 * 思考态流光的现场抽签。
 *
 * 色相、占比、软硬切、光斑大小位置都是每次调用重新抽，不写死谱。
 * 色带拉长，一屏仍只看见两三块；但调色盘有 5–8 色，不是三色循环。
 * 两段相同的 0–50 / 50–100 才能位移 50% 接上。
 */

export interface AuroraPrismPaint {
  ribbon: string
  blobs: string
  width: string
  ribbonMs: string
  wanderMs: string
}

export type AuroraRand = () => number

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

function pickHues(count: number, rand: AuroraRand): number[] {
  const hues: number[] = []
  let guard = 0
  while (hues.length < count && guard < 96) {
    guard += 1
    const hue = rand() * 360
    if (hues.some((seen) => hueDelta(seen, hue) < 24)) continue
    hues.push(hue)
  }
  while (hues.length < count) hues.push(rand() * 360)
  return hues
}

function mixColor(
  hue: number,
  rand: AuroraRand,
  dark: boolean,
): string {
  const light = dark ? 60 + rand() * 16 : 64 + rand() * 18
  const chroma = dark ? 0.2 + rand() * 0.1 : 0.16 + rand() * 0.12
  const amount = 76 + Math.round(rand() * 18)
  const wall =
    rand() < 0.34
      ? 'var(--color-accent)'
      : rand() < 0.5
        ? 'var(--color-secondary)'
        : 'var(--color-primary)'
  return `color-mix(in oklab, oklch(${light.toFixed(1)}% ${chroma.toFixed(3)} ${hue.toFixed(1)}deg) ${amount}%, ${wall})`
}

interface Stop {
  color: string
  pos: number
}

function pushStop(stops: Stop[], color: string, pos: number): void {
  const last = stops[stops.length - 1]
  const next = last ? Math.max(pos, last.pos + 0.3) : Math.max(pos, 0)
  stops.push({ color, pos: next })
}

function periodStops(
  palette: string[],
  rand: AuroraRand,
): Stop[] {
  const seam = palette[0] ?? 'var(--color-primary)'
  const segments = 4 + Math.floor(rand() * 4)
  const weights = Array.from(
    { length: segments },
    () => rand() ** 1.85 + 0.06,
  )
  const total = weights.reduce((sum, item) => sum + item, 0)
  const widths = weights.map((item) => (item / total) * 50)

  const stops: Stop[] = []
  let pos = 0
  let prev = 0
  for (let i = 0; i < segments; i += 1) {
    let index = Math.floor(rand() * palette.length)
    if (index === prev && palette.length > 1) {
      index = (index + 1 + Math.floor(rand() * (palette.length - 1))) %
        palette.length
    }
    const color = i === 0 ? seam : (palette[index] ?? seam)
    const width = widths[i] ?? 8
    if (i === 0) {
      pushStop(stops, color, 0)
      pos = width
      pushStop(stops, color, Math.min(pos, 48.8))
    } else {
      const snap = rand() < 0.45
      const travel = snap ? 0.4 + rand() * 0.9 : width * (0.2 + rand() * 0.5)
      pushStop(stops, color, Math.min(pos + travel, 49.1))
      pos += width
      pushStop(stops, color, Math.min(pos, 49.3))
    }
    prev = i === 0 ? 0 : index
  }

  const tail = stops[stops.length - 1]
  if (tail && tail.pos > 49.5) tail.pos = 49.5
  stops.push({ color: seam, pos: 50 })
  return stops
}

function doublePeriod(period: Stop[]): Stop[] {
  const seam = period[0]?.color ?? 'var(--color-primary)'
  const body = period.filter((stop) => stop.pos < 50)
  return [
    ...period,
    ...body.map((stop) => ({ color: stop.color, pos: stop.pos + 50 })),
    { color: seam, pos: 100 },
  ]
}

function blobLayer(palette: string[], rand: AuroraRand): string {
  const count = 2 + Math.floor(rand() * 3)
  return Array.from({ length: count }, () => {
    const color = palette[Math.floor(rand() * palette.length)] ?? palette[0]
    const x = (rand() * 100).toFixed(1)
    const y = (68 + rand() * 32).toFixed(1)
    const rx = (10 + rand() * 78).toFixed(1)
    const ry = (22 + rand() * 68).toFixed(1)
    const mix = (36 + rand() * 38).toFixed(0)
    const fade = (44 + rand() * 34).toFixed(0)
    return `radial-gradient(ellipse ${rx}% ${ry}% at ${x}% ${y}%, color-mix(in oklab, ${color} ${mix}%, transparent), transparent ${fade}%)`
  }).join(', ')
}

export function paintAuroraPrism(
  rand: AuroraRand = Math.random,
  dark = false,
): AuroraPrismPaint {
  const palette = pickHues(5 + Math.floor(rand() * 4), rand).map((hue) =>
    mixColor(hue, rand, dark),
  )
  const ribbon = `linear-gradient(90deg in oklch, ${doublePeriod(
    periodStops(palette, rand),
  )
    .map((stop) => `${stop.color} ${stop.pos.toFixed(1)}%`)
    .join(', ')})`

  return {
    ribbon,
    blobs: blobLayer(palette, rand),
    width: `${(400 + rand() * 160).toFixed(1)}%`,
    ribbonMs: `${(3.8 + rand() * 3.6).toFixed(2)}s`,
    wanderMs: `${(6.4 + rand() * 5.2).toFixed(2)}s`,
  }
}

export function applyAuroraPrism(
  el: HTMLElement,
  paint: AuroraPrismPaint,
): void {
  el.style.setProperty('--prism-ribbon', paint.ribbon)
  el.style.setProperty('--prism-blobs', paint.blobs)
  el.style.setProperty('--prism-width', paint.width)
  el.style.setProperty('--prism-ribbon-ms', paint.ribbonMs)
  el.style.setProperty('--prism-wander-ms', paint.wanderMs)
}
