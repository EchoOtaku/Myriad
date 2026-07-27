/**
 * auto 动效：会话内自适应（可降不可升）
 *
 * 采样刻意轻量：
 * - 不分配数组，只累加标量
 * - 少帧数（24 个间隔 ≈ 0.4s@60Hz）
 * - 空闲后再开，不抢首屏
 * - rAF 回调内仅几次比较与加减
 */

const SESSION_KEY = 'myriad-anim-auto-want-high'

/** 空闲多久后再采（ms） */
const IDLE_BEFORE_SAMPLE_MS = 2500

/**
 * 需要记录的间隔个数（不含丢弃的首帧）。
 * 24 足够做占比判断，比 40 更轻。
 */
const SAMPLE_GAPS = 24

/** 坏帧阈值（约 <30fps） */
const BAD_FRAME_MS = 34

/** 极差帧（约 <20fps） */
const SEVERE_FRAME_MS = 50

/** 坏帧占比门槛（偏严，不易降） */
const BAD_RATIO_THRESHOLD = 0.45

/** 极差帧下限 */
const MIN_SEVERE_FRAMES = 4

/** 平均间隔门槛 */
const AVG_FRAME_MS_THRESHOLD = 24

/** 丢弃的间隔上限（切后台等） */
const MAX_GAP_MS = 120

export type AutoSampleResult = {
  demoted: boolean
  avgMs: number
  badRatio: number
  severeCount: number
  frames: number
}

/** 会话内 auto 是否仍选「高」档（默认 true） */
export function getSessionAutoWantHigh(): boolean {
  if (typeof sessionStorage === 'undefined') return true
  try {
    const v = sessionStorage.getItem(SESSION_KEY)
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* private mode */
  }
  return true
}

export function setSessionAutoWantHigh(wantHigh: boolean): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_KEY, wantHigh ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 仅用累加计数判定，无数组分配 */
export function evaluateCounters(
  frames: number,
  sumMs: number,
  bad: number,
  severe: number,
): AutoSampleResult {
  if (frames < 12) {
    return {
      demoted: false,
      avgMs: 0,
      badRatio: 0,
      severeCount: severe,
      frames,
    }
  }
  const avgMs = sumMs / frames
  const badRatio = bad / frames
  const demoted =
    badRatio >= BAD_RATIO_THRESHOLD &&
    severe >= MIN_SEVERE_FRAMES &&
    avgMs >= AVG_FRAME_MS_THRESHOLD
  return { demoted, avgMs, badRatio, severeCount: severe, frames }
}

/**
 * 空闲后一次轻量 rAF 采样；明显很差才降级。
 * @returns cancel
 */
export function startSessionAutoFrameAdapt(options?: {
  onDemote?: (result: AutoSampleResult) => void
  enabled?: boolean
}): () => void {
  if (options?.enabled === false || typeof window === 'undefined') {
    return () => {}
  }
  if (!getSessionAutoWantHigh()) {
    return () => {}
  }

  let cancelled = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let rafId = 0
  let idleCallbackId = 0
  let visHandler: (() => void) | null = null

  const cancelAll = () => {
    cancelled = true
    if (idleTimer != null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (idleCallbackId && 'cancelIdleCallback' in window) {
      ;(
        window as Window & { cancelIdleCallback: (id: number) => void }
      ).cancelIdleCallback(idleCallbackId)
      idleCallbackId = 0
    }
    if (visHandler) {
      document.removeEventListener('visibilitychange', visHandler)
      visHandler = null
    }
  }

  const runSample = () => {
    if (cancelled || document.hidden) return

    // 标量累加，rAF 内零分配
    let last = 0
    let gaps = 0
    let sumMs = 0
    let bad = 0
    let severe = 0
    let sawFirst = false

    const tick = (now: number) => {
      if (cancelled) return

      if (!sawFirst) {
        // 首帧只打时间戳，不计间隔
        sawFirst = true
        last = now
        rafId = requestAnimationFrame(tick)
        return
      }

      const dt = now - last
      last = now

      // 合法间隔：累加；过大直接丢弃（不计入分母）
      if (dt > 0 && dt < MAX_GAP_MS) {
        gaps += 1
        sumMs += dt
        if (dt >= BAD_FRAME_MS) {
          bad += 1
          if (dt >= SEVERE_FRAME_MS) severe += 1
        }
      }

      if (gaps < SAMPLE_GAPS) {
        rafId = requestAnimationFrame(tick)
        return
      }

      rafId = 0
      const result = evaluateCounters(gaps, sumMs, bad, severe)
      if (!result.demoted) return
      // 再读一次 session，避免竞态；热路径外可接受
      if (!getSessionAutoWantHigh()) return
      setSessionAutoWantHigh(false)
      options?.onDemote?.(result)
    }

    rafId = requestAnimationFrame(tick)
  }

  const schedule = () => {
    if (cancelled) return
    if (document.hidden) {
      visHandler = () => {
        if (document.hidden || cancelled) return
        if (visHandler) {
          document.removeEventListener('visibilitychange', visHandler)
          visHandler = null
        }
        schedule()
      }
      document.addEventListener('visibilitychange', visHandler)
      return
    }

    const kick = () => {
      if (cancelled) return
      // 再等一小段，错开首屏 paint/数据请求尖峰
      idleTimer = setTimeout(runSample, IDLE_BEFORE_SAMPLE_MS)
    }

    if (typeof (
      window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number },
        ) => number
      }
    ).requestIdleCallback === 'function') {
      idleCallbackId = (
        window as Window & {
          requestIdleCallback: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number
        }
      ).requestIdleCallback(kick, { timeout: 5000 })
    } else {
      kick()
    }
  }

  schedule()
  return cancelAll
}

/** @deprecated test alias */
export function __evaluateSampleForTest(intervals: number[]): AutoSampleResult {
  let sum = 0
  let bad = 0
  let severe = 0
  let n = 0
  for (let i = 0; i < intervals.length; i++) {
    const dt = intervals[i]
    if (dt <= 0 || dt >= MAX_GAP_MS) continue
    n += 1
    sum += dt
    if (dt >= BAD_FRAME_MS) {
      bad += 1
      if (dt >= SEVERE_FRAME_MS) severe += 1
    }
  }
  return evaluateCounters(n, sum, bad, severe)
}
