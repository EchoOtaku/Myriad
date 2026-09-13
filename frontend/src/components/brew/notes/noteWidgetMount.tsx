/**
 * 正文小组件：占位壳只带 data-widget / data-size / data-config，React 挂在内部 face 上。
 * 换 innerHTML 必须走 replaceNoteHtml，避免 root 留在被扔掉的节点上。
 *
 * 岛是独立 createRoot，不在 App 的路由树上。报告卡 / 友链 / Tapp 快捷方式
 * 一挂就 useNavigate，没 Router 会整岛空白。
 */

import type { WidgetSize, WidgetType } from '../../widgetGridTypes'
import type { ErrorInfo, ReactNode } from 'react'
import { Component, Suspense, useLayoutEffect, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { useI18n } from '../../../contexts/I18nContext'
import useTappWidgets from '../../../hooks/useTappWidgets'
import { widgetHostConfig, widgetPreviewConfig } from '../../widgetLibraryModel'
import { getBuiltinWidgets } from '../../widgets/builtinWidgets'
import {
  decodeWidgetConfigAttr,
  encodeWidgetConfigAttr,
  serializeWidgetConfigJson,
  type NoteWidgetConfig,
} from './noteLayout'
import { NOTE_WIDGET_FACE } from './noteWidgetHtml'

export { hasNoteWidgetMarkup, NOTE_WIDGET_FACE } from './noteWidgetHtml'

const roots = new WeakMap<HTMLElement, Root>()
const signatures = new WeakMap<HTMLElement, string>()

export type NoteWidgetHydrateOptions = {
  editable?: boolean
  onConfigChange?: (host: HTMLElement, config: NoteWidgetConfig) => void
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

function NoteWidgetSlot({
  type,
  size,
  instanceConfig,
  catalog,
  missingLabel,
  editable,
  onConfigChange,
}: {
  type: string
  size: string
  instanceConfig: NoteWidgetConfig | null
  catalog: WidgetType[]
  missingLabel: string
  editable?: boolean
  onConfigChange?: (config: NoteWidgetConfig) => void
}) {
  const widgetType = catalog.find((entry) => entry.id === type)
  if (!widgetType) {
    return <div className="note-widget__missing">{missingLabel}</div>
  }
  const WidgetComponent = widgetType.component
  const config = {
    ...widgetPreviewConfig(widgetType),
    size: (size as WidgetSize) || widgetType.defaultSize,
    config: {
      ...widgetHostConfig(widgetType.id),
      ...instanceConfig,
    },
  }
  return (
    <MemoryRouter>
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
    </MemoryRouter>
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

export function unmountNoteWidgets(root: HTMLElement): void {
  for (const host of root.querySelectorAll<HTMLElement>('.note-widget')) {
    const mounted = roots.get(host)
    if (!mounted) continue
    mounted.unmount()
    roots.delete(host)
    signatures.delete(host)
  }
}

/** 先卸再写。不要对已水合的根直接赋 innerHTML。 */
export function replaceNoteHtml(root: HTMLElement, html: string): void {
  unmountNoteWidgets(root)
  root.innerHTML = html
}

export function mountNoteWidgets(
  root: HTMLElement,
  catalog: WidgetType[],
  missingLabel: string,
  options?: NoteWidgetHydrateOptions,
): void {
  const catalogKey = catalog.map((entry) => entry.id).join(',')
  for (const host of root.querySelectorAll<HTMLElement>('.note-widget')) {
    const type = host.dataset.widget ?? ''
    const size = host.dataset.size ?? '2x2'
    if (!type) continue
    host.classList.add('not-prose')
    const instanceConfig = decodeWidgetConfigAttr(host.dataset.config)
    const editable = Boolean(
      options?.editable && host.classList.contains('is-selected'),
    )
    const signature = `${type}:${size}:${serializeWidgetConfigJson(instanceConfig) ?? ''}:${editable ? 'edit' : 'view'}:${missingLabel}:${catalogKey}`
    const existing = roots.get(host)
    if (existing && signatures.get(host) === signature) continue
    if (existing) {
      existing.unmount()
      roots.delete(host)
      signatures.delete(host)
    }
    const persistConfig = options?.onConfigChange
      ? (next: NoteWidgetConfig) => {
          const encoded = encodeWidgetConfigAttr(next)
          if (encoded) host.dataset.config = encoded
          else delete host.dataset.config
          options.onConfigChange?.(host, next)
        }
      : undefined
    const face = widgetFace(host)
    const mounted = createRoot(face)
    roots.set(host, mounted)
    mounted.render(
      <NoteWidgetSlot
        type={type}
        size={size}
        instanceConfig={instanceConfig}
        catalog={catalog}
        missingLabel={missingLabel}
        editable={editable}
        onConfigChange={persistConfig}
      />,
    )
    signatures.set(host, signature)
  }
}

export function useNoteWidgetCatalog(enabled = true): WidgetType[] {
  const { t } = useI18n()
  const builtins = useMemo(
    () => (enabled ? getBuiltinWidgets(t.widgets, 'note') : []),
    [enabled, t.widgets],
  )
  const { tappWidgets } = useTappWidgets(enabled)
  return useMemo(() => [...builtins, ...tappWidgets], [builtins, tappWidgets])
}

/**
 * token 变了只补挂新占位，不整树卸载。
 * 切走 / 卸载才卸。写入 HTML 用 replaceNoteHtml。
 */
export function useNoteWidgetHydration(
  rootRef: React.RefObject<HTMLElement | null>,
  catalog: WidgetType[],
  token: string,
  active: boolean,
  options?: NoteWidgetHydrateOptions,
): void {
  const { t } = useI18n()
  const missing = t.brew.noteWidgetMissing
  const onConfigChange = options?.onConfigChange
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (!active) {
      unmountNoteWidgets(root)
      return
    }
    mountNoteWidgets(root, catalog, missing, {
      editable: options?.editable,
      onConfigChange,
    })
  }, [active, catalog, missing, onConfigChange, options?.editable, rootRef, token])

  useLayoutEffect(() => {
    return () => {
      const root = rootRef.current
      if (root) unmountNoteWidgets(root)
    }
  }, [rootRef])
}
