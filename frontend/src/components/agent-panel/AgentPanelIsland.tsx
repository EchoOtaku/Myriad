/**
 * Agent 岛 —— 助手在页面上最低限度的存在形态。
 *
 * 三档展开里的第一档，也是全站唯一常驻的那一档：平时只表达「它在不在、在做
 * 什么」，不抢当前工作。
 *
 * 位置按导航布局分叉：
 * - 桌面：导航岛在左侧轨，底部中间是空的，这里常驻一枚胶囊
 * - 移动：底部中间就是导航岛，所以只在助手活跃时出现，并顶替导航岛
 *
 * 它不是按钮。唤起走全站长按 —— 做成 `<button>` 反而会被长按的排除名单挡掉。
 */

import React, { useSyncExternalStore } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { useImmersiveChrome } from '../../contexts/NavigationContext'
import {
  getNavLayoutSnapshot,
  getServerNavLayoutSnapshot,
  subscribeNavLayout,
} from '../../utils/navLayout'
import { agentStatusIsActive } from './agentStatus'
import { AgentStatusGlyph } from './AgentStatusGlyph'
import { useAgentStatus } from './agentStatusStore'
import './agent-panel.css'

export const AgentPanelIsland: React.FC = () => {
  const { t } = useI18n()
  const { status, detail, progress } = useAgentStatus()
  const navLayout = useSyncExternalStore(
    subscribeNavLayout,
    getNavLayoutSnapshot,
    getServerNavLayoutSnapshot,
  )

  const active = agentStatusIsActive(status)
  const replacesNav = navLayout === 'mobile' && active

  // 移动端顶替导航岛：登记一条隐藏理由，收起时自动撤销
  useImmersiveChrome('agent-panel-island', replacesNav)

  // 移动端空闲不占位 —— 那个位置是导航岛的
  if (navLayout === 'mobile' && !active) return null

  return (
    <div
      className="agent-panel-island glass"
      data-status={status}
      data-has-detail={detail ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <AgentStatusGlyph status={status} className="agent-panel-island-glyph" />
      <span className="sr-only">{t.agentPanel.status[status]}</span>
      {detail && <span className="agent-panel-island-detail">{detail}</span>}
      {typeof progress === 'number' && (
        <span
          className="agent-panel-island-progress"
          style={{
            transform: `scaleX(${Math.min(1, Math.max(0, progress / 100))})`,
          }}
        />
      )}
    </div>
  )
}

export default AgentPanelIsland
