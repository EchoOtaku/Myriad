import type { ReactNode } from 'react'
import type { HostLanguageLabels, Locale } from '../../i18n'
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { hostLanguageName, hostLanguageShort, LOCALES } from '../../i18n'
import './LanguageSwitch.css'

const LOCALE_COUNT = LOCALES.length
const LOOP_OFFSET = LOCALE_COUNT
const LOOP_ITEMS = [...LOCALES, ...LOCALES, ...LOCALES]

interface LanguageSwitchProps {
  locale: Locale
  labels: HostLanguageLabels
  title: string
  ariaLabel: string
  icon: ReactNode
  onChange: (locale: Locale) => void
}

function wrapIndex(index: number): number {
  return ((index % LOCALE_COUNT) + LOCALE_COUNT) % LOCALE_COUNT
}

function localeAt(index: number): Locale {
  return LOCALES[wrapIndex(index)]
}

function rowTone(distance: number): string {
  if (distance === 0) return ' is-current'
  if (distance === 1) return ' is-near-1'
  if (distance === 2) return ' is-near-2'
  return ' is-far'
}

export function LanguageSwitch({
  locale,
  labels,
  title,
  ariaLabel,
  icon,
  onChange,
}: LanguageSwitchProps) {
  const [picking, setPicking] = useState(false)
  const [stripReady, setStripReady] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [virtualIndex, setVirtualIndex] = useState(
    () => LOOP_OFFSET + Math.max(0, LOCALES.indexOf(locale)),
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dragRef = useRef<{ id: number; startX: number; moved: boolean } | null>(
    null,
  )
  const didDragRef = useRef(false)
  const skipTransitionRef = useRef(false)
  const virtualIndexRef = useRef(virtualIndex)
  const localeRef = useRef(locale)
  const onChangeRef = useRef(onChange)
  const listId = useId()
  virtualIndexRef.current = virtualIndex
  localeRef.current = locale
  onChangeRef.current = onChange

  const stepTo = (nextVirtual: number) => {
    setVirtualIndex(nextVirtual)
    const nextLocale = localeAt(nextVirtual)
    if (nextLocale !== localeRef.current) onChangeRef.current(nextLocale)
  }

  const stepBy = (delta: number) => {
    stepTo(virtualIndexRef.current + delta)
  }

  useEffect(() => {
    if (picking) return
    setDragX(0)
    dragRef.current = null
    setVirtualIndex(LOOP_OFFSET + Math.max(0, LOCALES.indexOf(locale)))
  }, [picking, locale])

  useLayoutEffect(() => {
    const strip = stripRef.current
    const item = itemRefs.current[virtualIndex]
    if (!strip || !item) return
    const center = item.offsetLeft + item.offsetWidth / 2
    const nextTransform = `translate3d(${-center + dragX}px, -50%, 0)`
    if (skipTransitionRef.current) {
      strip.classList.remove('is-ready')
      strip.style.transform = nextTransform
      void strip.offsetWidth
      skipTransitionRef.current = false
      strip.classList.add('is-ready')
      return
    }
    strip.style.transform = nextTransform
    if (!stripReady) {
      requestAnimationFrame(() => setStripReady(true))
    }
  }, [virtualIndex, dragX, labels, stripReady])

  useEffect(() => {
    if (
      virtualIndex >= LOOP_OFFSET &&
      virtualIndex < LOOP_OFFSET + LOCALE_COUNT
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      skipTransitionRef.current = true
      setVirtualIndex(LOOP_OFFSET + wrapIndex(virtualIndex))
    }, 340)
    return () => window.clearTimeout(timer)
  }, [virtualIndex])

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
    return () => track.removeEventListener('wheel', onWheel)
  }, [picking])

  const stepByDrag = (dx: number) => {
    if (Math.abs(dx) < 28) return
    stepBy(dx < 0 ? 1 : -1)
  }

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
        onClick={() => setPicking(true)}
      >
        <div className="control-item-info">
          <div className="control-item-icon icon-language">{icon}</div>
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
          setDragX(dx)
        }}
        onPointerUp={(event) => {
          if (!picking) return
          const drag = dragRef.current
          if (!drag || drag.id !== event.pointerId) return
          const dx = event.clientX - drag.startX
          const moved = drag.moved
          didDragRef.current = moved
          dragRef.current = null
          setDragX(0)
          if (moved) stepByDrag(dx)
          requestAnimationFrame(() => {
            didDragRef.current = false
          })
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setDragX(0)
        }}
        onClick={(event) => {
          if (!picking || didDragRef.current) return
          if ((event.target as HTMLElement | null)?.closest('.language-switch-btn')) {
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          stepBy(event.clientX >= rect.left + rect.width / 2 ? 1 : -1)
        }}
      >
        <div
          ref={stripRef}
          className={`language-switch-strip${stripReady ? ' is-ready' : ''}${
            dragX !== 0 ? ' is-dragging' : ''
          }`}
          onTransitionEnd={(event) => {
            if (event.target !== stripRef.current) return
            if (event.propertyName !== 'transform') return
            if (
              virtualIndex >= LOOP_OFFSET &&
              virtualIndex < LOOP_OFFSET + LOCALE_COUNT
            ) {
              return
            }
            skipTransitionRef.current = true
            setVirtualIndex(LOOP_OFFSET + wrapIndex(virtualIndex))
          }}
        >
          {LOOP_ITEMS.map((code, index) => {
            const current = index === virtualIndex
            return (
              <button
                key={`${code}-${index}`}
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="radio"
                tabIndex={picking && current ? 0 : -1}
                aria-checked={current}
                className={`language-switch-btn${rowTone(
                  Math.abs(index - virtualIndex),
                )}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!picking || didDragRef.current) return
                  if (current) {
                    setPicking(false)
                    return
                  }
                  stepTo(index)
                }}
              >
                <span className="language-code">
                  {hostLanguageShort(code, labels)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
