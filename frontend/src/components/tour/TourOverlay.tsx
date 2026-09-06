import type { CSSProperties } from 'react'
import type { TourPlacement } from './tourLogic'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../contexts/I18nContext'
import {
  getTourSnapshot,
  nextTourStep,
  previousTourStep,
  recoverTourStep,
  stopTour,
  subscribeTour,
} from './tourEngine'
import {
  computeTourCardPosition,
  holePadForBox,
  holeRadiusFor,
  inflateRect,
  isDegenerateBox,
  queryTourAnchor,
  readTourBox,
} from './tourLogic'
import './TourOverlay.css'

const CARD_FALLBACK = { w: 296, h: 176 }
const PULSE_MS = 520

interface StepCopy {
  title: string
  body: string
}

function stepCopy(
  steps: Record<string, StepCopy>,
  id: string,
): StepCopy {
  return steps[id] ?? { title: id, body: '' }
}

function readRadius(node: HTMLElement): number {
  const raw = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius)
  return Number.isFinite(raw) ? raw : 16
}

export function TourOverlay() {
  const state = useSyncExternalStore(
    subscribeTour,
    getTourSnapshot,
    getTourSnapshot,
  )
  const { t } = useI18n()
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [hole, setHole] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    radius: 16,
  })
  const [cardPos, setCardPos] = useState<{
    top: number
    left: number
    placement: TourPlacement
    caret: number
  }>({ top: 24, left: 24, placement: 'bottom', caret: 80 })
  const [ready, setReady] = useState(false)
  const [pulse, setPulse] = useState(false)

  const measure = useCallback(() => {
    if (!state.active || !state.step) return
    const node = queryTourAnchor(state.step.anchor)
    if (!node) {
      recoverTourStep()
      return
    }
    const box = readTourBox(node)
    if (isDegenerateBox(box)) {
      recoverTourStep()
      return
    }
    const pad = holePadForBox(box)
    const inflated = inflateRect(box, pad)
    const vw = window.innerWidth
    const vh = window.innerHeight
    setHole({
      top: inflated.top,
      left: inflated.left,
      width: inflated.width,
      height: inflated.height,
      radius: holeRadiusFor(readRadius(node) + pad, inflated),
    })
    const measured = cardRef.current
    const width = measured?.offsetWidth || CARD_FALLBACK.w
    const height = measured?.offsetHeight || CARD_FALLBACK.h
    setCardPos(computeTourCardPosition(inflated, width, height, vw, vh))
    setReady(true)
  }, [state.active, state.step])

  useLayoutEffect(() => {
    if (!state.active) {
      setReady(false)
      return
    }
    measure()
    const anchor = state.step ? queryTourAnchor(state.step.anchor) : null
    const hosts = [
      cardRef.current,
      anchor,
      anchor?.closest<HTMLElement>('.nav-container'),
    ].filter((node, index, list): node is HTMLElement => {
      return !!node && list.indexOf(node) === index
    })
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure())
    if (observer) {
      for (const host of hosts) observer.observe(host)
    }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (
        event.propertyName === 'transform' ||
        event.propertyName === 'width' ||
        event.propertyName === 'height' ||
        event.propertyName === 'top' ||
        event.propertyName === 'left'
      ) {
        measure()
      }
    }
    for (const host of hosts) {
      host.addEventListener('transitionend', onTransitionEnd)
    }
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      measure()
      raf2 = window.requestAnimationFrame(measure)
    })
    return () => {
      observer?.disconnect()
      for (const host of hosts) {
        host.removeEventListener('transitionend', onTransitionEnd)
      }
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
  }, [measure, state.active, state.step])

  useEffect(() => {
    if (!state.active || !state.step) return
    setPulse(true)
    const timer = window.setTimeout(setPulse, PULSE_MS, false)
    return () => window.clearTimeout(timer)
  }, [state.active, state.step?.id])

  useEffect(() => {
    if (!state.active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        stopTour()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [state.active, measure])

  useEffect(() => {
    if (!state.active) return
    primaryRef.current?.focus({ preventScroll: true })
  }, [state.active, state.step?.id])

  if (!state.active || !state.step || typeof document === 'undefined') {
    return null
  }

  const copy = stepCopy(t.tour.steps, state.step.id)
  const isLast = state.index >= state.total - 1
  const isFirst = state.index <= 0
  const hasHole = hole.width > 0 && hole.height > 0
  const holeStyle = {
    top: hole.top,
    left: hole.left,
    width: hole.width,
    height: hole.height,
    borderRadius: hole.radius,
  }
  const cardStyle = {
    top: cardPos.top,
    left: cardPos.left,
    '--tour-caret': `${cardPos.caret}px`,
  } as CSSProperties

  return createPortal(
    <div className="tour-overlay" role="presentation">
      {hasHole ? (
        <>
          <div className="tour-spotlight" style={holeStyle} aria-hidden />
          <div
            className={`tour-ring${pulse ? ' is-pulse' : ''}`}
            style={holeStyle}
            aria-hidden
          />
        </>
      ) : null}
      <div
        ref={cardRef}
        className={`tour-card${ready ? ' is-ready' : ''}`}
        data-placement={cardPos.placement}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={cardStyle}
      >
        <span className="tour-card__caret" aria-hidden />
        <div className="tour-card__copy" key={state.step.id}>
          <p className="tour-card__kicker">
            {state.index + 1} / {state.total}
          </p>
          <h2 id={titleId} className="tour-card__title">
            {copy.title}
          </h2>
          <p className="tour-card__body">{copy.body}</p>
        </div>
        <div className="tour-card__actions">
          <button
            type="button"
            className="tour-card__skip"
            onClick={() => stopTour('skip')}
          >
            {t.tour.skip}
          </button>
          <span className="tour-card__actions-spacer" />
          {isFirst ? null : (
            <button
              type="button"
              className="tour-card__btn"
              onClick={previousTourStep}
            >
              {t.tour.back}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className="tour-card__btn tour-card__btn--primary"
            onClick={isLast ? () => stopTour('done') : nextTourStep}
          >
            {isLast ? t.tour.done : t.tour.next}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
