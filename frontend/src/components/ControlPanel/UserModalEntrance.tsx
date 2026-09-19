import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import '../UserModal.css'

/** Place inside Suspense so entrance starts only after the content commits. */
export function UserModalEntrance({ children, onReady }: { children: ReactNode, onReady: () => void }) {
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(onReady)
    })
    return () => cancelAnimationFrame(frame)
  }, [onReady])
  return children
}

export default UserModalEntrance
