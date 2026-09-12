import type { ConfigDomainOptions } from './configDomain'
import { useRef, useState, useSyncExternalStore } from 'react'
import { createConfigDomain } from './configDomain'

export function useConfigDomain<T>(options: ConfigDomainOptions<T>) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [controller] = useState(() =>
    createConfigDomain(() => optionsRef.current),
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  return { ...state, ...controller }
}
