import { LuKeyboard, LuSearch, LuX } from '@lib/icons'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingTitleGuideEntry } from '../../settings/SettingTitleGuideEntry'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import { PhantasiSearchGuide } from './PhantasiSearchGuide'
import { cx } from './cx'

export const phantasiSearchInputRef: { current: HTMLInputElement | null } = {
  current: null,
}

let showGuide: (() => void) | null = null

export function showPhantasiSearchGuide() {
  showGuide?.()
}

export function PhantasiSearch({
  value,
  onChange,
  matchCount = 0,
}: {
  value: string
  onChange?: (value: string) => void
  matchCount?: number
}) {
  const { t, format } = useI18n()
  const phantasi = t.phantasi
  const inputRef = useRef<HTMLInputElement>(null)
  const guideApiRef = useRef<{ open: boolean; toggle: () => void } | null>(
    null,
  )
  const [focused, setFocused] = useState(false)
  const query = value.trim()
  const typing = focused || Boolean(query)

  useEffect(() => {
    showGuide = () => {
      const api = guideApiRef.current
      if (api && !api.open) api.toggle()
    }
    return () => {
      showGuide = null
    }
  }, [])

  useEffect(() => {
    const input = inputRef.current
    phantasiSearchInputRef.current = input
    return () => {
      if (phantasiSearchInputRef.current === input) {
        phantasiSearchInputRef.current = null
      }
    }
  })

  if (!onChange) return null

  const search = (
    <div data-phantasi-surface="search" className={cx('phantasi-skin phantasi-search glass', typing && 'is-input')}>
      <span className="phantasi-search__mark" aria-hidden>
        <LuSearch />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-label={phantasi.searchSources}
        placeholder={phantasi.search}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (value) onChange('')
          else inputRef.current?.blur()
        }}
      />
      {query ? (
        <SettingTitleTag
          variant="muted"
          title={format(phantasi.resultsCount, { count: matchCount })}
        >
          {matchCount}
        </SettingTitleTag>
      ) : null}
      {query ? (
        <button
          type="button"
          className="phantasi-search__icon"
          aria-label={t.common.close}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <LuX aria-hidden />
        </button>
      ) : null}
      <SettingTitleGuideEntry
        title={phantasi.keyboardShortcuts}
        requireShowDetails={false}
        panelClassName="phantasi-search__guide"
        guide={<PhantasiSearchGuide />}
        renderTrigger={(api) => {
          guideApiRef.current = { open: api.open, toggle: api.toggle }
          return (
            <button
              type="button"
              className={cx('phantasi-search__hint', api.open && 'is-on')}
              aria-label={phantasi.keyboardShortcuts}
              aria-expanded={api.open}
              aria-controls={api.panelId}
              aria-hidden={typing || undefined}
              tabIndex={typing ? -1 : undefined}
              onClick={() => api.toggle()}
            >
              <LuKeyboard aria-hidden />
              <span>?</span>
            </button>
          )
        }}
      />
    </div>
  )

  return search
}
