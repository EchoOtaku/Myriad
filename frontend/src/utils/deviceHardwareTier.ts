/**
 * 分平台硬件档位判定（动画 standard/light vs light/exlight 的「是否达标」）。
 *
 * 产品规则（2026-07）：
 * - Android：内存 ≥ 8GB 且 CPU 逻辑核 ≥ 8 → 高
 * - iOS：系统主版本 >= 18 → 高；小于 18 → 低（含未来 26/27 等）
 * - macOS：Apple Silicon (M 系列) → 高；Intel → 低
 * - Windows / Linux：内存档 ≥ 12GB 级且逻辑核 ≥ 6 → 高
 *
 * 浏览器限制：
 * - `deviceMemory` 多为 0.25/0.5/1/2/4/8 分桶，≥8 表示「约 8GB 及以上」
 *   Windows「12G+」在 API 上用 ≥8 桶近似（12–16G 机器通常仍报 8）。
 * - Safari 无 deviceMemory；iOS 不以核数/内存分档。
 * - macOS 上 `navigator.platform` 在 M 芯片仍常为 MacIntel，需 architecture / WebGL 辅助。
 */

export type OsKind = 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'unknown'

export interface HardwareSignals {
  os: OsKind
  /** navigator.hardwareConcurrency */
  cores: number | null
  /** navigator.deviceMemory（GiB 近似分桶，可能为 null） */
  memoryGiB: number | null
  /** iOS 主版本，非 iOS 为 null */
  iosMajor: number | null
  /** macOS 是否判定为 Apple Silicon */
  appleSilicon: boolean | null
}

export interface HardwareTierResult {
  /** 是否达到「高硬件」门槛（可走 standard↔light） */
  highHardware: boolean
  signals: HardwareSignals
  /** 简短原因，便于 debug */
  reason: string
}

// —— 平台识别 ————————————————————————————————————————————————

export function detectOsKind(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
): OsKind {
  const uaDataPlatform =
    nav &&
    'userAgentData' in nav &&
    (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform

  const p = (uaDataPlatform || '').toLowerCase()
  if (p === 'android') return 'android'
  if (p === 'ios') return 'ios'
  if (p === 'macos') return 'macos'
  if (p === 'windows') return 'windows'
  if (p === 'linux') return 'linux'

  // Android 必须在 Linux 之前
  if (/Android/i.test(ua)) return 'android'

  // iPadOS 13+ 桌面 UA：Macintosh + 多点触控
  const maxTouch =
    nav && typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0
  if (/iPhone|iPod/i.test(ua)) return 'ios'
  if (/iPad/i.test(ua)) return 'ios'
  if (/Macintosh|Mac OS X/i.test(ua) && maxTouch > 1) return 'ios'

  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos'
  if (/Windows NT|Win64|WOW64|Windows /i.test(ua)) return 'windows'
  if (/Linux/i.test(ua)) return 'linux'

  return 'unknown'
}

/** 从 UA 解析 iOS / iPadOS 主版本，如 CPU iPhone OS 18_2 → 18 */
export function parseIosMajorVersion(ua: string): number | null {
  // iPhone OS 18_3 / CPU OS 17_0 like Mac OS X (iPad)
  const patterns = [
    new RegExp('OS (\\d+)[._](\\d+)', 'i'),
    new RegExp('iPhone OS (\\d+)', 'i'),
    new RegExp('CPU OS (\\d+)', 'i'),
  ]
  for (const re of patterns) {
    const m = ua.match(re)
    if (m) {
      const major = Number.parseInt(m[1], 10)
      if (Number.isFinite(major)) return major
    }
  }
  return null
}

/**
 * 判断 macOS 是否为 Apple Silicon。
 * 优先 userAgentData architecture；回退 WebGL UNMASKED_RENDERER。
 */
export function detectAppleSilicon(
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
): boolean | null {
  if (!nav) return null

  // Chromium：getHighEntropyValues 异步，同步路径用 ua 提示或 WebGL
  const uaData = (
    nav as Navigator & {
      userAgentData?: {
        platform?: string
        getHighEntropyValues?: (hints: string[]) => Promise<{
          architecture?: string
          bitness?: string
          model?: string
        }>
      }
    }
  ).userAgentData

  // 部分环境在 brands 旁暴露 platform；architecture 需异步，这里先 WebGL
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      const gl =
        canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      if (gl && 'getExtension' in gl) {
        const dbg = (
          gl as WebGLRenderingContext
        ).getExtension('WEBGL_debug_renderer_info')
        if (dbg) {
          const renderer = (
            gl as WebGLRenderingContext
          ).getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string
          if (typeof renderer === 'string' && renderer) {
            // "Apple M1", "Apple M2 Pro", "Apple GPU" on Apple Silicon
            if (/Apple\s+M\d/i.test(renderer) || /Apple GPU/i.test(renderer)) {
              return true
            }
            // Intel Iris / AMD on Mac → Intel / discrete, not M-series SoC
            if (/Intel|AMD|NVIDIA/i.test(renderer) && !/Apple/i.test(renderer)) {
              return false
            }
            if (/Apple/i.test(renderer) && !/Intel/i.test(renderer)) {
              return true
            }
          }
        }
      }
    }
  } catch {
    /* ignore WebGL probe failures */
  }

  // UA 极少直接写 arm；若 platform 为 MacIntel 不能当 Intel 芯片
  void uaData
  return null
}

/**
 * 异步补全 Apple Silicon（Chrome high-entropy architecture）。
 * 调用方可选：结果变化时刷新缓存。
 */
