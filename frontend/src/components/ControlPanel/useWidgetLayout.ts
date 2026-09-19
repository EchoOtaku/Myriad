import type { WidgetConfig } from '../widgetGridTypes'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { formatUserFacingError } from '../../utils/formatUserFacingError'
import { getUIConfigDeduped } from '../../utils/requestDedup'
import { showError } from '../../utils/toastManager'
import { decodeWidgetLayout, initialWidgetLayout, widgetLayoutReducer } from './widgetLayoutState'

export function useWidgetLayout(loadErrorMessage: string) {
  const [state, dispatch] = useReducer(widgetLayoutReducer, undefined, initialWidgetLayout)
  const message = useRef(loadErrorMessage)
  useLayoutEffect(() => { message.current = loadErrorMessage }, [loadErrorMessage])
  useEffect(() => {
    let active = true
    const report = async (error: unknown) => {
      const text = await formatUserFacingError(error, message.current)
      if (active) showError(text)
    }
    const load = async () => {
      try {
        const data = await getUIConfigDeduped()
        if (!active) return
        const decoded = decodeWidgetLayout(data)
        dispatch({ type: 'loaded', widgets: decoded.widgets, rows: decoded.rows })
        if (decoded.error) await report(decoded.error)
      } catch (error) {
        if (active) await report(error)
      }
    }
    void load().catch(error => { if (active) console.error('Control panel layout load failed:', error) })
    return () => { active = false }
  }, [])
  const editLayout = useCallback((widgets: WidgetConfig[], rows?: number) => {
    dispatch({ type: 'edited', widgets, rows })
  }, [])
  return { widgets: state.widgets, gridRows: state.rows, editLayout }
}
