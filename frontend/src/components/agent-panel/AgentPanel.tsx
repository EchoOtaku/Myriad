/**
 * Agent 面板外壳 —— 只管「现在展开到第几档」。
 *
 * 岛、Quick Overlay、Full 是同一块东西的三个大小，所以档位、手势、收起这些跨档的
 * 事集中在这里，各档自己只管长什么样。
 *
 * 输入那一行也归这里摆：它已经从卡片里搬出来，是卡片外面的输入框加一枚动作，两档
 * 共用同一行。「什么时候不该出现」（等人拍板、在设置那一面）于是也成了跨档的规矩。
 */

import type { AgentPanelFullView } from './AgentPanelFull'
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useImmersiveChrome } from '../../contexts/NavigationContext'
import { executeFrontendAction } from '../../services/agent'
import {
  getNavLayoutSnapshot,
  getServerNavLayoutSnapshot,
  subscribeNavLayout,
} from '../../utils/navLayout'
import { useAgentMessages } from './agentMessages'
import { AgentPanelComposer } from './AgentPanelComposer'
import {
  AGENT_PANEL_OPEN_EVENT,
  agentPanelOpenView,
  dispatchAgentPanelAction,
  dispatchAgentPanelSubmit,
} from './agentPanelEvents'
import { AgentPanelFull } from './AgentPanelFull'
import { AgentPanelIsland } from './AgentPanelIsland'
import { AgentPanelOverlay } from './AgentPanelOverlay'
import {
  agentPanelIsOpen,
  agentPanelSettleTimeoutMs,
  agentPanelShowsStage,
  agentPanelStageReducer,
  INITIAL_AGENT_PANEL_STAGE,
} from './agentPanelStage'
import { clearAgentSelection, watchAgentSelection } from './agentSelection'
import {
  clearAgentUndoOffer,
  useAgentPendingAction,
  useAgentUndoOffer,
} from './agentStatusStore'
import { LONG_PRESS_DURATION, useLongPress } from './useLongPress'
import './agent-panel.css'

