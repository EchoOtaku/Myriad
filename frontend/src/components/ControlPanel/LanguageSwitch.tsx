import type { HostLanguageLabels, Locale } from '../../i18n'
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { hostLanguageName, hostLanguageShort } from '../../i18n'
import { WeatherAssetIcon } from '../weather/WeatherAssetIcon'
import {
  initialVirtual,
  localeAtVirtual,
  LOOP_ITEMS,
  needsSnap,
  rowTone,
  snapVirtual,
  stripTransform,
} from './languageSwitchModel'
import './LanguageSwitch.css'

const LANGUAGE_ICON = '/icons/control-panel/language.webp'
const SNAP_MS = 320

interface LanguageSwitchProps {
  locale: Locale
  labels: HostLanguageLabels
  title: string
  ariaLabel: string
  onChange: (locale: Locale) => void
}

function paintTones(strip: HTMLElement, index: number, picking: boolean) {
  const buttons = strip.children
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i] as HTMLElement
    button.className = `language-switch-btn${rowTone(Math.abs(i - index))}`
    button.setAttribute('aria-checked', i === index ? 'true' : 'false')
    button.tabIndex = picking && i === index ? 0 : -1
  }
}

function writeStrip(
  strip: HTMLElement,
  index: number,
  dragPx: number,
  instant: boolean,
) {
  if (instant) {
    strip.classList.add('is-snap')
    strip.classList.remove('is-ready')
  }
  strip.style.transform = stripTransform(index, dragPx)
  if (instant) void strip.offsetWidth
  strip.classList.remove('is-snap')
  strip.classList.add('is-ready')
}

export const LanguageSwitch = memo(({
  locale,
  labels,
  title,
  ariaLabel,
  onChange,
}: LanguageSwitchProps) => {
  const [picking, setPicking] = useState(false)
  const [armed, setArmed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; startX: number; moved: boolean } | null>(
    null,
  )
  const didDragRef = useRef(false)
  const virtualIndexRef = useRef(initialVirtual(locale))
  const localeRef = useRef(locale)
  const onChangeRef = useRef(onChange)
  const pickingRef = useRef(picking)
  const dragRafRef = useRef(0)
  const snapTimerRef = useRef(0)
  const listId = useId()
  localeRef.current = locale
  onChangeRef.current = onChange
  pickingRef.current = picking

  const paint = (index: number, instant = false) => {
    virtualIndexRef.current = index
    const strip = stripRef.current
    if (!strip) return
    writeStrip(strip, index, 0, instant)
    paintTones(strip, index, pickingRef.current)
  }

  const applyDrag = (px: number) => {
    const strip = stripRef.current
    if (!strip) return
    if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current)
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0
      strip.style.transform = stripTransform(virtualIndexRef.current, px)
      strip.classList.toggle('is-dragging', px !== 0)
    })
  }

  const queueSnap = (index: number) => {
    if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current)
    if (!needsSnap(index)) return
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = 0
      paint(snapVirtual(index), true)
    }, SNAP_MS)
  }

  const stepTo = (nextVirtual: number) => {
    paint(nextVirtual)
    queueSnap(nextVirtual)
    const nextLocale = localeAtVirtual(nextVirtual)
    if (nextLocale !== localeRef.current) onChangeRef.current(nextLocale)
  }

  const stepBy = (delta: number) => {
    stepTo(virtualIndexRef.current + delta)
  }

  const openPicker = () => {
    if (!armed) setArmed(true)
    setPicking(true)
  }

  useEffect(() => {
    if (picking) return
    applyDrag(0)
    dragRef.current = null
    if (snapTimerRef.current) {
      window.clearTimeout(snapTimerRef.current)
      snapTimerRef.current = 0
    }
    paint(initialVirtual(locale), true)
  }, [picking, locale])

  useLayoutEffect(() => {
    if (!armed) return
    paint(virtualIndexRef.current, true)
  }, [armed])

  useEffect(() => {
    if (!picking) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (rootRef.current?.contains(target)) return
      setPicking(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPicking(false)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        stepBy(event.key === 'ArrowRight' ? 1 : -1)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [picking])

  useEffect(() => {
    if (!picking) return
    const track = trackRef.current
    if (!track) return
    let locked = false
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (locked) return
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
      if (Math.abs(delta) < 6) return
      locked = true
      stepBy(delta > 0 ? 1 : -1)
      window.setTimeout(() => {
        locked = false
      }, 280)
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      track.removeEventListener('wheel', onWheel)
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current)
    }
  }, [picking])

  return (
    <div
      ref={rootRef}
      className={`control-item control-item-compact language-switch-item${
        picking ? ' is-picking' : ''
      }`}
    >
      <button
        type="button"
        className="language-switch-idle"
        aria-haspopup="true"
        aria-expanded={picking}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-hidden={picking}
        tabIndex={picking ? -1 : 0}
        onClick={openPicker}
      >
        <div className="control-item-info">
          <div className="control-item-icon icon-language">
            <WeatherAssetIcon
              icon={LANGUAGE_ICON}
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <span className="control-item-title">{title}</span>
            <span className="control-item-desc">
              {hostLanguageName(locale, labels)}
            </span>
          </div>
        </div>
        <span className="language-switch-btn is-current">
          <span className="language-code">
            {hostLanguageShort(locale, labels)}
          </span>
        </span>
      </button>

      <div
        ref={trackRef}
        className="language-switch-track"
        role="radiogroup"
        id={listId}
        aria-label={title}
        aria-hidden={!picking}
        inert={!picking}
        onPointerDown={(event) => {
          if (!picking || event.button !== 0) return
          dragRef.current = {
            id: event.pointerId,
            startX: event.clientX,
            moved: false,
          }
        }}
        onPointerMove={(event) => {
          if (!picking) return
          const drag = dragRef.current
          if (!drag || drag.id !== event.pointerId) return
          const dx = event.clientX - drag.startX
          if (!drag.moved && Math.abs(dx) < 8) return
          if (!drag.moved) {
            drag.moved = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          applyDrag(dx)
        }}
        onPointerUp={(event) => {
          if (!picking) return
          const drag = dragRef.current
          if (!drag || drag.id !== event.pointerId) return
          const dx = event.clientX - drag.startX
          const moved = drag.moved
          didDragRef.current = moved
          dragRef.current = null
          applyDrag(0)
          if (moved && Math.abs(dx) >= 28) stepBy(dx < 0 ? 1 : -1)
          requestAnimationFrame(() => {
            didDragRef.current = false
          })
        }}
        onPointerCancel={() => {
          dragRef.current = null
          applyDrag(0)
        }}
        onClick={(event) => {
          if (!picking || didDragRef.current) return
          const button = (event.target as HTMLElement | null)?.closest(
            '[data-ls-i]',
          )
          if (button instanceof HTMLElement) {
            const index = Number(button.dataset.lsI)
            if (index === virtualIndexRef.current) {
              setPicking(false)
              return
            }
            if (Number.isFinite(index)) stepTo(index)
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          stepBy(event.clientX >= rect.left + rect.width / 2 ? 1 : -1)
        }}
      >
        {armed && (
          <div ref={stripRef} className="language-switch-strip">
            {LOOP_ITEMS.map((code, index) => (
              <button
                key={`${code}-${index}`}
                type="button"
                role="radio"
                tabIndex={-1}
                aria-checked={false}
                data-ls-i={index}
                className="language-switch-btn"
              >
                <span className="language-code">
                  {hostLanguageShort(code, labels)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
