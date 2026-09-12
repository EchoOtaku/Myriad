import type { ShowMessage } from './types'
import { useCallback } from 'react'
import { showStickyToast, showToast } from '../../../utils/toastManager'

const CONFIG_TOAST_KEY = 'config'

export function useConfigMessage() {
  const showMessage: ShowMessage = useCallback(
    (nextMessage, nextType = 'info', duration = 3000) => {
      const persist = duration <= 0
      if (persist) {
        showStickyToast({
          message: nextMessage,
          type: nextType,
          replaceKey: CONFIG_TOAST_KEY,
        })
        return
      }
      showToast({
        message: nextMessage,
        type: nextType,
        duration,
        replaceKey: CONFIG_TOAST_KEY,
      })
    },
    [],
  )

  const clearMessage = useCallback(() => {}, [])

  return { showMessage, clearMessage }
}
