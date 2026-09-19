import { useEffect, useState } from 'react'
import { isPageVisible, onVisibility } from '../../hooks/animation/core'

export function welcomeGreetingKey(hour: number) {
  if (hour < 6) return 'lateNight'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

function hourKey(date: Date) {
  return `${date.toDateString()}/${date.getHours()}/${date.getTimezoneOffset()}`
}

/** Calendar content follows wall time; background time never replays animation. */
export function useWelcomeTime() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clear = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const refresh = () => {
      clear()
      if (!isPageVisible()) return
      const current = new Date()
      setNow(previous => hourKey(previous) === hourKey(current) ? previous : current)
      const nextHour = new Date(current)
      nextHour.setMinutes(60, 0, 0)
      timer = setTimeout(refresh, Math.max(1, nextHour.getTime() - current.getTime()))
    }
    const unsubscribe = onVisibility(visible => {
      if (visible) refresh()
      else clear()
    })
    window.addEventListener('focus', refresh)
    refresh()
    return () => {
      clear()
      unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return now
}
