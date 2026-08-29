/**
 * 面板里只剩「跟当前这个人相处」的开关。定时、技能、记忆已经迁到「设置 · AI」。
 */

import React, { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { AgentPresence } from './useAgentPresence'

export const AgentPanelManage: React.FC = () => {
  const { t } = useI18n()
  const { isAuthenticated } = useAuth()
  const [note, setNote] = useState<string | null>(null)
  /**
   * 勿扰是「跟当前这个人相处」的状态，不是站长的全站设置 —— 所以它在这里，
   * 而不是跟名字性格一起去 /config。
   */
  const [doNotDisturb, setDoNotDisturb] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    void (async () => {
      try {
        const persona = await agentService.getPersona()
        if (!cancelled) setDoNotDisturb(persona?.doNotDisturb === true)
      } catch {
        // 读不到就不摆这个开关，别给一个点了没反应的东西
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  return (
    <div className="agent-panel-manage">
      <AgentPresence open={!!note} kind="row" from="self">
        <span className="agent-panel-tag" data-block="true" data-tone="alert">
          {note}
        </span>
      </AgentPresence>

      {doNotDisturb !== null && (
        <div className="agent-panel-manage-row">
          <span className="agent-panel-manage-name">
            {t.agentPanel.manage.doNotDisturb}
          </span>
          <button
            type="button"
            className="agent-panel-manage-toggle"
            data-on={doNotDisturb ? 'true' : 'false'}
            aria-pressed={doNotDisturb}
            aria-label={t.agentPanel.manage.doNotDisturb}
            onClick={() => {
              const next = !doNotDisturb
              setDoNotDisturb(next)
              void agentService
                .putAddressee({ doNotDisturb: next })
                .catch(() => {
                  setDoNotDisturb(!next)
                  setNote(t.agentPanel.manage.actionFailed)
                })
            }}
          >
            <span className="agent-panel-manage-knob" />
          </button>
        </div>
      )}

      <span
        className="agent-panel-tag agent-panel-manage-hint"
        data-block="true"
      >
        {t.agentPanel.manage.personaElsewhere}
      </span>
    </div>
  )
}

