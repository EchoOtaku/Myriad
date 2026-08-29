/**
 * 输入那一行 —— 输入框，外加右侧一枚动作。
 *
 * 语音、发送、终止占同一个位置：空着是语音，框里有字变成发送，正在跑则是终止。
 * 语音服务没配置时，空着那一枚不画 —— 没有麦克风可点，不要占一个空位。
 *
 * 左边那枚既是状态灯也是添加附件：待命是加号，亮状态时收成一颗状态色在里面游的圆。
 * 上下文、附件和操作贴同一行、同一高度。选中或当前页后面紧跟着能做的事。
 * 框里只写字，写满就换行，高度跟着走。
 *
 * 这一行长在卡片外面，输入框和动作各自一块玻璃：套在 `.glass` 里的子层采不到
 * 卡片背后的画面，再滤一次只会糊成乳白带（theme.css 记过这一跤）。
 *
 * Quick Overlay 和 Full 共用这一行 —— 同一个动作在两档里不该是两套手感。
 */

import type { AgentAttachment, AttachError } from './agentAttachments'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { isImeComposing } from '../../utils/ime'
import { AGENT_ATTACH_ACCEPT, collectAttachments } from './agentAttachments'
import { dispatchAgentPanelCommand } from './agentPanelEvents'
import { setAgentStatusRecording, useAgentStatus } from './agentStatusStore'
import { attachOrbDriftSpeed, startAttachOrbDrift } from './attachOrbDrift'
import { composerActionKind } from './composerAction'
import { useAgentPanelContext } from './useAgentPanelContext'
import { AgentPresence, AgentPresenceList, AgentSwap } from './useAgentPresence'
import { useVoiceRecording } from './useVoiceRecording'

const FIELD_MAX_PX = 168