export async function detectAppleSiliconAsync(
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
): Promise<boolean | null> {
  if (!nav) return null
  const uaData = (
    nav as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (hints: string[]) => Promise<{
          architecture?: string
          platform?: string
        }>
      }
    }
  ).userAgentData
  if (!uaData?.getHighEntropyValues) {
    return detectAppleSilicon(nav)
  }
  try {
    const values = await uaData.getHighEntropyValues([
      'architecture',
      'platform',
    ])
    const arch = (values.architecture || '').toLowerCase()
    const platform = (values.platform || '').toLowerCase()
    if (platform === 'macos' || platform === '') {
      if (arch === 'arm' || arch === 'arm64') return true
      if (arch === 'x86' || arch === 'x86_64') return false
    }
  } catch {
    /* ignore */
  }
  return detectAppleSilicon(nav)
}

// —— 分平台规则 ————————————————————————————————————————————————

function readCores(
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
): number | null {
  if (!nav) return null
  const n = nav.hardwareConcurrency
  return typeof n === 'number' && n > 0 ? n : null
}

function readMemoryGiB(
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
): number | null {
  if (!nav) return null
  const mem = (nav as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof mem === 'number' && mem > 0 ? mem : null
}

/**
 * 收集信号（同步）。macOS Apple Silicon 可能为 null，需 async 补全。
 */
export function collectHardwareSignals(
  nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null,
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): HardwareSignals {
  const os = detectOsKind(ua, nav)
  return {
    os,
    cores: readCores(nav),
    memoryGiB: readMemoryGiB(nav),
    iosMajor: os === 'ios' ? parseIosMajorVersion(ua) : null,
    appleSilicon: os === 'macos' ? detectAppleSilicon(nav) : null,
  }
}

/**
 * 是否「高硬件」：
 * - Android：≥8GB 档 且 ≥8 核
 * - iOS：系统主版本 ≥ 18
 * - macOS：M 系列；Intel 为低；无法识别时保守为低
 * - Windows/Linux：≥12GB 级（API 用 ≥8 桶）且 ≥6 核
 * - unknown：核与内存同时偏高才给高，否则低
 */
export function evaluateHighHardware(
  signals: HardwareSignals,
): HardwareTierResult {
  const { os, cores, memoryGiB, iosMajor, appleSilicon } = signals

  switch (os) {
    case 'android': {
      // 8G 以上 + 8 核级以上
      const memOk = memoryGiB != null && memoryGiB >= 8
      const cpuOk = cores != null && cores >= 8
      if (memOk && cpuOk) {
        return {
          highHardware: true,
          signals,
          reason: `android high: mem=${memoryGiB} cores=${cores}`,
        }
      }
      return {
        highHardware: false,
        signals,
        reason: `android low: mem=${memoryGiB ?? 'n/a'} cores=${cores ?? 'n/a'} (need ≥8GB & ≥8 cores)`,
      }
    }

    case 'ios': {
      // 18 / 26 / 27…：主版本 ≥ 18 为高；以下为低
      if (iosMajor == null) {
        return {
          highHardware: false,
          signals,
          reason: 'ios low: version unknown',
        }
      }
      if (iosMajor >= 18) {
        return {
          highHardware: true,
          signals,
          reason: `ios high: iOS ${iosMajor}`,
        }
      }
      return {
        highHardware: false,
        signals,
        reason: `ios low: iOS ${iosMajor} < 18`,
      }
    }

    case 'macos': {
      // M 系列高，Intel 低
      if (appleSilicon === true) {
        return {
          highHardware: true,
          signals,
          reason: 'macos high: Apple Silicon',
        }
      }
      if (appleSilicon === false) {
        return {
          highHardware: false,
          signals,
          reason: 'macos low: Intel',
        }
      }
      // 无法识别：保守当低（避免 Intel 误开 standard 重特效）
      return {
        highHardware: false,
        signals,
        reason: 'macos low: chip unknown (conservative)',
      }
    }

    case 'windows':
    case 'linux': {
      // 12G 以上（deviceMemory 分桶 ≥8）+ 6 核级以上
      const memOk = memoryGiB != null && memoryGiB >= 8
      const cpuOk = cores != null && cores >= 6
      // 无 memory API 时：仅 cores ≥ 6 不够稳妥，要求 cores ≥ 8 才给高
      if (memoryGiB == null) {
        if (cores != null && cores >= 8) {
          return {
            highHardware: true,
            signals,
            reason: `${os} high: cores=${cores} (mem n/a, cores≥8)`,
          }
        }
        return {
          highHardware: false,
          signals,
          reason: `${os} low: mem n/a cores=${cores ?? 'n/a'}`,
        }
      }
      if (memOk && cpuOk) {
        return {
          highHardware: true,
          signals,
          reason: `${os} high: memBucket=${memoryGiB} cores=${cores}`,
        }
      }
      return {
        highHardware: false,
        signals,
        reason: `${os} low: memBucket=${memoryGiB} cores=${cores ?? 'n/a'} (need ~12GB+ & ≥6 cores)`,
      }
    }

    default: {
      // 未知平台：双高才给高
      if (
        memoryGiB != null &&
        memoryGiB >= 8 &&
        cores != null &&
        cores >= 8
      ) {
        return {
          highHardware: true,
          signals,
          reason: 'unknown high: mem≥8 cores≥8',
        }
      }
      return {
        highHardware: false,
        signals,
        reason: 'unknown low: conservative',
      }
    }
  }
}

/** 同步评估当前环境是否高硬件 */
export function evaluateCurrentHardwareTier(): HardwareTierResult {
  return evaluateHighHardware(collectHardwareSignals())
}
