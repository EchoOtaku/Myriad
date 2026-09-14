import { LuPlus as Plus } from '@lib/icons'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { brewCategoryParts } from '../../constants'

export function SourceCategoryField({
  categories,
  value,
  open,
  onOpenChange,
  onChange,
  disabled = false,
  labelFor,
}: {
  categories: readonly string[]
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
  disabled?: boolean
  labelFor?: (name: string) => string
}) {
  const brew = useI18n().t.brew
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const name = draft.trim()
  const canAdd = name.length > 0 && !categories.includes(name)
  const parts = brewCategoryParts(value)
  const shown = parts.length
    ? parts.map((part) => labelFor?.(part) ?? part).join(' · ')
    : brew.selectCategory

  const close = (next = draft) => {
    const picked = next.trim()
    if (picked !== value) onChange(picked)
    onOpenChange(false)
  }

  useEffect(() => {
    if (!open) return
    setDraft(value)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onDoc = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        close(inputRef.current?.value ?? draft)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, value, onOpenChange])

  const pick = (next: string) => {
    onChange(next)
    onOpenChange(false)
  }

  const selected = (cat: string) =>
    value === cat || parts.includes(cat) || (labelFor?.(cat) ?? cat) === value

  return (
    <div className="setting-item setting-item-select setting-vertical setting-sm brew-add-form__category">
      <label className="setting-label">
        <span className="setting-label-text">{brew.category}</span>
      </label>
      <div className="setting-control">
        <div
          ref={wrapRef}
          className={`field-select-wrap field-select-size-sm${open ? ' is-open' : ''}`}
        >
          <button
            type="button"
            className="field-select field-select-trigger"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              if (!disabled) onOpenChange(!open)
            }}
          >
            <span className="field-select-value">{shown}</span>
            <span className="field-select-chevron" aria-hidden />
          </button>
          {open ? (
            <div className="field-select-panel">
              <div className="field-select-search">
                <input
                  ref={inputRef}
                  type="text"
                  className="field-select-search-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={brew.inputNewCategory}
                  autoComplete="off"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    event.stopPropagation()
                    if (name) pick(name)
                  }}
                />
              </div>
              <ul className="field-select-menu" role="listbox">
                {canAdd ? (
                  <li role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected
                      className="field-select-option is-selected"
                      onClick={() => pick(name)}
                    >
                      <Plus />
                      {`${brew.addCategory.replace(/[….]+$/u, '')}「${name}」`}
                    </button>
                  </li>
                ) : null}
                <li role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={!value && !name}
                    className={`field-select-option${!value && !name ? ' is-selected' : ''}`}
                    onClick={() => pick('')}
                  >
                    {brew.noCategory}
                  </button>
                </li>
                {categories.map((cat) => (
                  <li key={cat} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected(cat)}
                      className={`field-select-option${selected(cat) ? ' is-selected' : ''}`}
                      onClick={() => pick(cat)}
                    >
                      {labelFor?.(cat) ?? cat}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
