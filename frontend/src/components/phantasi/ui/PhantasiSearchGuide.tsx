import type { ReactNode } from 'react'
import type { ShortcutDescKey } from '../../../hooks/usePhantasiKeyboard'
import {
  LuBookOpen,
  LuCheckCircle,
  LuCheckSquare,
  LuChevronDown,
  LuChevronUp,
  LuKeyboard,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuStar,
  LuX,
} from '@lib/icons'
import { useI18n } from '../../../contexts/I18nContext'
import { PHANTASI_SHORTCUTS } from '../../../hooks/usePhantasiKeyboard'
import { SettingTitleTag } from '../../settings/SettingTitleTag'

const SHORTCUT_ICON: Record<ShortcutDescKey, ReactNode> = {
  shortcutDescNextArticle: <LuChevronDown />,
  shortcutDescPrevArticle: <LuChevronUp />,
  shortcutDescOpenReader: <LuBookOpen />,
  shortcutDescCloseReader: <LuX />,
  shortcutDescFocusSearch: <LuSearch />,
  shortcutDescToggleRead: <LuCheckCircle />,
  shortcutDescToggleStar: <LuStar />,
  shortcutDescMarkAllRead: <LuCheckSquare />,
  shortcutDescRefreshSource: <LuRefreshCw />,
  shortcutDescAddSource: <LuPlus />,
  shortcutDescShowHelp: <LuKeyboard />,
}

const GROUPS = [
  'navigation',
  'article',
  'source',
  'other',
] as const

function keyCaps(key: string): string[] {
  if (key.includes(' / ')) return key.split(' / ')
  if (key.includes(' + ')) return key.split(' + ')
  return [key === 'Escape' ? 'Esc' : key]
}

export function PhantasiSearchGuide() {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const labels = {
    navigation: phantasi.shortcutNavigation,
    article: phantasi.shortcutArticle,
    source: phantasi.shortcutSource,
    other: phantasi.shortcutOther,
  }

  return (
    <div className="phantasi-search-guide">
      {GROUPS.map((group) => {
        const items = PHANTASI_SHORTCUTS.filter((item) => item.category === group)
        if (items.length === 0) return null
        return (
          <section key={group} className="setting-guide-block">
            <h4 className="setting-guide-block-label">{labels[group]}</h4>
            <ul className="phantasi-search-guide__list">
              {items.map((item) => (
                <li key={item.key} className="phantasi-search-guide__row">
                  <span className="phantasi-search-guide__icon" aria-hidden>
                    {SHORTCUT_ICON[item.descriptionKey]}
                  </span>
                  <span className="phantasi-search-guide__label">
                    {phantasi[item.descriptionKey]}
                  </span>
                  <span className="phantasi-search-guide__caps">
                    {keyCaps(item.key).map((cap) => (
                      <SettingTitleTag key={cap} variant="muted">
                        {cap}
                      </SettingTitleTag>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
