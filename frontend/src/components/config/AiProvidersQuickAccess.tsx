/**
 * AI 配置页标题栏「快捷访问」
 * - 入口：与「显示说明」同款 CheckboxCard（标题 + 简介 + 图标）
 * - 内容：SettingTitleGuideEntry 浮窗 + SettingGuideBody（逐服务商）
 * 仅由 AiConfigSection 通过 headerBetweenPinned 挂载。
 */

import { LuBookOpen } from '@lib/icons'
import React, { useMemo } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import {
  CheckboxCard,
  SettingTitleGuideEntry,
  useSettingGuide,
} from '../settings'
import { AI_PROVIDER_GUIDE_ORDER } from '../settings/guides/catalog.aiProviders.order'
import { guideDomProps } from '../settings/guides/guideAnchor'
import './AiProvidersQuickAccess.css'

export const AiProvidersQuickAccess: React.FC = () => {
  const { t } = useI18n()
  const { catalog: g, renderGuide } = useSettingGuide()

  const title = t.config.aiProvidersQuickAccess
  const description = t.config.aiProvidersQuickAccessDesc

  const guide = useMemo(() => {
    const providers = g.ai.providers
    return (
      <div className="ai-providers-quick-access-guide">
        <div
          className="ai-providers-quick-access-overview has-guide-anchor"
          {...guideDomProps('ai.providersQuickAccess')}
        >
          {renderGuide(g.ai.providersQuickAccess)}
        </div>
        <div className="ai-providers-quick-access-list" role="list">
          {AI_PROVIDER_GUIDE_ORDER.map((id) => {
            const entry = providers[id]
            if (!entry?.what) return null
            return (
              <div
                key={id}
                role="listitem"
                className="ai-providers-quick-access-item has-guide-anchor"
                {...guideDomProps(`ai.providers.${id}`)}
              >
                {renderGuide(entry)}
              </div>
            )
          })}
        </div>
      </div>
    )
  }, [g.ai.providers, g.ai.providersQuickAccess, renderGuide])

  return (
    <SettingTitleGuideEntry
      title={title}
      guide={guide}
      requireShowDetails={false}
      className="ai-providers-quick-access-entry"
      panelClassName="ai-providers-quick-access-float"
      renderTrigger={({ open, closing, toggle, ariaLabel }) => (
        <CheckboxCard
          variant="switch"
          label={title}
          description={description}
          icon={<LuBookOpen />}
          showIndicator={false}
          checked={open || closing}
          onChange={() => toggle()}
          title={description}
          aria-label={ariaLabel}
          aria-expanded={open}
          className="ai-providers-quick-access-toggle settings-help-toggle"
        />
      )}
    />
  )
}

AiProvidersQuickAccess.displayName = 'AiProvidersQuickAccess'

export default AiProvidersQuickAccess
