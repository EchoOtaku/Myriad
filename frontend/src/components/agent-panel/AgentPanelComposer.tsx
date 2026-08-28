/**
 * 输入那一行 —— 输入框，外加右侧一枚动作。
 *
 * 语音、发送、终止占同一个位置：空着是语音，框里有字变成发送，正在跑则是终止。
 * 语音服务没配置时，空着那一枚不画 —— 没有麦克风可点，不要占一个空位。
 *
 * 这一行长在卡片外面，输入框和动作各自一块玻璃：套在 `.glass` 里的子层采不到
 * 卡片背后的画面，再滤一次只会糊成乳白带（theme.css 记过这一跤）。
 *
 * Quick Overlay 和 Full 共用这一行 —— 同一个动作在两档里不该是两套手感。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { isImeComposing } from '../../utils/ime'
import { dispatchAgentPanelCommand } from './agentPanelEvents'
import { setAgentStatusRecording, useAgentStatus } from './agentStatusStore'
import { composerActionKind } from './composerAction'
import { useVoiceRecording } from './useVoiceRecording'

export interface AgentPanelComposerProps {
  onSubmit: (text: string) => void
  /** 展开动画期间就聚焦，用户一开口就能打字 */
  autoFocus?: boolean
}

export const AgentPanelComposer: React.FC<AgentPanelComposerProps> = ({
  onSubmit,
  autoFocus = true,
}) => {
  const { t, locale } = useI18n()
  const { status } = useAgentStatus()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  // 正在跑的时候，发送键换成停止键 —— 收起面板只是不看，停下才是真的停
  const busy = status === 'thinking' || status === 'working'

  // 说完就发。识别出来的那句话不落回输入框再等一次回车 —— 开口本身就是「我要说」。
  const { speechAvailable, isRecording, isProcessingVoice, toggleRecording } =
    useVoiceRecording((text: string) => {
      if (text.trim()) onSubmit(text)
    }, locale)

  // 麦克风是本地状态，不走 SSE —— 单独告诉状态岛，它才好显示「在听」
  useEffect(() => {
    setAgentStatusRecording(isRecording)
    return () => setAgentStatusRecording(false)
  }, [isRecording])

  useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [autoFocus])

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return
      setValue('')
      onSubmit(text)
    },
    [onSubmit],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // 组字途中按回车是在选候选词，不是要发出去
      if (event.key !== 'Enter' || event.shiftKey || isImeComposing(event)) {
        return
      }
      event.preventDefault()
      submit(value)
    },
    [submit, value],
  )

  const hasText = value.trim().length > 0
  const kind = composerActionKind({
    hasText,
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

  return (
    <div className="agent-panel-composer">
      <div className="agent-panel-field-shell glass">
        <input
          ref={inputRef}
          className="agent-panel-field"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.agentPanel.inputPlaceholder}
          aria-label={t.agentPanel.inputPlaceholder}
        />
      </div>

      {kind && (
        <button
          type="button"
          className={[
            'agent-panel-control',
            'glass',
            kind === 'voice' ? 'agent-panel-mic' : 'agent-panel-send',
            kind === 'stop' ? 'agent-panel-stop' : '',
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
          {kind === 'stop' ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
        </button>
      )}
    </div>
  )
}

export default AgentPanelComposer
