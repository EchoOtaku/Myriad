import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SettingOption } from '../types'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import './FieldSelect.css'

export interface FieldSelectProps<T extends string = string> {
  id?: string
  value: T
  options: SettingOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
  size?: 'md' | 'sm'
  searchable?: boolean
  searchPlaceholder?: string
  emptySearchText?: string
}

const TYPEAHEAD_RESET_MS = 750

function enabledIndices<T extends string>(
  options: SettingOption<T>[],
): number[] {
  return options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0)
}

function optionSearchText(opt: SettingOption<string>): string {
  if (typeof opt.label === 'string') return opt.label
  return String(opt.value)
}

export function FieldSelect<T extends string = string>({
  id,
  value,
  options: optionsProp,
  onChange,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
  size = 'md',
  searchable = false,
  searchPlaceholder = 'Search…',
  emptySearchText = 'No matches',
}: FieldSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const [menuBox, setMenuBox] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const typeaheadRef = useRef({ buf: '', timer: 0 as ReturnType<
    typeof setTimeout
  > | 0 })
  const autoId = useId()
  const listboxId = `${(id || autoId).replaceAll(':', '')}-listbox`
  const searchId = `${(id || autoId).replaceAll(':', '')}-search`
  const options = optionsProp ?? []

  const selected =
    options.find((o) => o.value === value) ?? options.find((o) => !o.disabled)

  const filteredOptions = useMemo(() => {
    if (!searchable) return options
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const label = optionSearchText(o).toLowerCase()
      const val = String(o.value).toLowerCase()
      return label.includes(q) || val.includes(q)
    })
  }, [options, query, searchable])

  const focusOptionIndex = useCallback((index: number) => {
    const list = listRef.current
    if (!list) return
    const buttons = list.querySelectorAll<HTMLButtonElement>(
      'button[role="option"]:not(:disabled)',
    )
    const btn = buttons[index]
    btn?.focus()
  }, [])

  const runTypeahead = useCallback(
    (char: string) => {
      if (searchable) return
      const enabled = enabledIndices(filteredOptions)
      if (enabled.length === 0) return
      const state = typeaheadRef.current
      if (state.timer) clearTimeout(state.timer)
      state.buf = `${state.buf}${char}`.toLowerCase()
      state.timer = setTimeout(() => {
        state.buf = ''
        state.timer = 0
      }, TYPEAHEAD_RESET_MS)

      const buf = state.buf
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]:not(:disabled)',
      )
      let start = 0
      if (buttons?.length) {
        buttons.forEach((b, i) => {
          if (b === document.activeElement) start = i
        })
      }
      const order = [
        ...enabled.slice(start + 1),
        ...enabled.slice(0, start + 1),
      ]
      const searchQ =
        buf.length > 1 && buf.split('').every((c) => c === buf[0])
          ? buf[0]
          : buf
      const hit = order.find((optIdx) =>
        optionSearchText(filteredOptions[optIdx]).toLowerCase().startsWith(
          searchQ,
        ),
      )
      if (hit == null) return
      const focusAt = enabled.indexOf(hit)
      if (focusAt >= 0) focusOptionIndex(focusAt)
    },
    [filteredOptions, focusOptionIndex, searchable],
  )

  const placeMenu = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const panel = panelRef.current
    const menuH = Math.min(
      panel?.offsetHeight || panel?.scrollHeight || 12 * 16,
      window.innerHeight * 0.5,
      18 * 16,
    )
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const up = spaceBelow < menuH && spaceAbove > spaceBelow
    const minW = size === 'sm' ? Math.max(rect.width, 9 * 16) : rect.width
    const width = Math.min(minW, Math.min(16 * 16, window.innerWidth - 16))
    let left = size === 'sm' ? rect.right - width : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    const top = up
      ? Math.max(8, rect.top - 8 - menuH)
      : Math.min(rect.bottom + 5, window.innerHeight - 8)
    setMenuUp(up)
    setMenuBox({ top, left, width })
  }, [size])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node
      if (rootRef.current?.contains(node)) return
      if (panelRef.current?.contains(node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }
    placeMenu()
  }, [open, placeMenu, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    placeMenu()
    const onResize = () => placeMenu()
    const onScroll = (event: Event) => {
      const root = rootRef.current
      const node = event.target
      if (
        node instanceof Node &&
        (root?.contains(node) || panelRef.current?.contains(node))
      ) {
        return
      }
      placeMenu()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    requestAnimationFrame(() => {
      if (searchable) {
        searchRef.current?.focus()
        return
      }
      const idx = filteredOptions.findIndex(
        (o) => o.value === value && !o.disabled,
      )
      const enabled = enabledIndices(filteredOptions)
      const focusAt = idx >= 0 ? enabled.indexOf(idx) : 0
      if (enabled.length > 0) focusOptionIndex(Math.max(0, focusAt))
    })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [
    open,
    filteredOptions,
    value,
    placeMenu,
    focusOptionIndex,
    searchable,
  ])

  useEffect(() => {
    if (!open || !searchable) return
    placeMenu()
  }, [query, open, searchable, placeMenu])

  const commit = useCallback(
    (next: T, optionDisabled?: boolean) => {
      if (optionDisabled) return
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
      if (next !== value) onChange(next)
    },
    [onChange, value],
  )

  const onListKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const enabled = enabledIndices(filteredOptions)
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]:not(:disabled)',
      )

      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }

      if (!buttons?.length) {
        if (e.key === 'ArrowUp' && searchable) {
          e.preventDefault()
          searchRef.current?.focus()
        }
        return
      }

      let current = -1
      buttons.forEach((b, i) => {
        if (b === document.activeElement) current = i
      })
      if (current < 0) current = 0

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusOptionIndex((current + 1) % buttons.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (searchable && current === 0) {
          searchRef.current?.focus()
          return
        }
        focusOptionIndex((current - 1 + buttons.length) % buttons.length)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        focusOptionIndex(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        focusOptionIndex(buttons.length - 1)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const opt = filteredOptions[enabled[current]]
        if (opt) commit(opt.value, opt.disabled)
        return
      }
      if (
        !searchable &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault()
        runTypeahead(e.key)
      }
    },
    [filteredOptions, focusOptionIndex, commit, runTypeahead, searchable],
  )

  const onSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusOptionIndex(0)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const enabled = enabledIndices(filteredOptions)
        if (enabled.length === 1) {
          const opt = filteredOptions[enabled[0]]
          if (opt) commit(opt.value, opt.disabled)
        } else if (enabled.length > 0) {
          const q = query.trim().toLowerCase()
          const exact = filteredOptions.find(
            (o, i) =>
              !o.disabled &&
              enabled.includes(i) &&
              (optionSearchText(o).toLowerCase() === q ||
                String(o.value).toLowerCase() === q),
          )
          const pick = exact ?? filteredOptions[enabled[0]]
          if (pick) commit(pick.value, pick.disabled)
        }
      }
    },
    [filteredOptions, focusOptionIndex, commit, query],
  )

  const onTriggerKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (disabled) return
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (
        !searchable &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => runTypeahead(e.key))
      }
    },
    [disabled, runTypeahead, searchable],
  )

  useEffect(() => {
    return () => {
      const t = typeaheadRef.current.timer
      if (t) clearTimeout(t)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={`field-select-wrap field-select-size-${size}${open ? ' is-open' : ''}${menuUp ? ' is-up' : ''}${searchable ? ' is-searchable' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="field-select field-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel || selected?.label || undefined}
        onClick={() => {
          if (!disabled) setOpen((v) => !v)
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="field-select-value">
          {selected?.label ?? String(value)}
        </span>
        <span className="field-select-chevron" aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className={`field-select-panel is-portal field-select-size-${size}${menuUp ? ' is-up' : ''}`}
              style={
                menuBox
                  ? {
                      top: menuBox.top,
                      left: menuBox.left,
                      width: menuBox.width,
                    }
                  : { top: 0, left: 0, visibility: 'hidden' }
              }
            >
              {searchable ? (
                <div className="field-select-search">
                  <input
                    ref={searchRef}
                    id={searchId}
                    type="search"
                    className="field-select-search-input"
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : null}
              <ul
                ref={listRef}
                id={listboxId}
                className="field-select-menu"
                role="listbox"
                aria-label={ariaLabel || selected?.label}
                onKeyDown={onListKeyDown}
              >
                {filteredOptions.length === 0 ? (
                  <li className="field-select-empty" role="presentation">
                    {emptySearchText}
                  </li>
                ) : (
                  filteredOptions.map((option) => {
                    const isSelected = option.value === value
                    return (
                      <li key={String(option.value)} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={option.disabled}
                          tabIndex={-1}
                          className={`field-select-option${isSelected ? ' is-selected' : ''}`}
                          onClick={() => commit(option.value, option.disabled)}
                        >
                          {option.label}
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
