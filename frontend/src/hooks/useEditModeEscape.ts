import { useEffect, useRef } from 'react'

/** Inner editors and overlays may consume Esc before the edit surface. */
export function useEditModeEscape(
  enabled: boolean,
  onExit: () => void,
  confirmationMessage?: string,
): void {
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const confirmationRef = useRef(confirmationMessage)
  confirmationRef.current = confirmationMessage

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (confirmationRef.current && !window.confirm(confirmationRef.current))
        return
      onExitRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
