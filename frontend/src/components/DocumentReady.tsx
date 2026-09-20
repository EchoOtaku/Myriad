import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { markDocumentReady } from '../utils/pageLoader'

/** Reveal only a committed page (including its data loading state) or recovery UI. */
export function DocumentReady({ children }: { children: ReactNode }) {
  useEffect(markDocumentReady, [])
  return children
}

/** Last-resort recovery must not depend on a downloadable locale catalog. */
export function StartupFailure() {
  return (
    <DocumentReady>
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <p>Unable to load this page. Please reload to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </DocumentReady>
  )
}
