import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import type { LibraryCanvasTransform } from '../utils/libraryCanvas'

import { useCallback, useEffect, useRef, useState } from 'react'

const KEYBOARD_PAN_SPEED = 540
const KEYBOARD_PAN_ACCELERATION = 16
const KEYBOARD_PAN_DECELERATION = 11

export type LibraryCanvasKeyboardAction =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'reset' }

export function getLibraryCanvasKeyboardAction(
  key: string,
): LibraryCanvasKeyboardAction | null {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'pan', x: 1, y: 0 }
    case 'ArrowRight':
      return { kind: 'pan', x: -1, y: 0 }
    case 'ArrowUp':
      return { kind: 'pan', x: 0, y: 1 }
    case 'ArrowDown':
      return { kind: 'pan', x: 0, y: -1 }
    case '+':
    case '=':
      return { kind: 'zoom', factor: 1.16 }
    case '-':
    case '_':
      return { kind: 'zoom', factor: 1 / 1.16 }
    case '0':
    case 'Home':
      return { kind: 'reset' }
    default:
      return null
  }
}

interface LibraryCanvasControlsOptions {
  active: boolean
  defaultScale: number
  maxScale: number
  minScale: number
  surfaceRef: RefObject<HTMLDivElement | null>
}

export function useLibraryCanvasControls({
  active,
  defaultScale,
  maxScale,
  minScale,
  surfaceRef,
}: LibraryCanvasControlsOptions) {
  const initialTransform = useRef<LibraryCanvasTransform>({
    x: 0,
    y: 0,
    scale: defaultScale,
  }).current
  const [transform, setTransform] =
    useState<LibraryCanvasTransform>(initialTransform)
  const transformRef = useRef(initialTransform)
  const pendingTransformRef = useRef(initialTransform)
  const transformRafRef = useRef<number | null>(null)
  const pressedPanKeysRef = useRef(new Set<string>())
  const keyboardMotionRef = useRef({
    frame: null as number | null,
    velocityX: 0,
    velocityY: 0,
  })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    dragging: boolean
  } | null>(null)
  const suppressClickUntilRef = useRef(0)

  const scheduleTransform = useCallback(
    (update: (current: LibraryCanvasTransform) => LibraryCanvasTransform) => {
      const current = pendingTransformRef.current
      const next = update(current)
      if (
        next.x === current.x &&
        next.y === current.y &&
        next.scale === current.scale
      ) {
        return
      }
      pendingTransformRef.current = next
      transformRef.current = next
      if (transformRafRef.current !== null) return
      transformRafRef.current = requestAnimationFrame(() => {
        transformRafRef.current = null
        const pending = pendingTransformRef.current
        setTransform((rendered) =>
          rendered.x === pending.x &&
          rendered.y === pending.y &&
          rendered.scale === pending.scale
            ? rendered
            : pending,
        )
      })
    },
    [],
  )

  const reset = useCallback(() => {
    scheduleTransform(() => ({ x: 0, y: 0, scale: defaultScale }))
  }, [defaultScale, scheduleTransform])

  const zoom = useCallback(
    (factor: number) => {
      scheduleTransform((current) => ({
        ...current,
        scale: Math.min(maxScale, Math.max(minScale, current.scale * factor)),
      }))
    },
    [maxScale, minScale, scheduleTransform],
  )

  const keyboardDirection = useCallback(() => {
    let x = 0
    let y = 0
    pressedPanKeysRef.current.forEach((key) => {
      const action = getLibraryCanvasKeyboardAction(key)
      if (action?.kind === 'pan') {
        x += action.x
        y += action.y
      }
    })
    const magnitude = Math.hypot(x, y)
    return magnitude > 1 ? { x: x / magnitude, y: y / magnitude } : { x, y }
  }, [])

  const startKeyboardMotion = useCallback(() => {
    const motion = keyboardMotionRef.current
    if (motion.frame !== null) return
    let previousTime = performance.now()

    const tick = (time: number) => {
      const elapsed = Math.min(
        0.05,
        Math.max(0.001, (time - previousTime) / 1000),
      )
      previousTime = time
      const direction = keyboardDirection()
      const hasDirection = direction.x !== 0 || direction.y !== 0
      const targetX = direction.x * KEYBOARD_PAN_SPEED
      const targetY = direction.y * KEYBOARD_PAN_SPEED
      const response = hasDirection
        ? KEYBOARD_PAN_ACCELERATION
        : KEYBOARD_PAN_DECELERATION
      const blend = 1 - Math.exp(-response * elapsed)
      motion.velocityX += (targetX - motion.velocityX) * blend
      motion.velocityY += (targetY - motion.velocityY) * blend

      if (Math.abs(motion.velocityX) < 0.5) motion.velocityX = 0
      if (Math.abs(motion.velocityY) < 0.5) motion.velocityY = 0
      if (motion.velocityX !== 0 || motion.velocityY !== 0) {
        scheduleTransform((current) => ({
          ...current,
          x: current.x + motion.velocityX * elapsed,
          y: current.y + motion.velocityY * elapsed,
        }))
      }

      if (
        pressedPanKeysRef.current.size > 0 ||
        motion.velocityX !== 0 ||
        motion.velocityY !== 0
      ) {
        motion.frame = requestAnimationFrame(tick)
      } else {
        motion.frame = null
      }
    }

    motion.frame = requestAnimationFrame(tick)
  }, [keyboardDirection, scheduleTransform])

  const stopKeyboardMotion = useCallback(() => {
    pressedPanKeysRef.current.clear()
    const motion = keyboardMotionRef.current
    if (motion.frame !== null) cancelAnimationFrame(motion.frame)
    motion.frame = null
    motion.velocityX = 0
    motion.velocityY = 0
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const target = event.target as Element
      const primaryCardAction = target.closest('[data-canvas-card-action]')
      const interactive = target.closest(
        'button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
      )
      if (interactive && interactive !== primaryCardAction) return
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
        dragging: false,
      }
    },
    [],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.dragging) {
        if (dx * dx + dy * dy < 36) return
        drag.dragging = true
        suppressClickUntilRef.current = performance.now() + 400
        window.getSelection()?.removeAllRanges()
        const activeElement = document.activeElement
        if (
          activeElement instanceof HTMLElement &&
          activeElement.closest('[data-canvas-card-action]')
        ) {
          activeElement.blur()
        }
        event.currentTarget.dataset.dragging = 'true'
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      event.preventDefault()
      scheduleTransform((current) => ({
        ...current,
        x: drag.originX + dx,
        y: drag.originY + dy,
      }))
    },
    [scheduleTransform],
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      if (drag.dragging) {
        suppressClickUntilRef.current = performance.now() + 250
      }
      delete event.currentTarget.dataset.dragging
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (performance.now() > suppressClickUntilRef.current) return
      suppressClickUntilRef.current = 0
      event.preventDefault()
      event.stopPropagation()
    },
    [],
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      const surface = surfaceRef.current
      if (!surface) return
      if (event.ctrlKey || event.metaKey) {
        const rect = surface.getBoundingClientRect()
        const pointerX = event.clientX - rect.left - rect.width / 2
        const pointerY = event.clientY - rect.top - rect.height / 2
        const factor = Math.exp(-event.deltaY * 0.002)
        scheduleTransform((current) => {
          const scale = Math.min(
            maxScale,
            Math.max(minScale, current.scale * factor),
          )
          const ratio = scale / current.scale
          return {
            scale,
            x: pointerX - (pointerX - current.x) * ratio,
            y: pointerY - (pointerY - current.y) * ratio,
          }
        })
      } else {
        scheduleTransform((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }))
      }
    },
    [maxScale, minScale, scheduleTransform, surfaceRef],
  )

  useEffect(() => {
    if (!active) return
    const surface = surfaceRef.current
    if (!surface) return
    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [active, handleWheel, surfaceRef])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      surfaceRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [active, surfaceRef])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return
      }
      const action = getLibraryCanvasKeyboardAction(event.key)
      if (!action) {
        return
      }
      event.preventDefault()
      if (action.kind === 'reset') {
        reset()
      } else if (action.kind === 'zoom') {
        zoom(action.factor)
      } else {
        pressedPanKeysRef.current.add(event.key)
        startKeyboardMotion()
      }
    },
    [reset, startKeyboardMotion, zoom],
  )

  const handleKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const action = getLibraryCanvasKeyboardAction(event.key)
      if (action?.kind !== 'pan') return
      event.preventDefault()
      pressedPanKeysRef.current.delete(event.key)
      startKeyboardMotion()
    },
    [startKeyboardMotion],
  )

  useEffect(() => {
    if (!active) stopKeyboardMotion()
  }, [active, stopKeyboardMotion])

  useEffect(() => {
    return () => {
      if (transformRafRef.current !== null) {
        cancelAnimationFrame(transformRafRef.current)
      }
      stopKeyboardMotion()
    }
  }, [stopKeyboardMotion])

  return {
    atMaxZoom: transform.scale >= maxScale - 0.001,
    atMinZoom: transform.scale <= minScale + 0.001,
    // 聚焦尺寸与画布位姿同一 rAF 更新，拖拽和滚轮中保持实时。
    focusTransform: transform,
    handleClickCapture,
    handleBlur: stopKeyboardMotion,
    handleKeyDown,
    handleKeyUp,
    handlePointerDown,
    handlePointerMove,
    isDefault:
      Math.abs(transform.x) < 0.5 &&
      Math.abs(transform.y) < 0.5 &&
      Math.abs(transform.scale - defaultScale) < 0.001,
    finishPointer,
    reset,
    transform,
    zoom,
    zoomPercent: Math.round(transform.scale * 100),
  }
}
