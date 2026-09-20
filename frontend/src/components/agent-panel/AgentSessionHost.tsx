import type { QueuedAgentPanelOpen } from './agentPanelEvents'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { isDocumentReady, subscribeDocumentReady } from '../../utils/pageLoader'
import {
  AGENT_PANEL_OPEN_EVENT,
  AGENT_PANEL_OPEN_SESSION_EVENT,
  agentPanelOpenView,
  queueAgentPanelOpen,
} from './agentPanelEvents'
import { LONG_PRESS_DURATION, useLongPress } from './useLongPress'
import './agent-panel-longpress.css'

export const AGENT_SESSION_DELAY_MS = 5000
export const AGENT_SESSION_IDLE_TIMEOUT_MS = 4000

const WAKE_EVENTS = [
  AGENT_PANEL_OPEN_EVENT,
  AGENT_PANEL_OPEN_SESSION_EVENT,
  'arael-open-session',
  'arael-open-manage',
] as const

// React lazy surfaces import failures through its render boundary; warming is optional.
function preloadAgentSession(): void {
  void import('./AgentEngine').catch(() => {})
  void import('./AgentPanel').catch(() => {})
}

/**
 * 推迟 AgentEngine / AgentPanel 的第一次 import。
 * 打开面板立刻挂；否则首屏后 5s + idle，避开 3s 后台 Tapp。挂上之后关面板不卸。
 */
export function AgentSessionHost({ children }: { children: React.ReactNode }) {
  const documentReady = useSyncExternalStore(subscribeDocumentReady, isDocumentReady, () => false)
  const [ready, setReady] = useState(false)

  const wake = useCallback((queued?: QueuedAgentPanelOpen) => {
    if (queued) queueAgentPanelOpen(queued)
    preloadAgentSession()
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) return
    const onEvent = (event: Event) => {
      if (event.type === AGENT_PANEL_OPEN_EVENT) {
        wake({ view: agentPanelOpenView(event), stage: 'full' })
        return
      }
      if (event.type === 'arael-open-manage') {
        wake({ view: 'manage', stage: 'full' })
        return
      }
      if (
        event.type === AGENT_PANEL_OPEN_SESSION_EVENT ||
        event.type === 'arael-open-session'
      ) {
        wake({ view: 'messages', stage: 'full' })
        return
      }
      wake({ view: 'messages', stage: 'full' })
    }
    for (const name of WAKE_EVENTS) {
      window.addEventListener(name, onEvent)
    }
    let idleId: number | null = null
    const timerId = documentReady ? window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = requestIdleCallback(() => wake(), {
          timeout: AGENT_SESSION_IDLE_TIMEOUT_MS,
        })
      } else {
        wake()
      }
    }, AGENT_SESSION_DELAY_MS) : null
    return () => {
      for (const name of WAKE_EVENTS) {
        window.removeEventListener(name, onEvent)
      }
      if (timerId !== null) window.clearTimeout(timerId)
      if (idleId !== null && 'cancelIdleCallback' in window) {
        cancelIdleCallback(idleId)
      }
    }
  }, [documentReady, ready, wake])

  const { indicator } = useLongPress(
    LONG_PRESS_DURATION,
    useCallback(() => {
      wake({ view: 'messages', stage: 'overlay' })
    }, [wake]),
    !ready,
  )

  if (ready) return children

  return (
    <div
      className={`agent-panel-longpress${indicator.active ? ' active' : ''}`}
      style={{ left: indicator.x, top: indicator.y }}
    >
      <div className="agent-panel-lp-dot" />
      <div className="agent-panel-lp-pulse" />
      <svg className="agent-panel-lp-svg" viewBox="0 0 40 40">
        <circle className="agent-panel-lp-track" cx="20" cy="20" r="16" />
        <circle className="agent-panel-lp-ring" cx="20" cy="20" r="16" />
      </svg>
    </div>
  )
}
