import type { WidgetType } from '../../widgetGridTypes'
import { FaSearch, FaTimes } from '@lib/icons'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { widgetDisplayLabel, widgetSearchExtras } from '../../widgetLibraryModel'
import { widgetTypeMatchesLibrarySearch } from '../../widgetLibrarySearch'
import { NOTE_WIDGET_SIZES, normalizeNoteWidgetSize } from './noteLayout'

interface NoteWidgetPickerProps {
  open: boolean
  widgets: WidgetType[]
  onPick: (type: string, size: string) => void
  onClose: () => void
}

export function NoteWidgetPicker({
  open,
  widgets,
  onPick,
  onClose,
}: NoteWidgetPickerProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const widgetsI18n = t.widgets as Record<string, unknown>
  const filtered = useMemo(
    () =>
      widgets.filter((widget) =>
        widgetTypeMatchesLibrarySearch(query, {
          id: widget.id,
          name: widget.name,
          label: widgetDisplayLabel(widget, widgetsI18n),
          extras: widgetSearchExtras(widget),
        }),
      ),
    [query, widgets, widgetsI18n],
  )

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="phantasi-note__widget-picker-layer" onMouseDown={onClose}>
      <div
        className="phantasi-skin phantasi-note__widget-picker"
        role="dialog"
        aria-label={t.phantasi.noteWidgetPicker}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="phantasi-note__widget-picker-head">
          <div className="phantasi-note__widget-picker-search">
            <FaSearch size={12} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.phantasi.noteWidgetSearch}
              aria-label={t.phantasi.noteWidgetSearch}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="phantasi-note__widget-picker-close"
            onClick={onClose}
            aria-label={t.phantasi.close}
          >
            <FaTimes size={12} />
          </button>
        </div>
        <div className="phantasi-note__widget-picker-list">
          {filtered.length === 0 ? (
            <p className="phantasi-note__widget-picker-empty">{t.phantasi.noteWidgetEmpty}</p>
          ) : (
            filtered.map((widget) => {
              const label = widgetDisplayLabel(widget, widgetsI18n)
              const size = normalizeNoteWidgetSize(
                widget.supportedSizes?.find((item) =>
                  (NOTE_WIDGET_SIZES as readonly string[]).includes(item),
                ) ?? widget.defaultSize,
              )
              return (
                <button
                  key={widget.id}
                  type="button"
                  className="phantasi-note__widget-picker-item"
                  onClick={() => onPick(widget.id, size)}
                >
                  <span className="phantasi-note__widget-picker-name">{label}</span>
                  <span className="phantasi-note__widget-picker-size">{size}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
