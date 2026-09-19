import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { isPageVisible, onVisibility } from '../../hooks/animation/core'
import { dynamicContentProvider } from '../../services/DynamicContentProvider'

const serverSnapshot = () => 0

/** Read TAPP content from its source; background changes collapse into one visible refresh. */
export function useTappIslandContents() {
  const subscribe = useCallback((onChange: () => void) => {
    const unsubscribe = dynamicContentProvider.subscribe(() => {
      if (isPageVisible()) onChange()
    })
    const unwatch = onVisibility(visible => { if (visible) dynamicContentProvider.refreshSnapshot() })
    return () => { unsubscribe(); unwatch() }
  }, [])
  const revision = useSyncExternalStore(subscribe, dynamicContentProvider.getSnapshot, serverSnapshot)
  return useMemo(() => {
    void revision
    return dynamicContentProvider.getAllContents().filter(content => content.type.startsWith('tapp-'))
  }, [revision])
}