export const AgentPanel: React.FC = () => {
  const location = useLocation()
  const [stage, dispatch] = useReducer(
    agentPanelStageReducer,
    INITIAL_AGENT_PANEL_STAGE,
  )
  const overlayRef = useRef<HTMLDivElement>(null)
  const open = agentPanelIsOpen(stage)
  const showsOverlay = agentPanelShowsStage(stage, 'overlay')
  const showsFull = agentPanelShowsStage(stage, 'full')
  const messages = useAgentMessages()

  const navLayout = useSyncExternalStore(
    subscribeNavLayout,
    getNavLayoutSnapshot,
    getServerNavLayoutSnapshot,
  )
  const pendingAction = useAgentPendingAction()
  const undoOffer = useAgentUndoOffer()
  /**
   * Full 档正看着哪一面。
   *
   * 放在这里而不是 Full 自己身上，是因为输入那一行也归这里摆 —— 设置那一面没有
   * 「跟它说话」这回事，输入框得收起来，而收的人在外面。
   */
  const [fullView, setFullView] = useState<AgentPanelFullView>('messages')

  // 收起之后重新唤起，从对话那一面开始 —— 上次翻到设置页不该留到下一次
  useEffect(() => {
    if (!showsFull) setFullView('messages')
  }, [showsFull])

  /** 等人拍板时那一档整块让给操作卡片；设置那一面没有「跟它说话」这回事。 */
  const showsComposer = !pendingAction && !(showsFull && fullView === 'manage')

  // 通知中心这些外部入口：叫开面板，并落到它们想让人看的那一面
  useEffect(() => {
    const onOpen = (event: Event) => {
      setFullView(agentPanelOpenView(event))
      dispatch({ type: 'open', stage: 'full' })
    }
    window.addEventListener(AGENT_PANEL_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(AGENT_PANEL_OPEN_EVENT, onOpen)
  }, [])

  // 要人拍板的时候自动展开。这不算抢占：确认是用户自己那条指令的下一步，
  // 而且它有时限，摆在岛上等人主动来看会过期。
  useEffect(() => {
    if (pendingAction) dispatch({ type: 'open', stage: 'overlay' })
  }, [pendingAction])

  // 移动端展开时也要给导航岛让位。岛自己另有一条理由，两条各记各的，
  // 都撤销了导航岛才回来。
  useImmersiveChrome('agent-panel-overlay', navLayout === 'mobile' && open)

  // 档位跟着「有没有话要读」走：正说着的时候唤起，直接展开到能读的那一档，
  // 不该让人先看到一个空输入框再自己点开。
  const hasConversation = messages.length > 0
  const { indicator } = useLongPress(
    LONG_PRESS_DURATION,
    useCallback(
      () =>
        dispatch({
          type: 'open',
          stage: hasConversation ? 'full' : 'overlay',
        }),
      [hasConversation],
    ),
    !open,
  )

  // 动画结束的落定。用定时器而不是 transitionend：后者会被打断、被丢，
  // 状态卡在「变形中」比晚落定 100ms 难受得多。
  useEffect(() => {
    if (stage.phase === 'settled') return
    const timer = setTimeout(dispatch, agentPanelSettleTimeoutMs(), {
      type: 'settle',
    })
    return () => clearTimeout(timer)
  }, [stage])

  // 一直盯着选区。必须常驻 —— 长按那一下会把选区收掉，等面板开了再看就晚了。
  useEffect(() => watchAgentSelection(), [])

  // 换页面时收起：上下文都变了，开着的那句话已经不成立，记着的那段选中也是
  useEffect(() => {
    dispatch({ type: 'close' })
    clearAgentSelection()
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch({ type: 'close' })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const node = overlayRef.current
      if (node && !node.contains(event.target as Node)) {
        dispatch({ type: 'close' })
      }
    }
    // 延后挂载：唤起用的那次长按会以 mouseup 收尾，立刻挂上会被同一串事件关掉
    const timer = setTimeout(
      () => document.addEventListener('mousedown', onPointerDown),
      100,
    )
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  const submit = useCallback((text: string) => {
    dispatchAgentPanelSubmit(text)
    // 展开到能读答案的那一档，而不是收起 —— 问完就把面板关掉等于让人白问
    setFullView('messages')
    dispatch({ type: 'open', stage: 'full' })
  }, [])

  // 撤销就是把逆操作再执行一遍 —— 不另起一套机制
  const undo = useCallback(() => {
    if (!undoOffer) return
    clearAgentUndoOffer(undoOffer.id)
    dispatch({ type: 'close' })
    void executeFrontendAction(undoOffer.inverse)
  }, [undoOffer])

  const decide = useCallback(
    (approved: boolean) => {
      if (!pendingAction) return
      dispatchAgentPanelAction(pendingAction.id, approved)
      dispatch({ type: 'close' })
    },
    [pendingAction],
  )

  return (
    <>
      {/* 展开时岛让位 —— 同一块东西不该同时出现两次 */}
      {!showsOverlay && !showsFull && <AgentPanelIsland />}

      {(showsOverlay || showsFull) && (
        <div ref={overlayRef} className="agent-panel-overlay-anchor">
          {showsFull ? (
            <AgentPanelFull
              phase={stage.phase}
              view={fullView}
              onView={setFullView}
              onSubmit={submit}
              onCollapse={() => dispatch({ type: 'close' })}
            />
          ) : (
            <AgentPanelOverlay
              phase={stage.phase}
              pathname={location.pathname}
              onSubmit={submit}
              pendingAction={pendingAction}
              onDecide={decide}
              undoOffer={undoOffer}
              onUndo={undo}
              onExpand={() => dispatch({ type: 'open', stage: 'full' })}
            />
          )}

          {/* 等人拍板、翻设置的时候没有话可说，这一行就不该杵在那儿 */}
          {showsComposer && (
            <AgentPanelComposer
              onSubmit={submit}
              autoFocus={fullView !== 'sessions'}
            />
          )}
        </div>
      )}

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
    </>
  )
}

export default AgentPanel
