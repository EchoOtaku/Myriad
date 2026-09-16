import type { HTMLAttributes, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageTransition } from '../hooks/animation/usePageTransition'
import { pageIdFromPath } from '../hooks/animation/pageId'

interface AnimatedViewProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
}

export default function AnimatedView({
  children,
  className = '',
  ...rest
}: AnimatedViewProps) {
  const location = useLocation()
  const pageId = pageIdFromPath(location.pathname)

  const { onEnterComplete } = usePageTransition({ pageId })

  const hasNotified = useRef(false)

  useEffect(() => {
    let rafId: number | null = null

    if (!hasNotified.current) {
      hasNotified.current = true
      rafId = requestAnimationFrame(() => {
        rafId = null
        onEnterComplete()
      })
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      hasNotified.current = false
    }
  }, [pageId, onEnterComplete])

  return (
    <div className={`animated-view-container ${className}`} {...rest}>
      {children}
    </div>
  )
}
