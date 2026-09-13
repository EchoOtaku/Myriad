import type { ReactNode } from 'react'
import type { ShortcutDescKey } from '../../../hooks/useBrewKeyboard'
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
import { BREW_SHORTCUTS } from '../../../hooks/useBrewKeyboard'
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

export function BrewSearchGuide() {
  const { t } = useI18n()
  const brew = t.brew
  const labels = {
    navigation: brew.shortcutNavigation,
    article: brew.shortcutArticle,
    source: brew.shortcutSource,
    other: brew.shortcutOther,
  }

  return (
    <div className="brew-search-guide">
      {GROUPS.map((group) => {
        const items = BREW_SHORTCUTS.filter((item) => item.category === group)
        if (items.length === 0) return null
        return (
          <section key={group} className="setting-guide-block">
            <h4 className="setting-guide-block-label">{labels[group]}</h4>
            <ul className="brew-search-guide__list">
              {items.map((item) => (
                <li key={item.key} className="brew-search-guide__row">
                  <span className="brew-search-guide__icon" aria-hidden>
                    {SHORTCUT_ICON[item.descriptionKey]}
                  </span>
                  <span className="brew-search-guide__label">
                    {brew[item.descriptionKey]}
                  </span>
                  <span className="brew-search-guide__caps">
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
