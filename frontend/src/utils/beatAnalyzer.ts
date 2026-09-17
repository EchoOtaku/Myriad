export interface BeatGrid {
  bpm: number
  beats: number[]
  accents: number[]
  confidence: number
}

const gridCache = new Map<string, BeatGrid>()
const MAX_AUDIO_BYTES = 4 * 1024 * 1024
const MAX_AUDIO_SECONDS = 120
let analysisTail: Promise<unknown> = Promise.resolve()
let outstanding = 0

async function readAudio(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const response = await fetch(url, { signal })
  if (!response.ok) { await response.body?.cancel(); return null }
  if (Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES || !response.body) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_AUDIO_BYTES) return null
      chunks.push(value)
    }
    const result = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result.buffer
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Reject long media before Web Audio allocates a full PCM buffer. */
async function hasBoundedDuration(raw: ArrayBuffer, signal: AbortSignal): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([raw]))
  const audio = new Audio()
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const abort = () => finish(false, signal.reason)
      const finish = (valid: boolean, error?: unknown) => {
        signal.removeEventListener('abort', abort)
        audio.onloadedmetadata = null
        audio.onerror = null
        if (error) reject(error)
        else resolve(valid)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration >= 10 && audio.duration <= MAX_AUDIO_SECONDS)
      audio.onerror = () => finish(false)
      audio.src = url
      audio.load()
    })
  } finally {
    audio.src = ''
    audio.load()
    URL.revokeObjectURL(url)
  }
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curR = 1
      let curI = 0
      for (let k = 0; k < half; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + half] * curR - im[i + k + half] * curI
        const vi = re[i + k + half] * curI + im[i + k + half] * curR
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + half] = ur - vr
        im[i + k + half] = ui - vi
        const nr = curR * wr - curI * wi
        curI = curR * wi + curI * wr
        curR = nr
      }
    }
  }
}

async function analyze(url: string, signal: AbortSignal): Promise<BeatGrid | null> {
  const raw = await readAudio(url, signal)
  if (!raw || !await hasBoundedDuration(raw, signal)) return null
  signal.throwIfAborted()
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  const ctx = new AC({ sampleRate: 11025 })
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(raw)
  } finally {
    void ctx.close()
  }
  // Skip overly long audio (memory).
  signal.throwIfAborted()
  if (audio.duration > MAX_AUDIO_SECONDS || audio.duration < 10) return null

  const sr = audio.sampleRate
  const down = Math.max(1, Math.round(sr / 11025))
  const dsr = sr / down
  const ch0 = audio.getChannelData(0)
  const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null
  const n = Math.floor(ch0.length / down)
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = i * down
    mono[i] = ch1 ? (ch0[s] + ch1[s]) * 0.5 : ch0[s]
  }

  const win = 512
  const hop = 128
  const frames = Math.floor((n - win) / hop)
  if (frames < 400) return null
  const env = new Float32Array(frames)
  const re = new Float32Array(win)
  const im = new Float32Array(win)
  const prevMag = new Float32Array(win / 2)
  const hann = new Float32Array(win)
  for (let i = 0; i < win; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win)
  }
  let sliceStart = performance.now()
  for (let f = 0; f < frames; f++) {
    const off = f * hop
    for (let i = 0; i < win; i++) {
      re[i] = mono[off + i] * hann[i]
      im[i] = 0
    }
    fft(re, im)
    let flux = 0
    for (let k = 1; k < win / 2; k++) {
      const mag = Math.log(1 + 10 * Math.hypot(re[k], im[k]))
      const d = mag - prevMag[k]
      if (d > 0) flux += d
      prevMag[k] = mag
    }
    env[f] = flux
    if (performance.now() - sliceStart >= 8) {
      await new Promise((r) => setTimeout(r, 0))
      signal.throwIfAborted()
      sliceStart = performance.now()
    }
  }

  const smooth = new Float32Array(frames)
  let ema = 0
  for (let i = 0; i < frames; i++) {
    ema += (env[i] - ema) * 0.4
    smooth[i] = ema
  }
  let mean = 0
  for (let i = 0; i < frames; i++) mean += smooth[i]
  mean /= frames
  for (let i = 0; i < frames; i++) {
    smooth[i] = Math.max(0, smooth[i] - mean)
  }

  const fps = dsr / hop
  const minLag = Math.max(4, Math.round((fps * 60) / 200))
  const maxLag = Math.min(frames >> 1, Math.round((fps * 60) / 55))
  let bestLag = 0
  let bestScore = 0
  let scoreSum = 0
  let scoreCnt = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (performance.now() - sliceStart >= 8) {
      await new Promise((r) => setTimeout(r, 0))
      signal.throwIfAborted()
      sliceStart = performance.now()
    }
    let r = 0
    for (let i = 0; i + lag < frames; i += 2) {
      r += smooth[i] * smooth[i + lag]
    }
    const bpm = (60 * fps) / lag
    const prior = Math.exp(-0.5 * ((Math.log2(bpm / 120) / 0.9) ** 2))
    const s = r * prior
    scoreSum += s
    scoreCnt++
    if (s > bestScore) {
      bestScore = s
      bestLag = lag
    }
  }
  if (!bestLag || scoreCnt === 0) return null
  const ratio = bestScore / (scoreSum / scoreCnt)
  const confidence = Math.max(0, Math.min(1, (ratio - 1.2) / 3.5))

  let bestP = 0
  let bestPS = -1
  for (let p = 0; p < bestLag; p++) {
    let s = 0
    for (let i = p; i < frames; i += bestLag) s += smooth[i]
    if (s > bestPS) {
      bestPS = s
      bestP = p
    }
  }

  const beats: number[] = []
  const peaks: number[] = []
  const snapW = Math.max(2, Math.round(bestLag * 0.12))
  for (let f = bestP; f < frames; f += bestLag) {
    let m = f
    let mv = -1
    const lo = Math.max(0, f - snapW)
    const hi = Math.min(frames - 1, f + snapW)
    for (let k = lo; k <= hi; k++) {
      if (smooth[k] > mv) {
        mv = smooth[k]
        m = k
      }
    }
    beats.push((m * hop + win / 2) / dsr)
    peaks.push(mv)
  }

  let pMean = 0
  for (let i = 0; i < peaks.length; i++) pMean += peaks[i]
  pMean /= peaks.length || 1
  let pVar = 0
  for (let i = 0; i < peaks.length; i++) {
    pVar += (peaks[i] - pMean) ** 2
  }
  const pStd = Math.sqrt(pVar / (peaks.length || 1))
  const accents: number[] = []
  const accThreshold = pMean + 1.5 * pStd
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > accThreshold) accents.push(i)
  }

  return {
    bpm: Math.round(((60 * fps) / bestLag) * 10) / 10,
    beats,
    accents,
    confidence,
  }
}

export function analyzeBeatGrid(
  url: string,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<BeatGrid | null> {
  if (signal?.aborted) return Promise.resolve(null)
  const cached = gridCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  if (outstanding >= 5) return Promise.resolve(null)
  outstanding++
  const timeout = AbortSignal.timeout(30_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const task = analysisTail.then(async () => {
    if (combined.aborted) return null
    try {
      const grid = await analyze(url, combined)
      if (grid && !combined.aborted) {
        gridCache.set(cacheKey, grid)
        if (gridCache.size > 20) gridCache.delete(gridCache.keys().next().value!)
      }
      return grid
    } catch {
      return null
    }
  }).finally(() => { outstanding-- })
  analysisTail = task
  return task
}
