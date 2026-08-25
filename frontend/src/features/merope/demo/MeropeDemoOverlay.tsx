/**
 * Merope UI Demo（设计评审用，不进生产路径）
 *
 * 三条硬约束，前几版都没做对，这版是按它们搭的：
 *   1. 角色在屏幕底部**正中**
 *   2. 整个 UI 是一层**彻底透明的全局覆层**，底下页面全程可见
 *   3. chat 与 work **不是两个版面**，work 只是同一层里多长出执行细节
 *
 * 说话走仓库里现成的管线：dispatchMeropeSpeechUtterance → useRigSpeechLifecycle。
 *
 * 叠在真实页面上：任意页面加 ?merope-demo=1
 */

import type React from 'react'
import type { PerformanceDirective } from '../../../services/agent/types'
import type { RigCharacterHandle } from '../rig/RigCharacter'
import type { MeropeRigManifest } from '../rig/types'
import type { MeropeActivity } from '../types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { currentCopy } from '../../../i18n/localeCopy'
import { userFacingError } from '../../../utils/userFacingError'
import { useLongPress } from '../../../components/agent/hooks/useLongPress'
import RigCharacter from '../rig/RigCharacter'
import { dispatchMeropeSpeechUtterance } from '../speechEvents'
import { useRigSpeechLifecycle } from '../useRigSpeechLifecycle'
import '../merope.css'
import './demo.css'

type Stage = 'hidden' | 'peek' | 'active'
type Mode = 'chat' | 'work'
type Band = 'floor' | 'low' | 'normal' | 'high'
type Surface = 'glass' | 'solid' | 'flat' | 'outline' | 'liquid'
type Figure = 'rig' | 'static' | 'aura'

interface Line {
  id: string
  role: 'user' | 'merope'
  text: string
  streaming?: boolean
}

interface Step {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'failed'
  tier?: 'pro' | 'std'
  ms?: number
}

const LONG_PRESS_MS = 500

function bandOf(mood: number): Band {
  if (mood < 20) return 'floor'
  if (mood < 45) return 'low'
  if (mood < 75) return 'normal'
  return 'high'
}

function directive(
  phase: PerformanceDirective['phase'],
  revision: number,
  baseline: PerformanceDirective['plan']['baseline'],
  cues: PerformanceDirective['plan']['cues'],
): PerformanceDirective {
  return { phase, moodRevision: revision, plan: { baseline, cues } }
}

const REPLIES = [
  '今天 Bilibili 那边多了两条动态，网易云的周报也出来了。要我念一遍吗？',
  '刚看完你昨天听的歌单，比上周安静了不少。是不是最近在赶什么东西？',
  '我把 Steam 那边的时长统计好了，这周比上周少了四个小时。',
]

const TASK_STEPS: Array<Omit<Step, 'status'>> = [
  { id: 's1', name: '读取订阅源清单', tier: 'std', ms: 210 },
  { id: 's2', name: '拉取 12 个源的更新', tier: 'std', ms: 1840 },
  { id: 's3', name: '去重并按主题聚类', tier: 'pro', ms: 2260 },
  { id: 's4', name: '生成摘要', tier: 'pro', ms: 3100 },
  { id: 's5', name: '写入阅读列表', tier: 'std', ms: 340 },
]

const CLUSTERS: Array<[string, number, string]> = [
  ['技术', 14, '78%'],
  ['游戏', 9, '54%'],
  ['音乐', 6, '36%'],
  ['其它', 5, '22%'],
]

