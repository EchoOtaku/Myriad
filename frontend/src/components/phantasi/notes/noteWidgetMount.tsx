/**
 * 正文小组件：占位壳只带 data-widget / data-size / data-config。
 * React 从笔记 / 阅读器这棵树上 portal 进 face，沿用路由和 i18n。
 * 换 innerHTML 必须走 replaceNoteHtml，写完再补挂，避免 portal 还指着旧节点。
 */

import type { WidgetConfig, WidgetSize, WidgetType } from '../../widgetGridTypes'
import type { ErrorInfo, ReactNode, RefObject } from 'react'
import { Component, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { widgetHostConfig } from '../../widgetLibraryModel'
import {
  decodeWidgetConfigAttr,
  encodeWidgetConfigAttr,
  type NoteWidgetConfig,
} from './noteLayout'
import { noteWidgetInstanceId, noteWidgetIslandKey } from './noteWidgetId'
import { NOTE_WIDGET_FACE } from './noteWidgetHtml'

export { hasNoteWidgetMarkup, NOTE_WIDGET_FACE } from './noteWidgetHtml'
export { noteWidgetInstanceId } from './noteWidgetId'

type Surface = { paint: () => void }

const surfaces = new WeakMap<HTMLElement, Set<Surface>>()

function registerSurface(root: HTMLElement, surface: Surface): () => void {
  let set = surfaces.get(root)
  if (!set) {
    set = new Set()
    surfaces.set(root, set)
  }
  set.add(surface)
  return () => {
    set.delete(surface)
  }
}

export type NoteWidgetHydrateOptions = {
  editable?: boolean
  onConfigChange?: (host: HTMLElement, config: NoteWidgetConfig) => void
}

export type NoteWidgetHydration = {
  portals: ReactNode
  refresh: () => void
}

class NoteWidgetGuard extends Component<
  { missingLabel: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[note-widget]', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <div className="note-widget__missing">{this.props.missingLabel}</div>
    }
    return this.props.children
  }
}

function noteWidgetConfig(
  widgetType: WidgetType,
  host: HTMLElement,
  size: string,
  instanceConfig: NoteWidgetConfig | null,
): WidgetConfig {
  return {
    id: noteWidgetInstanceId(host, widgetType.id),
    type: widgetType.id,
    size: (size as WidgetSize) || widgetType.defaultSize,
    position: { x: 0, y: 0 },
    config: {
      ...widgetHostConfig(widgetType.id),
      ...instanceConfig,
    },
  }
}

function NoteWidgetSlot({
  host,
  type,
  size,
  instanceConfig,
  catalog,
  missingLabel,
  editable,
  onConfigChange,
}: {
  host: HTMLElement
  type: string
  size: string
  instanceConfig: NoteWidgetConfig | null
  catalog: WidgetType[]
  missingLabel: string
  editable?: boolean
  onConfigChange?: (config: NoteWidgetConfig) => void
}) {
  const widgetType = catalog.find((entry) => entry.id === type)
  const config = useMemo(
    () =>
      widgetType ? noteWidgetConfig(widgetType, host, size, instanceConfig) : null,
    [host, instanceConfig, size, widgetType],
  )
  if (!widgetType || !config) {
    return <div className="note-widget__missing">{missingLabel}</div>
  }
  const WidgetComponent = widgetType.component
  return (
    <NoteWidgetGuard missingLabel={missingLabel}>
      <Suspense fallback={null}>
        <WidgetComponent
          config={config}
          isEditMode={Boolean(editable)}
          isPreview={false}
          onConfigChange={onConfigChange}
        />
      </Suspense>
    </NoteWidgetGuard>
  )
}

function widgetFace(host: HTMLElement): HTMLElement {
  const existing = host.querySelector(`:scope > .${NOTE_WIDGET_FACE}`)
  if (existing instanceof HTMLElement) return existing
  const face = host.ownerDocument.createElement('div')
  face.className = NOTE_WIDGET_FACE
  host.replaceChildren(face)
  return face
}

type Island = {
  key: string
  host: HTMLElement
  face: HTMLElement
  type: string
  size: string
  instanceConfig: NoteWidgetConfig | null
  editable: boolean
}

function collectNoteWidgetIslands(
  root: HTMLElement,
  options?: NoteWidgetHydrateOptions,
): Island[] {
  const islands: Island[] = []
  for (const host of root.querySelectorAll<HTMLElement>('.note-widget')) {
    const type = host.dataset.widget ?? ''
    if (!type) continue
    host.classList.add('not-prose')
    islands.push({
      key: noteWidgetIslandKey(host),
      host,
      face: widgetFace(host),
      type,
      size: host.dataset.size ?? '2x2',
      instanceConfig: decodeWidgetConfigAttr(host.dataset.config),
      editable: Boolean(options?.editable && host.classList.contains('is-selected')),
    })
  }
  return islands
}

/** 先写占位。已登记的水合会在同一轮 layout 里补挂。 */
export function replaceNoteHtml(root: HTMLElement, html: string): void {
  root.innerHTML = html
  const set = surfaces.get(root)
  if (!set) return
  for (const surface of set) surface.paint()
}

/**
 * 目录变了只重渲，不卸岛。选中切换走 refresh。
 * 切走 / 卸载才卸。写入 HTML 用 replaceNoteHtml。
 */
export function useNoteWidgetHydration(
  rootRef: RefObject<HTMLElement | null>,
  catalog: WidgetType[],
  token: string | number | boolean,
  active: boolean,
  options?: NoteWidgetHydrateOptions,
): NoteWidgetHydration {
  const { t } = useI18n()
  const missing = t.phantasi.noteWidgetMissing
  const [islands, setIslands] = useState<Island[]>([])
  const optionsRef = useRef(options)
  optionsRef.current = options
  const activeRef = useRef(active)
  activeRef.current = active

  const paint = useCallback(() => {
    const root = rootRef.current
    if (!root || !activeRef.current) {
      setIslands([])
      return
    }
    setIslands(collectNoteWidgetIslands(root, optionsRef.current))
  }, [rootRef])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      setIslands([])
      return
    }
    const stop = registerSurface(root, { paint })
    if (active) paint()
    else setIslands([])
    return stop
  }, [active, paint, rootRef, token])

  const onConfigChangeRef = useRef(options?.onConfigChange)
  onConfigChangeRef.current = options?.onConfigChange
  const persistCache = useRef(new WeakMap<HTMLElement, (next: NoteWidgetConfig) => void>())
  const persistFor = useCallback((host: HTMLElement) => {
    if (!onConfigChangeRef.current) return undefined
    const cached = persistCache.current.get(host)
    if (cached) return cached
    const persist = (next: NoteWidgetConfig) => {
      const encoded = encodeWidgetConfigAttr(next)
      if (encoded) host.dataset.config = encoded
      else delete host.dataset.config
      onConfigChangeRef.current?.(host, next)
    }
    persistCache.current.set(host, persist)
    return persist
  }, [])

  const portals = islands.map((island) =>
    createPortal(
      <NoteWidgetSlot
        host={island.host}
        type={island.type}
        size={island.size}
        instanceConfig={island.instanceConfig}
        catalog={catalog}
        missingLabel={missing}
        editable={island.editable}
        onConfigChange={persistFor(island.host)}
      />,
      island.face,
      island.key,
    ),
  )

  return { portals, refresh: paint }
}