function fitComposerField(el: HTMLTextAreaElement | null): void {
  if (!el) return
  if (!el.value) {
    el.style.height = '28px'
    return
  }
  el.style.height = '0px'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 28), FIELD_MAX_PX)}px`
}

export interface AgentPanelComposerProps {
  onSubmit: (text: string, attachments?: AgentAttachment[]) => void
  /** 展开动画期间就聚焦，用户一开口就能打字 */
  autoFocus?: boolean
  /** 跟在上下文后面的操作：撤销 */
  leading?: React.ReactNode
  /** 同一行靠右：展开、新话题、历史 */
  trailing?: React.ReactNode
}

export const AgentPanelComposer: React.FC<AgentPanelComposerProps> = ({
  onSubmit,
  autoFocus = true,
  leading,
  trailing,
}) => {
  const { t, locale, format } = useI18n()
  const { pathname } = useLocation()
  const { isAuthenticated } = useAuth()
  const { status } = useAgentStatus()
  const {
    context,
    kicker,
    text: contextText,
    label,
    contextConsent,
    canMute,
    setContextConsent,
  } = useAgentPanelContext(pathname)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const orbRef = useRef<HTMLSpanElement>(null)
  const orbSpeedRef = useRef(attachOrbDriftSpeed(status))
  orbSpeedRef.current = attachOrbDriftSpeed(status)
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [attachError, setAttachError] = useState<AttachError | null>(null)
  const [dropping, setDropping] = useState(false)
  const [favorites, setFavorites] = useState<
    Array<{ id: number; input: string; title?: string }>
  >([])

  // 正在跑的时候，发送键换成停止键 —— 收起面板只是不看，停下才是真的停
  const busy = status === 'thinking' || status === 'working'
  const orbActive = status !== 'idle'

  const submit = useCallback(
    (text: string) => {
      const files = attachmentsRef.current
      if (!text.trim() && files.length === 0) return
      setValue('')
      setAttachments([])
      attachmentsRef.current = []
      setAttachError(null)
      onSubmit(text, files.length ? files : undefined)
    },
    [onSubmit],
  )

  // 说完就发。识别出来的那句话不落回输入框再等一次回车 —— 开口本身就是「我要说」。
  const { speechAvailable, isRecording, isProcessingVoice, toggleRecording } =
    useVoiceRecording((text: string) => {
      if (text.trim() || attachmentsRef.current.length) submit(text)
    }, locale)

  // 麦克风是本地状态，不走 SSE —— 单独告诉输入框里那颗点，它才好显示「在听」
  useEffect(() => {
    setAgentStatusRecording(isRecording)
    return () => setAgentStatusRecording(false)
  }, [isRecording])

  useEffect(() => {
    if (!orbActive) return
    const node = orbRef.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    return startAttachOrbDrift(node, () => orbSpeedRef.current)
  }, [orbActive])

  useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => fieldRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [autoFocus])

  useLayoutEffect(() => {
    fitComposerField(fieldRef.current)
  }, [value])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    void (async () => {
      try {
        const response = await agentService.getPresets()
        if (!cancelled) setFavorites(response.favorites.slice(0, 4))
      } catch {
        // 拿不到收藏不影响问话
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!attachError) return
    const timer = setTimeout(setAttachError, 2800, null)
    return () => clearTimeout(timer)
  }, [attachError])

  const addFiles = useCallback(async (list: Iterable<File>) => {
    const { attachments: next, error } = await collectAttachments(
      list,
      attachmentsRef.current,
    )
    attachmentsRef.current = next
    setAttachments(next)
    setAttachError(error)
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const next = prev.filter((item) => item.id !== id)
      attachmentsRef.current = next
      return next
    })
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 组字途中按回车是在选候选词；Shift+Enter 是换行
      if (event.key !== 'Enter' || event.shiftKey || isImeComposing(event)) {
        return
      }
      event.preventDefault()
      submit(value)
    },
    [submit, value],
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files)
      if (!files.length) return
      event.preventDefault()
      void addFiles(files)
    },
    [addFiles],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDropping(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length) void addFiles(files)
    },
    [addFiles],
  )

  const hasText = value.trim().length > 0
  const hasAttachments = attachments.length > 0
  const kind = composerActionKind({
    hasText,
    hasAttachments,
    busy,
    speechAvailable,
    voiceLocked: isRecording || isProcessingVoice,
  })

  const voiceLabel = isProcessingVoice
    ? t.agentPanel.voice.working
    : isRecording
      ? t.agentPanel.voice.stop
      : t.agentPanel.voice.start
  const actionLabel =
    kind === 'stop'
      ? t.agentPanel.stop
      : kind === 'send'
        ? t.agentPanel.send
        : voiceLabel
  const attachLabel = `${t.agentPanel.attach.add} · ${t.agentPanel.status[status]}`
  const attachErrorLabel = attachError ? t.agentPanel.attach[attachError] : null

  return (
    <div className="agent-panel-composer">
      <div className="agent-panel-composer-tags">
        {leading}
        <AgentSwap
          id={`${canMute ? 'mute' : 'label'}:${context.kind}`}
          from="self"
        >
          {canMute ? (
            <button
              type="button"
              className="agent-panel-tag"
              data-tone={contextConsent ? 'neutral' : 'alert'}
              title={
                contextConsent
                  ? t.agentPanel.context.muteHint
                  : t.agentPanel.context.allowHint
              }
              aria-label={label}
              aria-pressed={contextConsent}
              onClick={() => setContextConsent(!contextConsent)}
            >
              <span className="agent-panel-tag-kicker">{kicker}</span>
              <span className="agent-panel-tag-text">{contextText}</span>
            </button>
          ) : (
            <span
              className="agent-panel-tag"
              data-tone={context.kind === 'selection' ? 'primary' : 'neutral'}
            >
              <span className="agent-panel-tag-kicker">{kicker}</span>
              <span className="agent-panel-tag-text">{contextText}</span>
            </span>
          )}
        </AgentSwap>
        <AgentPresence
          open={context.kind === 'selection'}
          kind="chip"
          from="context"
        >
          <button
            type="button"
            className="agent-panel-tag"
            onClick={() =>
              onSubmit(
                format(t.agentPanel.prompts.explainSelection, {
                  text: context.selection ?? '',
                }),
              )
            }
          >
            {t.agentPanel.actions.explain}
          </button>
        </AgentPresence>
        <AgentPresence
          open={context.kind === 'selection'}
          kind="chip"
          from="context"
        >
          <button
            type="button"
            className="agent-panel-tag"
            onClick={() =>
              onSubmit(
                format(t.agentPanel.prompts.translateSelection, {
                  text: context.selection ?? '',
                }),
              )
            }
          >
            {t.agentPanel.actions.translate}
          </button>
        </AgentPresence>
        <AgentPresence
          open={context.kind === 'content'}
          kind="chip"
          from="context"
        >
          <button
            type="button"
            className="agent-panel-tag"
            onClick={() => onSubmit(t.agentPanel.prompts.summarize)}
          >
            {t.agentPanel.actions.summarize}
          </button>
        </AgentPresence>
        <AgentPresence
          open={context.kind === 'content'}
          kind="chip"
          from="context"
        >
          <button
            type="button"
            className="agent-panel-tag"
            onClick={() => onSubmit(t.agentPanel.prompts.translate)}
          >
            {t.agentPanel.actions.translate}
          </button>
        </AgentPresence>
        <AgentPresenceList
          items={favorites}
          keyOf={(preset) => String(preset.id)}
          kind="chip"
          from="self"
        >
          {(preset) => (
            <span className="agent-panel-saved">
              <button
                type="button"
                className="agent-panel-tag agent-panel-tag-saved"
                title={preset.input}
                onClick={() => onSubmit(preset.input)}
              >
                {preset.title?.trim() || preset.input}
              </button>
              <button
                type="button"
                className="agent-panel-saved-remove"
                title={t.agentPanel.unsave}
                aria-label={t.agentPanel.unsave}
                onClick={() => {
                  setFavorites((current) =>
                    current.filter((item) => item.id !== preset.id),
                  )
                  void agentService.toggleFavorite(preset.id).catch(() => {})
                }}
              >
                ×
              </button>
            </span>
          )}
        </AgentPresenceList>
        <AgentPresenceList
          items={attachments}
          keyOf={(item) => item.id}
          kind="chip"
          from="attach"
        >
          {(item) => (
            <span className="agent-panel-tag">
              {item.previewUrl ? <img src={item.previewUrl} alt="" /> : null}
              <span className="agent-panel-tag-kicker">
                {t.agentPanel.attach.kind}
              </span>
              <span className="agent-panel-tag-text">{item.name}</span>
              <button
                type="button"
                className="agent-panel-tag-dismiss"
                title={t.agentPanel.attach.remove}
                aria-label={t.agentPanel.attach.remove}
                onClick={() => removeAttachment(item.id)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6l-12 12" />
                </svg>
              </button>
            </span>
          )}
        </AgentPresenceList>
        <AgentPresence open={!!attachErrorLabel} kind="chip" from="attach">
          <span className="agent-panel-tag" data-tone="alert" role="status">
            <span className="agent-panel-tag-text">{attachErrorLabel}</span>
          </span>
        </AgentPresence>
        {trailing ? (
          <div className="agent-panel-tag-actions">{trailing}</div>
        ) : null}
      </div>

      <div className="agent-panel-composer-row">
        <div
          className="agent-panel-field-shell glass"
          data-drop={dropping ? 'true' : undefined}
          onDragEnter={(event) => {
            event.preventDefault()
            setDropping(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return
            }
            setDropping(false)
          }}
          onDrop={handleDrop}
        >
          <button
            type="button"
            className="agent-panel-attach"
            data-status={status}
            title={attachErrorLabel ?? attachLabel}
            aria-label={attachLabel}
            onClick={() => fileRef.current?.click()}
          >
            <span className="agent-panel-attach-plus" aria-hidden="true">
              <span className="agent-panel-attach-bar" data-axis="x" />
              <span className="agent-panel-attach-bar" data-axis="y" />
            </span>
            <span
              ref={orbRef}
              className="agent-panel-attach-orb"
              aria-hidden="true"
            >
              <span data-orb-blob="0" />
              <span data-orb-blob="1" />
              <span data-orb-blob="2" />
            </span>
          </button>
          <textarea
            ref={fieldRef}
            className="agent-panel-field"
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t.agentPanel.inputPlaceholder}
            aria-label={t.agentPanel.inputPlaceholder}
          />
          <input
            ref={fileRef}
            className="agent-panel-attach-input"
            type="file"
            multiple
            accept={AGENT_ATTACH_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = event.target.files
              if (files?.length) void addFiles(files)
              event.target.value = ''
            }}
          />
        </div>

        <AgentPresence open={!!kind} kind="chip" from="self">
          {kind ? (
            <button
              type="button"
              className={[
                'agent-panel-control',
                'glass',
                kind === 'stop'
                  ? 'agent-panel-stop'
                  : kind === 'voice'
                    ? 'agent-panel-mic'
                    : 'agent-panel-send',
              ]
                .filter(Boolean)
                .join(' ')}
              data-on={kind === 'voice' && isRecording ? 'true' : 'false'}
              onClick={() => {
                if (kind === 'stop') dispatchAgentPanelCommand('interrupt')
                else if (kind === 'send') submit(value)
                else toggleRecording()
              }}
              disabled={kind === 'voice' ? isProcessingVoice : false}
              title={actionLabel}
              aria-label={actionLabel}
              aria-pressed={kind === 'voice' ? isRecording : undefined}
            >
              <AgentSwap id={kind} from="self">
                {kind === 'stop' ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="7" y="7" width="10" height="10" rx="2" />
                  </svg>
                ) : kind === 'send' ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 19V5" />
                    <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                  </svg>
                )}
              </AgentSwap>
            </button>
          ) : null}
        </AgentPresence>
      </div>
    </div>
  )
}