export default function MeropeDemoOverlay() {
  const [manifest, setManifest] = useState<MeropeRigManifest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [stage, setStage] = useState<Stage>('hidden')
  const [mode, setMode] = useState<Mode>('chat')
  const [figure, setFigure] = useState<Figure>('rig')
  const [mood, setMood] = useState(62)
  const [activity, setActivity] = useState<MeropeActivity>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [escalated, setEscalated] = useState(false)

  const [surface, setSurface] = useState<Surface>('glass')
  const [dark, setDark] = useState(false)
  const [showControls, setShowControls] = useState(true)

  const rigRef = useRef<RigCharacterHandle>(null)
  const revisionRef = useRef(0)
  const timersRef = useRef<number[]>([])
  const flowRef = useRef<HTMLDivElement>(null)

  const band = bandOf(mood)

  // 仓库现成的口型管线：覆层只负责发事件，rig 自己接
  useRigSpeechLifecycle(rigRef)

  useEffect(() => {
    let cancelled = false
    fetch('/merope-demo/manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setManifest(data as MeropeRigManifest)
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            userFacingError(error, currentCopy().merope.loadFailed),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 真实的表面令牌切换
  useEffect(() => {
    document.documentElement.setAttribute('data-surface', surface)
    return () => document.documentElement.removeAttribute('data-surface')
  }, [surface])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
  }, [dark])

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
    return id
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const { indicator } = useLongPress(
    LONG_PRESS_MS,
    useCallback(() => {
      setStage('active')
      setMode('chat')
    }, []),
    stage === 'hidden',
  )

  const perform = useCallback(
    (
      phase: PerformanceDirective['phase'],
      baseline: PerformanceDirective['plan']['baseline'],
      cues: PerformanceDirective['plan']['cues'] = [],
    ) => {
      revisionRef.current += 1
      rigRef.current?.playMotionPlan(
        directive(phase, revisionRef.current, baseline, cues),
      )
    },
    [],
  )

  const streamReply = useCallback(
    (text: string, source: 'reply' | 'proactive' = 'reply') => {
      const id = `m${Date.now()}`
      setLines((prev) => [
        ...prev,
        { id, role: 'merope', text: '', streaming: true },
      ])
      setActivity('talking')

      // 口型交给仓库里的 speech lifecycle，覆层不自己算
      dispatchMeropeSpeechUtterance({
        messageId: id,
        source,
        text,
        utteranceId: `${id}-0`,
      })

      perform(
        'delivery',
        {
          expression: 'warm',
          posture: 'open',
          motionEnergy: 0.95,
          attention: 0.85,
        },
        [
          {
            intent: 'respond',
            atMs: 0,
            intensity: 0.9,
            tempo: 1,
            fadeInMs: 120,
            fadeOutMs: 260,
            interrupt: 'replace',
          },
        ],
      )

      const perChar = 42
      for (let i = 1; i <= text.length; i += 1) {
        later(() => {
          setLines((prev) =>
            prev.map((l) =>
              l.id === id
                ? { ...l, text: text.slice(0, i), streaming: i < text.length }
                : l,
            ),
          )
        }, i * perChar)
      }
      later(() => setActivity('idle'), text.length * perChar + 200)
    },
    [later, perform],
  )

  useEffect(() => {
    flowRef.current?.scrollTo({
      top: flowRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [lines, steps, needsConfirm])

  const scenarioGreet = useCallback(() => {
    clearTimers()
    setMode('chat')
    setStage('peek')
    setLines([])
    setSteps([])
    perform(
      'proactive',
      {
        expression: 'warm',
        posture: 'open',
        motionEnergy: 1.1,
        attention: 0.9,
      },
      [
        {
          intent: 'greet',
          atMs: 300,
          intensity: 1.1,
          tempo: 1.1,
          fadeInMs: 160,
          fadeOutMs: 400,
          interrupt: 'replace',
        },
      ],
    )
    later(
      () =>
        streamReply(
          REPLIES[Math.floor(Math.random() * REPLIES.length)],
          'proactive',
        ),
      600,
    )
  }, [clearTimers, later, perform, streamReply])

  const scenarioAsk = useCallback(() => {
    clearTimers()
    setMode('chat')
    setStage('active')
    setLines((prev) => [
      ...prev,
      {
        id: `u${Date.now()}`,
        role: 'user',
        text: '最近我这边有什么新东西吗？',
      },
    ])
    setActivity('thinking')
    perform('reaction', {
      expression: 'steady',
      posture: 'neutral',
      motionEnergy: 0.7,
      attention: 1,
    })
    later(
      () => streamReply(REPLIES[Math.floor(Math.random() * REPLIES.length)]),
      900,
    )
  }, [clearTimers, later, perform, streamReply])

  const runTask = useCallback(() => {
    setSteps(TASK_STEPS.map((s) => ({ ...s, status: 'pending' })))
    setNeedsConfirm(false)
    let at = 400
    TASK_STEPS.forEach((step, index) => {
      later(() => {
        setSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, status: 'running' } : s)),
        )
        setActivity('thinking')
        perform('delivery', {
          expression: 'steady',
          posture: 'neutral',
          motionEnergy: 0.6,
          attention: 1,
        })
      }, at)
      at += step.ms ?? 500

      // 第 4 步前插一次敏感确认：她转头去看确认卡
      if (index === 3) {
        later(() => {
          setNeedsConfirm(true)
          rigRef.current?.setGazeTarget({ x: 0.1, y: -0.6 }, 'performance')
          perform(
            'delivery',
            {
              expression: 'steady',
              posture: 'open',
              motionEnergy: 0.8,
              attention: 1,
            },
            [
              {
                intent: 'notify',
                atMs: 0,
                intensity: 1.2,
                tempo: 1.2,
                fadeInMs: 100,
                fadeOutMs: 320,
                interrupt: 'replace',
              },
            ],
          )
        }, at - 60)
        later(() => {
          setNeedsConfirm(false)
          rigRef.current?.setGazeTarget(null)
        }, at + 1500)
        at += 1600
      }

      later(() => {
        setSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, status: 'done' } : s)),
        )
      }, at)
    })

    later(() => {
      setActivity('idle')
      setMood((m) => Math.min(100, m + 12))
      perform(
        'outcome',
        {
          expression: 'warm',
          posture: 'open',
          motionEnergy: 1.2,
          attention: 0.7,
        },
        [
          {
            intent: 'delight',
            atMs: 0,
            intensity: 1.3,
            tempo: 1.2,
            fadeInMs: 140,
            fadeOutMs: 520,
            interrupt: 'replace',
          },
        ],
      )
    }, at + 200)
  }, [later, perform])

  const scenarioTask = useCallback(() => {
    clearTimers()
    setMode('chat')
    setStage('active')
    setEscalated(false)
    setLines([
      {
        id: `u${Date.now()}`,
        role: 'user',
        text: '把我所有订阅源的更新整理成一份摘要',
      },
    ])
    setActivity('thinking')
    later(() => {
      setEscalated(true)
      setMode('work')
      runTask()
    }, 1100)
  }, [clearTimers, later, runTask])

  const reset = useCallback(() => {
    clearTimers()
    setMode('chat')
    setStage('hidden')
    setLines([])
    setSteps([])
    setEscalated(false)
    setNeedsConfirm(false)
    setActivity('idle')
    rigRef.current?.setGazeTarget(null)
    rigRef.current?.setSpeechActive(false)
  }, [clearTimers])

  // 视线追光标：chat 才追，work 下视线只服务于「看向要注意的地方」
  useEffect(() => {
    if (mode !== 'chat' || stage === 'hidden' || figure !== 'rig') return
    let raf = 0
    let pending: { x: number; y: number } | null = null
    const onMove = (e: MouseEvent) => {
      pending = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      }
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        if (pending) rigRef.current?.setGazeTarget(pending, 'pointer')
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [mode, stage, figure])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setStage('active')
    setLines((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', text }])
    setActivity('thinking')
    perform('reaction', {
      expression: 'steady',
      posture: 'neutral',
      motionEnergy: 0.7,
      attention: 1,
    })
    later(
      () => streamReply(REPLIES[Math.floor(Math.random() * REPLIES.length)]),
      800,
    )
  }, [input, later, perform, streamReply])

  const doneCount = useMemo(
    () => steps.filter((s) => s.status === 'done').length,
    [steps],
  )

  const renderText = (text: string) =>
    Array.from(text).map((ch, i) =>
      // 空格不包 inline-block：否则行尾会留一个占宽的空块
      ch === ' ' ? (
        ch
      ) : (
        <span
          className="md-ch"
          key={i}
          style={{ animationDelay: `${Math.min(i, 40) * 12}ms` }}
        >
          {ch}
        </span>
      ),
    )

  const shownSteps = steps.length
    ? steps
    : TASK_STEPS.map((s) => ({ ...s, status: 'pending' as const }))

  return (
    <div className="md-root">
      {/* ---- demo 控制台（不属于设计） ---- */}
      <aside className="md-console-anchor">
        <div
          className={`md-console glass md-dense${showControls ? '' : ' is-collapsed'}`}
        >
          <button
            className="md-console-toggle"
            onClick={() => setShowControls((v) => !v)}
          >
            {showControls ? '收起' : '控制台'}
          </button>
          {showControls && (
            <div className="md-console-body">
              <div className="md-console-group">
                <span className="md-console-label">场景</span>
                <button
                  className="md-btn md-btn--primary"
                  onClick={scenarioGreet}
                >
                  她主动开口
                </button>
                <button className="md-btn" onClick={scenarioAsk}>
                  问她一句
                </button>
                <button className="md-btn" onClick={scenarioTask}>
                  交个任务 → 转 work
                </button>
                <button className="md-btn md-btn--ghost" onClick={reset}>
                  重置
                </button>
              </div>

              <div className="md-console-group">
                <span className="md-console-label">模式</span>
                <div className="md-seg">
                  <button
                    className={mode === 'chat' ? 'is-on' : ''}
                    onClick={() => {
                      setMode('chat')
                      setStage('active')
                    }}
                  >
                    chat
                  </button>
                  <button
                    className={mode === 'work' ? 'is-on' : ''}
                    onClick={() => {
                      setMode('work')
                      setStage('active')
                      if (steps.length === 0) runTask()
                    }}
                  >
                    work
                  </button>
                </div>
              </div>

              <div className="md-console-group">
                <span className="md-console-label">形象</span>
                <div className="md-seg">
                  {(['rig', 'static', 'aura'] as Figure[]).map((f) => (
                    <button
                      key={f}
                      className={figure === f ? 'is-on' : ''}
                      onClick={() => setFigure(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="md-console-group">
                <span className="md-console-label">
                  心情 {mood} · {band}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={mood}
                  onChange={(e) => setMood(Number(e.target.value))}
                  className="md-range"
                />
              </div>

              <div className="md-console-group">
                <span className="md-console-label">表面主题（真实令牌）</span>
                <div className="md-seg md-seg--wrap">
                  {(
                    ['glass', 'solid', 'flat', 'outline', 'liquid'] as Surface[]
                  ).map((s) => (
                    <button
                      key={s}
                      className={surface === s ? 'is-on' : ''}
                      onClick={() => setSurface(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  className="md-btn md-btn--ghost"
                  onClick={() => setDark((v) => !v)}
                >
                  {dark ? '切到亮色' : '切到暗色'}
                </button>
              </div>

              <p className="md-console-hint">
                空白处<b>长按 500ms</b>{' '}
                唤起。她始终在底部正中；覆层是透明的，底下页面一直在。
                {loadError && <span className="md-err">{loadError}</span>}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* ================================================================
          唯一的全局透明覆层。chat / work 共用，work 只是多长出执行细节。
          纵向堆叠（自下而上）：她 → 输入条 → 内容列
          ================================================================ */}
      {stage !== 'hidden' && (
        <div className="md-overlay" data-mode={mode} data-stage={stage}>
          <div className="md-flow" ref={flowRef}>
            {lines.map((l) =>
              l.role === 'user' ? (
                <div className="md-user" key={l.id}>
                  <span>{l.text}</span>
                </div>
              ) : (
                <div className="md-bubble glass md-dense" key={l.id}>
                  <p className="md-say">
                    {renderText(l.text)}
                    {l.streaming && <span className="md-caret" />}
                  </p>
                </div>
              ),
            )}

            {mode === 'work' && (
              <div className="md-bubble md-bubble--run glass md-dense">
                <div className="md-run">
                  {escalated && (
                    <p className="md-run-note">
                      这个要跑 5 步，我在这儿做，你看着就行
                    </p>
                  )}

                  <ol className="md-steps">
                    {shownSteps.map((s) => (
                      <li className={`md-step is-${s.status}`} key={s.id}>
                        <span className="md-step-dot" />
                        <span className="md-step-name">{s.name}</span>
                        {s.tier && (
                          <span className={`md-tier md-tier--${s.tier}`}>
                            {s.tier}
                          </span>
                        )}
                        {s.status === 'done' && s.ms && (
                          <span className="md-step-ms">{s.ms}ms</span>
                        )}
                      </li>
                    ))}
                  </ol>

                  {needsConfirm && (
                    <div className="md-confirm glass md-dense">
                      <div className="md-confirm-head">
                        <strong>
                          要写 34 条进阅读列表，其中 6 条会覆盖已有摘要
                        </strong>
                        <span className="md-ttl">28s</span>
                      </div>
                      <div className="md-confirm-actions">
                        <button className="md-btn md-btn--primary md-btn--tiny">
                          确认
                        </button>
                        <button className="md-btn md-btn--tiny">取消</button>
                      </div>
                    </div>
                  )}

                  {doneCount >= 3 && (
                    <div className="md-out">
                      {CLUSTERS.map(([name, n, w]) => (
                        <div
                          className="md-bar"
                          key={name}
                          style={{ ['--w' as string]: w }}
                        >
                          <span>{name}</span>
                          <b>{n}</b>
                        </div>
                      ))}
                    </div>
                  )}

                  {doneCount >= 4 && (
                    <p className="md-say md-say--out">
                      {renderText(
                        '本周你的订阅源里技术类占了近一半，主要围绕两个话题——Rust 的异步运行时和字体渲染。',
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 输入条：通栏贴底，她站在它前面 */}
          <div className="md-dock">
            <div className="md-dock-inner glass md-dense">
              <div className="md-input-wrap">
                <input
                  className="md-input"
                  value={input}
                  placeholder={
                    mode === 'work' ? '执行中也可以插一句…' : '随便说点什么…'
                  }
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
                  }}
                />
              </div>
              <div className="md-mode-switch" role="group" aria-label="模式">
                <button
                  className={mode === 'chat' ? 'is-on' : ''}
                  onClick={() => setMode('chat')}
                >
                  chat
                </button>
                <button
                  className={mode === 'work' ? 'is-on' : ''}
                  onClick={() => {
                    setMode('work')
                    if (steps.length === 0) runTask()
                  }}
                >
                  work
                </button>
              </div>
              <button className="md-send" onClick={send} aria-label="发送">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 形象层：底部正中，全局唯一实例，切模式只换类名 ---- */}
      <div
        className={`md-figure md-figure--${mode} md-figure--${figure}`}
        data-stage={stage}
        data-press={indicator.active ? '1' : '0'}
        data-confirm={needsConfirm ? 'true' : 'false'}
      >
        <div className={`md-aura md-aura--${band}`} aria-hidden />
        {figure === 'rig' && manifest && (
          <RigCharacter
            ref={rigRef}
            activity={activity}
            fallbackUrl="/merope-demo/atlas.png"
            manifest={manifest}
            mood={mood}
          />
        )}
        {figure === 'static' && (
          <div className="md-static" aria-hidden>
            <div className="md-static-bust" />
          </div>
        )}
        {figure === 'aura' && (
          <div
            className={`md-orb md-orb--${band}`}
            data-activity={activity}
            aria-hidden
          />
        )}
      </div>

      {/* 长按指示环 */}
      <div
        className={`md-lp${indicator.active ? ' is-active' : ''}`}
        style={{ left: indicator.x, top: indicator.y }}
        aria-hidden
      >
        <svg viewBox="0 0 40 40">
          <circle className="md-lp-track" cx="20" cy="20" r="16" />
          <circle className="md-lp-ring" cx="20" cy="20" r="16" />
        </svg>
      </div>
    </div>
  )
}
