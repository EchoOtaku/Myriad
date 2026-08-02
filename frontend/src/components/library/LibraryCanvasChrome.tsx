import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  getNavLayoutSnapshot,
  getServerNavLayoutSnapshot,
  subscribeNavLayout,
} from '../../utils/navLayout'

const CANVAS_HINT_SESSION_KEY = 'library-canvas-hint-dismissed'

interface LibraryCanvasChromeProps {
  ariaLabel: string
  atMaxZoom: boolean
  atMinZoom: boolean
  dismissHintLabel: string
  hint: string
  /** Shorter touch-first copy; falls back to `hint` when omitted. */
  mobileHint?: string
  isDefault: boolean
  onReset: () => void
  onZoom: (factor: number) => void
  resetLabel: string
  zoomInLabel: string
  zoomOutLabel: string
  zoomPercent: number
}

export function LibraryCanvasChrome({
  ariaLabel,
  atMaxZoom,
  atMinZoom,
  dismissHintLabel,
  hint,
  mobileHint,
  isDefault,
  onReset,
  onZoom,
  resetLabel,
  zoomInLabel,
  zoomOutLabel,
  zoomPercent,
}: LibraryCanvasChromeProps) {
  // null until we read sessionStorage — avoids a false flash of dismissed state
  // and ensures the first paint can still show the tip on fresh sessions.
  const [showHint, setShowHint] = useState<boolean | null>(null)
  const navLayout = useSyncExternalStore(
    subscribeNavLayout,
    getNavLayoutSnapshot,
    getServerNavLayoutSnapshot,
  )
  const isMobile = navLayout === 'mobile'

  useEffect(() => {
    try {
      setShowHint(
        window.sessionStorage.getItem(CANVAS_HINT_SESSION_KEY) !== '1',
      )
    } catch {
      setShowHint(true)
    }
  }, [])

  const dismissHint = useCallback(() => {
    setShowHint(false)
    try {
      window.sessionStorage.setItem(CANVAS_HINT_SESSION_KEY, '1')
    } catch {
      // Dismiss locally even when session storage is unavailable.
    }
  }, [])

  if (typeof document === 'undefined') return null

  const hintText =
    isMobile && mobileHint && mobileHint.trim().length > 0 ? mobileHint : hint

  // Portal out of the z-0 canvas surface so chrome isn't trapped under host
  // nav (z-50) / GCP stacking, and isn't covered by the transformed card world.
  return createPortal(
    <>
      {showHint === true && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 sm:px-16 md:px-24"
          style={{
            top: 'max(0.75rem, env(safe-area-inset-top, 0px))',
          }}
        >
          <div className="pointer-events-auto glass flex max-w-[min(100%,28rem)] items-center gap-1 rounded-full py-1 pr-1 pl-3 text-[10px] leading-snug text-gray-600 shadow-sm dark:text-gray-300 sm:max-w-none sm:text-[11px]">
            <span className="min-w-0">{hintText}</span>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={dismissHint}
              aria-label={dismissHintLabel}
              title={dismissHintLabel}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  d="m7 7 10 10M17 7 7 17"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div
        className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/35 glass p-1 shadow-xl dark:border-white/10"
        style={{
          // Bottom island needs clearance; side rail can sit lower.
          bottom: isMobile
            ? 'calc(env(safe-area-inset-bottom, 0px) + 5.75rem)'
            : 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
        role="toolbar"
        aria-label={ariaLabel}
      >
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-white/65 hover:text-gray-950 active:bg-white/80 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={() => onZoom(1 / 1.16)}
          disabled={atMinZoom}
          title={`${zoomOutLabel} (-)`}
          aria-label={zoomOutLabel}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M5 12h14" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <output
          className="min-w-11 select-none text-center text-[11px] font-semibold tabular-nums text-gray-700 dark:text-gray-200"
          aria-live="polite"
        >
          {zoomPercent}%
        </output>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-white/65 hover:text-gray-950 active:bg-white/80 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={() => onZoom(1.16)}
          disabled={atMaxZoom}
          title={`${zoomInLabel} (+)`}
          aria-label={zoomInLabel}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <span
          className="mx-0.5 h-4 w-px bg-gray-900/10 dark:bg-white/15"
          aria-hidden="true"
        />
        <button
          type="button"
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white/65 hover:text-gray-950 active:bg-white/80 disabled:cursor-default disabled:opacity-35 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={onReset}
          disabled={isDefault}
          title={`${resetLabel} (0)`}
          aria-label={resetLabel}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3M12 8v8m-4-4h8"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="hidden sm:inline">{resetLabel}</span>
        </button>
      </div>
    </>,
    document.body,
  )
}
