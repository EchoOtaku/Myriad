/**
 * 设置页自定义下拉（替代原生 select option 列表）。
 * 原生 option 弹层由系统绘制，深色模式几乎不可样式化。
 *
 * - 视口空间不足时向上翻转（is-up）
 * - listbox：Arrow / Home / End / Enter / Space / Escape
 * - 字母/数字 typeahead（聚合输入，约 750ms 清空）
 */

import type { SettingOption } from '../types'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import './FieldSelect.css'

export interface FieldSelectProps<T extends string = string> {
  id?: string
  value: T
  options: SettingOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  /** 触发按钮 aria-label；缺省用当前选中项文案 */
  'aria-label'?: string
  /** 紧凑模式（列表行内使用） */
  size?: 'md' | 'sm'
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
}: FieldSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const typeaheadRef = useRef({ buf: '', timer: 0 as ReturnType<
    typeof setTimeout
  > | 0 })
  const autoId = useId()
  const listboxId = `${(id || autoId).replace(/:/g, '')}-listbox`
  const options = optionsProp ?? []

  const selected =
    options.find((o) => o.value === value) ?? options.find((o) => !o.disabled)

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
      const enabled = enabledIndices(options)
      if (enabled.length === 0) return
      const state = typeaheadRef.current
      if (state.timer) clearTimeout(state.timer)
      state.buf = `${state.buf}${char}`.toLowerCase()
      state.timer = setTimeout(() => {
        state.buf = ''
        state.timer = 0
      }, TYPEAHEAD_RESET_MS)

      const buf = state.buf
      // Prefer match from current focus onward, then wrap
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
      // Same-letter repeat: jump to next starting with that letter
      const query =
        buf.length > 1 && buf.split('').every((c) => c === buf[0])
          ? buf[0]
          : buf
      const hit = order.find((optIdx) =>
        optionSearchText(options[optIdx]).toLowerCase().startsWith(query),
      )
      if (hit == null) return
      const focusAt = enabled.indexOf(hit)
      if (focusAt >= 0) focusOptionIndex(focusAt)
    },
    [options, focusOptionIndex],
  )

  const placeMenu = useCallback(() => {
    const root = rootRef.current
    const list = listRef.current
    if (!root || !list) return
    const rect = root.getBoundingClientRect()
    const menuH = Math.min(list.scrollHeight, window.innerHeight * 0.5, 16 * 16)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    setMenuUp(spaceBelow < menuH && spaceAbove > spaceBelow)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    placeMenu()
    const onResize = () => placeMenu()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    // Focus selected (or first enabled) option
    requestAnimationFrame(() => {
      const idx = options.findIndex((o) => o.value === value && !o.disabled)
      const enabled = enabledIndices(options)
      const focusAt =
        idx >= 0
          ? enabled.indexOf(idx)
          : 0
      if (enabled.length > 0) focusOptionIndex(Math.max(0, focusAt))
    })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open, options, value, placeMenu, focusOptionIndex])

  const commit = useCallback(
    (next: T, optionDisabled?: boolean) => {
      if (optionDisabled) return
      setOpen(false)
      triggerRef.current?.focus()
      if (next !== value) onChange(next)
    },
    [onChange, value],
  )

  const onListKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const enabled = enabledIndices(options)
      if (enabled.length === 0) return

      const active = document.activeElement as HTMLElement | null
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]:not(:disabled)',
      )
      if (!buttons?.length) return

      let current = -1
      buttons.forEach((b, i) => {
        if (b === active) current = i
      })
      if (current < 0) current = 0

      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusOptionIndex((current + 1) % buttons.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
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
        const opt = options[enabled[current]]
        if (opt) commit(opt.value, opt.disabled)
        return
      }
      // Typeahead: single printable character (no modifiers)
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault()
        runTypeahead(e.key)
      }
    },
    [options, focusOptionIndex, commit, runTypeahead],
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
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault()
        setOpen(true)
        // Defer typeahead until menu mounts
        requestAnimationFrame(() => runTypeahead(e.key))
      }
    },
    [disabled, runTypeahead],
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
      className={`field-select-wrap field-select-size-${size}${open ? ' is-open' : ''}${menuUp ? ' is-up' : ''}${className ? ` ${className}` : ''}`}
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
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          className="field-select-menu"
          role="listbox"
          aria-label={ariaLabel || selected?.label}
          onKeyDown={onListKeyDown}
        >
          {options.map((option) => {
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
          })}
        </ul>
      )}
    </div>
  )
}
