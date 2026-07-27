/**
 * auto 动效：会话内自适应（可降不可升）
 *
 * - 默认 wantHigh=true（取硬件允许对中的高档）
 * - 空闲后轻量 rAF 采样；仅当帧质量**明显很差**才降为 wantHigh=false
 * - 结果写入 sessionStorage，本标签页会话内保持，不轻易降
 */

const SESSION_KEY = 'myriad-anim-auto-want-high'

/** 空闲多久后再采（ms）—— 避开首屏抢主线程 */
const IDLE_BEFORE_SAMPLE_MS = 2000

/** 采样帧数 */
const SAMPLE_FRAMES = 40

/**
 * 单帧间隔超过此值才算「坏帧」（约 < 30fps）。
 * 比 16ms 宽很多，轻微掉帧不会触发。
 */
const BAD_FRAME_MS = 34

/**
 * 「极差帧」：卡顿感明显（约 < 20fps）
 */
const SEVERE_FRAME_MS = 50

/**
 * 坏帧占比需达到此比例才降级（0–1）。
 * 默认 45%：40 帧里约 ≥18 帧偏慢才认。
 */
const BAD_RATIO_THRESHOLD = 0.45

/**
 * 极差帧至少要有这么多才允许降级（防止偶发长任务误伤）。
 */
const MIN_SEVERE_FRAMES = 4

/**
 * 平均帧间隔还要超过此值（ms）才降。
 * 与坏帧占比双条件，避免「偶发尖刺、平均仍健康」误降。
 */
const AVG_FRAME_MS_THRESHOLD = 24

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

function evaluateSample(intervals: number[]): AutoSampleResult {
  const frames = intervals.length
  if (frames < 10) {
    return {
      demoted: false,
      avgMs: 0,
      badRatio: 0,
      severeCount: 0,
      frames,
    }
  }

  let sum = 0
  let bad = 0
  let severe = 0
  for (const ms of intervals) {
    sum += ms
    if (ms >= BAD_FRAME_MS) bad += 1
    if (ms >= SEVERE_FRAME_MS) severe += 1
  }
  const avgMs = sum / frames
  const badRatio = bad / frames

  // 双条件 + 极差帧下限：不容易降
  const demoted =
    badRatio >= BAD_RATIO_THRESHOLD &&
    severe >= MIN_SEVERE_FRAMES &&
    avgMs >= AVG_FRAME_MS_THRESHOLD

  return { demoted, avgMs, badRatio, severeCount: severe, frames }
}

/**
 * 在页面空闲后做一次 rAF 采样；若判定应降级则写入 session 并回调。
 * 若会话已是 wantHigh=false，直接 no-op（不升、不重复采）。
 *
 * @returns cancel 函数
 */
export function startSessionAutoFrameAdapt(options?: {
  onDemote?: (result: AutoSampleResult) => void
  /** 仅 auto 偏好时启用；调用方保证 */
  enabled?: boolean
}): () => void {
  const enabled = options?.enabled !== false
  if (!enabled || typeof window === 'undefined') {
    return () => {}
  }

  // 本会话已经降过，不再采样（可降不可升）
  if (!getSessionAutoWantHigh()) {
    return () => {}
  }

  let cancelled = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let rafId = 0
  let idleCallbackId = 0

  const cleanupRaf = () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  const runSample = () => {
    if (cancelled || document.hidden) return

    const intervals: number[] = []
    let last = performance.now()
    let count = 0

    const tick = (now: number) => {
      if (cancelled) return
      const dt = now - last
      last = now
      // 跳过第一帧（调度间隙）与异常超大间隔（切后台等）
      if (count > 0 && dt < 200) {
        intervals.push(dt)
      }
      count += 1
      if (count <= SAMPLE_FRAMES) {
        rafId = requestAnimationFrame(tick)
        return
      }

      const result = evaluateSample(intervals)
      if (result.demoted && getSessionAutoWantHigh()) {
        setSessionAutoWantHigh(false)
        options?.onDemote?.(result)
        if (typeof import.meta !== 'undefined') {
          const dev = (import.meta as ImportMeta & { env?: { DEV?: boolean } })
            .env?.DEV
          if (dev) {
            console.info('[anim-auto] session demote', result)
          }
        }
      }
    }

    rafId = requestAnimationFrame(tick)
  }

  const schedule = () => {
    if (cancelled) return
    // 页面不可见则延后
    if (document.hidden) {
      const onVis = () => {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', onVis)
          schedule()
        }
      }
      document.addEventListener('visibilitychange', onVis)
      return
    }

    const startAfterIdle = () => {
      if (cancelled) return
      idleTimer = setTimeout(runSample, IDLE_BEFORE_SAMPLE_MS)
    }

    if ('requestIdleCallback' in window) {
      idleCallbackId = (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number
        }
      ).requestIdleCallback(startAfterIdle, { timeout: 4000 })
    } else {
      startAfterIdle()
    }
  }

  schedule()

  return () => {
    cancelled = true
    if (idleTimer) clearTimeout(idleTimer)
    cleanupRaf()
    if (
      idleCallbackId &&
      'cancelIdleCallback' in window
    ) {
      ;(
        window as Window & { cancelIdleCallback: (id: number) => void }
      ).cancelIdleCallback(idleCallbackId)
    }
  }
}

/** 测试用：导出阈值评估 */
export function __evaluateSampleForTest(intervals: number[]): AutoSampleResult {
  return evaluateSample(intervals)
}
