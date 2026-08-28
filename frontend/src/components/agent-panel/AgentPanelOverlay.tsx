/**
 * Quick Overlay —— 三档里的第二档。
 *
 * 从岛长出来的一小块，不铺满、不遮死当前页面。两行：
 * 1. 它现在看得到什么（说出来，用户才知道自己在跟谁说话）
 * 2. 就着这份上下文能一键做的事
 *
 * **说明性的短句一律是 tag**：看得到什么、刚做了什么、能不能读这一页 —— 全都是
 * 同一种贴，不是六处各写各的裸文本。输入那一行不在这里，它是卡片外面的输入框加
 * 一枚动作（见 AgentPanelComposer）。
 *
 * 它不执行任何东西 —— 话递给 `dispatchAgentPanelSubmit`，谁在执行谁接住。
 */

import type { AgentPendingAction } from './agentAction'
import type { AgentPanelPhase } from './agentPanelStage'
import type { AgentUndoOffer } from './agentUndo'
import React, {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { usePageContentOptional } from '../../contexts/PageContentContext'
import { agentService } from '../../services/agent'
import { resolveAgentContext } from './agentContext'
import {
  getAgentContextConsent,
  getServerAgentContextConsent,
  setAgentContextConsent,
  subscribeAgentContextConsent,
} from './agentContextConsent'
import { useAgentMessages } from './agentMessages'
import { AgentPanelActionCard } from './AgentPanelActionCard'
import {
  getAgentSelectionSnapshot,
  getServerAgentSelectionSnapshot,
  selectionIsFresh,
  selectionPreview,
  subscribeAgentSelection,
} from './agentSelection'
import { AgentStatusGlyph } from './AgentStatusGlyph'
import { useAgentStatus } from './agentStatusStore'

export interface AgentPanelOverlayProps {
  phase: AgentPanelPhase
  pathname: string
  onSubmit: (text: string) => void
  /** 有待确认的操作时，这一档整块让给操作卡片 */
  pendingAction: AgentPendingAction | null
  onDecide: (approved: boolean) => void
  /** 刚做完的那一下还能退回去 */
  undoOffer: AgentUndoOffer | null
  onUndo: () => void
  /** 已经有话可读时，往上展开一档 */
  onExpand: () => void
}

export const AgentPanelOverlay: React.FC<AgentPanelOverlayProps> = ({
  phase,
  pathname,
  onSubmit,
  pendingAction,
  onDecide,
  undoOffer,
  onUndo,
  onExpand,
}) => {
  const { t, format } = useI18n()
  const { status } = useAgentStatus()
  const pageContent = usePageContentOptional()
  const messages = useAgentMessages()
  const { isAuthenticated } = useAuth()

  /**
   * 收藏的常用问法。
   *
   * 摆在上下文动作后面，是因为两者是同一类东西 —— 都是「不用打字就能做的事」。
   * 上下文那几个来自这一页，收藏这几个来自你自己。合成一排比分成两处清楚。
   */
  const [favorites, setFavorites] = useState<
    Array<{ id: number; input: string; title?: string }>
  >([])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    void (async () => {
      try {
        const response = await agentService.getPresets()
        if (!cancelled) {
          // 一排就够了，再多会把这一档撑成列表
          setFavorites(response.favorites.slice(0, 4))
        }
      } catch {
        // 拿不到收藏不影响问话，静默即可
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const selectionSnapshot = useSyncExternalStore(
    subscribeAgentSelection,
    getAgentSelectionSnapshot,
    getServerAgentSelectionSnapshot,
  )
  const contextConsent = useSyncExternalStore(
    subscribeAgentContextConsent,
    getAgentContextConsent,
    getServerAgentContextConsent,
  )

  // 面板打开那一刻定死时效：开着的时候不该因为过了 60 秒就把那段字抽走
  const [openedAtMs] = useState(() => Date.now())
  const selection = selectionIsFresh(selectionSnapshot, openedAtMs)
    ? selectionSnapshot.text
    : undefined

  const context = resolveAgentContext({
    pathname,
    pageTitle: pageContent?.pageContent?.title,
    hasPageContent: !!pageContent?.hasContent,
    selection,
    contextConsent,
  })

  const submit = useCallback(
    (text: string) => {
      if (text.trim()) onSubmit(text)
    },
    [onSubmit],
  )

  const routeName = t.agentPanel.context.routes[context.route]
  const contextLabel =
    context.kind === 'selection'
      ? `${t.agentPanel.context.selected}：${selectionPreview(context.selection ?? '')}`
      : context.kind === 'content'
        ? `${t.agentPanel.context.watching}：${context.title ?? routeName}`
        : contextConsent
          ? `${t.agentPanel.context.onPage}：${routeName}`
          : t.agentPanel.context.blind

  // 选区是用户自己划的，而且会原样出现在发出去的那句话里 —— 那道闸管的是
  // 「默默读整页」，不该连它一起关掉
  const showsConsentToggle = context.kind !== 'selection'

  // 等人拍板的时候不该还摆着输入框和「总结这页」—— 先把这一件事了了
  if (pendingAction) {
    return (
      <div className="agent-panel-overlay glass" data-phase={phase}>
        <AgentPanelActionCard action={pendingAction} onDecide={onDecide} />
      </div>
    )
  }

  return (
    <div className="agent-panel-overlay glass" data-phase={phase}>
      {undoOffer && (
        <div className="agent-panel-tag-row">
          <span className="agent-panel-tag" data-tone="primary">
            <span className="agent-panel-tag-text">
              {t.agentPanel.undo.did[undoOffer.actionType]}
            </span>
          </span>
          <button
            type="button"
            className="agent-panel-tag agent-panel-tag-strong"
            data-tone="primary"
            onClick={onUndo}
          >
            {t.agentPanel.undo.button}
          </button>
        </div>
      )}

      <div className="agent-panel-tag-row">
        <span
          className="agent-panel-tag"
          data-tone={context.kind === 'selection' ? 'primary' : 'neutral'}
        >
          <AgentStatusGlyph status={status} className="agent-panel-tag-glyph" />
          <span className="agent-panel-tag-text">{contextLabel}</span>
        </span>
        <div className="agent-panel-tag-actions">
          {messages.length > 0 && (
            <button
              type="button"
              className="agent-panel-tag"
              data-icon="true"
              onClick={onExpand}
              title={t.agentPanel.expand}
              aria-label={t.agentPanel.expand}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 15 6-6 6 6" />
              </svg>
            </button>
          )}
          {showsConsentToggle && (
            <button
              type="button"
              className="agent-panel-tag"
              data-icon="true"
              data-tone={contextConsent ? 'neutral' : 'alert'}
              onClick={() => setAgentContextConsent(!contextConsent)}
              title={
                contextConsent
                  ? t.agentPanel.context.muteHint
                  : t.agentPanel.context.allowHint
              }
              aria-label={
                contextConsent
                  ? t.agentPanel.context.muteHint
                  : t.agentPanel.context.allowHint
              }
              aria-pressed={contextConsent}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="2.8" />
                {!contextConsent && <path d="M4 20 20 4" />}
              </svg>
            </button>
          )}
        </div>
      </div>

      {context.kind === 'selection' && (
        <div className="agent-panel-overlay-actions">
          <button
            type="button"
            className="agent-panel-chip"
            onClick={() =>
              submit(
                format(t.agentPanel.prompts.explainSelection, {
                  text: context.selection ?? '',
                }),
              )
            }
          >
            {t.agentPanel.actions.explain}
          </button>
          <button
            type="button"
            className="agent-panel-chip"
            onClick={() =>
              submit(
                format(t.agentPanel.prompts.translateSelection, {
                  text: context.selection ?? '',
                }),
              )
            }
          >
            {t.agentPanel.actions.translate}
          </button>
        </div>
      )}

      {context.kind === 'content' && (
        <div className="agent-panel-overlay-actions">
          <button
            type="button"
            className="agent-panel-chip"
            onClick={() => submit(t.agentPanel.prompts.summarize)}
          >
            {t.agentPanel.actions.summarize}
          </button>
          <button
            type="button"
            className="agent-panel-chip"
            onClick={() => submit(t.agentPanel.prompts.translate)}
          >
            {t.agentPanel.actions.translate}
          </button>
        </div>
      )}

      {favorites.length > 0 && (
        <div className="agent-panel-overlay-actions">
          {favorites.map((preset) => (
            <span key={preset.id} className="agent-panel-saved">
              <button
                type="button"
                className="agent-panel-chip agent-panel-chip-saved"
                title={preset.input}
                onClick={() => submit(preset.input)}
              >
                {preset.title?.trim() || preset.input}
              </button>
              <button
                type="button"
                className="agent-panel-saved-remove"
                title={t.agentPanel.unsave}
                aria-label={t.agentPanel.unsave}
                onClick={() => {
                  // 先从这一排拿掉，别让人点完还看着它
                  setFavorites((current) =>
                    current.filter((item) => item.id !== preset.id),
                  )
                  void agentService.toggleFavorite(preset.id).catch(() => {
                    // 失败就等下次打开重新取，不在这一档报错
                  })
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default AgentPanelOverlay
