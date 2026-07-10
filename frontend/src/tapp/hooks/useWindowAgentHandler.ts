/**
 * 将 Agent 前端操作处理逻辑从 TappWindowManager 解耦
 *
 * 通过 Hook 封装 registerActionHandler / unregisterActionHandler 调用，
 * TappWindowManager 不再直接依赖 agent 服务实现细节。
 */

import type { FrontendAction, WindowTarget } from '../../services/agent'
import { useEffect } from 'react'

import {
  registerActionHandler,
  unregisterActionHandler,
} from '../../services/agent'

export interface WindowRef {
  windowId: string
  tappId: string
}

interface UseWindowAgentHandlerOptions {
  /** 当前所有窗口的 ref（避免 useEffect 依赖频繁变化） */
  windowsRef: React.RefObject<WindowRef[]>
  /** 当前活跃窗口 ID 的 ref */
  activeWindowIdRef: React.RefObject<string | null>
  /** 打开一个 Tapp 窗口 */
  openTappWindow: (tappId: string) => Promise<void>
  /** 关闭窗口 */
  closeWindow: (windowId: string) => void
  /** 聚焦窗口 */
  focusWindow: (windowId: string) => void
}

function resolveWindowTarget(
  target: WindowTarget,
  windowsRef: React.RefObject<WindowRef[]>,
  activeWindowIdRef: React.RefObject<string | null>,
): string | null {
  if (target.windowId) {
    return target.windowId
  }
  if (target.tappId) {
    const win = windowsRef.current?.find((w) => w.tappId === target.tappId)
    return win?.windowId || null
  }
  if (target.position === 'active') {
    return activeWindowIdRef.current
  }
  return null
}

function findTappIframe(
  action: FrontendAction,
  windowsRef: React.RefObject<WindowRef[]>,
  activeWindowIdRef: React.RefObject<string | null>,
): HTMLIFrameElement | null {
  const target = action.target as WindowTarget | undefined
  const directWindowId = action.windowId
  const tappWindowId = action.tappId
    ? windowsRef.current?.find((window) => window.tappId === action.tappId)
        ?.windowId
    : null
  const windowId =
    directWindowId ||
    tappWindowId ||
    (target
      ? resolveWindowTarget(target, windowsRef, activeWindowIdRef)
      : activeWindowIdRef.current)

  if (!windowId) return null
  const container = document.querySelector(
    `[data-window-id="${CSS.escape(windowId)}"]`,
  )
  return container?.querySelector('iframe') ?? null
}

function requestTappData(
  iframe: HTMLIFrameElement,
  action: FrontendAction,
): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse)
      reject(new Error('Tapp data read timed out'))
    }, 5000)

    const handleResponse = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.data?.type !== 'AGENT_READ_DATA_RESPONSE' ||
        event.data?.requestId !== requestId
      ) {
        return
      }
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handleResponse)
      resolve((event.data.data as Record<string, unknown>) ?? {})
    }

    window.addEventListener('message', handleResponse)
    iframe.contentWindow?.postMessage(
      {
        type: 'AGENT_READ_DATA',
        requestId,
        fields: action.data?.fields,
        readType: action.readType ?? 'all',
        selector: action.selector,
      },
      '*',
    )
  })
}

/**
 * 注册 Agent 前端操作处理器，在卸载时自动注销
 */
export function useWindowAgentHandler({
  windowsRef,
  activeWindowIdRef,
  openTappWindow,
  closeWindow,
  focusWindow,
}: UseWindowAgentHandlerOptions): void {
  useEffect(() => {
    const handleAgentAction = async (
      action: FrontendAction,
    ): Promise<unknown> => {
      try {
        switch (action.type) {
          case 'open_window': {
            const data = action.data as Record<string, unknown> | undefined
            const tappId =
              action.tappId ||
              (data?.tappId as string | undefined) ||
              (data?.tapp_id as string | undefined)
            if (tappId) {
              await openTappWindow(tappId)
              return true
            }
            return false
          }

          case 'close_window': {
            const target = action.target as WindowTarget | undefined
            if (target) {
              const windowId = resolveWindowTarget(
                target,
                windowsRef,
                activeWindowIdRef,
              )
              if (windowId) {
                closeWindow(windowId)
                return true
              }
            }
            return false
          }

          case 'focus_window': {
            const target = action.target as WindowTarget | undefined
            if (target) {
              const windowId = resolveWindowTarget(
                target,
                windowsRef,
                activeWindowIdRef,
              )
              if (windowId) {
                focusWindow(windowId)
                return true
              }
            }
            return false
          }

          case 'fill_data': {
            const data = action.data as Record<string, unknown> | undefined
            const iframe = findTappIframe(
              action,
              windowsRef,
              activeWindowIdRef,
            )
            if (iframe?.contentWindow && data) {
              iframe.contentWindow.postMessage(
                {
                  type: 'AGENT_FILL_DATA',
                  data,
                  autoSubmit: action.autoSubmit,
                },
                '*',
              )
              return true
            }
            return false
          }

          case 'read_data': {
            const iframe = findTappIframe(
              action,
              windowsRef,
              activeWindowIdRef,
            )
            if (iframe?.contentWindow) {
              return requestTappData(iframe, action)
            }
            return false
          }

          case 'tapp_interact': {
            const iframe = findTappIframe(
              action,
              windowsRef,
              activeWindowIdRef,
            )
            if (!iframe?.contentWindow || !action.commands?.length) {
              return false
            }
            iframe.contentWindow.postMessage(
              {
                type: 'AGENT_INTERACT',
                commands: action.commands,
              },
              '*',
            )
            return true
          }

          case 'query_windows':
            return {
              windows: windowsRef.current ?? [],
              activeWindowId: activeWindowIdRef.current,
              windowCount: windowsRef.current?.length ?? 0,
            }

          default:
            console.warn('Unknown agent action:', action.type)
            return false
        }
      } catch (error) {
        console.error('Failed to execute agent action:', error)
        return false
      }
    }

    registerActionHandler(handleAgentAction)
    return () => {
      unregisterActionHandler(handleAgentAction)
    }
  }, [windowsRef, activeWindowIdRef, openTappWindow, closeWindow, focusWindow])
}
